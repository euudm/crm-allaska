const COLUNAS = [
  { id: 'lead',       label: 'Lead',             cor: '#7c6ff7' },
  { id: 'contato',    label: 'Contato feito',    cor: '#00b4ff' },
  // colunas do prospector (WhatsApp do Kaptar)
  { id: 'respondeu',  label: 'Respondeu',        cor: '#4fd1c5' },
  { id: 'comvoce',    label: 'É com você',       cor: '#ff6b9a' },
  { id: 'site',       label: 'Site pronto',      cor: '#a3e635' },
  { id: 'proposta',   label: 'Proposta enviada', cor: '#ff9f43' },
  { id: 'negociando', label: 'Negociando',       cor: '#ffd32a' },
  { id: 'fechado',    label: 'Fechado',          cor: '#0be881' },
  { id: 'perdido',    label: 'Perdido',          cor: '#ff5e57' },
];

let cards = [];
let draggedId = null;
let editingId = null;
let searchQuery = '';

// ── API ──────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ── LOAD & RENDER ────────────────────────────────────────────
// Só redesenha quando algo mudou: o quadro atualiza a cada 10 s e não pode ficar piscando nem pular a rolagem.
let assinaturaQuadro = '';
async function load() {
  const data = await api('GET', '/api/pipeline');
  const novos = data.cards || [];
  const assinatura = JSON.stringify(novos);
  if (assinatura === assinaturaQuadro) return;
  assinaturaQuadro = assinatura;
  cards = novos;
  render();
  updateStats();
  renderLevas();
  renderEtapas();
}

function render() {
  const kanban = document.getElementById('kanban');
  // guarda a rolagem (do quadro e de cada coluna) pra devolver depois de redesenhar
  const rolX = kanban.scrollLeft, rolY = {};
  kanban.querySelectorAll('.col-cards').forEach(c => { rolY[c.dataset.coluna] = c.scrollTop; });
  kanban.innerHTML = '';

  const q = searchQuery.toLowerCase();
  const base = cardsDaLeva();
  const visible = q
    ? base.filter(c => (c.nome + c.empresa + c.email + c.telefone).toLowerCase().includes(q))
    : base;

  COLUNAS.forEach(col => {
    const colCards = visible.filter(c => c.coluna === col.id);

    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.coluna = col.id;
    colEl.innerHTML = `
      <div class="col-header">
        <div class="col-title">
          <span class="col-dot" style="background:${col.cor}"></span>
          ${col.label}
        </div>
        <span class="col-count">${colCards.length}</span>
      </div>
      <div class="col-cards" data-coluna="${col.id}">
        ${colCards.length === 0 ? '<div class="col-empty">Nenhum lead aqui</div>' : ''}
        ${colCards.map(renderCard).join('')}
      </div>
      <button class="col-add" data-coluna="${col.id}">+ Adicionar</button>
    `;
    kanban.appendChild(colEl);
  });

  kanban.scrollLeft = rolX;
  kanban.querySelectorAll('.col-cards').forEach(c => { if (rolY[c.dataset.coluna]) c.scrollTop = rolY[c.dataset.coluna]; });

  // Drag & drop via delegation no kanban: liga UMA vez só (render roda de novo a cada atualização
  // e, antes, cada render empilhava mais um listener: um arrastar virava vários PUT)
  if (!kanban.dataset.ligado) { kanban.dataset.ligado = '1'; ligarArrastar(kanban); }
  ligarCards();
}

// Arrastando um card perto da borda, o quadro rola sozinho pra aquele lado (mais perto = mais rápido).
const rolagem = { v: 0, raf: 0 };
function rolarArrastando(kanban, x) {
  const r = kanban.getBoundingClientRect();
  const zona = Math.min(220, r.width * 0.22);
  let f = 0;
  if (x > r.right - zona) f = (x - (r.right - zona)) / zona;
  else if (x < r.left + zona) f = -((r.left + zona - x) / zona);
  rolagem.v = Math.sign(f) * (4 + Math.pow(Math.min(1, Math.abs(f)), 1.6) * 30);
  if (!f) rolagem.v = 0;
  if (rolagem.v && !rolagem.raf) {
    const passo = () => {
      if (!rolagem.v) { rolagem.raf = 0; return; }
      kanban.scrollLeft += rolagem.v;
      rolagem.raf = requestAnimationFrame(passo);
    };
    rolagem.raf = requestAnimationFrame(passo);
  }
}
const pararRolagem = () => { rolagem.v = 0; };

// Rodinha do mouse em cima do quadro rola pros lados. Sentido pedido pelo Diego: pra cima = direita,
// pra baixo = esquerda (trocar pra 1 inverte). Em cima de coluna comprida, rola a coluna primeiro e,
// no fim dela, passa pro quadro. Trackpad de lado e Ctrl+rodinha (zoom) ficam com o navegador.
const RODINHA_SENTIDO = -1;
function ligarRodinha(kanban) {
  let alvoX = null, raf = 0;
  kanban.addEventListener('wheel', e => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const col = e.target.closest('.col-cards');
    if (col && col.scrollHeight > col.clientHeight + 1) {
      const podeDescer = col.scrollTop + col.clientHeight < col.scrollHeight - 1;
      const podeSubir = col.scrollTop > 0;
      if ((e.deltaY > 0 && podeDescer) || (e.deltaY < 0 && podeSubir)) return;
    }
    e.preventDefault();
    const passo = (e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY) * RODINHA_SENTIDO;
    const max = kanban.scrollWidth - kanban.clientWidth;
    alvoX = Math.max(0, Math.min(max, (alvoX === null ? kanban.scrollLeft : alvoX) + passo));
    if (!raf) {
      const anda = () => {
        const d = alvoX - kanban.scrollLeft;
        if (Math.abs(d) < 1) { kanban.scrollLeft = alvoX; alvoX = null; raf = 0; return; }
        kanban.scrollLeft += d * 0.22;
        raf = requestAnimationFrame(anda);
      };
      raf = requestAnimationFrame(anda);
    }
  }, { passive: false });
}

