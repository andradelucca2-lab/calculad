
const moeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

const API = '/api';
let appKey = sessionStorage.getItem('controle_app_key') || '';
let dados = {
  itens: [],
  fretes: [],
  impostos: []
};

const timers = new Map();

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
  const pw = document.getElementById('appPassword').value;
  if (!pw) return;

  appKey = pw;

  try {
    const d = await apiFetch('/data');

    sessionStorage.setItem('controle_app_key', appKey);
    document.getElementById('loginOverlay').style.display = 'none';

    dados = d;

    const old = localStorage.getItem('controle_compras_fretes_v2');

    if (!d.itens.length && !d.fretes.length && !d.impostos.length && old) {
      const x = normalize(JSON.parse(old));

      await apiFetch('/import', {
        method: 'POST',
        body: JSON.stringify(x)
      });

      dados = x;
      setStatus('Dados locais importados');
    } else {
      setStatus('Sincronizado');
    }

    render();
  } catch {
    appKey = '';
    sessionStorage.removeItem('controle_app_key');

    document.getElementById('loginError').style.display = 'block';
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

function pesoTotal(a) {
  return a.reduce((s, x) => s + num(x.peso), 0);
}

function valorTotal(a) {
  return a.reduce((s, x) => s + num(x.preco), 0);
}

function rateio(item, grupo, tipo, total) {
  if (total <= 0 || !grupo.length) return 0;

  if (tipo === 'igual') {
    return total / grupo.length;
  }

  if (tipo === 'valor') {
    const b = valorTotal(grupo);
    return b > 0 ? num(item.preco) / b * total : 0;
  }

  const b = pesoTotal(grupo);
  return b > 0 ? num(item.peso) / b * total : 0;
}

function freteItem(x) {
  return dados.fretes.reduce((s, f) => {
    if (String(x.freteId) !== String(f.id)) return s;

    const g = dados.itens.filter(
      i => String(i.freteId) === String(f.id)
    );

    return s + rateio(x, g, f.rateio, f.valor);
  }, 0);
}

function impostoItem(x) {
  if (!x.freteId) return 0;

  return dados.impostos.reduce((s, t) => {
    if (String(t.freteId) !== String(x.freteId)) return s;

    const g = dados.itens.filter(
      i => String(i.freteId) === String(t.freteId)
    );

    return s + rateio(x, g, t.rateio, t.valor);
  }, 0);
}

function custo(x) {
  return num(x.preco) + freteItem(x) + impostoItem(x);
}

function tipo(r) {
  return r === 'peso'
    ? 'Por peso'
    : r === 'igual'
      ? 'Igualmente'
      : 'Pelo valor dos itens';
}

function remoteItem(x) {
  return {
    ...x,
    peso_g: num(x.peso) * 1000
  };
}

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

    document.getElementById('freteNome').value = '';
    document.getElementById('freteValor').value = '';

    render();
    setStatus('Salvo na nuvem');
  } catch {
    setStatus('Falha ao salvar', false);
  }
}

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
    setStatus('Salvo na nuvem');
  } catch {
    setStatus('Falha ao salvar', false);
  }
}

