
const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

const API = '/api';
let appKey = sessionStorage.getItem('controle_app_key') || '';
let dados = { itens: [], fretes: [], impostos: [] };

const timers = new Map();
const abertosProdutos = new Set();
const abertosFretes = new Set();
const abertosCustos = new Set();

const acordeoesInicializados = {
  produtos: false,
  fretes: false,
  custos: false
};

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[m]));
}

function setStatus(t, ok = true) {
  const e = document.getElementById('cloudStatus');
  if (!e) return;

  e.textContent = (ok ? '☁ ' : '⚠ ') + t;
  e.style.background = ok ? '#eef2ff' : '#fff7ed';
  e.style.color = ok ? '#3730a3' : '#9a3412';
}

async function apiFetch(path, opt = {}) {
  const headers = Object.assign({
    'Content-Type': 'application/json',
    'X-App-Key': appKey
  }, opt.headers || {});

  const r = await fetch(API + path, {
    ...opt,
    headers
  });

  if (r.status === 401) throw Error('AUTH');
  if (!r.ok) throw Error(await r.text() || 'Erro de servidor');

  return r.status === 204 ? null : r.json();
}

function normalize(x) {
  return {
    itens: (x.itens || []).map(i => ({
      id: String(i.id || crypto.randomUUID()),
      item: i.item || '',
      preco: num(i.preco),
      peso: num(i.peso),
      status: i.status || 'Comprado',
      freteId: i.freteId ? String(i.freteId) : ''
    })),

    fretes: (x.fretes || []).map(f => ({
      id: String(f.id || crypto.randomUUID()),
      nome: f.nome || 'Frete',
      valor: num(f.valor),
      rateio: f.rateio || 'peso'
    })),

    impostos: Array.isArray(x.impostos)
      ? x.impostos.map(t => ({
          id: String(t.id || crypto.randomUUID()),
          freteId: String(t.freteId || ''),
          valor: num(t.valor),
          rateio: t.rateio || 'peso'
        }))
      : []
  };
}

async function entrar() {
  const pw = document.getElementById('appPassword')?.value;
  if (!pw) return;

  appKey = pw;

  try {
    const d = await apiFetch('/data');

    sessionStorage.setItem('controle_app_key', appKey);
    document.getElementById('loginOverlay').style.display = 'none';
    dados = d;

    const antigo = localStorage.getItem('controle_compras_fretes_v2');

    if (
      !d.itens.length &&
      !d.fretes.length &&
      !d.impostos.length &&
      antigo
    ) {
      const copia = normalize(JSON.parse(antigo));

      await apiFetch('/import', {
        method: 'POST',
        body: JSON.stringify(copia)
      });

      dados = copia;
      setStatus('Dados locais importados');
    } else {
      setStatus('Sincronizado');
    }

    render();
  } catch {
    appKey = '';
    sessionStorage.removeItem('controle_app_key');

    const erro = document.getElementById('loginError');
    if (erro) erro.style.display = 'block';

    setStatus('Falha ao entrar', false);
  }
}

function schedule(key, fn, delay = 700) {
  clearTimeout(timers.get(key));

  timers.set(key, setTimeout(async () => {
    timers.delete(key);

    try {
      await fn();
      setStatus('Salvo na nuvem');
    } catch {
      setStatus('Falha ao salvar', false);
    }
  }, delay));
}

function remoteItem(x) {
  return {
    ...x,
    peso_g: num(x.peso) * 1000
  };
}

function pesoTotal(lista) {
  return lista.reduce((s, x) => s + num(x.peso), 0);
}

function valorTotal(lista) {
  return lista.reduce((s, x) => s + num(x.preco), 0);
}

function rateio(item, grupo, tipo, total) {
  if (total <= 0 || !grupo.length) return 0;

  if (tipo === 'igual') {
    return total / grupo.length;
  }

  if (tipo === 'valor') {
    const base = valorTotal(grupo);
    return base > 0 ? num(item.preco) / base * total : 0;
  }

  const base = pesoTotal(grupo);
  return base > 0 ? num(item.peso) / base * total : 0;
}

function freteItem(x) {
  return dados.fretes.reduce((s, f) => {
    if (String(x.freteId) !== String(f.id)) return s;

    const grupo = dados.itens.filter(
      i => String(i.freteId) === String(f.id)
    );

    return s + rateio(x, grupo, f.rateio, f.valor);
  }, 0);
}

