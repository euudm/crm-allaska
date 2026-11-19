const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');

const app = express();
const PORT = 5010;
const DATA_FILE = path.join(__dirname, 'dados', 'pipeline.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!fs.existsSync(path.join(__dirname, 'dados'))) {
  fs.mkdirSync(path.join(__dirname, 'dados'), { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ cards: [] }, null, 2));
}

function load() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/pipeline', (req, res) => res.json(load()));

app.post('/api/cards', (req, res) => {
  const data = load();
  const card = {
    id: Date.now().toString(),
    coluna: req.body.coluna || 'lead',
    nome: req.body.nome || '',
    empresa: req.body.empresa || '',
    telefone: req.body.telefone || '',
    email: req.body.email || '',
    valor: req.body.valor || '',
    notas: req.body.notas || '',
    criado: new Date().toISOString()
  };
  data.cards.push(card);
  save(data);
  res.json(card);
});

app.put('/api/cards/:id', (req, res) => {
  const data = load();
  const idx = data.cards.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'não encontrado' });
  data.cards[idx] = { ...data.cards[idx], ...req.body };
  save(data);
  res.json(data.cards[idx]);
});

app.delete('/api/cards/:id', (req, res) => {
  const data = load();
  data.cards = data.cards.filter(c => c.id !== req.params.id);
  // Card do prospector excluído pelo Diego: guarda quando, senão o vigia recria na próxima rodada.
  if (req.params.id.startsWith('zap-')) {
    data.removidos = data.removidos || {};
    data.removidos[req.params.id.slice(4)] = new Date().toISOString();
  }
  save(data);
  res.json({ ok: true });
});

// ── PROSPECTOR (ALLASKA/prospector) ─────────────────────────────
// O vigia do WhatsApp do Kaptar manda aqui cada lead que respondeu. Id fixo "zap-<telefone>":
// mandar de novo só atualiza. A coluna só é definida quando o card nasce (ou com forcarColuna),
// pra não puxar de volta um card que o Diego arrastou.
app.post('/api/prospector/card', (req, res) => {
  const b = req.body || {};
  const tel = String(b.tel || '').replace(/\D/g, '');
  if (!tel) return res.status(400).json({ error: 'sem telefone' });
  const data = load();
  const id = `zap-${tel}`;
  // Excluído pelo Diego: só volta se o lead mandou mensagem DEPOIS da exclusão.
  const removidoEm = (data.removidos || {})[tel];
  if (removidoEm) {
    const voltou = b.quemFalouPorUltimo === 'lead' && b.ultimaRespostaEm && b.ultimaRespostaEm > removidoEm;
    if (!voltou) return res.json({ id, ignorado: 'excluído pelo Diego' });
    delete data.removidos[tel];
  }
  let card = data.cards.find(c => c.id === id);
  const dados = {
    origem: 'kaptar', nome: b.nome || tel, empresa: [b.nicho, b.cidade].filter(Boolean).join(' · '),
    telefone: tel, previa: b.previa || '', quemFalouPorUltimo: b.quemFalouPorUltimo || '', tipo: b.tipo || '',
    respondeuEm: b.respondeuEm || '', contatadoEm: b.contatadoEm || '', instagram: b.instagram || '', mapsUrl: b.mapsUrl || '',
    cidade: b.cidade || '', aviso: b.aviso || '', siteUrl: b.siteUrl || (card && card.siteUrl) || '',
  };
  if (!card) {
    card = { id, coluna: b.coluna || 'respondeu', email: '', valor: '', notas: '', criado: new Date().toISOString(), ...dados };
    data.cards.push(card);
  } else {
    Object.assign(card, dados);
    if (b.forcarColuna && b.coluna) card.coluna = b.coluna;
  }
  save(data);
  res.json(card);
});

// Botão "Responder" do card: resposta padrão do roteiro e envio pelo WhatsApp do Kaptar (prospector/lib/manual.mjs).
// Só envia com clique do Diego. Sem "?t=": o módulo precisa ser o mesmo pra trava de um envio por vez valer.
const manual = () => import(require('url').pathToFileURL(path.join(__dirname, '..', 'prospector', 'lib', 'manual.mjs')).href);