function editarItem(i, campo, v) {
  const x = dados.itens[i];

  if (campo === 'peso') {
    x.peso = num(v) / 1000;
  } else {
    x[campo] = campo === 'preco' ? num(v) : v;
  }

  const row = document.activeElement?.closest('tr');
  const costCell = row?.querySelector('.cost-final');

  if (costCell) costCell.textContent = moeda.format(custo(x));

  renderFretes();
  renderCustos();
  renderResumo();

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

function editarFrete(id, campo, v) {
  const f = dados.fretes.find(x => String(x.id) === String(id));
  if (!f) return;

  f[campo] = campo === 'valor' ? num(v) : v;

  renderFretes();
  renderCustos();
  renderResumo();

  schedule('frete-' + f.id, () =>
    apiFetch('/fretes/' + encodeURIComponent(f.id), {
      method: 'PUT',
      body: JSON.stringify(f)
    })
  );
}

function editarRateio(id, v) {
  const f = dados.fretes.find(x => String(x.id) === String(id));
  if (!f) return;

  f.rateio = v;

  apiFetch('/fretes/' + encodeURIComponent(f.id), {
    method: 'PUT',
    body: JSON.stringify(f)
  })
    .then(() => setStatus('Salvo na nuvem'))
    .catch(() => setStatus('Falha ao salvar', false));

  render();
}

async function excluirItem(i) {
  const x = dados.itens[i];

  if (!confirm('Excluir este item?')) return;

  try {
    await apiFetch('/items/' + encodeURIComponent(x.id), {
      method: 'DELETE'
    });

    dados.itens.splice(i, 1);
    render();
  } catch {
    setStatus('Falha ao excluir', false);
  }
}

async function excluirFrete(id) {
  if (!confirm(
    'Excluir este frete? Os itens continuarão cadastrados, mas ficarão sem remessa.'
  )) return;

  try {
    await apiFetch('/fretes/' + encodeURIComponent(id), {
      method: 'DELETE'
    });

    dados.fretes = dados.fretes.filter(
      f => String(f.id) !== String(id)
    );

    dados.impostos = dados.impostos.filter(
      t => String(t.freteId) !== String(id)
    );

    dados.itens.forEach(x => {
      if (String(x.freteId) === String(id)) x.freteId = '';
    });

    render();
  } catch {
    setStatus('Falha ao excluir', false);
  }
}

async function excluirImposto(id) {
  if (!confirm('Excluir este imposto?')) return;

  try {
    await apiFetch('/impostos/' + encodeURIComponent(id), {
      method: 'DELETE'
    });

    dados.impostos = dados.impostos.filter(
      t => String(t.id) !== String(id)
    );

    render();
  } catch {
    setStatus('Falha ao excluir', false);
  }
}

// PRODUTOS AGRUPADOS POR FRETE

function renderItens() {
  const box = document.getElementById('itensContainer');
  const al = document.getElementById('pesoAlert');
  const filterRow = document.querySelector('.filter-row');

  if (filterRow) filterRow.style.display = 'none';

  const warn = [];

  [...dados.fretes].reverse().forEach(r => {
    const g = dados.itens.filter(
      x => String(x.freteId) === String(r.id)
    );

    if (r.rateio === 'peso' && g.some(x => num(x.peso) <= 0)) {
      warn.push(
        `${esc(r.nome)}: ${g.filter(x => num(x.peso) <= 0).length} item(ns) sem peso.`
      );
    }
  });

  al.innerHTML = warn.length
    ? `<div class="alert">⚠️ ${warn.join('<br>')}</div>`
    : '';

  if (!dados.itens.length && !dados.fretes.length) {
    box.innerHTML = '<div class="empty">Nenhum produto cadastrado ainda.</div>';
    return;
  }

  const fretesRecentes = [...dados.fretes].reverse();

  function tabela(grupo) {
    if (!grupo.length) {
      return '<div class="empty">Nenhum produto vinculado a este frete ainda.</div>';
    }

    let t = `
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

      t += `<tr>
        <td><input value="${esc(x.item)}"
          oninput="editarItem(${i},'item',this.value)"></td>

        <td><input type="number" min="0" step="0.01"
          value="${x.preco || ''}"
          oninput="editarItem(${i},'preco',this.value)"></td>

        <td><input type="number" min="0" step="1"
          value="${x.peso ? Math.round(x.peso * 1000) : ''}"
          oninput="editarItem(${i},'peso',this.value)"></td>

        <td><select onchange="editarItem(${i},'status',this.value)">
          ${['Comprado', 'Na suíte', 'Consolidado', 'Recebido BR']
            .map(st => `<option ${x.status === st ? 'selected' : ''}>${st}</option>`)
            .join('')}
        </select></td>

        <td><select onchange="atribuirFrete(${i},this.value)">
          <option value="">Sem remessa</option>
          ${fretesRecentes.map(r => `
            <option value="${esc(r.id)}"
              ${String(x.freteId) === String(r.id) ? 'selected' : ''}>
              ${esc(r.nome)}
            </option>`).join('')}
        </select></td>

        <td class="cost-final">${moeda.format(custo(x))}</td>

        <td><button type="button" class="btn-danger"
          onclick="excluirItem(${i})">Excluir</button></td>
      </tr>`;
    });

    return t + '</tbody></table></div>';
  }

  let html = '';

  fretesRecentes.forEach(r => {
    const grupo = dados.itens.filter(
      x => String(x.freteId) === String(r.id)
    );

    const peso = pesoTotal(grupo);

    html += `
      <div class="remessa" style="margin:12px 16px">
        <div class="remessa-top">
          <div>
            <div class="remessa-name">${esc(r.nome)}</div>
            <div class="muted">
              ${grupo.length} produto(s) nesta remessa ·
              ${peso.toFixed(2).replace('.', ',')} kg
            </div>
          </div>
          <span class="pill">${moeda.format(r.valor)}</span>
        </div>
        ${tabela(grupo)}
      </div>`;
  });

  const sem = dados.itens.filter(
    x => !x.freteId ||
      !dados.fretes.some(r => String(r.id) === String(x.freteId))
  );

  if (sem.length) {
    html += `
      <div class="remessa" style="margin:12px 16px">
        <div class="remessa-top">
          <div>
            <div class="remessa-name">Sem remessa</div>
            <div class="muted">
              ${sem.length} produto(s) ainda não vinculados a um frete
            </div>
          </div>
        </div>
        ${tabela(sem)}
      </div>`;
  }

  box.innerHTML = html;
}

// FRETES MAIS RECENTES PRIMEIRO

function renderFretes() {
  const b = document.getElementById('fretesContainer');

  if (!dados.fretes.length) {
    b.innerHTML = '<div class="empty">Nenhum frete salvo ainda.</div>';
    return;
  }

  let h = '<div class="remessa-list">';

  [...dados.fretes].reverse().forEach(f => {
    const g = dados.itens.filter(
      x => String(x.freteId) === String(f.id)
    );

    const peso = pesoTotal(g);
    const missing = g.filter(x => x.peso <= 0).length;
    const nomes = g.map(x => x.item).join(', ') || 'Nenhum item vinculado';

    h += `
      <div class="remessa">
        <div class="remessa-top">
          <div>
            <div class="remessa-name">${esc(f.nome)}</div>
            <div class="muted">${g.length} item(ns)</div>
          </div>
          <button type="button" class="btn-danger"
            onclick="excluirFrete('${String(f.id)}')">Excluir</button>
        </div>

        <div class="remessa-meta">
          <span class="pill">${moeda.format(f.valor)}</span>
          <span class="pill">Rateio: ${tipo(f.rateio)}</span>
          <span class="pill">${peso.toFixed(2).replace('.', ',')} kg total</span>
          ${f.rateio === 'peso' && missing ? `
            <span class="pill" style="background:#fff7ed;color:#9a3412">
              ${missing} sem peso
            </span>` : ''}
        </div>

        <div class="remessa-items">${esc(nomes)}</div>

        <div class="form" style="padding:0;grid-template-columns:1fr 1fr">
          <input type="number" min="0" step="0.01"
            value="${f.valor}"
            oninput="editarFrete('${String(f.id)}','valor',this.value)">

          <select onchange="editarRateio('${String(f.id)}',this.value)">
            <option value="peso" ${f.rateio === 'peso' ? 'selected' : ''}>Ratear por peso</option>
            <option value="igual" ${f.rateio === 'igual' ? 'selected' : ''}>Dividir igualmente</option>
            <option value="valor" ${f.rateio === 'valor' ? 'selected' : ''}>Ratear pelo valor</option>
          </select>
        </div>
      </div>`;
  });

  b.innerHTML = h + '</div>';
}

// IMPOSTOS AGRUPADOS POR FRETE

function renderImpostos() {
  const s = document.getElementById('impostoFrete');
  const old = s.value;

  s.innerHTML = dados.fretes.length
    ? dados.fretes.map(f =>
        `<option value="${esc(f.id)}">${esc(f.nome)}</option>`
      ).join('')
    : '<option value="">Crie um frete primeiro</option>';

  if (old && [...s.options].some(o => o.value === old)) {
    s.value = old;
  }

  const b = document.getElementById('impostosContainer');

  if (!dados.impostos.length) {
    b.innerHTML = '<div class="empty">Nenhum imposto cadastrado ainda.</div>';
    return;
  }

  let h = '<div class="remessa-list">';

  [...dados.impostos].reverse().forEach(t => {
    const f = dados.fretes.find(
      x => String(x.id) === String(t.freteId)
    );

    h += `
      <div class="remessa">
        <div class="remessa-top">
          <div>
            <div class="remessa-name">${esc(f ? f.nome : 'Frete removido')}</div>
            <div class="muted">Imposto vinculado a esta remessa</div>
          </div>
          <button type="button" class="btn-danger"
            onclick="excluirImposto('${String(t.id)}')">Excluir</button>
        </div>

        <div class="remessa-meta">
          <span class="pill">${moeda.format(t.valor)}</span>
          <span class="pill">Rateio: ${tipo(t.rateio)}</span>
        </div>
      </div>`;
  });

  b.innerHTML = h + '</div>';
}

// CUSTO POR ITEM AGRUPADO POR FRETE

function renderCustos() {
  const b = document.getElementById('custoContainer');

  if (!dados.itens.length) {
    b.innerHTML = '<div class="empty">Cadastre produtos para ver o custo.</div>';
    return;
  }

  function tabela(grupo) {
    if (!grupo.length) {
      return '<div class="empty">Nenhum produto nesta remessa.</div>';
    }

    let h = `
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
      h += `
        <tr>
          <td>${esc(x.item)}</td>
          <td>${moeda.format(x.preco)}</td>
          <td>${moeda.format(freteItem(x))}</td>
          <td>${moeda.format(impostoItem(x))}</td>
          <td class="cost-final">${moeda.format(custo(x))}</td>
        </tr>`;
    });

    return h + '</tbody></table></div>';
  }

  let h = '';

  [...dados.fretes].reverse().forEach(f => {
    const grupo = dados.itens.filter(
      x => String(x.freteId) === String(f.id)
    );

    if (!grupo.length) return;

    const soma = grupo.reduce((s, x) => s + custo(x), 0);

    h += `
      <div class="remessa" style="margin:12px 16px">
        <div class="remessa-top">
          <div>
            <div class="remessa-name">${esc(f.nome)}</div>
            <div class="muted">
              ${grupo.length} produto(s) · custo total dos itens desta remessa
            </div>
          </div>
          <span class="pill">${moeda.format(soma)}</span>
        </div>
        ${tabela(grupo)}
      </div>`;
  });

  const sem = dados.itens.filter(
    x => !x.freteId ||
      !dados.fretes.some(f => String(f.id) === String(x.freteId))
  );

  if (sem.length) {
    const soma = sem.reduce((s, x) => s + custo(x), 0);

    h += `
      <div class="remessa" style="margin:12px 16px">
        <div class="remessa-top">
          <div>
            <div class="remessa-name">Sem remessa</div>
            <div class="muted">
              ${sem.length} produto(s) ainda não vinculados a um frete
            </div>
          </div>
          <span class="pill">${moeda.format(soma)}</span>
        </div>
        ${tabela(sem)}
      </div>`;
  }

  b.innerHTML = h;
}

function renderResumo() {
  const a = valorTotal(dados.itens);
  const b = dados.fretes.reduce((s, f) => s + num(f.valor), 0);
  const c = dados.impostos.reduce((s, t) => s + num(t.valor), 0);

  document.getElementById('totalItens').textContent = moeda.format(a);
  document.getElementById('totalFretes').textContent = moeda.format(b);
  document.getElementById('totalImpostos').textContent = moeda.format(c);
  document.getElementById('jaPago').textContent = moeda.format(a + b);
  document.getElementById('custoFinal').textContent = moeda.format(a + b + c);
}

function render() {
  renderItens();
  renderFretes();
  renderImpostos();
  renderCustos();
  renderResumo();
}

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

async function importarBackup(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const x = normalize(JSON.parse(await file.text()));

    if (!confirm('Importar este backup substituirá os dados atuais. Continuar?')) {
      return;
    }

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
    e.target.value = '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (appKey) {
    entrar();
  } else {
    document.getElementById('appPassword').focus();
  }
});