function impostoItem(x) {
  if (!x.freteId) return 0;

  return dados.impostos.reduce((s, t) => {
    if (String(t.freteId) !== String(x.freteId)) return s;

    const grupo = dados.itens.filter(
      i => String(i.freteId) === String(t.freteId)
    );

    return s + rateio(x, grupo, t.rateio, t.valor);
  }, 0);
}

function custo(x) {
  return num(x.preco) + freteItem(x) + impostoItem(x);
}

function tipoRateio(r) {
  if (r === 'peso') return 'Por peso';
  if (r === 'igual') return 'Igualmente';
  return 'Pelo valor dos itens';
}

// Estilos adicionais para os filtros e as setas de recolhimento.
function prepararEstilos() {
  if (document.getElementById('melhoriasAppStyles')) return;

  const style = document.createElement('style');
  style.id = 'melhoriasAppStyles';

  style.textContent = `
    .filter-row {
      display: flex !important;
      flex-wrap: wrap;
      align-items: center;
      gap: 9px;
      padding: 0 16px 14px;
    }

    .filter-row input {
      flex: 1 1 200px;
      min-width: 140px;
      max-width: 360px;
    }

    .filter-row select {
      min-width: 145px;
    }

    details.remessa-fold {
      padding: 0 !important;
      overflow: hidden;
    }

    details.remessa-fold > summary {
      list-style: none;
      cursor: pointer;
      padding: 14px 16px;
    }

    details.remessa-fold > summary::-webkit-details-marker {
      display: none;
    }

    details.remessa-fold > summary::after {
      content: '＋';
      float: right;
      color: #6b7280;
      font-size: 17px;
      margin-left: 10px;
    }

    details.remessa-fold[open] > summary::after {
      content: '−';
    }

    details.remessa-fold[open] > summary {
      border-bottom: 1px solid #e5e7eb;
    }

    .remessa-fold-content {
      padding: 12px 14px;
    }

    .remessa-edit-grid {
      display: grid;
      grid-template-columns: minmax(180px, 2fr) minmax(125px, 1fr) minmax(170px, 1.2fr);
      gap: 9px;
      padding: 0 0 12px;
    }

    @media (max-width: 650px) {
      .remessa-edit-grid {
        grid-template-columns: 1fr;
      }
    }
  `;

  document.head.appendChild(style);
}

// Substitui o filtro antigo por busca e situação, sem recriar
// os campos a cada tecla digitada.
function prepararFiltros() {
  const row = document.querySelector('.filter-row');
  if (!row || row.dataset.preparado === '1') return;

  row.innerHTML = `
    <span class="filter-label">Buscar:</span>
    <input id="buscaProduto"
      type="search"
      placeholder="Digite o nome do produto..."
      autocomplete="off"
      oninput="renderItens()">

    <span class="filter-label">Situação:</span>
    <select id="filtroStatus" onchange="renderItens()">
      <option value="todos">Todas</option>
      <option value="Comprado">Comprado</option>
      <option value="Na suíte">Na suíte</option>
      <option value="Consolidado">Consolidado</option>
      <option value="Recebido BR">Recebido BR</option>
    </select>
  `;

  row.dataset.preparado = '1';
}

function correspondeFiltro(x) {
  const busca = (
    document.getElementById('buscaProduto')?.value || ''
  ).trim().toLocaleLowerCase('pt-BR');

  const status =
    document.getElementById('filtroStatus')?.value || 'todos';

  const nome = String(x.item || '').toLocaleLowerCase('pt-BR');

  return (
    (!busca || nome.includes(busca)) &&
    (status === 'todos' || x.status === status)
  );
}

// Guarda quais remessas estavam abertas antes de atualizar a tela.
function guardarAbertos(container, seletor, conjunto, chave, idInicial) {
  const elementos = [
    ...container.querySelectorAll(seletor)
  ];

  if (elementos.length) {
    elementos.forEach(el => {
      const id = String(el.dataset.freteId);

      if (el.open) {
        conjunto.add(id);
      } else {
        conjunto.delete(id);
      }
    });

    acordeoesInicializados[chave] = true;
  } else if (
    !acordeoesInicializados[chave] &&
    idInicial
  ) {
    conjunto.add(String(idInicial));
    acordeoesInicializados[chave] = true;
  }
}

// PRODUTOS

