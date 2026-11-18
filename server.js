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