app.get('/api/prospector/resposta/:tel', async (req, res) => {
  try { res.json((await manual()).respostaPadrao(req.params.tel)); }
  catch (e) { res.status(500).json({ error: 'prospector indisponível: ' + e.message }); }
});

app.post('/api/prospector/enviar', async (req, res) => {
  const tel = String((req.body || {}).tel || '').replace(/\D/g, '');
  const mensagens = ((req.body || {}).mensagens || []).map(s => String(s).trim()).filter(Boolean);
  if (!tel || !mensagens.length) return res.status(400).json({ error: 'sem telefone ou sem mensagem' });
  try {
    const m = await manual();
    // Kaptar disparando uma leva: não digita junto com ele. Guarda e sai quando a leva terminar.
    if (m.kaptarDisparando()) {
      const pos = m.enfileirar(tel, mensagens);
      marcarCardEnviado(tel, null, `Na fila (${pos}º): sai sozinha quando a leva do Kaptar terminar. Clicou em ${new Date().toLocaleString('pt-BR')}.`);
      return res.json({ ok: true, fila: pos });
    }
    await m.enviarManual(tel, mensagens);
    marcarCardEnviado(tel, mensagens, `Você respondeu pelo CRM em ${new Date().toLocaleString('pt-BR')}.`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Atualiza o card depois de um envio (mensagens) ou só o aviso (mensagens = null). */
function marcarCardEnviado(tel, mensagens, aviso) {
  const data = load();
  const card = data.cards.find(c => c.id === `zap-${tel}`);
  if (!card) return;
  if (mensagens) Object.assign(card, { previa: mensagens[mensagens.length - 1], quemFalouPorUltimo: 'nos' });
  card.aviso = aviso;
  save(data);
}

// A cada 20 s: resposta que ficou na fila (Kaptar estava disparando) sai quando ele termina.
setInterval(async () => {
  try {
    await (await manual()).processarFila((item, erro) => {
      if (erro) marcarCardEnviado(item.tel, null, `A resposta da fila NÃO saiu: ${erro.message}. Responda de novo.`);
      else marcarCardEnviado(item.tel, item.mensagens, `Resposta da fila enviada em ${new Date().toLocaleString('pt-BR')} (a leva do Kaptar tinha terminado).`);
      console.log(`[FILA] ${item.tel}: ${erro ? 'falhou: ' + erro.message : 'enviada'}`);
    });
  } catch (e) { console.log('[FILA] erro:', e.message); }
}, 20000);

// ── Faixa de etapas + PARAR TUDO ──
// A etapa 1 (Kaptar chamou) vem do arquivo de campanha do Kaptar; as outras o navegador conta pelos cards.
const PROSPECTOR_DADOS = path.join(__dirname, '..', 'prospector', 'dados');
const ARQ_PARADO = path.join(PROSPECTOR_DADOS, 'PARADO');
const ARQ_CAMPANHA = path.join(process.env.APPDATA || '', 'Kaptar', 'leads', 'campanha.json');
const lerJsonSeguro = (arq) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return null; } };
const { execFile } = require('child_process');
const kaptarAberto = () => new Promise(ok => execFile('tasklist', ['/FI', 'IMAGENAME eq Kaptar.exe', '/NH'], { windowsHide: true },
  (err, out) => ok(!err && /Kaptar\.exe/i.test(out || ''))));

app.get('/api/prospector/status', async (req, res) => {
  const c = lerJsonSeguro(ARQ_CAMPANHA) || {};
  const hoje = new Date().toLocaleDateString('sv-SE');
  let vigiaOk = false;
  try { vigiaOk = Date.now() - fs.statSync(path.join(PROSPECTOR_DADOS, 'estado.json')).mtimeMs < 5 * 60e3; } catch {}
  let parado = null;
  try { parado = fs.readFileSync(ARQ_PARADO, 'utf8') || 'parado'; } catch {}
  res.json({
    parado, vigiaOk, kaptarAberto: await kaptarAberto(),
    campanha: {
      situacao: c.situacao || '', nome: (c.automacao && c.automacao.nome) || '',
      enviadosHoje: c.dia === hoje ? (c.enviadosHoje || 0) : 0,
      alvos: c.dia === hoje ? (c.alvos || []).length : 0,
    },
  });
});

// Levas de disparo (cada vez que o Kaptar dispara): o CRM filtra cards e etapas por leva.
app.get('/api/prospector/levas', async (req, res) => {
  try {
    const mod = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'prospector', 'lib', 'levas.mjs')).href + `?t=${Date.now()}`);
    res.json(mod.calcularLevas(Number(req.query.dias) || 7));
  } catch (e) {
    res.status(500).json({ error: 'prospector indisponível: ' + e.message });
  }
});