async function adicionarItem() {
  const nome = document.getElementById('item').value.trim();

  if (!nome) return alert('Digite o nome do item.');

  const x = {
    id: crypto.randomUUID(),
    item: nome,
    preco: num(document.getElementById('preco').value),
    peso: num(document.getElementById('peso').value) / 1000,
    status: document.getElementById('status').value,
    freteId: ''
  };

  try {
    await apiFetch('/items', {
      method: 'POST',
      body: JSON.stringify(remoteItem(x))
    });

    dados.itens.push(x);

    ['item', 'preco', 'peso'].forEach(id => {
      document.getElementById(id).value = '';
    });

    document.getElementById('status').value = 'Comprado';

    render();
    setStatus('Salvo na nuvem');
  } catch {
    setStatus('Falha ao salvar', false);
  }
}

function renderItens() {
  prepararFiltros();

  const box = document.getElementById('itensContainer');
  const alerta = document.getElementById('pesoAlert');
  if (!box) return;

  const recentes = [...dados.fretes].reverse();

  guardarAbertos(
    box,
    'details[data-produto-frete]',
    abertosProdutos,
    'produtos',
    recentes[0]?.id
  );

  const avisos = [];

  recentes.forEach(f => {
    const grupo = dados.itens.filter(
      x => String(x.freteId) === String(f.id)
    );

    if (
      f.rateio === 'peso' &&
      grupo.some(x => num(x.peso) <= 0)
    ) {
      const quantidade = grupo.filter(x => num(x.peso) <= 0).length;
      avisos.push(
        `${esc(f.nome)}: ${quantidade} item(ns) sem peso.`
      );
    }
  });

  if (alerta) {
    alerta.innerHTML = avisos.length
      ? `<div class="alert">⚠️ ${avisos.join('<br>')}</div>`
      : '';
  }

  if (!dados.itens.length) {
    box.innerHTML = '<div class="empty">Nenhum produto cadastrado ainda.</div>';
    return;
  }

  function tabela(grupo) {
    if (!grupo.length) {
      return '<div class="empty">Nenhum produto nesta remessa corresponde ao filtro.</div>';
    }

    let h = `
      <div class="table-wrap">
      <table>
      <thead><tr>
        <th>Item</th>
        <th>Preço</th>
        <th>Peso (g)</th>
        <th>Status</th>
        <th>Frete</th>
        <th>Custo final</th>
        <th>Ação</th>
      </tr></thead><tbody>`;

    grupo.forEach(x => {
      const i = dados.itens.indexOf(x);

      h += `
        <tr>
          <td>
            <input value="${esc(x.item)}"
              aria-label="Nome do produto"
              oninput="editarItem(${i},'item',this.value)">
          </td>

          <td>
            <input type="number" min="0" step="0.01"
              value="${x.preco || ''}"
              aria-label="Preço em reais"
              oninput="editarItem(${i},'preco',this.value)">
          </td>

          <td>
            <input type="number" min="0" step="1"
              value="${x.peso ? Math.round(x.peso * 1000) : ''}"
              aria-label="Peso em gramas"
              oninput="editarItem(${i},'peso',this.value)">
          </td>

          <td>
            <select onchange="editarItem(${i},'status',this.value)">
              ${['Comprado', 'Na suíte', 'Consolidado', 'Recebido BR']
                .map(st => `<option ${x.status === st ? 'selected' : ''}>${st}</option>`)
                .join('')}
            </select>
          </td>

          <td>
            <select onchange="atribuirFrete(${i},this.value)">
              <option value="">Sem remessa</option>
              ${recentes.map(f => `
                <option value="${esc(f.id)}"
                  ${String(x.freteId) === String(f.id) ? 'selected' : ''}>
                  ${esc(f.nome)}
                </option>
              `).join('')}
            </select>
          </td>

          <td class="cost-final">${moeda.format(custo(x))}</td>

          <td>
            <button type="button" class="btn-danger"
              onclick="excluirItem(${i})">Excluir</button>
          </td>
        </tr>`;
    });

    return h + '</tbody></table></div>';
  }

  let html = '';
  let encontrados = 0;

  recentes.forEach(f => {
    const todos = dados.itens.filter(
      x => String(x.freteId) === String(f.id)
    );

    const grupo = todos.filter(correspondeFiltro);
    const filtrando = filtroAtivo();

    if (filtrando && !grupo.length) return;

    encontrados += grupo.length;

    const peso = pesoTotal(todos);
    const abrir = abertosProdutos.has(String(f.id));

    html += `
      <details class="remessa remessa-fold"
        data-produto-frete="1"
        data-frete-id="${esc(f.id)}"
        ${abrir ? 'open' : ''}>

        <summary>
          <div class="remessa-top" style="margin:0">
            <div>
              <div class="remessa-name">${esc(f.nome)}</div>
              <div class="muted">
                ${todos.length} produto(s) ·
                ${peso.toFixed(2).replace('.', ',')} kg
              </div>
            </div>
            <span class="pill">${moeda.format(f.valor)}</span>
          </div>
        </summary>

        <div class="remessa-fold-content">
          ${tabela(grupo)}
        </div>
      </details>`;
  });

  const sem = dados.itens.filter(x =>
    (
      !x.freteId ||
      !dados.fretes.some(f => String(f.id) === String(x.freteId))
    ) && correspondeFiltro(x)
  );

  encontrados += sem.length;

  if (sem.length) {
    html += `
      <div class="remessa" style="margin:12px 16px">
        <div class="remessa-top">
          <div>
            <div class="remessa-name">Sem remessa</div>
            <div class="muted">
              ${sem.length} produto(s) ainda não vinculados
            </div>
          </div>
        </div>
        ${tabela(sem)}
      </div>`;
  }

  box.innerHTML = encontrados
    ? html
    : '<div class="empty">Nenhum produto corresponde à busca ou à situação selecionada.</div>';
}

