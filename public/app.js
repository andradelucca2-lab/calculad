
/* Controle de Compras e Fretes — app.js conectado ao Worker + D1 */
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const API = '/api';
let appKey = sessionStorage.getItem('controle_app_key') || '';
let dados = { itens: [], fretes: [], impostos: [] };
const timers = new Map();
const abertos = { produtos: new Set(), fretes: new Set(), custos: new Set() };
let gruposInicializados = false;
let ultimaExclusao = null;

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#039;'
  }[m]));
}

function setStatus(texto, ok = true) {
  const el = document.getElementById('cloudStatus');
  if (!el) return;
  el.textContent = (ok ? '☁ ' : '⚠ ') + texto;
  el.style.background = ok ? '#dcfce7' : '#ffedd5';
  el.style.color = ok ? '#166534' : '#9a3412';
  el.style.border = '1px solid ' + (ok ? '#86efac' : '#fdba74');
}

async function apiFetch(path, options = {}) {
  const headers = Object.assign({
    'Content-Type': 'application/json',
    'X-App-Key': appKey
  }, options.headers || {});

  const response = await fetch(API + path, { ...options, headers });
  if (response.status === 401) throw new Error('AUTH');
  if (!response.ok) throw new Error(await response.text() || 'Erro de servidor');
  return response.status === 204 ? null : response.json();
}

function normalize(source) {
  return {
    itens: (source.itens || []).map(item => ({
      id: String(item.id || crypto.randomUUID()),
      item: item.item || '',
      preco: num(item.preco),
      peso: num(item.peso),
      status: item.status || 'Comprado',
      freteId: item.freteId ? String(item.freteId) : ''
    })),
    fretes: (source.fretes || []).map(frete => ({
      id: String(frete.id || crypto.randomUUID()),
      nome: frete.nome || 'Frete',
      valor: num(frete.valor),
      rateio: frete.rateio || 'peso'
    })),
    impostos: Array.isArray(source.impostos) ? source.impostos.map(imposto => ({
      id: String(imposto.id || crypto.randomUUID()),
      freteId: String(imposto.freteId || ''),
      valor: num(imposto.valor),
      rateio: imposto.rateio || 'peso'
    })) : []
  };
}

