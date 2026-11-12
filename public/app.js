const COLUNAS = [
  { id: 'lead',       label: 'Lead',             cor: '#7c6ff7' },
  { id: 'contato',    label: 'Contato feito',    cor: '#00b4ff' },
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
async function load() {
  const data = await api('GET', '/api/pipeline');
  cards = data.cards || [];
  render();
  updateStats();
}

function render() {
  const kanban = document.getElementById('kanban');
  kanban.innerHTML = '';

  const q = searchQuery.toLowerCase();
  const visible = q
    ? cards.filter(c => (c.nome + c.empresa + c.email + c.telefone).toLowerCase().includes(q))
    : cards;

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

  // Drag & drop via delegation no kanban
  kanban.addEventListener('dragover', e => {
    e.preventDefault();
    const target = e.target.closest('.col-cards');
    document.querySelectorAll('.col-cards.drag-over').forEach(el => {
      if (el !== target) el.classList.remove('drag-over');
    });
    if (target) target.classList.add('drag-over');
  });

  kanban.addEventListener('dragleave', e => {
    if (!kanban.contains(e.relatedTarget)) {
      document.querySelectorAll('.col-cards.drag-over').forEach(el => el.classList.remove('drag-over'));
    }
  });

  kanban.addEventListener('drop', async e => {
    e.preventDefault();
    document.querySelectorAll('.col-cards.drag-over').forEach(el => el.classList.remove('drag-over'));
    const target = e.target.closest('.col-cards');
    if (!target || !draggedId) return;
    const novaColuna = target.dataset.coluna;
    await api('PUT', `/api/cards/${draggedId}`, { coluna: novaColuna });
    draggedId = null;
    await load();
  });

  // Card events
  document.querySelectorAll('.card').forEach(el => {
    el.addEventListener('dragstart', () => {
      draggedId = el.dataset.id;
      setTimeout(() => el.classList.add('dragging'), 0);
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
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

function renderCard(card) {
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
document.addEventListener('DOMContentLoaded', () => {
  load();
  checkToolStatus();
  setInterval(checkToolStatus, 30000);

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