function filtroAtivo() {
  const busca = (
    document.getElementById('buscaProduto')?.value || ''
  ).trim();

  const status =
    document.getElementById('filtroStatus')?.value || 'todos';

  return busca !== '' || status !== 'todos';
}

function editarItem(i, campo, valor) {
  const x = dados.itens[i];
  if (!x) return;

  if (campo === 'peso') {
    x.peso = num(valor) / 1000;
  } else {
    x[campo] = campo === 'preco' ? num(valor) : valor;
  }

  // Atualiza cálculos sem reconstruir a tabela que está sendo digitada.
  const linha = document.activeElement?.closest('tr');
  const celula = linha?.querySelector('.cost-final');

  if (celula) {
    celula.textContent = moeda.format(custo(x));
  }

  renderFretes();
  renderCustos();
  renderResumo();

  if (campo === 'status') {
    renderItens();
  }

  schedule('item-' + x.id, () =>
    apiFetch('/items/' + encodeURIComponent(x.id), {
      method: 'PUT',
      body: JSON.stringify(remoteItem(x))
    })
  );
}

function atribuirFrete(i, id) {
  const x = dados.itens[i];
  x.freteId = id;

  schedule('item-' + x.id, () =>
    apiFetch('/items/' + encodeURIComponent(x.id), {
      method: 'PUT',
      body: JSON.stringify(remoteItem(x))
    })
  );

  render();
}

// FRETES

async function adicionarFrete() {
  const nome = document.getElementById('freteNome').value.trim();
  const valor = num(document.getElementById('freteValor').value);

  if (!nome) return alert('Dê um nome para o frete.');
  if (valor <= 0) return alert('Informe o valor do frete.');

  const x = {
    id: crypto.randomUUID(),
    nome,
    valor,
    rateio: document.getElementById('freteRateio').value
  };

  try {
    await apiFetch('/fretes', {
      method: 'POST',
      body: JSON.stringify(x)
    });

    dados.fretes.push(x);

    // Abre automaticamente o frete recém-criado.
    abertosProdutos.add(String(x.id));
    abertosFretes.add(String(x.id));
    abertosCustos.add(String(x.id));

    document.getElementById('freteNome').value = '';
    document.getElementById('freteValor').value = '';

    render();
    setStatus('Salvo na nuvem');
  } catch {
    setStatus('Falha ao salvar', false);
  }
}

function editarFrete(id, campo, valor) {
  const f = dados.fretes.find(x => String(x.id) === String(id));
  if (!f) return;

  f[campo] = campo === 'valor' ? num(valor) : valor;

  if (campo === 'valor') {
    renderCustos();
    renderResumo();
  }

  schedule('frete-' + f.id, () =>
    apiFetch('/fretes/' + encodeURIComponent(f.id), {
      method: 'PUT',
      body: JSON.stringify(f)
    })
  );
}

// Executada quando terminar a edição do nome ou valor.
// Recria os títulos sem interromper a digitação.
function finalizarEdicaoFrete() {
  render();
}