// "11959737257" -> "(11) 95973-7257"
function formatarTel(t) {
  const d = String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

function ligarArrastar(kanban) {
  ligarRodinha(kanban);
  kanban.addEventListener('dragover', e => {
    e.preventDefault();
    if (draggedId) rolarArrastando(kanban, e.clientX);
    const target = e.target.closest('.col-cards');
    document.querySelectorAll('.col-cards.drag-over').forEach(el => {
      if (el !== target) el.classList.remove('drag-over');
    });
    if (target) target.classList.add('drag-over');
  });

  kanban.addEventListener('dragleave', e => {
    if (!kanban.contains(e.relatedTarget)) {
      pararRolagem();
      document.querySelectorAll('.col-cards.drag-over').forEach(el => el.classList.remove('drag-over'));
    }
  });

  kanban.addEventListener('drop', async e => {
    e.preventDefault();
    pararRolagem();
    document.querySelectorAll('.col-cards.drag-over').forEach(el => el.classList.remove('drag-over'));
    const target = e.target.closest('.col-cards');
    if (!target || !draggedId) return;
    const novaColuna = target.dataset.coluna;
    await api('PUT', `/api/cards/${draggedId}`, { coluna: novaColuna });
    draggedId = null;
    await load();
  });
}

function ligarCards() {
  // Card events
  document.querySelectorAll('.card').forEach(el => {
    el.addEventListener('dragstart', () => {
      draggedId = el.dataset.id;
      setTimeout(() => el.classList.add('dragging'), 0);
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); pararRolagem(); });
  });

  document.querySelectorAll('.quick-btn.responder').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); abrirResposta(btn.dataset.id); });
  });

  document.querySelectorAll('.zap-mais').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id, el = btn.closest('.card-zap');
      const abrir = !cardsAbertos.has(id);
      abrir ? cardsAbertos.add(id) : cardsAbertos.delete(id);
      el.classList.toggle('aberto', abrir);
      btn.textContent = abrir ? 'Ver menos' : 'Ver mais';
    });
  });

  document.querySelectorAll('.card-btn.edit').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openModal(btn.dataset.id); });
  });

  document.querySelectorAll('.card-btn.delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Remover este lead do pipeline?')) return;
      await api('DELETE', `/api/cards/${btn.dataset.id}`);
      await load();
    });
  });

  document.querySelectorAll('.col-add').forEach(btn => {
    btn.addEventListener('click', () => openModal(null, btn.dataset.coluna));
  });

  // Badge total
  document.getElementById('total-badge').textContent =
    `${cards.length} lead${cards.length !== 1 ? 's' : ''}`;
}

const TIPO_ZAP = { saudacao: 'respondeu a saudação', nao: 'disse que não', sim: 'disse que pode', audio: 'mandou áudio', duvida: 'fora do roteiro', conversa: 'conversa' };