// ── Botão COMEÇAR: dispara uma leva pela automação do Kaptar (o mesmo "enviar agora" da tela dele) ──
const comandoKaptar = () => import(require('url').pathToFileURL(path.join(__dirname, '..', 'prospector', 'lib', 'kaptar-comando.mjs')).href);

app.get('/api/prospector/automacoes', async (req, res) => {
  try {
    const k = await comandoKaptar();
    // abre a janela já com a saudação certa pro horário (bom dia / boa tarde / boa noite)
    try { await k.acertarSaudacoes(); } catch (e) { console.log('[SAUDAÇÃO] não acertei:', e.message); }
    res.json(await k.listarAutomacoes());
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/prospector/automacoes/:id/fila', async (req, res) => {
  try { res.json(await (await comandoKaptar()).filaDe(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Troca a mensagem da automação (só as variações; o resto fica igual). Não mexe com o Kaptar disparando.
app.put('/api/prospector/automacoes/:id/mensagens', async (req, res) => {
  try {
    const c = lerJsonSeguro(ARQ_CAMPANHA) || {};
    if (c.situacao === 'rodando') return res.status(409).json({ error: 'o Kaptar está disparando agora: espere a leva terminar pra trocar a mensagem' });
    await (await comandoKaptar()).trocarMensagens(req.params.id, (req.body || {}).mensagens);
    console.log(`[MENSAGEM] ${new Date().toLocaleString('pt-BR')} automação ${req.params.id}: ${JSON.stringify((req.body || {}).mensagens)}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/prospector/comecar', async (req, res) => {
  const id = String((req.body || {}).id || '');
  if (!id) return res.status(400).json({ error: 'escolha a automação' });
  if (fs.existsSync(ARQ_PARADO)) return res.status(409).json({ error: 'PARAR TUDO está ativo: clique em Retomar antes de começar' });
  try {
    const k = await comandoKaptar();
    // última conferida da saudação antes de disparar (se falhar, NÃO começa: melhor que mandar errado)
    await k.acertarSaudacoes();
    const r = await k.comecarDisparo(id);
    console.log(`[COMEÇAR] ${new Date().toLocaleString('pt-BR')} automação ${id}: ${r.ok ? 'começou' : 'recusada: ' + r.motivo}`);
    if (!r.ok) return res.status(409).json({ error: r.motivo });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PARAR TUDO: trava todo envio do prospector (arquivo PARADO), pede pro Kaptar parar a campanha
// (o mesmo botão de parar dele) e depois fecha o Kaptar, pra garantir.
app.post('/api/prospector/parar', async (req, res) => {
  fs.writeFileSync(ARQ_PARADO, new Date().toISOString());
  try { await (await comandoKaptar()).pararDisparo(); } catch { /* Kaptar já fechado ou travado: o taskkill resolve */ }
  execFile('taskkill', ['/IM', 'Kaptar.exe', '/F', '/T'], { windowsHide: true }, (err, out, errOut) => {
    const fechou = !err;
    console.log(`[PARAR TUDO] ${new Date().toLocaleString('pt-BR')} prospector travado; Kaptar ${fechou ? 'fechado' : 'já estava fechado'}`);
    res.json({ ok: true, kaptarFechado: fechou });
  });
});

// Retomar: só destrava o prospector. O Kaptar o Diego abre de novo à mão (de propósito).
app.post('/api/prospector/retomar', (req, res) => {
  try { fs.unlinkSync(ARQ_PARADO); } catch {}
  console.log(`[RETOMAR] ${new Date().toLocaleString('pt-BR')} prospector destravado`);
  res.json({ ok: true });
});

// Placar de resposta (calculado pelo prospector a partir dos arquivos dele e do Kaptar)
app.get('/api/placar', async (req, res) => {
  try {
    const { pathToFileURL } = require('url');
    const mod = await import(pathToFileURL(path.join(__dirname, '..', 'prospector', 'placar.mjs')).href + `?t=${Date.now()}`);
    res.json(mod.calcular(Number(req.query.dias) || 30));
  } catch (e) {
    res.status(500).json({ error: 'prospector indisponível: ' + e.message });
  }
});

const TOOL_BATS = {
  prospeccao:    'C:\\Users\\diego\\OneDrive\\Desktop\\ALLASKA\\ALLASKA-Sistemas\\sistemas\\prospeccao\\iniciar.bat',
  rastreamento:  'C:\\Users\\diego\\OneDrive\\Desktop\\ALLASKA\\ALLASKA-Sistemas\\sistemas\\rastreamento-concorrencia\\abrir.bat',
  proposta:      'C:\\Users\\diego\\OneDrive\\Desktop\\ALLASKA\\ALLASKA-Sistemas\\sistemas\\gerador-proposta\\abrir.bat',
  avaliacao:     'C:\\Users\\diego\\OneDrive\\Desktop\\ALLASKA\\ALLASKA-Sistemas\\sistemas\\gerador-avaliacao\\abrir.bat',
  carrossel:     'C:\\Users\\diego\\OneDrive\\Desktop\\ALLASKA\\ALLASKA-Sistemas\\sistemas\\gerador-carrossel\\abrir.bat',
  monitor:       'C:\\Users\\diego\\OneDrive\\Desktop\\ALLASKA\\ALLASKA-Sistemas\\sistemas\\monitor-reputacao\\iniciar.bat',
};

app.post('/api/tools/launch/:tool', (req, res) => {
  const bat = TOOL_BATS[req.params.tool];
  if (!bat) return res.status(404).json({ error: 'Ferramenta não encontrada' });
  const { spawn } = require('child_process');
  const toolDir = path.dirname(bat);
  const proc = spawn('cmd.exe', ['/c', bat], {
    cwd: toolDir,
    detached: true,
    windowsHide: false,
    stdio: 'ignore',
  });
  proc.unref();
  res.json({ ok: true });
});

app.get('/api/tools/status', (req, res) => {
  const tools = [
    { id: 'prospeccao', port: 5000 },
    { id: 'rastreamento', port: 5001 },
    { id: 'proposta', port: 5002 },
    { id: 'avaliacao', port: 5003 },
    { id: 'carrossel', port: 5004 },
    { id: 'monitor', port: 5005 },
  ];

  Promise.all(tools.map(t => new Promise(resolve => {
    const req = http.get({ hostname: 'localhost', port: t.port, path: '/', timeout: 1000 }, () => {
      resolve({ id: t.id, ativo: true });
    });
    req.on('error', () => resolve({ id: t.id, ativo: false }));
    req.on('timeout', () => { req.destroy(); resolve({ id: t.id, ativo: false }); });
  }))).then(statuses => res.json(statuses));
});

app.listen(PORT, () => {
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║         ALLASKA CRM — Online         ║');
  console.log(`  ║   http://localhost:${PORT}              ║`);
  console.log('  ╚══════════════════════════════════════╝\n');
  // SEM_ABRIR=1: sobe sem abrir o navegador (testes, ou quando o prospector liga o CRM em segundo plano)
  if (!process.env.SEM_ABRIR) require('child_process').exec(`start http://localhost:${PORT}`);
});