function editarRateio(id, valor) {
  const f = dados.fretes.find(x => String(x.id) === String(id));
  if (!f) return;

  f.rateio = valor;

  apiFetch('/fretes/' + encodeURIComponent(f.id), {
    method: 'PUT',
    body: JSON.stringify(f)
  })
    .then(() => setStatus('Salvo na nuvem'))
    .catch(() => setStatus('Falha ao salvar', false));

  render();
}

function renderFretes() {
  const box = document.getElementById('fretesContainer');
  if (!box) return;

  const recentes = [...dados.fretes].reverse();

  guardarAbertos(
    box,
    'details[data-frete-card]',
    abertosFretes,
    'fretes',
    recentes[0]?.id
  );

  if (!recentes.length) {
    box.innerHTML = '<div class="empty">Nenhum frete salvo ainda.</div>';
    return;
  }

  let html = '<div class="remessa-list">';

  recentes.forEach(f => {
    const grupo = dados.itens.filter(
      x => String(x.freteId) === String(f.id)
    );

    const peso = pesoTotal(grupo);
    const semPeso = grupo.filter(x => num(x.peso) <= 0).length;
    const nomes = grupo.map(x => x.item).join(', ') ||
      'Nenhum produto vinculado ainda';

    const impostos = dados.impostos.filter(
      t => String(t.freteId) === String(f.id)
    );

    const abrir = abertosFretes.has(String(f.id));

    html += `
      <details class="remessa remessa-fold"
        data-frete-card="1"
        data-frete-id="${esc(f.id)}"
        ${abrir ? 'open' : ''}>

        <summary>
          <div class="remessa-top" style="margin:0">
            <div>
              <div class="remessa-name">${esc(f.nome)}</div>
              <div class="muted">${grupo.length} produto(s)</div>
            </div>
            <span class="pill">${moeda.format(f.valor)}</span>
          </div>
        </summary>

        <div class="remessa-fold-content">
          <div class="remessa-meta">
            <span class="pill">Rateio: ${tipoRateio(f.rateio)}</span>
            <span class="pill">${peso.toFixed(2).replace('.', ',')} kg total</span>
            <span class="pill">${impostos.length} imposto(s)</span>
            ${f.rateio === 'peso' && semPeso ? `
              <span class="pill" style="background:#fff7ed;color:#9a3412">
                ${semPeso} sem peso
              </span>` : ''}
          </div>

          <div class="remessa-items">${esc(nomes)}</div>

          <div class="remessa-edit-grid">
            <input
              type="text"
              value="${esc(f.nome)}"
              aria-label="Nome do frete"
              placeholder="Nome do frete"
              oninput="editarFrete('${String(f.id)}','nome',this.value)"
              onchange="finalizarEdicaoFrete()">

            <input
              type="number"
              min="0"
              step="0.01"
              value="${f.valor}"
              aria-label="Valor do frete"
              oninput="editarFrete('${String(f.id)}','valor',this.value)"
              onchange="finalizarEdicaoFrete()">

            <select
              aria-label="Tipo de rateio"
              onchange="editarRateio('${String(f.id)}',this.value)">
              <option value="peso" ${f.rateio === 'peso' ? 'selected' : ''}>Ratear por peso</option>
              <option value="igual" ${f.rateio === 'igual' ? 'selected' : ''}>Dividir igualmente</option>
              <option value="valor" ${f.rateio === 'valor' ? 'selected' : ''}>Ratear pelo valor</option>
            </select>
          </div>

          <button
            type="button"
            class="btn-danger"
            onclick="excluirFrete('${String(f.id)}')">
            Excluir frete
          </button>
        </div>
      </details>`;
  });

  box.innerHTML = html + '</div>';
}

async function excluirItem(i) {
  const x = dados.itens[i];
  if (!x) return;

  const mensagem =
    `Excluir o produto "${x.item}"?\n\n` +
    'Esta ação não pode ser desfeita.';

  if (!confirm(mensagem)) return;

  try {
    await apiFetch('/items/' + encodeURIComponent(x.id), {
      method: 'DELETE'
    });

    dados.itens.splice(i, 1);
    render();
    setStatus('Produto excluído');
  } catch {
    setStatus('Falha ao excluir', false);
  }
}