function quando(iso) {
  if (!iso) return '';
  const d = new Date(iso), hoje = new Date();
  const h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === hoje.toDateString() ? `hoje ${h}` : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${h}`;
}

// Card que veio do prospector: fechado mostra só o nome; "Ver mais" abre a mensagem, o status e os links.
// Quais cards estão abertos fica guardado aqui (o quadro se redesenha a cada minuto).
const cardsAbertos = new Set();

function renderCardZap(card) {
  const vez = card.quemFalouPorUltimo === 'nos' ? 'esperando o lead' : 'lead esperando resposta';
  const aberto = cardsAbertos.has(card.id);
  return `
    <div class="card card-zap ${aberto ? 'aberto' : ''}" draggable="true" data-id="${card.id}" data-coluna="${card.coluna}">
      <div class="card-top">
        <div class="card-identity">
          <div class="card-name" title="${esc(card.nome)}">${esc(/^\+?[\d\s()-]+$/.test(card.nome) ? formatarTel(card.nome) : card.nome)}</div>
          ${(() => {
            const tel = card.telefone && card.nome.replace(/\D/g, '') !== String(card.telefone).replace(/\D/g, '') ? esc(formatarTel(card.telefone)) : '';
            const lv = levaDoTel(card.telefone);
            const tag = lv ? `<span class="card-leva" title="${esc(nomeLeva(lv))}">Leva ${lv.numero}</span>` : '';
            return tel || tag ? `<div class="card-tel">${tel}${tag}</div>` : '';
          })()}
        </div>
        <div class="card-actions">
          <button class="card-btn edit" data-id="${card.id}" title="Editar">✏</button>
          <button class="card-btn delete" data-id="${card.id}" title="Remover">✕</button>
        </div>
      </div>
      <div class="zap-detalhes">
        ${card.empresa ? `<div class="card-empresa">${esc(card.empresa)}</div>` : ''}
        ${card.previa ? `<div class="zap-previa ${card.quemFalouPorUltimo === 'nos' ? 'nossa' : ''}">"${esc(card.previa)}"</div>` : ''}
        <div class="zap-meta">
          ${card.tipo ? `<span class="zap-tipo t-${esc(card.tipo)}">${esc(TIPO_ZAP[card.tipo] || card.tipo)}</span>` : ''}
          <span class="zap-vez">${vez}</span>
        </div>
        ${card.aviso ? `<div class="card-notas">${esc(card.aviso)}</div>` : ''}
        ${card.notas ? `<div class="card-notas">${esc(card.notas)}</div>` : ''}
        <div class="card-footer">
          <span class="card-date">respondeu ${esc(quando(card.respondeuEm))}</span>
          <div class="card-quick">
            ${card.siteUrl ? `<a class="quick-btn" href="${esc(card.siteUrl)}" target="_blank">Ver site</a>` : ''}
            ${card.mapsUrl ? `<a class="quick-btn" href="${esc(card.mapsUrl)}" target="_blank" title="Abrir no Google Maps">Maps</a>` : ''}
            ${card.instagram ? `<a class="quick-btn" href="${esc(card.instagram)}" target="_blank">Insta</a>` : ''}
          </div>
        </div>
      </div>
      <div class="zap-acoes">
        <button class="zap-mais" data-id="${card.id}">${aberto ? 'Ver menos' : 'Ver mais'}</button>
        ${card.quemFalouPorUltimo === 'nos' ? '<span class="zap-ok" title="A última mensagem da conversa é sua">✓ Respondido</span>' : ''}
        <button class="quick-btn responder" data-id="${card.id}" title="Escolher uma resposta pronta e mandar pelo WhatsApp">Responder</button>
      </div>
    </div>
  `;
}

function renderCard(card) {
  if (card.origem === 'kaptar') return renderCardZap(card);
  const dias = Math.floor((Date.now() - new Date(card.criado)) / 86400000);
  const dataStr = dias === 0 ? 'hoje' : dias === 1 ? 'há 1 dia' : `há ${dias} dias`;

  return `
    <div class="card" draggable="true" data-id="${card.id}" data-coluna="${card.coluna}">
      <div class="card-top">
        <div class="card-identity">
          <div class="card-name">${esc(card.nome)}</div>
          ${card.empresa ? `<div class="card-empresa">${esc(card.empresa)}</div>` : ''}
        </div>
        <div class="card-actions">
          <button class="card-btn edit" data-id="${card.id}" title="Editar">✏</button>
          <button class="card-btn delete" data-id="${card.id}" title="Remover">✕</button>
        </div>
      </div>
      <div class="card-info">
        ${card.telefone ? `<div class="card-info-item">📱 ${esc(card.telefone)}</div>` : ''}
        ${card.email ? `<div class="card-info-item">✉ ${esc(card.email)}</div>` : ''}
      </div>
      ${card.valor ? `<div class="card-valor">${esc(card.valor)}</div>` : ''}
      ${card.notas ? `<div class="card-notas">${esc(card.notas)}</div>` : ''}
      <div class="card-footer">
        <span class="card-date">${dataStr}</span>
        <div class="card-quick">
          <a class="quick-btn" href="http://localhost:5002" target="_blank" title="Gerar Proposta">📋 Proposta</a>
          <a class="quick-btn" href="http://localhost:5003" target="_blank" title="Pedir Avaliação">⭐ Avaliação</a>
          <a class="quick-btn" href="http://localhost:5001" target="_blank" title="Ver Concorrentes">🔍</a>
        </div>
      </div>
    </div>
  `;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── STATS ────────────────────────────────────────────────────
function updateStats() {
  const ativos   = cards.filter(c => !['fechado', 'perdido'].includes(c.coluna)).length;
  const nego     = cards.filter(c => c.coluna === 'negociando').length;
  const fechados = cards.filter(c => c.coluna === 'fechado').length;
  document.getElementById('stat-ativos').textContent  = ativos;
  document.getElementById('stat-nego').textContent    = nego;
  document.getElementById('stat-fechados').textContent = fechados;
}

// ── MODAL ────────────────────────────────────────────────────
function openModal(id = null, coluna = 'lead') {
  editingId = id;
  const overlay = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = id ? 'Editar Lead' : 'Novo Lead';
  document.getElementById('btn-salvar').textContent  = id ? 'Salvar alterações' : 'Salvar';

  if (id) {
    const c = cards.find(c => c.id === id);
    if (!c) return;
    document.getElementById('f-nome').value     = c.nome;
    document.getElementById('f-empresa').value  = c.empresa;
    document.getElementById('f-telefone').value = c.telefone;
    document.getElementById('f-email').value    = c.email;
    document.getElementById('f-valor').value    = c.valor;
    document.getElementById('f-coluna').value   = c.coluna;
    document.getElementById('f-notas').value    = c.notas;
  } else {
    document.getElementById('modal-form').reset();
    document.getElementById('f-coluna').value = coluna;
  }

  overlay.classList.remove('hidden');
  setTimeout(() => document.getElementById('f-nome').focus(), 50);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  editingId = null;
}

// ── RESPONDER (prospector) ───────────────────────────────────
// Abre a resposta padrão do roteiro já escrita; o Diego confere/edita e envia pelo WhatsApp do Kaptar.
let respTel = null, respCard = null, respOpcoes = [], respEscolhida = null;
const $ = (id) => document.getElementById(id);

// Qual resposta já vem marcada, pelo que o lead falou por último.
function respostaSugerida(c) {
  if (c.quemFalouPorUltimo === 'nos') return c.siteUrl ? 'cobrar' : 'assunto';
  if (c.tipo === 'sim') return c.siteUrl ? 'link' : 'separar';
  if (c.tipo === 'audio') return 'audio';
  if (c.tipo === 'nao') return 'nao';
  if (c.tipo === 'conversa') return 'gostou';
  return 'assunto';
}

function escolherResposta(id) {
  const o = respOpcoes.find(x => x.id === id) || respOpcoes[0];
  if (!o) return;
  respEscolhida = o.id;
  document.querySelectorAll('#resp-opcoes button').forEach(b => b.classList.toggle('ativo', b.dataset.id === o.id));
  const temLink = /\{link\}/.test(o.texto);
  $('resp-link-grupo').classList.toggle('hidden', !temLink);
  $('resp-antes-grupo').classList.toggle('hidden', !o.antes);
  $('resp-antes').value = o.antes || '';
  const link = $('resp-link').value.trim() || '{link}';
  $('resp-texto').value = o.texto.replace(/\{link\}/g, link);
  if (respCard) respCard._linkNoTexto = link;
  $('resp-erro').textContent = '';
}

async function abrirResposta(id) {
  const c = cards.find(x => x.id === id);
  if (!c) return;
  respCard = c;
  respTel = String(c.telefone || id.replace(/^zap-/, '')).replace(/\D/g, '');
  $('resp-titulo').textContent = `Responder ${c.nome}`;
  $('resp-previa').textContent = c.previa ? `"${c.previa}"` : 'Sem mensagem.';
  $('resp-previa').parentElement.dataset.quem = c.quemFalouPorUltimo === 'nos' ? 'Você falou por último' : 'Ele falou';
  $('resp-opcoes').innerHTML = '';
  $('resp-link').value = c.siteUrl || '';
  $('resp-antes').value = ''; $('resp-texto').value = '';
  $('resp-texto').placeholder = 'Carregando as respostas...';
  $('resp-erro').textContent = '';
  $('resp-enviar').disabled = false; $('resp-enviar').textContent = 'Enviar pelo WhatsApp';
  $('resp-overlay').classList.remove('hidden');
  const r = await api('GET', `/api/prospector/resposta/${respTel}`);
  if (r.error) { $('resp-erro').textContent = r.error; return; }
  respOpcoes = r.opcoes || [{ id: 'assunto', rotulo: 'Apresentação + modelo', antes: r.antes, texto: r.texto }];
  $('resp-opcoes').innerHTML = respOpcoes.map(o => `<button type="button" data-id="${esc(o.id)}">${esc(o.rotulo)}</button>`).join('');
  $('resp-opcoes').querySelectorAll('button').forEach(b => b.addEventListener('click', () => escolherResposta(b.dataset.id)));
  $('resp-texto').placeholder = '';
  escolherResposta(respostaSugerida(c));
}

// Mudou o link do site: troca no texto (se a resposta escolhida usa link).
function atualizarLink() {
  const o = respOpcoes.find(x => x.id === respEscolhida);
  if (!o || !/\{link\}/.test(o.texto)) return;
  const antigo = (respCard && respCard._linkNoTexto) || '{link}';
  const novo = $('resp-link').value.trim() || '{link}';
  $('resp-texto').value = $('resp-texto').value.split(antigo).join(novo);
  if (respCard) respCard._linkNoTexto = novo;
}

function fecharResposta() {
  if ($('resp-enviar').disabled && $('resp-enviar').dataset.enviando) return; // não fecha no meio do envio
  $('resp-overlay').classList.add('hidden');
  respTel = null;
}

async function enviarResposta() {
  const antesVisivel = !$('resp-antes-grupo').classList.contains('hidden');
  const mensagens = [antesVisivel ? $('resp-antes').value : '', $('resp-texto').value].map(s => s.trim()).filter(Boolean);
  if (!mensagens.length) { $('resp-erro').textContent = 'Escreva alguma coisa antes de enviar.'; return; }
  if (mensagens.some(m => m.includes('{link}'))) { $('resp-erro').textContent = 'Falta o link do site: cole no campo "Link do site".'; return; }
  // Link novo digitado aqui: fica salvo no card (aparece o "Ver site").
  const link = $('resp-link').value.trim();
  if (link && respCard && link !== respCard.siteUrl && mensagens.some(m => m.includes(link))) {
    await api('PUT', `/api/cards/${respCard.id}`, { siteUrl: link });
  }
  const btn = $('resp-enviar');
  btn.disabled = true; btn.dataset.enviando = '1';
  btn.textContent = mensagens.length > 1 ? 'Enviando as 2 mensagens...' : 'Enviando...';
  $('resp-erro').textContent = '';
  let r;
  try { r = await api('POST', '/api/prospector/enviar', { tel: respTel, mensagens }); }
  catch (e) { r = { error: 'o CRM não respondeu: ' + e.message }; }
  delete btn.dataset.enviando;
  if (r.error) {
    btn.disabled = false; btn.textContent = 'Tentar de novo';
    $('resp-erro').textContent = 'Não enviou: ' + r.error;
    return;
  }
  fecharResposta();
  showToast(r.fila
    ? `O Kaptar está disparando a leva: a resposta ficou na fila (${r.fila}º) e sai sozinha quando ele terminar.`
    : 'Resposta enviada no WhatsApp.');
  load();
}

// ── PLACAR DE RESPOSTA (prospector) ──────────────────────────
async function carregarPlacar() {
  const el = document.getElementById('placar');
  try {
    const p = await api('GET', `/api/placar?dias=${document.getElementById('placar-dias').value}`);
    if (p.error) throw new Error(p.error);
    const linha = (g) => `<tr><td>${esc(g.grupo)}</td><td>${g.responderam} de ${g.contatados}</td><td><span class="barra-taxa"><i style="width:${Math.min(100, g.taxa)}%"></i></span>${g.taxa}%</td></tr>`;
    const bloco = (titulo, gs, max = 8) => gs.length ? `<div class="placar-bloco"><h4>${titulo}</h4><table>${gs.slice(0, max).map(linha).join('')}</table></div>` : '';
    document.getElementById('placar-total').textContent = `${p.geral.responderam} de ${p.geral.contatados} responderam (${p.geral.taxa}%)`;
    el.querySelector('.placar-corpo').innerHTML =
      bloco('Por dia do envio', p.porDia, 7) + bloco('Por horário', p.porFaixa) + bloco('Por dia da semana', p.porDiaDaSemana) +
      bloco('Por cidade', p.porCidade) + bloco('Por nicho', p.porNicho) + bloco('Por site (conferido)', p.porSite || []) + bloco('Por mensagem', p.porMensagem) +
      (p.diasSemVigia.length ? `<p class="placar-nota">Fora da conta (ninguém lendo o WhatsApp nesses dias): ${p.diasSemVigia.map(d => `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}`).join(', ')}.</p>` : '');
  } catch (e) {
    document.getElementById('placar-total').textContent = 'indisponível';
    el.querySelector('.placar-corpo').innerHTML = `<p class="placar-nota">${esc(e.message)}</p>`;
  }
}

// ── TOOLS STATUS ─────────────────────────────────────────────
const toolStatus = {};

async function checkToolStatus() {
  try {
    const statuses = await api('GET', '/api/tools/status');
    statuses.forEach(s => {
      toolStatus[s.id] = s.ativo;
      const dot = document.getElementById(`dot-${s.id}`);
      if (dot) dot.classList.toggle('ativo', s.ativo);

      const row = document.querySelector(`.tool-row[data-tool="${s.id}"]`);
      if (row) row.classList.toggle('offline', !s.ativo);
    });
  } catch {}
}

function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ── INIT ─────────────────────────────────────────────────────
// Link vindo da ilha / aviso do prospector: localhost:5010/#card=zap-<telefone> rola até o card e acende ele.
function focarCardDoLink() {
  const m = /#card=([\w-]+)/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  const el = document.querySelector(`.card[data-id="${CSS.escape(m[1])}"]`);
  if (!el) { showToast('Esse card não está mais no quadro.'); return; }
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  el.classList.add('card-foco');
  setTimeout(() => el.classList.remove('card-foco'), 4000);
}

// ── LEVAS DE DISPARO ────────────────────────────────────────────
// Cada vez que o Kaptar dispara vira uma leva (prospector/lib/levas.mjs). Escolher uma leva filtra
// o quadro e a faixa de etapas só pra ela; "Todas" junta tudo. A escolha fica salva no navegador.
let levas = [];
let levaSel = (() => { try { return localStorage.getItem('levaSel') || 'todas'; } catch { return 'todas'; } })();
const telDig = (t) => String(t || '').replace(/\D/g, '');

const levaAtual = () => levas.find(l => l.id === levaSel) || null;
const levaDoTel = (tel) => { const t = telDig(tel); return levas.find(l => l.tels.includes(t)) || null; };
function nomeLeva(l) {
  return `Leva ${l.numero} · ${quando(l.inicio)}${l.cidades.length ? ' · ' + l.cidades.join(', ') : ''}`;
}
/** Cards visíveis na leva escolhida (em "Todas", tudo; numa leva, só os leads dela). */
function cardsDaLeva() {
  const l = levaAtual();
  if (!l) return cards;
  return cards.filter(c => l.tels.includes(telDig(c.telefone)) && String(c.id).startsWith('zap-'));
}

async function carregarLevas() {
  try { levas = await api('GET', '/api/prospector/levas?dias=7'); } catch { levas = []; }
  if (!Array.isArray(levas)) levas = [];
  if (levaSel !== 'todas' && !levaAtual()) levaSel = 'todas';
  renderLevas();
  render();
  renderEtapas();
}

function escolherLeva(id) {
  levaSel = id;
  try { localStorage.setItem('levaSel', id); } catch {}
  renderLevas(); render(); renderEtapas();
}

function renderLevas() {
  const esperandoNa = (l) => cards.filter(c => l.tels.includes(telDig(c.telefone)) && c.quemFalouPorUltimo === 'lead' && !['perdido', 'fechado'].includes(c.coluna)).length;
  const chip = (id, titulo, sub, extra = '') => `<button type="button" class="leva-chip${levaSel === id ? ' sel' : ''}${extra}" data-leva="${esc(id)}">
      <b>${titulo}</b><small>${sub}</small></button>`;
  const total = levas.reduce((s, l) => s + l.chamados, 0);
  $('levas-lista').innerHTML = chip('todas', 'Todas', `${levas.length} levas · ${total} chamados (7 dias)`) + levas.map(l => {
    const esp = esperandoNa(l);
    const hora = new Date(l.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const dia = new Date(l.inicio).toDateString() === new Date().toDateString() ? 'hoje' : new Date(l.inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return chip(l.id,
      `${l.emAndamento ? '<i class="leva-viva" title="disparando agora"></i>' : ''}Leva ${l.numero} · ${dia} ${hora}`,
      `${esc(l.cidades[0] || 'sem cidade')} · ${l.chamados} chamados · ${l.responderam} resp.${esp ? ` · <em>${esp} esperando</em>` : ''}`,
      esp ? ' tem-espera' : '');
  }).join('');
}

// ── ETAPAS DA OPERAÇÃO + PARAR TUDO ─────────────────────────────
// 1 Kaptar chamou (arquivo de campanha do Kaptar)  2 Respondeu  3 Quer ver o site  4 Proposta (pelos cards)
let statusOp = null;
async function carregarStatus() {
  try { statusOp = await api('GET', '/api/prospector/status'); } catch { statusOp = null; }
  renderEtapas();
}

function renderEtapas() {
  const zap = cardsDaLeva().filter(c => String(c.id).startsWith('zap-'));
  const leva = levaAtual();
  const vivos = zap.filter(c => c.coluna !== 'perdido');
  const esperando = vivos.filter(c => c.quemFalouPorUltimo === 'lead' && c.coluna !== 'fechado').length;
  const querSite = vivos.filter(c => c.tipo === 'sim' || c.coluna === 'site' || c.siteUrl);
  const comSite = querSite.filter(c => c.siteUrl).length;
  const proposta = vivos.filter(c => ['proposta', 'negociando', 'fechado'].includes(c.coluna));
  const fechados = proposta.filter(c => c.coluna === 'fechado').length;

  const s = statusOp || {}, camp = s.campanha || {};
  const rodando = !s.parado && s.kaptarAberto && camp.situacao === 'rodando';
  const sub1 = s.parado ? 'parado' : !statusOp ? 'sem status' : !s.kaptarAberto ? 'Kaptar fechado'
    : rodando ? `disparando agora${camp.nome ? ' · ' + camp.nome : ''}` : 'campanha parada';

  const etapas = [
    // Etapa 1 no mesmo período das outras: a leva escolhida, ou (em "Todas") as levas dos últimos 3 dias,
    // que é a janela em que o lead que respondeu tem card. Antes era "hoje" e o % entre 1 e 2 misturava períodos.
    leva
      ? { n: 1, nome: 'Kaptar chamou', valor: leva.chamados, sub: leva.emAndamento ? 'disparando agora' : `leva de ${quando(leva.inicio)}`, ativa: leva.emAndamento }
      : { n: 1, nome: 'Kaptar chamou', valor: levas.filter(l => Date.now() - new Date(l.fim) < 3 * 86400000).reduce((s, l) => s + l.chamados, 0), sub: `3 dias · ${sub1}`, ativa: rodando },
    { n: 2, nome: 'Respondeu', valor: zap.length, sub: esperando ? `${esperando} esperando você` : 'ninguém esperando', ativa: esperando > 0, alerta: esperando > 0 },
    { n: 3, nome: 'Quer ver o site', valor: querSite.length, sub: querSite.length ? `${comSite} com site pronto` : 'nenhum ainda', ativa: querSite.length > comSite },
    { n: 4, nome: 'Proposta', valor: proposta.length, sub: fechados ? `${fechados} fechado(s)` : 'nenhum fechado', ativa: false },
  ];
  // barra entre as etapas = quanto passou de uma pra outra
  const pct = (a, b) => (a ? Math.min(100, Math.round(b / a * 100)) : 0);
  $('etapas-trilha').innerHTML = etapas.map((e, i) => {
    const prox = etapas[i + 1];
    const liga = prox ? `<li class="etapa-liga" title="${pct(e.valor, prox.valor)}% passaram pra próxima etapa">
        <span class="etapa-barra"><i style="width:${pct(e.valor, prox.valor)}%"></i></span>
        <small>${e.valor ? pct(e.valor, prox.valor) + '%' : ''}</small></li>` : '';
    return `<li class="etapa${e.valor ? ' feita' : ''}${e.ativa ? ' ativa' : ''}${e.alerta ? ' alerta' : ''}">
        <span class="etapa-num">${e.n}</span>
        <span class="etapa-txt"><b>${e.nome}</b><em>${esc(e.sub)}</em></span>
        <span class="etapa-valor">${e.valor}</span>
      </li>${liga}`;
  }).join('');

  const parado = !!s.parado;
  $('etapas').classList.toggle('parado', parado);
  $('btn-parar').classList.toggle('hidden', parado);
  $('btn-retomar').classList.toggle('hidden', !parado);
  // Começar: some no PARADO; desabilita com o Kaptar fechado ou já disparando
  $('btn-comecar').classList.toggle('hidden', parado);
  $('btn-comecar').disabled = !s.kaptarAberto || camp.situacao === 'rodando';
  $('btn-comecar').title = !s.kaptarAberto ? 'Kaptar fechado: abra ele primeiro' : camp.situacao === 'rodando' ? 'O Kaptar já está disparando uma leva' : 'Dispara uma leva pela automação do Kaptar';
  $('etapas-estado').textContent = parado
    ? `TUDO PARADO desde ${new Date(s.parado).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : statusOp ? (s.vigiaOk ? 'vigia lendo o WhatsApp' : 'vigia desligado') : '';
}

// ── COMEÇAR LEVA ──
// Mesma coisa que o botão "enviar agora" da automação no Kaptar: escolhe a automação, mostra pra quem vai
// (a fila que o Kaptar mostra) e a mensagem, e só dispara no clique de confirmar.
let automacoes = [];

function saudacaoCerta() {
  const h = new Date().getHours();
  return h < 12 ? 'bom dia' : h < 18 ? 'boa tarde' : 'boa noite';
}

async function abrirComecar() {
  $('com-overlay').classList.remove('hidden');
  $('com-erro').textContent = '';
  $('com-ir').disabled = true;
  $('com-aut').innerHTML = '<option>carregando as automações do Kaptar...</option>';
  $('com-resumo').textContent = '';
  $('com-fila').innerHTML = '';
  $('com-qtd').textContent = '';
  try {
    const r = await fetch('/api/prospector/automacoes');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    automacoes = j.filter(a => a.tipo !== 'busca');
    if (!automacoes.length) throw new Error('nenhuma automação de envio no Kaptar');
    // a ativa primeiro (é a que você usa)
    automacoes.sort((a, b) => (b.ativa - a.ativa));
    $('com-aut').innerHTML = automacoes.map(a => `<option value="${esc(a.id)}">${esc(a.nome)}${a.ativa ? '' : ' (desligada no Kaptar)'}</option>`).join('');
    await mostrarAutomacao();
  } catch (e) {
    $('com-aut').innerHTML = '';
    $('com-erro').textContent = 'Não consegui falar com o Kaptar: ' + e.message;
  }
}

async function mostrarAutomacao() {
  const a = automacoes.find(x => x.id === $('com-aut').value);
  if (!a) return;
  comFilaVazia = true;
  $('com-ir').disabled = true;
  $('com-erro').textContent = '';
  desenharMensagens(a.mensagens.length ? a.mensagens : ['']);
  $('com-resumo').innerHTML = `
    <b>Ritmo:</b> uma a cada ${a.intervaloMin} a ${a.intervaloMax} min · até ${a.porEnvio} nesta leva<br>
    <b>Leads:</b> ${a.fonteDeLeads === 'base' ? 'da base do Kaptar (o que você buscou)' : 'da fila desta automação'}`;
  $('com-fila').innerHTML = '<li class="com-vazia">carregando...</li>';
  try {
    const r = await fetch(`/api/prospector/automacoes/${encodeURIComponent(a.id)}/fila`);
    const fila = await r.json();
    if (!r.ok) throw new Error(fila.error);
    const vai = fila.slice(0, a.porEnvio);
    $('com-qtd').textContent = vai.length ? `${vai.length} academia(s)${fila.length > vai.length ? ` (${fila.length - vai.length} ficam pra próxima)` : ''}` : '';
    $('com-fila').innerHTML = vai.length
      ? vai.map(l => `<li>${esc(l.nome)}<small>${esc(l.cidade)}</small></li>`).join('')
      : '<li class="com-vazia">Ninguém na fila. Busque leads no Kaptar antes.</li>';
    comFilaVazia = !vai.length;
    conferirMensagens();
    $('com-ir').textContent = vai.length ? `Começar agora (${vai.length})` : 'Começar agora';
  } catch (e) {
    $('com-fila').innerHTML = '';
    $('com-erro').textContent = 'Não consegui ler a fila: ' + e.message;
  }
}

// Mensagens editáveis: o que está salvo no Kaptar x o que está nos campos. Com mudança não salva,
// ou com saudação errada pro horário, o "Começar agora" fica travado.
let comFilaVazia = true;
const SAUDACOES = /\b(bom dia|boa tarde|boa noite)\b/i;
const msgsNosCampos = () => [...document.querySelectorAll('#com-msgs input')].map(i => i.value.replace(/\s+/g, ' ').trim()).filter(Boolean);
const automacaoAberta = () => automacoes.find(x => x.id === $('com-aut').value);

function desenharMensagens(lista) {
  $('com-msgs').innerHTML = lista.map(m => `<div class="com-msg"><input type="text" maxlength="1000" value="${esc(m)}"><button type="button" title="Tirar esta variação">✕</button></div>`).join('');
  conferirMensagens();
}

function conferirMensagens() {
  const a = automacaoAberta();
  if (!a) return;
  const certa = saudacaoCerta();
  let temErrada = false;
  document.querySelectorAll('#com-msgs input').forEach(i => {
    const m = i.value.match(SAUDACOES);
    const errada = !!m && m[1].toLowerCase() !== certa;
    i.classList.toggle('errada', errada);
    if (errada) temErrada = true;
  });
  const atuais = msgsNosCampos();
  const mudou = JSON.stringify(atuais) !== JSON.stringify(a.mensagens);
  $('com-saudacao').textContent = `Trocar saudação pra "${certa}"`;
  $('com-saudacao').classList.toggle('hidden', !temErrada);
  $('com-salvar-msg').disabled = !mudou || !atuais.length;
  const st = $('com-msg-status');
  st.className = 'com-msg-status' + (mudou ? ' pendente' : temErrada ? ' pendente' : ' ok');
  // Saudação errada não trava mais: o CRM acerta sozinho pelo horário na hora do Começar (e o vigia, a cada 30 s).
  st.textContent = mudou ? 'mudou: salve no Kaptar antes de começar'
    : temErrada ? `a saudação vira "${certa}" sozinha ao começar` : `igual ao Kaptar · saudação automática pelo horário`;
  $('com-ir').disabled = comFilaVazia || mudou || !atuais.length;
}

function trocarSaudacao() {
  const certa = saudacaoCerta();
  document.querySelectorAll('#com-msgs input').forEach(i => {
    i.value = i.value.replace(SAUDACOES, (s) => s[0] === s[0].toUpperCase() ? certa[0].toUpperCase() + certa.slice(1) : certa);
  });
  conferirMensagens();
}

async function salvarMensagens() {
  const a = automacaoAberta();
  const mensagens = msgsNosCampos();
  $('com-salvar-msg').disabled = true; $('com-salvar-msg').textContent = 'Salvando...';
  $('com-erro').textContent = '';
  try {
    const r = await fetch(`/api/prospector/automacoes/${encodeURIComponent(a.id)}/mensagens`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensagens }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    // confere lendo de volta do Kaptar (o que vale é o que ficou gravado lá)
    const lista = await (await fetch('/api/prospector/automacoes')).json();
    const nova = lista.find(x => x.id === a.id);
    if (nova) a.mensagens = nova.mensagens;
    desenharMensagens(a.mensagens);
  } catch (e) {
    $('com-erro').textContent = 'Não salvou no Kaptar: ' + e.message;
  }
  $('com-salvar-msg').textContent = 'Salvar no Kaptar';
  conferirMensagens();
}

async function confirmarComecar() {
  const id = $('com-aut').value;
  $('com-ir').disabled = true; $('com-ir').textContent = 'Começando...';
  $('com-erro').textContent = '';
  try {
    const r = await fetch('/api/prospector/comecar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    $('com-overlay').classList.add('hidden');
    carregarStatus();
    setTimeout(carregarLevas, 8000);
  } catch (e) {
    $('com-erro').textContent = 'O Kaptar não começou: ' + e.message;
    $('com-ir').disabled = false; $('com-ir').textContent = 'Tentar de novo';
  }
}

async function pararTudo() {
  const b = $('btn-parar');
  b.disabled = true; b.textContent = 'Parando...';
  try {
    const r = await api('POST', '/api/prospector/parar');
    if (!r.ok) throw new Error('falhou');
  } catch { alert('Não consegui parar pelo CRM. Feche o Kaptar à mão AGORA.'); }
  b.disabled = false; b.textContent = '■ PARAR TUDO';
  carregarStatus();
}

async function retomar() {
  await api('POST', '/api/prospector/retomar');
  await carregarStatus();
  alert('Prospector destravado. O Kaptar continua fechado: abra ele à mão quando quiser voltar a disparar.');
}

document.addEventListener('DOMContentLoaded', () => {
  load().then(() => { focarCardDoLink(); carregarStatus(); carregarLevas(); });
  setInterval(carregarLevas, 60000);
  $('levas-lista').addEventListener('click', e => { const b = e.target.closest('.leva-chip'); if (b) escolherLeva(b.dataset.leva); });
  $('btn-parar').addEventListener('click', pararTudo);
  $('btn-comecar').addEventListener('click', abrirComecar);
  $('com-aut').addEventListener('change', mostrarAutomacao);
  $('com-ir').addEventListener('click', confirmarComecar);
  $('com-msgs').addEventListener('input', conferirMensagens);
  $('com-msgs').addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') return;
    e.target.closest('.com-msg').remove();
    conferirMensagens();
  });
  $('com-mais').addEventListener('click', () => {
    $('com-msgs').insertAdjacentHTML('beforeend', '<div class="com-msg"><input type="text" maxlength="1000" placeholder="outra forma de dizer"><button type="button" title="Tirar esta variação">✕</button></div>');
    $('com-msgs').lastElementChild.querySelector('input').focus();
  });
  $('com-saudacao').addEventListener('click', trocarSaudacao);
  $('com-salvar-msg').addEventListener('click', salvarMensagens);
  $('com-fechar').addEventListener('click', () => $('com-overlay').classList.add('hidden'));
  $('com-cancelar').addEventListener('click', () => $('com-overlay').classList.add('hidden'));
  $('btn-retomar').addEventListener('click', retomar);
  setInterval(carregarStatus, 15000);
  window.addEventListener('hashchange', focarCardDoLink);
  $('resp-fechar').addEventListener('click', fecharResposta);
  $('resp-cancelar').addEventListener('click', fecharResposta);
  $('resp-enviar').addEventListener('click', enviarResposta);
  $('resp-link').addEventListener('input', atualizarLink);
  $('resp-overlay').addEventListener('click', e => { if (e.target.id === 'resp-overlay') fecharResposta(); });
  checkToolStatus();
  setInterval(checkToolStatus, 30000);
  // prospector: cards novos e placar atualizam sozinhos (o vigia lê o WhatsApp a cada 2 min)
  carregarPlacar();
  // cards a cada 10 s (o vigia lê o WhatsApp a cada 30 s); placar a cada 1 min
  setInterval(() => { if (!document.querySelector('.card.dragging') && document.getElementById('modal-overlay').classList.contains('hidden')) load(); }, 10000);
  setInterval(carregarPlacar, 60000);
  document.getElementById('placar-dias').addEventListener('change', carregarPlacar);
  document.getElementById('placar-toggle').addEventListener('click', () => document.getElementById('placar').classList.toggle('aberto'));

  // Bloquear clique em ferramentas offline
  document.getElementById('tools-nav').addEventListener('click', e => {
    const link = e.target.closest('.tool-link');
    if (!link) return;
    const row = link.closest('.tool-row');
    const tool = row && row.dataset.tool;
    if (tool && !toolStatus[tool]) {
      e.preventDefault();
      showToast(`${link.querySelector('.tool-name').textContent} está offline. Clique em ▶ para iniciar.`);
    }
  });

  // Botões de lançar ferramenta
  document.getElementById('tools-nav').addEventListener('click', async e => {
    const btn = e.target.closest('.tool-launch');
    if (!btn) return;
    const tool = btn.dataset.tool;
    btn.textContent = '↻';
    btn.classList.add('loading');
    try {
      await api('POST', `/api/tools/launch/${tool}`);
      showToast('Iniciando ferramenta... aguarde alguns segundos.');
      setTimeout(checkToolStatus, 4000);
      setTimeout(checkToolStatus, 8000);
    } catch {
      showToast('Não foi possível iniciar a ferramenta.');
    } finally {
      btn.textContent = '▶';
      btn.classList.remove('loading');
    }
  });

  document.getElementById('search').addEventListener('input', e => {
    searchQuery = e.target.value;
    render();
  });

  document.getElementById('btn-novo').addEventListener('click', () => openModal());

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancelar').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') closeModal();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  document.getElementById('modal-form').addEventListener('submit', async e => {
    e.preventDefault();
    const body = {
      nome:     document.getElementById('f-nome').value.trim(),
      empresa:  document.getElementById('f-empresa').value.trim(),
      telefone: document.getElementById('f-telefone').value.trim(),
      email:    document.getElementById('f-email').value.trim(),
      valor:    document.getElementById('f-valor').value.trim(),
      coluna:   document.getElementById('f-coluna').value,
      notas:    document.getElementById('f-notas').value.trim(),
    };
    if (editingId) {
      await api('PUT', `/api/cards/${editingId}`, body);
    } else {
      await api('POST', '/api/cards', body);
    }
    closeModal();
    await load();
  });
});