async function entrar() {
  const campo = document.getElementById('appPassword');
  const senha = campo ? campo.value : '';
  if (!senha) return;
  appKey = senha;

  try {
    const remoto = await apiFetch('/data');
    sessionStorage.setItem('controle_app_key', appKey);

    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'none';

    dados = remoto;
    const antigo = localStorage.getItem('controle_compras_fretes_v2');

    if (!remoto.itens.length && !remoto.fretes.length &&
        !remoto.impostos.length && antigo) {
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

function schedule(key, task, delay = 650) {
  clearTimeout(timers.get(key));
  setStatus('Salvando…');

  timers.set(key, setTimeout(async () => {
    timers.delete(key);
    try {
      await task();
      setStatus('Salvo na nuvem');
    } catch {
      setStatus('Falha ao salvar — confira a conexão', false);
    }
  }, delay));
}

function cancelScheduled(key) {
  clearTimeout(timers.get(key));
  timers.delete(key);
}

function remoteItem(item) {
  return { ...item, peso_g: num(item.peso) * 1000 };
}

function pesoTotal(lista) {
  return lista.reduce((total, item) => total + num(item.peso), 0);
}

function valorTotal(lista) {
  return lista.reduce((total, item) => total + num(item.preco), 0);
}

function rateio(item, grupo, metodo, total) {
  if (total <= 0 || !grupo.length) return 0;
  if (metodo === 'igual') return total / grupo.length;

  if (metodo === 'valor') {
    const base = valorTotal(grupo);
    return base > 0 ? num(item.preco) / base * total : 0;
  }

  const base = pesoTotal(grupo);
  return base > 0 ? num(item.peso) / base * total : 0;
}

function freteItem(item) {
  return dados.fretes.reduce((soma, frete) => {
    if (String(item.freteId) !== String(frete.id)) return soma;
    const grupo = dados.itens.filter(x => String(x.freteId) === String(frete.id));
    return soma + rateio(item, grupo, frete.rateio, frete.valor);
  }, 0);
}

function impostoItem(item) {
  if (!item.freteId) return 0;
  return dados.impostos.reduce((soma, imposto) => {
    if (String(imposto.freteId) !== String(item.freteId)) return soma;
    const grupo = dados.itens.filter(x => String(x.freteId) === String(imposto.freteId));
    return soma + rateio(item, grupo, imposto.rateio, imposto.valor);
  }, 0);
}

function custo(item) {
  return num(item.preco) + freteItem(item) + impostoItem(item);
}

function nomeRateio(rateio) {
  if (rateio === 'peso') return 'Por peso';
  if (rateio === 'igual') return 'Igualmente';
  return 'Pelo valor dos itens';
}

function listaRecente() {
  return [...dados.fretes].reverse();
}

/* Aparência e controles */
function prepararEstilos() {
  if (document.getElementById('melhoriasAppStyles')) return;

  const style = document.createElement('style');
  style.id = 'melhoriasAppStyles';
  style.textContent = `
    .filter-row {
      display:flex!important;
      flex-wrap:wrap;
      align-items:center;
      gap:9px;
      padding:0 16px 14px
    }
    .filter-row input {
      flex:1 1 210px;
      min-width:150px;
      max-width:360px
    }
    .filter-row select {
      min-width:130px;
      width:auto
    }
    .fold-toolbar {
      display:flex;
      flex-wrap:wrap;
      gap:8px;
      padding:0 16px 14px
    }
    .fold-card {
      margin:12px 16px;
      padding:0!important;
      overflow:hidden
    }
    .fold-head {
      display:flex;
      gap:12px;
      align-items:center;
      justify-content:space-between;
      flex-wrap:wrap;
      padding:13px 14px
    }
    .fold-head-main {
      flex:1;
      min-width:150px
    }
    .fold-content {
      padding:0 14px 14px
    }
    .fold-content[hidden] {
      display:none!important
    }
    .fold-btn {
      border:1px solid #1d4ed8;
      background:#dbeafe;
      color:#1e40af;
      border-radius:9px;
      padding:9px 13px;
      font-size:12px;
      font-weight:800;
      cursor:pointer;
      min-height:38px;
      width:auto;
      white-space:nowrap
    }
    .fold-btn.is-closed {
      background:#1f2937;
      color:#fff;
      border-color:#1f2937
    }
    .fold-btn:hover {
      filter:brightness(.94)
    }
    .frete-edit-grid {
      display:grid;
      grid-template-columns:minmax(180px,2fr) minmax(120px,1fr) minmax(155px,1.2fr);
      gap:9px;
      padding:0 0 12px
    }
    .undo-bar {
      position:fixed;
      left:16px;
      bottom:16px;
      z-index:10000;
      display:flex;
      align-items:center;
      gap:12px;
      flex-wrap:wrap;
      max-width:min(700px,calc(100vw - 32px));
      background:#111827;
      color:#fff;
      padding:12px 14px;
      border-radius:12px;
      box-shadow:0 8px 28px #0003;
      font-size:14px
    }
    .undo-bar[hidden] {
      display:none!important
    }
    .undo-bar button {
      background:#fbbf24;
      color:#422006;
      width:auto;
      min-height:36px
    }
    #cloudStatus {
      padding:7px 11px;
      border-radius:999px;
      box-shadow:0 2px 8px #00000012;
      font-size:12px;
      font-weight:700
    }
    @media(max-width:700px) {
      .frete-edit-grid {
        grid-template-columns:1fr
      }
      .fold-head {
        align-items:flex-start
      }
    }
  `;
  document.head.appendChild(style);
}

function prepararFiltros() {
  const row = document.querySelector('.filter-row');
  if (!row || row.dataset.preparado === '1') return;

  row.innerHTML = `
    <span class="filter-label">Buscar:</span>
    <input id="buscaProduto" type="search"
      placeholder="Nome do produto…" autocomplete="off"
      oninput="renderItens()">

    <span class="filter-label">Situação:</span>
    <select id="filtroStatus" onchange="renderItens()">
      <option value="todos">Todas</option>
      <option value="Comprado">Comprado</option>
      <option value="Na suíte">Na suíte</option>
      <option value="Consolidado">Consolidado</option>
      <option value="Recebido BR">Recebido BR</option>
    </select>

    <span class="filter-label">Peso:</span>
    <select id="filtroPeso" onchange="renderItens()">
      <option value="todos">Todos</option>
      <option value="sem">Sem peso</option>
      <option value="com">Com peso</option>
    </select>`;

  row.dataset.preparado = '1';

  const toolbar = document.createElement('div');
  toolbar.id = 'foldToolbar';
  toolbar.className = 'fold-toolbar';
  toolbar.innerHTML = `
    <button type="button" class="btn-secondary"
      onclick="recolherExpandirTodos(false)">Recolher todos</button>
    <button type="button" class="btn-secondary"
      onclick="recolherExpandirTodos(true)">Expandir todos</button>`;

  row.insertAdjacentElement('afterend', toolbar);
}

function filtroAtivo(item) {
  const busca = (document.getElementById('buscaProduto')?.value || '')
    .trim().toLocaleLowerCase('pt-BR');
  const status = document.getElementById('filtroStatus')?.value || 'todos';
  const peso = document.getElementById('filtroPeso')?.value || 'todos';
  const nome = String(item.item || '').toLocaleLowerCase('pt-BR');

  return (!busca || nome.includes(busca)) &&
    (status === 'todos' || item.status === status) &&
    (peso === 'todos' ||
      (peso === 'sem' ? num(item.peso) <= 0 : num(item.peso) > 0));
}

function iniciarGrupos() {
  if (gruposInicializados) return;
  const maisRecente = dados.fretes[dados.fretes.length - 1];

  if (maisRecente) {
    ['produtos', 'fretes', 'custos'].forEach(area =>
      abertos[area].add(String(maisRecente.id))
    );
  }

  gruposInicializados = true;
}

function alternarGrupo(area, id) {
  const conjunto = abertos[area];
  const chave = String(id);

  if (conjunto.has(chave)) conjunto.delete(chave);
  else conjunto.add(chave);

  if (area === 'produtos') renderItens();
  else if (area === 'fretes') renderFretes();
  else renderCustos();
}

function botaoAbrir(area, id, aberto) {
  return `<button type="button"
    class="fold-btn ${aberto ? '' : 'is-closed'}"
    onclick="alternarGrupo('${area}','${String(id)}')">${
      aberto ? '▼ RECOLHER' : '＋ EXPANDIR'
    }</button>`;
}

function recolherExpandirTodos(expandir) {
  ['produtos', 'fretes', 'custos'].forEach(area => {
    abertos[area].clear();
    if (expandir) {
      dados.fretes.forEach(f => abertos[area].add(String(f.id)));
    }
  });

  renderItens();
  renderFretes();
  renderCustos();
}

/* Produtos */
async function adicionarItem() {
  const nome = document.getElementById('item').value.trim();
  if (!nome) return alert('Digite o nome do item.');

  const item = {
    id: crypto.randomUUID(),
    item: nome,
    preco: num(document.getElementById('preco').value),
    peso: num(document.getElementById('peso').value) / 1000,
    status: document.getElementById('status').value,
    freteId: ''
  };

  setStatus('Salvando…');

  try {
    await apiFetch('/items', {
      method: 'POST',
      body: JSON.stringify(remoteItem(item))
    });

    dados.itens.push(item);
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

function editarItem(i, campo, valor) {
  const item = dados.itens[i];
  if (!item) return;

  if (campo === 'peso') item.peso = num(valor) / 1000;
  else item[campo] = campo === 'preco' ? num(valor) : valor;

  const linha = document.activeElement?.closest('tr');
  const celula = linha?.querySelector('.cost-final');
  if (celula) celula.textContent = moeda.format(custo(item));

  renderFretes();
  renderCustos();
  renderResumo();

  if (campo === 'status') renderItens();

  schedule('item-' + item.id, () =>
    apiFetch('/items/' + encodeURIComponent(item.id), {
      method: 'PUT',
      body: JSON.stringify(remoteItem(item))
    })
  );
}

function atribuirFrete(i, id) {
  const item = dados.itens[i];
  if (!item) return;

  item.freteId = id;
  schedule('item-' + item.id, () =>
    apiFetch('/items/' + encodeURIComponent(item.id), {
      method: 'PUT',
      body: JSON.stringify(remoteItem(item))
    })
  );

  render();
}

function renderItens() {
  prepararFiltros();
  const box = document.getElementById('itensContainer');
  const alerta = document.getElementById('pesoAlert');
  if (!box) return;

  iniciarGrupos();
  const fretes = listaRecente();
  const avisos = [];

  fretes.forEach(frete => {
    const grupo = dados.itens.filter(
      item => String(item.freteId) === String(frete.id)
    );

    if (frete.rateio === 'peso' && grupo.some(item => num(item.peso) <= 0)) {
      avisos.push(
        `${esc(frete.nome)}: ${grupo.filter(item => num(item.peso) <= 0).length} item(ns) sem peso.`
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
      return '<div class="empty">Nenhum produto corresponde aos filtros.</div>';
    }

    let html = '<div class="table-wrap"><table><thead><tr>' +
      '<th>Item</th><th>Preço</th><th>Peso (g)</th><th>Status</th>' +
      '<th>Frete</th><th>Custo final</th><th>Ação</th>' +
      '</tr></thead><tbody>';

    grupo.forEach(item => {
      const i = dados.itens.indexOf(item);

      html += `<tr>
        <td><input value="${esc(item.item)}"
          aria-label="Nome do produto"
          oninput="editarItem(${i},'item',this.value)"
          onchange="renderItens()"></td>

        <td><input type="number" min="0" step="0.01"
          value="${item.preco || ''}"
          aria-label="Preço em reais"
          oninput="editarItem(${i},'preco',this.value)"></td>

        <td><input type="number" min="0" step="1"
          value="${item.peso ? Math.round(item.peso * 1000) : ''}"
          aria-label="Peso em gramas"
          oninput="editarItem(${i},'peso',this.value)"></td>

        <td><select onchange="editarItem(${i},'status',this.value)">
          ${['Comprado','Na suíte','Consolidado','Recebido BR']
            .map(s => `<option ${item.status === s ? 'selected' : ''}>${s}</option>`)
            .join('')}
        </select></td>

        <td><select onchange="atribuirFrete(${i},this.value)">
          <option value="">Sem remessa</option>
          ${fretes.map(f => `<option value="${esc(f.id)}"
            ${String(item.freteId) === String(f.id) ? 'selected' : ''}>
            ${esc(f.nome)}
          </option>`).join('')}
        </select></td>

        <td class="cost-final">${moeda.format(custo(item))}</td>

        <td><button type="button" class="btn-danger"
          onclick="excluirItem(${i})">Excluir produto</button></td>
      </tr>`;
    });

    return html + '</tbody></table></div>';
  }

  let html = '';
  let encontrados = 0;

  fretes.forEach(frete => {
    const todos = dados.itens.filter(
      item => String(item.freteId) === String(frete.id)
    );
    const grupo = todos.filter(filtroAtivo);

    if (filtroFoiUsado() && !grupo.length) return;

    encontrados += grupo.length;
    const aberto = abertos.produtos.has(String(frete.id));

    html += `<div class="remessa fold-card">
      <div class="fold-head">
        <div class="fold-head-main">
          <div class="remessa-name">${esc(frete.nome)}</div>
          <div class="muted">
            ${todos.length} produto(s) ·
            ${pesoTotal(todos).toFixed(2).replace('.', ',')} kg
          </div>
        </div>
        <span class="pill">${moeda.format(frete.valor)}</span>
        ${botaoAbrir('produtos', frete.id, aberto)}
      </div>
      <div class="fold-content" ${aberto ? '' : 'hidden'}>
        ${tabela(grupo)}
      </div>
    </div>`;
  });

  const semRemessa = dados.itens.filter(item => (
    !item.freteId ||
    !dados.fretes.some(f => String(f.id) === String(item.freteId))
  ) && filtroAtivo(item));

  encontrados += semRemessa.length;

  if (semRemessa.length) {
    html += `<div class="remessa fold-card">
      <div class="fold-head">
        <div class="fold-head-main">
          <div class="remessa-name">Sem remessa</div>
          <div class="muted">
            ${semRemessa.length} produto(s) não vinculados a frete
          </div>
        </div>
      </div>
      <div class="fold-content">${tabela(semRemessa)}</div>
    </div>`;
  }

  box.innerHTML = encontrados
    ? html
    : '<div class="empty">Nenhum produto corresponde à busca ou aos filtros.</div>';
}

function filtroFoiUsado() {
  const busca = (document.getElementById('buscaProduto')?.value || '').trim();
  const status = document.getElementById('filtroStatus')?.value || 'todos';
  const peso = document.getElementById('filtroPeso')?.value || 'todos';
  return !!busca || status !== 'todos' || peso !== 'todos';
}

/* Fretes */
async function adicionarFrete() {
  const nome = document.getElementById('freteNome').value.trim();
  const valor = num(document.getElementById('freteValor').value);

  if (!nome) return alert('Dê um nome para o frete.');
  if (valor <= 0) return alert('Informe o valor do frete.');

  const frete = {
    id: crypto.randomUUID(),
    nome,
    valor,
    rateio: document.getElementById('freteRateio').value
  };

  setStatus('Salvando…');

  try {
    await apiFetch('/fretes', {
      method: 'POST',
      body: JSON.stringify(frete)
    });

    dados.fretes.push(frete);

    ['produtos', 'fretes', 'custos'].forEach(area => {
      abertos[area].clear();
      abertos[area].add(String(frete.id));
    });

    document.getElementById('freteNome').value = '';
    document.getElementById('freteValor').value = '';
    gruposInicializados = true;

    render();
    setStatus('Salvo na nuvem');
  } catch {
    setStatus('Falha ao salvar frete', false);
  }
}

function editarFrete(id, campo, valor) {
  const frete = dados.fretes.find(f => String(f.id) === String(id));
  if (!frete) return;

  frete[campo] = campo === 'valor' ? num(valor) : valor;

  renderCustos();
  renderResumo();

  schedule('frete-' + frete.id, () =>
    apiFetch('/fretes/' + encodeURIComponent(frete.id), {
      method: 'PUT',
      body: JSON.stringify(frete)
    })
  );
}

function finalizarEdicaoFrete() {
  render();
}

function editarRateio(id, valor) {
  const frete = dados.fretes.find(f => String(f.id) === String(id));
  if (!frete) return;

  frete.rateio = valor;
  setStatus('Salvando…');

  apiFetch('/fretes/' + encodeURIComponent(frete.id), {
    method: 'PUT',
    body: JSON.stringify(frete)
  }).then(() => {
    render();
    setStatus('Salvo na nuvem');
  }).catch(() => setStatus('Falha ao salvar', false));
}

function renderFretes() {
  const box = document.getElementById('fretesContainer');
  if (!box) return;

  iniciarGrupos();
  const fretes = listaRecente();

  if (!fretes.length) {
    box.innerHTML = '<div class="empty">Nenhum frete salvo ainda.</div>';
    return;
  }

  let html = '<div class="remessa-list">';

  fretes.forEach(frete => {
    const grupo = dados.itens.filter(item => String(item.freteId) === String(frete.id));
    const peso = pesoTotal(grupo);
    const semPeso = grupo.filter(item => num(item.peso) <= 0).length;
    const impostos = dados.impostos.filter(t => String(t.freteId) === String(frete.id));
    const nomes = grupo.map(item => item.item).join(', ') || 'Nenhum produto vinculado ainda';
    const aberto = abertos.fretes.has(String(frete.id));

    html += `<div class="remessa fold-card">
      <div class="fold-head">
        <div class="fold-head-main">
          <div class="remessa-name">${esc(frete.nome)}</div>
          <div class="muted">${grupo.length} produto(s)</div>
        </div>
        <span class="pill">${moeda.format(frete.valor)}</span>
        ${botaoAbrir('fretes', frete.id, aberto)}
      </div>

      <div class="fold-content" ${aberto ? '' : 'hidden'}>
        <div class="remessa-meta">
          <span class="pill">Rateio: ${nomeRateio(frete.rateio)}</span>
          <span class="pill">${peso.toFixed(2).replace('.', ',')} kg total</span>
          <span class="pill">${impostos.length} imposto(s)</span>
          ${frete.rateio === 'peso' && semPeso ? `
            <span class="pill" style="background:#fff7ed;color:#9a3412">
              ${semPeso} sem peso
            </span>` : ''}
        </div>

        <div class="remessa-items">${esc(nomes)}</div>

        <div class="frete-edit-grid">
          <input type="text" value="${esc(frete.nome)}"
            aria-label="Nome do frete" placeholder="Nome do frete"
            oninput="editarFrete('${String(frete.id)}','nome',this.value)"
            onchange="finalizarEdicaoFrete()">

          <input type="number" min="0" step="0.01"
            value="${frete.valor}" aria-label="Valor do frete"
            oninput="editarFrete('${String(frete.id)}','valor',this.value)"
            onchange="finalizarEdicaoFrete()">

          <select aria-label="Tipo de rateio"
            onchange="editarRateio('${String(frete.id)}',this.value)">
            <option value="peso" ${frete.rateio === 'peso' ? 'selected' : ''}>Ratear por peso</option>
            <option value="igual" ${frete.rateio === 'igual' ? 'selected' : ''}>Dividir igualmente</option>
            <option value="valor" ${frete.rateio === 'valor' ? 'selected' : ''}>Ratear pelo valor</option>
          </select>
        </div>

        <button type="button" class="btn-danger"
          onclick="excluirFrete('${String(frete.id)}')">
          Excluir frete "${esc(frete.nome)}"
        </button>
      </div>
    </div>`;
  });

  box.innerHTML = html + '</div>';
}

/* Impostos */
async function salvarImposto() {
  const freteId = document.getElementById('impostoFrete').value;
  const valor = num(document.getElementById('impostoValor').value);

  if (!freteId) return alert('Crie ou selecione um frete primeiro.');
  if (valor <= 0) return alert('Informe o valor do imposto.');

  const imposto = {
    id: crypto.randomUUID(),
    freteId,
    valor,
    rateio: document.getElementById('impostoRateio').value
  };

  setStatus('Salvando…');

  try {
    await apiFetch('/impostos', {
      method: 'POST',
      body: JSON.stringify(imposto)
    });

    dados.impostos.push(imposto);
    document.getElementById('impostoValor').value = '';
    render();
    setStatus('Imposto salvo');
  } catch {
    setStatus('Falha ao salvar imposto', false);
  }
}

function renderImpostos() {
  const select = document.getElementById('impostoFrete');
  const box = document.getElementById('impostosContainer');
  if (!select || !box) return;

  const anterior = select.value;

  select.innerHTML = dados.fretes.length
    ? listaRecente().map(frete =>
        `<option value="${esc(frete.id)}">${esc(frete.nome)}</option>`
      ).join('')
    : '<option value="">Crie um frete primeiro</option>';

  if ([...select.options].some(option => option.value === anterior)) {
    select.value = anterior;
  }

  if (!dados.impostos.length) {
    box.innerHTML = '<div class="empty">Nenhum imposto cadastrado ainda.</div>';
    return;
  }

  let html = '<div class="remessa-list">';

  [...dados.impostos].reverse().forEach(imposto => {
    const frete = dados.fretes.find(f => String(f.id) === String(imposto.freteId));

    html += `<div class="remessa">
      <div class="remessa-top">
        <div>
          <div class="remessa-name">${esc(frete ? frete.nome : 'Frete removido')}</div>
          <div class="muted">Imposto vinculado a esta remessa</div>
        </div>
        <button type="button" class="btn-danger"
          onclick="excluirImposto('${String(imposto.id)}')">
          Excluir imposto de ${moeda.format(imposto.valor)}
        </button>
      </div>

      <div class="remessa-meta">
        <span class="pill">${moeda.format(imposto.valor)}</span>
        <span class="pill">Rateio: ${nomeRateio(imposto.rateio)}</span>
      </div>
    </div>`;
  });

  box.innerHTML = html + '</div>';
}

/* Desfazer exclusão: um produto, frete ou imposto por vez. */
function garantirBarraDesfazer() {
  let bar = document.getElementById('undoBar');
  if (bar) return bar;

  bar = document.createElement('div');
  bar.id = 'undoBar';
  bar.className = 'undo-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  document.body.appendChild(bar);
  return bar;
}

function mostrarDesfazer(mensagem) {
  const bar = garantirBarraDesfazer();
  bar.innerHTML = `<span>${esc(mensagem)}</span>
    <button type="button" onclick="desfazerExclusao()">Desfazer</button>
    <button type="button" class="btn-secondary" onclick="descartarDesfazer()">Fechar</button>`;
  bar.hidden = false;
}

function descartarDesfazer() {
  ultimaExclusao = null;
  const bar = document.getElementById('undoBar');
  if (bar) bar.hidden = true;
}

async function excluirItem(i) {
  const item = dados.itens[i];
  if (!item) return;

  if (!confirm(`Excluir o produto "${item.item}"?\n\nVocê poderá desfazer logo depois.`)) return;

  cancelScheduled('item-' + item.id);
  setStatus('Salvando exclusão…');

  try {
    await apiFetch('/items/' + encodeURIComponent(item.id), { method: 'DELETE' });
    ultimaExclusao = { tipo: 'item', item: { ...item } };
    dados.itens.splice(i, 1);

    render();
    mostrarDesfazer(`Produto "${item.item}" excluído.`);
    setStatus('Exclusão salva');
  } catch {
    setStatus('Falha ao excluir produto', false);
  }
}

async function excluirFrete(id) {
  const frete = dados.fretes.find(f => String(f.id) === String(id));
  if (!frete) return;

  const itens = dados.itens
    .filter(item => String(item.freteId) === String(id))
    .map(item => ({ ...item }));

  const impostos = dados.impostos
    .filter(imposto => String(imposto.freteId) === String(id))
    .map(imposto => ({ ...imposto }));

  const mensagem = `Excluir o frete "${frete.nome}"?\n\n` +
    `${itens.length} produto(s) ficarão sem remessa.\n` +
    `${impostos.length} imposto(s) vinculados também serão removidos.\n\n` +
    'Você poderá desfazer logo depois.';

  if (!confirm(mensagem)) return;

  cancelScheduled('frete-' + frete.id);
  itens.forEach(item => cancelScheduled('item-' + item.id));
  setStatus('Salvando exclusão…');

  try {
    await apiFetch('/fretes/' + encodeURIComponent(id), { method: 'DELETE' });

    ultimaExclusao = {
      tipo: 'frete',
      frete: { ...frete },
      itens,
      impostos
    };

    dados.fretes = dados.fretes.filter(f => String(f.id) !== String(id));
    dados.impostos = dados.impostos.filter(t => String(t.freteId) !== String(id));
    dados.itens.forEach(item => {
      if (String(item.freteId) === String(id)) item.freteId = '';
    });

    ['produtos', 'fretes', 'custos'].forEach(area =>
      abertos[area].delete(String(id))
    );

    render();
    mostrarDesfazer(`Frete "${frete.nome}" excluído.`);
    setStatus('Exclusão salva');
  } catch {
    setStatus('Falha ao excluir frete', false);
  }
}

async function excluirImposto(id) {
  const imposto = dados.impostos.find(t => String(t.id) === String(id));
  if (!imposto) return;

  const frete = dados.fretes.find(f => String(f.id) === String(imposto.freteId));

  if (!confirm(
    `Excluir o imposto de ${moeda.format(imposto.valor)} do frete "${frete ? frete.nome : 'não encontrado'}"?\n\nVocê poderá desfazer logo depois.`
  )) return;

  setStatus('Salvando exclusão…');

  try {
    await apiFetch('/impostos/' + encodeURIComponent(id), { method: 'DELETE' });
    ultimaExclusao = { tipo: 'imposto', imposto: { ...imposto } };
    dados.impostos = dados.impostos.filter(t => String(t.id) !== String(id));

    render();
    mostrarDesfazer(`Imposto de ${moeda.format(imposto.valor)} excluído.`);
    setStatus('Exclusão salva');
  } catch {
    setStatus('Falha ao excluir imposto', false);
  }
}

async function desfazerExclusao() {
  if (!ultimaExclusao) return;

  const snapshot = ultimaExclusao;
  setStatus('Restaurando…');

  try {
    if (snapshot.tipo === 'item') {
      await apiFetch('/items', {
        method: 'POST',
        body: JSON.stringify(remoteItem(snapshot.item))
      });
      dados.itens.push({ ...snapshot.item });

    } else if (snapshot.tipo === 'imposto') {
      await apiFetch('/impostos', {
        method: 'POST',
        body: JSON.stringify(snapshot.imposto)
      });
      dados.impostos.push({ ...snapshot.imposto });

    } else if (snapshot.tipo === 'frete') {
      await apiFetch('/fretes', {
        method: 'POST',
        body: JSON.stringify(snapshot.frete)
      });

      // A exclusão do frete mantém os produtos, mas os desvincula.
      for (const antigo of snapshot.itens) {
        const atual = dados.itens.find(item => String(item.id) === String(antigo.id));
        if (!atual) continue;

        const restaurado = { ...atual, freteId: String(snapshot.frete.id) };

        await apiFetch('/items/' + encodeURIComponent(restaurado.id), {
          method: 'PUT',
          body: JSON.stringify(remoteItem(restaurado))
        });

        atual.freteId = restaurado.freteId;
      }

      for (const imposto of snapshot.impostos) {
        await apiFetch('/impostos', {
          method: 'POST',
          body: JSON.stringify(imposto)
        });
        dados.impostos.push({ ...imposto });
      }

      dados.fretes.push({ ...snapshot.frete });

      ['produtos', 'fretes', 'custos'].forEach(area =>
        abertos[area].add(String(snapshot.frete.id))
      );
    }

    ultimaExclusao = null;
    const bar = document.getElementById('undoBar');
    if (bar) bar.hidden = true;

    render();
    setStatus('Exclusão desfeita');

  } catch {
    try {
      dados = await apiFetch('/data');
      render();
    } catch {}

    setStatus('Não foi possível desfazer completamente. Atualize e confira os dados.', false);
  }
}

/* Custos por remessa */
function renderCustos() {
  const box = document.getElementById('custoContainer');
  if (!box) return;

  iniciarGrupos();

  if (!dados.itens.length) {
    box.innerHTML = '<div class="empty">Cadastre produtos para ver o custo.</div>';
    return;
  }

  function tabela(lista) {
    let html = '<div class="table-wrap"><table><thead><tr>' +
      '<th>Item</th><th>Preço pago</th><th>Frete rateado</th>' +
      '<th>Imposto rateado</th><th>Custo final</th>' +
      '</tr></thead><tbody>';

    lista.forEach(item => {
      html += `<tr>
        <td>${esc(item.item)}</td>
        <td>${moeda.format(item.preco)}</td>
        <td>${moeda.format(freteItem(item))}</td>
        <td>${moeda.format(impostoItem(item))}</td>
        <td class="cost-final">${moeda.format(custo(item))}</td>
      </tr>`;
    });

    return html + '</tbody></table></div>';
  }

  let html = '';

  listaRecente().forEach(frete => {
    const grupo = dados.itens.filter(item => String(item.freteId) === String(frete.id));
    if (!grupo.length) return;

    const soma = grupo.reduce((total, item) => total + custo(item), 0);
    const aberto = abertos.custos.has(String(frete.id));

    html += `<div class="remessa fold-card">
      <div class="fold-head">
        <div class="fold-head-main">
          <div class="remessa-name">${esc(frete.nome)}</div>
          <div class="muted">${grupo.length} produto(s) · custo total</div>
        </div>
        <span class="pill">${moeda.format(soma)}</span>
        ${botaoAbrir('custos', frete.id, aberto)}
      </div>
      <div class="fold-content" ${aberto ? '' : 'hidden'}>
        ${tabela(grupo)}
      </div>
    </div>`;
  });

  const sem = dados.itens.filter(item =>
    !item.freteId ||
    !dados.fretes.some(frete => String(frete.id) === String(item.freteId))
  );

  if (sem.length) {
    const soma = sem.reduce((total, item) => total + custo(item), 0);

    html += `<div class="remessa fold-card">
      <div class="fold-head">
        <div class="fold-head-main">
          <div class="remessa-name">Sem remessa</div>
          <div class="muted">${sem.length} produto(s) · custo total</div>
        </div>
        <span class="pill">${moeda.format(soma)}</span>
      </div>
      <div class="fold-content">${tabela(sem)}</div>
    </div>`;
  }

  box.innerHTML = html;
}

function renderResumo() {
  const totalItens = valorTotal(dados.itens);
  const totalFretes = dados.fretes.reduce((soma, f) => soma + num(f.valor), 0);
  const impostos = dados.impostos.reduce((soma, t) => soma + num(t.valor), 0);

  document.getElementById('totalItens').textContent = moeda.format(totalItens);
  document.getElementById('totalFretes').textContent = moeda.format(totalFretes);
  document.getElementById('totalImpostos').textContent = moeda.format(impostos);
  document.getElementById('jaPago').textContent = moeda.format(totalItens + totalFretes);
  document.getElementById('custoFinal').textContent = moeda.format(totalItens + totalFretes + impostos);
}

function render() {
  prepararEstilos();
  prepararFiltros();
  iniciarGrupos();
  renderItens();
  renderFretes();
  renderImpostos();
  renderCustos();
  renderResumo();
  garantirBarraDesfazer();
}

/* Backup */
function exportarBackup() {
  const blob = new Blob([JSON.stringify(dados, null, 2)], {
    type: 'application/json'
  });
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
    const backup = normalize(JSON.parse(await file.text()));

    if (!confirm('Importar este backup substituirá os dados atuais. Continuar?')) return;

    setStatus('Importando backup…');

    await apiFetch('/import', {
      method: 'POST',
      body: JSON.stringify(backup)
    });

    dados = backup;
    gruposInicializados = false;
    ['produtos', 'fretes', 'custos'].forEach(area => abertos[area].clear());

    render();
    setStatus('Backup importado');
  } catch {
    alert('Não foi possível importar o backup.');
    setStatus('Falha ao importar', false);
  } finally {
    event.target.value = '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  prepararEstilos();
  prepararFiltros();
  garantirBarraDesfazer();

  if (appKey) entrar();
  else document.getElementById('appPassword')?.focus();
});