async function excluirFrete(id) {
  const f = dados.fretes.find(x => String(x.id) === String(id));
  if (!f) return;

  const quantidade = dados.itens.filter(
    x => String(x.freteId) === String(id)
  ).length;

  const impostos = dados.impostos.filter(
    x => String(x.freteId) === String(id)
  ).length;

  const mensagem =
    `Excluir o frete "${f.nome}"?\n\n` +
    `${quantidade} produto(s) continuarão cadastrados, mas ficarão sem remessa.\n` +
    `${impostos} imposto(s) vinculados a este frete também serão removidos.\n\n` +
    'Esta ação não pode ser desfeita.';

  if (!confirm(mensagem)) return;

  try {
    await apiFetch('/fretes/' + encodeURIComponent(id), {
      method: 'DELETE'
    });

    dados.fretes = dados.fretes.filter(
      x => String(x.id) !== String(id)
    );

    dados.impostos = dados.impostos.filter(
      x => String(x.freteId) !== String(id)
    );

    dados.itens.forEach(x => {
      if (String(x.freteId) === String(id)) x.freteId = '';
    });

    abertosProdutos.delete(String(id));
    abertosFretes.delete(String(id));
    abertosCustos.delete(String(id));

    render();
    setStatus('Frete excluído');
  } catch {
    setStatus('Falha ao excluir', false);
  }
}

// IMPOSTOS

async function salvarImposto() {
  const freteId = document.getElementById('impostoFrete').value;
  const valor = num(document.getElementById('impostoValor').value);

  if (!freteId) return alert('Crie ou selecione um frete primeiro.');
  if (valor <= 0) return alert('Informe o valor do imposto.');

  const x = {
    id: crypto.randomUUID(),
    freteId,
    valor,
    rateio: document.getElementById('impostoRateio').value
  };

  try {
    await apiFetch('/impostos', {
      method: 'POST',
      body: JSON.stringify(x)
    });

    dados.impostos.push(x);
    document.getElementById('impostoValor').value = '';

    render();
    setStatus('Imposto salvo');
  } catch {
    setStatus('Falha ao salvar', false);
  }
}

async function excluirImposto(id) {
  const t = dados.impostos.find(x => String(x.id) === String(id));
  if (!t) return;

  const f = dados.fretes.find(
    x => String(x.id) === String(t.freteId)
  );

  const mensagem =
    `Excluir o imposto de ${moeda.format(t.valor)}?\n` +
    `Frete: "${f ? f.nome : 'Remessa não encontrada'}".\n\n` +
    'Esta ação não pode ser desfeita.';

  if (!confirm(mensagem)) return;

  try {
    await apiFetch('/impostos/' + encodeURIComponent(id), {
      method: 'DELETE'
    });

    dados.impostos = dados.impostos.filter(
      x => String(x.id) !== String(id)
    );

    render();
    setStatus('Imposto excluído');
  } catch {
    setStatus('Falha ao excluir', false);
  }
}

function renderImpostos() {
  const select = document.getElementById('impostoFrete');
  const anterior = select.value;

  select.innerHTML = dados.fretes.length
    ? dados.fretes.map(f =>
        `<option value="${esc(f.id)}">${esc(f.nome)}</option>`
      ).join('')
    : '<option value="">Crie um frete primeiro</option>';

  if ([...select.options].some(o => o.value === anterior)) {
    select.value = anterior;
  }

  const box = document.getElementById('impostosContainer');

  if (!dados.impostos.length) {
    box.innerHTML = '<div class="empty">Nenhum imposto cadastrado ainda.</div>';
    return;
  }

  let html = '<div class="remessa-list">';

  [...dados.impostos].reverse().forEach(t => {
    const f = dados.fretes.find(
      x => String(x.id) === String(t.freteId)
    );

    html += `
      <div class="remessa">
        <div class="remessa-top">
          <div>
            <div class="remessa-name">${esc(f ? f.nome : 'Frete removido')}</div>
            <div class="muted">Imposto vinculado a esta remessa</div>
          </div>
          <button type="button" class="btn-danger"
            onclick="excluirImposto('${String(t.id)}')">
            Excluir
          </button>
        </div>

        <div class="remessa-meta">
          <span class="pill">${moeda.format(t.valor)}</span>
          <span class="pill">Rateio: ${tipoRateio(t.rateio)}</span>
        </div>
      </div>`;
  });

  box.innerHTML = html + '</div>';
}

// CUSTO FINAL POR ITEM

function renderCustos() {
  const box = document.getElementById('custoContainer');
  if (!box) return;

  const recentes = [...dados.fretes].reverse();

  guardarAbertos(
    box,
    'details[data-custo-frete]',
    abertosCustos,
    'custos',
    recentes[0]?.id
  );

  if (!dados.itens.length) {
    box.innerHTML = '<div class="empty">Cadastre produtos para ver o custo.</div>';
    return;
  }

  function tabela(grupo) {
    let html = `
      <div class="table-wrap">
      <table>
      <thead><tr>
        <th>Item</th>
        <th>Preço pago</th>
        <th>Frete rateado</th>
        <th>Imposto rateado</th>
        <th>Custo final</th>
      </tr></thead><tbody>`;

    grupo.forEach(x => {
      html += `
        <tr>
          <td>${esc(x.item)}</td>
          <td>${moeda.format(x.preco)}</td>
          <td>${moeda.format(freteItem(x))}</td>
          <td>${moeda.format(impostoItem(x))}</td>
          <td class="cost-final">${moeda.format(custo(x))}</td>
        </tr>`;
    });

    return html + '</tbody></table></div>';
  }

  let html = '';

  recentes.forEach(f => {
    const grupo = dados.itens.filter(
      x => String(x.freteId) === String(f.id)
    );

    if (!grupo.length) return;

    const soma = grupo.reduce((s, x) => s + custo(x), 0);
    const abrir = abertosCustos.has(String(f.id));

    html += `
      <details class="remessa remessa-fold"
        data-custo-frete="1"
        data-frete-id="${esc(f.id)}"
        ${abrir ? 'open' : ''}>

        <summary>
          <div class="remessa-top" style="margin:0">
            <div>
              <div class="remessa-name">${esc(f.nome)}</div>
              <div class="muted">${grupo.length} produto(s) · custo total</div>
            </div>
            <span class="pill">${moeda.format(soma)}</span>
          </div>
        </summary>

        <div class="remessa-fold-content">
          ${tabela(grupo)}
        </div>
      </details>`;
  });

  const sem = dados.itens.filter(x =>
    !x.freteId ||
    !dados.fretes.some(f => String(f.id) === String(x.freteId))
  );

  if (sem.length) {
    const soma = sem.reduce((s, x) => s + custo(x), 0);

    html += `
      <div class="remessa" style="margin:12px 16px">
        <div class="remessa-top">
          <div>
            <div class="remessa-name">Sem remessa</div>
            <div class="muted">${sem.length} produto(s) sem frete</div>
          </div>
          <span class="pill">${moeda.format(soma)}</span>
        </div>
        ${tabela(sem)}
      </div>`;
  }

  box.innerHTML = html;
}

function renderResumo() {
  const itens = valorTotal(dados.itens);
  const fretes = dados.fretes.reduce((s, f) => s + num(f.valor), 0);
  const impostos = dados.impostos.reduce((s, t) => s + num(t.valor), 0);

  document.getElementById('totalItens').textContent = moeda.format(itens);
  document.getElementById('totalFretes').textContent = moeda.format(fretes);
  document.getElementById('totalImpostos').textContent = moeda.format(impostos);
  document.getElementById('jaPago').textContent = moeda.format(itens + fretes);
  document.getElementById('custoFinal').textContent =
    moeda.format(itens + fretes + impostos);
}

function render() {
  prepararEstilos();
  prepararFiltros();
  renderItens();
  renderFretes();
  renderImpostos();
  renderCustos();
  renderResumo();
}

// BACKUP

function exportarBackup() {
  const blob = new Blob(
    [JSON.stringify(dados, null, 2)],
    { type: 'application/json' }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = 'controle-compras-backup-' +
    new Date().toISOString().slice(0, 10) + '.json';

  a.click();
  URL.revokeObjectURL(url);
}

async function importarBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const x = normalize(JSON.parse(await file.text()));

    if (!confirm(
      'Importar este backup substituirá os dados atuais. Continuar?'
    )) return;

    await apiFetch('/import', {
      method: 'POST',
      body: JSON.stringify(x)
    });

    dados = x;
    render();
    setStatus('Backup importado');
  } catch {
    alert('Não foi possível importar o backup.');
  } finally {
    event.target.value = '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  prepararEstilos();

  if (appKey) {
    entrar();
  } else {
    document.getElementById('appPassword')?.focus();
  }
});
