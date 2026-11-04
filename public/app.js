const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const API = "/api";

let appKey = sessionStorage.getItem("controle_app_key") || "";
let abaAtual = sessionStorage.getItem("controle_aba_atual") || "resumo";
let temaAtual = localStorage.getItem("controle_tema") || "claro";
let dados = { itens: [], fretes: [], impostos: [] };
const timers = new Map();

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function bool(v, padrao) {
  if (v === undefined || v === null || v === "") return !!padrao;
  return v === true || v === 1 || v === "1" || v === "true";
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(m) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m];
  });
}

function aplicarTema(tema) {
  const permitidos = ["claro", "escuro", "azul"];
  if (permitidos.indexOf(tema) < 0) tema = "claro";
  temaAtual = tema;

  const mapa = { claro: "light", escuro: "dark", azul: "blue" };
  document.body.dataset.theme = mapa[tema];
  document.documentElement.style.colorScheme = tema === "escuro" ? "dark" : "light";

  document.querySelectorAll("[data-theme-choice]").forEach(function(btn) {
    btn.classList.toggle("active", btn.dataset.themeChoice === tema);
    btn.setAttribute("aria-pressed", btn.dataset.themeChoice === tema ? "true" : "false");
  });
}

function mudarTema(tema) {
  localStorage.setItem("controle_tema", tema);
  aplicarTema(tema);
}

function setStatus(texto, ok) {
  if (ok === undefined) ok = true;
  const el = document.getElementById("cloudStatus");
  if (!el) return;
  el.textContent = (ok ? "☁ " : "⚠ ") + texto;
  el.style.background = ok ? "var(--greenbg)" : "var(--orangebg)";
  el.style.color = ok ? "var(--green)" : "var(--orange)";
  el.style.borderColor = "var(--line)";
}

async function apiFetch(path, options) {
  options = options || {};
  const headers = Object.assign({
    "Content-Type": "application/json",
    "X-App-Key": appKey
  }, options.headers || {});

  const response = await fetch(API + path, Object.assign({}, options, { headers: headers }));
  if (response.status === 401) throw new Error("AUTH");
  if (!response.ok) throw new Error((await response.text()) || "Erro de servidor");
  return response.status === 204 ? null : response.json();
}

function normalize(source) {
  source = source || {};
  return {
    itens: (source.itens || []).map(function(item) {
      const moedaItem = item.moeda || "BRL";
      const precoOriginal = num(item.precoOriginal != null ? item.precoOriginal : item.preco);
      const cotacao = moedaItem === "BRL" ? 1 : (num(item.cotacao) || 1);
      return {
        id: String(item.id || crypto.randomUUID()),
        item: item.item || "",
        preco: num(item.preco) || precoOriginal * cotacao,
        peso: num(item.peso),
        status: item.status || "Comprado",
        freteId: item.freteId ? String(item.freteId) : "",
        moeda: moedaItem,
        precoOriginal: precoOriginal,
        cotacao: cotacao,
        vendaPrevista: num(item.vendaPrevista),
        plataforma: item.plataforma || "",
        taxaPct: num(item.taxaPct),
        taxaFixa: num(item.taxaFixa),
        pago: bool(item.pago, true)
      };
    }),
    fretes: (source.fretes || []).map(function(frete) {
      return {
        id: String(frete.id || crypto.randomUUID()),
        nome: frete.nome || "Frete",
        valor: num(frete.valor),
        rateio: frete.rateio || "peso",
        status: frete.status || "Montando",
        pago: bool(frete.pago, true)
      };
    }),
    impostos: (source.impostos || []).map(function(imposto) {
      return {
        id: String(imposto.id || crypto.randomUUID()),
        freteId: String(imposto.freteId || ""),
        valor: num(imposto.valor),
        rateio: imposto.rateio || "peso",
        pago: bool(imposto.pago, false)
      };
    })
  };
}

async function entrar() {
  const campo = document.getElementById("appPassword");
  const senha = campo ? campo.value : "";
  if (!senha) return;

  appKey = senha;
  setStatus("Conectando…");

  try {
    const remoto = normalize(await apiFetch("/data"));
    sessionStorage.setItem("controle_app_key", appKey);
    const overlay = document.getElementById("loginOverlay");
    if (overlay) overlay.style.display = "none";

    const antigo = localStorage.getItem("controle_compras_fretes_v2");
    if (!remoto.itens.length && !remoto.fretes.length && !remoto.impostos.length && antigo) {
      const copia = normalize(JSON.parse(antigo));
      await apiFetch("/import", { method: "POST", body: JSON.stringify(copia) });
      dados = copia;
      setStatus("Dados locais importados");
    } else {
      dados = remoto;
      setStatus("Sincronizado");
    }

    render();
  } catch (e) {
    appKey = "";
    sessionStorage.removeItem("controle_app_key");
    const erro = document.getElementById("loginError");
    if (erro) erro.style.display = "block";
    setStatus("Falha ao entrar", false);
  }
}

function schedule(key, task, delay) {
  delay = delay == null ? 650 : delay;
  clearTimeout(timers.get(key));
  setStatus("Salvando…");

  timers.set(key, setTimeout(async function() {
    timers.delete(key);
    try {
      await task();
      setStatus("Salvo na nuvem");
    } catch (e) {
      setStatus("Falha ao salvar", false);
    }
  }, delay));
}

function remoteItem(item) {
  return {
    id: item.id,
    item: item.item,
    preco: num(item.preco),
    peso_g: num(item.peso) * 1000,
    status: item.status,
    freteId: item.freteId || "",
    moeda: item.moeda || "BRL",
    precoOriginal: num(item.precoOriginal),
    cotacao: num(item.cotacao) || 1,
    vendaPrevista: num(item.vendaPrevista),
    plataforma: item.plataforma || "",
    taxaPct: num(item.taxaPct),
    taxaFixa: num(item.taxaFixa),
    pago: !!item.pago
  };
}

function pesoTotal(lista) {
  return lista.reduce(function(total, item) { return total + num(item.peso); }, 0);
}

function valorTotal(lista) {
  return lista.reduce(function(total, item) { return total + num(item.preco); }, 0);
}

function rateio(item, grupo, metodo, total) {
  if (total <= 0 || !grupo.length) return 0;
  if (metodo === "igual") return total / grupo.length;

  if (metodo === "valor") {
    const baseValor = valorTotal(grupo);
    return baseValor > 0 ? num(item.preco) / baseValor * total : 0;
  }

  const basePeso = pesoTotal(grupo);
  return basePeso > 0 ? num(item.peso) / basePeso * total : 0;
}

function freteItem(item) {
  return dados.fretes.reduce(function(soma, frete) {
    if (String(item.freteId) !== String(frete.id)) return soma;
    const grupo = dados.itens.filter(function(x) { return String(x.freteId) === String(frete.id); });
    return soma + rateio(item, grupo, frete.rateio, frete.valor);
  }, 0);
}

function impostoItem(item) {
  if (!item.freteId) return 0;
  return dados.impostos.reduce(function(soma, imposto) {
    if (String(imposto.freteId) !== String(item.freteId)) return soma;
    const grupo = dados.itens.filter(function(x) { return String(x.freteId) === String(imposto.freteId); });
    return soma + rateio(item, grupo, imposto.rateio, imposto.valor);
  }, 0);
}

function custo(item) {
  return num(item.preco) + freteItem(item) + impostoItem(item);
}

function taxaVenda(item) {
  return num(item.vendaPrevista) * num(item.taxaPct) / 100 + num(item.taxaFixa);
}

function vendaLiquida(item) {
  return Math.max(0, num(item.vendaPrevista) - taxaVenda(item));
}

function lucro(item) {
  if (num(item.vendaPrevista) <= 0) return 0;
  return vendaLiquida(item) - custo(item);
}

function margem(item) {
  if (num(item.vendaPrevista) <= 0) return 0;
  return lucro(item) / num(item.vendaPrevista) * 100;
}

function precoEquilibrio(item) {
  const pct = num(item.taxaPct) / 100;
  if (pct >= 1) return 0;
  return (custo(item) + num(item.taxaFixa)) / (1 - pct);
}

function nomeRateio(rateio) {
  if (rateio === "peso") return "Por peso";
  if (rateio === "igual") return "Igual";
  return "Por valor";
}

function statusProgress(status) {
  if (status === "Recebido") return 100;
  if (status === "Alfândega") return 75;
  if (status === "Enviado") return 50;
  return 25;
}

function formatPct(v) {
  return numero.format(v) + "%";
}

function listaRecente() {
  return dados.fretes.slice().reverse();
}

function trocarAba(nome) {
  const permitidas = ["resumo", "produtos", "remessas", "custos", "calc-shopee", "calc-ml", "historico", "backup"];
  if (permitidas.indexOf(nome) < 0) nome = "resumo";
  abaAtual = nome;
  sessionStorage.setItem("controle_aba_atual", nome);

  document.querySelectorAll(".tab-btn").forEach(function(btn) {
    btn.classList.toggle("active", btn.dataset.tab === nome);
  });
  document.querySelectorAll(".tab-panel").forEach(function(panel) {
    panel.classList.toggle("active", panel.dataset.tabPanel === nome);
  });

  if (nome === "historico") carregarHistorico();
  if (nome === "backup") carregarBackups();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function ajustarCotacaoCadastro() {
  const moedaEl = document.getElementById("moeda");
  const cotacaoEl = document.getElementById("cotacao");
  if (!moedaEl || !cotacaoEl) return;
  if (moedaEl.value === "BRL") cotacaoEl.value = "1";
  else if (cotacaoEl.value === "1") cotacaoEl.value = "";
}

async function adicionarItem() {
  const nome = document.getElementById("item").value.trim();
  if (!nome) return alert("Digite o nome do produto.");

  const moedaItem = document.getElementById("moeda").value;
  const precoOriginal = num(document.getElementById("precoOriginal").value);
  const cotacao = moedaItem === "BRL" ? 1 : num(document.getElementById("cotacao").value);
  if (precoOriginal <= 0) return alert("Informe o preço pago.");
  if (moedaItem !== "BRL" && cotacao <= 0) return alert("Informe a cotação usada para converter para BRL.");

  const item = {
    id: crypto.randomUUID(),
    item: nome,
    moeda: moedaItem,
    precoOriginal: precoOriginal,
    cotacao: cotacao || 1,
    preco: precoOriginal * (cotacao || 1),
    peso: num(document.getElementById("peso").value) / 1000,
    status: document.getElementById("status").value,
    freteId: "",
    vendaPrevista: num(document.getElementById("vendaPrevista").value),
    plataforma: document.getElementById("plataforma").value,
    taxaPct: num(document.getElementById("taxaPct").value),
    taxaFixa: num(document.getElementById("taxaFixa").value),
    pago: document.getElementById("itemPago").value === "1"
  };

  setStatus("Salvando…");
  try {
    await apiFetch("/items", { method: "POST", body: JSON.stringify(remoteItem(item)) });
    dados.itens.push(item);
    ["item", "precoOriginal", "peso", "vendaPrevista"].forEach(function(id) {
      document.getElementById(id).value = "";
    });
    document.getElementById("moeda").value = "BRL";
    document.getElementById("cotacao").value = "1";
    document.getElementById("status").value = "Comprado";
    document.getElementById("plataforma").value = "";
    document.getElementById("taxaPct").value = "0";
    document.getElementById("taxaFixa").value = "0";
    document.getElementById("itemPago").value = "1";
    render();
    setStatus("Produto salvo");
  } catch (e) {
    setStatus("Falha ao salvar produto", false);
  }
}

function editarItem(id, campo, valor) {
  const item = dados.itens.find(function(x) { return String(x.id) === String(id); });
  if (!item) return;

  if (["precoOriginal", "cotacao", "peso", "vendaPrevista", "taxaPct", "taxaFixa"].indexOf(campo) >= 0) {
    if (campo === "peso") item.peso = num(valor) / 1000;
    else item[campo] = num(valor);
  } else if (campo === "pago") {
    item.pago = String(valor) === "1";
  } else {
    item[campo] = valor;
  }

  if (campo === "moeda" && item.moeda === "BRL") item.cotacao = 1;
  if (["moeda", "precoOriginal", "cotacao"].indexOf(campo) >= 0) {
    if (item.moeda === "BRL") item.cotacao = 1;
    item.preco = num(item.precoOriginal) * (num(item.cotacao) || 1);
  }

  schedule("item-" + item.id, function() {
    return apiFetch("/items/" + encodeURIComponent(item.id), {
      method: "PUT",
      body: JSON.stringify(remoteItem(item))
    });
  });

  render();
}

function atribuirFrete(id, freteId) {
  editarItem(id, "freteId", freteId);
}

async function excluirItem(id) {
  const item = dados.itens.find(function(x) { return String(x.id) === String(id); });
  if (!item) return;
  if (!confirm('Excluir o produto "' + item.item + '"? Um backup automático poderá ser usado para recuperação.')) return;

  setStatus("Excluindo…");
  try {
    await apiFetch("/items/" + encodeURIComponent(id), { method: "DELETE" });
    dados.itens = dados.itens.filter(function(x) { return String(x.id) !== String(id); });
    render();
    setStatus("Produto excluído");
  } catch (e) {
    setStatus("Falha ao excluir", false);
  }
}

function preencherFiltroRemessas() {
  const select = document.getElementById("filtroRemessa");
  if (!select) return;
  const atual = select.value || "todos";
  let html = '<option value="todos">Todas as remessas</option><option value="sem">Sem remessa</option>';
  listaRecente().forEach(function(f) {
    html += '<option value="' + esc(f.id) + '">' + esc(f.nome) + "</option>";
  });
  select.innerHTML = html;
  if ([].slice.call(select.options).some(function(o) { return o.value === atual; })) select.value = atual;
}

function filtrarItens() {
  const busca = (document.getElementById("buscaProduto")?.value || "").trim().toLocaleLowerCase("pt-BR");
  const status = document.getElementById("filtroStatus")?.value || "todos";
  const remessa = document.getElementById("filtroRemessa")?.value || "todos";
  const peso = document.getElementById("filtroPeso")?.value || "todos";
  const precoMin = num(document.getElementById("filtroPrecoMin")?.value);
  const precoMax = num(document.getElementById("filtroPrecoMax")?.value);
  const resultado = document.getElementById("filtroLucro")?.value || "todos";
  const ordem = document.getElementById("ordenarProdutos")?.value || "recente";

  let lista = dados.itens.filter(function(item) {
    const nome = String(item.item || "").toLocaleLowerCase("pt-BR");
    const okBusca = !busca || nome.indexOf(busca) >= 0;
    const okStatus = status === "todos" || item.status === status;
    const okRemessa = remessa === "todos" ||
      (remessa === "sem" ? !item.freteId : String(item.freteId) === String(remessa));
    const okPeso = peso === "todos" || (peso === "sem" ? num(item.peso) <= 0 : num(item.peso) > 0);
    const custoAtual = custo(item);
    const okMin = precoMin <= 0 || custoAtual >= precoMin;
    const okMax = precoMax <= 0 || custoAtual <= precoMax;
    const l = lucro(item);
    const okResultado = resultado === "todos" ||
      (resultado === "lucro" && num(item.vendaPrevista) > 0 && l >= 0) ||
      (resultado === "prejuizo" && num(item.vendaPrevista) > 0 && l < 0) ||
      (resultado === "semvenda" && num(item.vendaPrevista) <= 0);
    return okBusca && okStatus && okRemessa && okPeso && okMin && okMax && okResultado;
  });

  if (ordem === "custo_desc") lista.sort(function(a, b) { return custo(b) - custo(a); });
  if (ordem === "lucro_desc") lista.sort(function(a, b) { return lucro(b) - lucro(a); });
  if (ordem === "lucro_asc") lista.sort(function(a, b) { return lucro(a) - lucro(b); });
  if (ordem === "peso_desc") lista.sort(function(a, b) { return num(b.peso) - num(a.peso); });
  return lista;
}

function selectOptions(valorAtual, valores, rotulos) {
  return valores.map(function(v, i) {
    return '<option value="' + esc(v) + '"' + (String(valorAtual) === String(v) ? " selected" : "") + ">" + esc(rotulos ? rotulos[i] : v) + "</option>";
  }).join("");
}

function renderItens() {
  const box = document.getElementById("itensContainer");
  if (!box) return;
  preencherFiltroRemessas();

  const lista = filtrarItens();
  if (!dados.itens.length) {
    box.innerHTML = '<div class="empty">Nenhum produto cadastrado.</div>';
    return;
  }
  if (!lista.length) {
    box.innerHTML = '<div class="empty">Nenhum produto corresponde aos filtros.</div>';
    return;
  }

  let html = '<div class="table-wrap"><table><thead><tr>' +
    "<th>Produto</th><th>Preço pago</th><th>Peso</th><th>Status</th><th>Remessa</th><th>Custo final</th><th>Lucro</th><th>Ação</th>" +
    "</tr></thead><tbody>";

  lista.forEach(function(item) {
    const lucroItem = lucro(item);
    const lucroClasse = num(item.vendaPrevista) > 0 ? (lucroItem >= 0 ? "profit-pos" : "profit-neg") : "muted";
    let freteOpts = '<option value="">Sem remessa</option>';
    listaRecente().forEach(function(f) {
      freteOpts += '<option value="' + esc(f.id) + '"' + (String(item.freteId) === String(f.id) ? " selected" : "") + ">" + esc(f.nome) + "</option>";
    });

    html += "<tr>" +
      '<td class="product-name"><input class="table-input" style="min-width:220px" value="' + esc(item.item) + '" onchange="editarItem(\'' + esc(item.id) + '\',\'item\',this.value)"></td>' +
      '<td><div class="strong">' + moeda.format(item.preco) + '</div><div style="margin-top:4px"><span class="pill ' + (item.pago ? "green" : "orange") + '">' + (item.pago ? "Pago" : "Pendente") + "</span></div></td>" +
      '<td><input class="table-input" style="width:90px" type="number" min="0" step="1" value="' + (item.peso ? Math.round(item.peso * 1000) : "") + '" onchange="editarItem(\'' + esc(item.id) + '\',\'peso\',this.value)"> <span class="muted">g</span></td>' +
      '<td><select class="table-input" style="min-width:125px" onchange="editarItem(\'' + esc(item.id) + '\',\'status\',this.value)">' +
      selectOptions(item.status, ["Comprado", "Na suíte", "Consolidado", "Recebido BR"]) + "</select></td>" +
      '<td><select class="table-input" style="min-width:155px" onchange="atribuirFrete(\'' + esc(item.id) + '\',this.value)">' + freteOpts + "</select></td>" +
      '<td class="num strong">' + moeda.format(custo(item)) + "</td>" +
      '<td class="num ' + lucroClasse + '">' + (item.vendaPrevista > 0 ? moeda.format(lucroItem) : "—") + (item.vendaPrevista > 0 ? '<div class="muted" style="font-size:10px;margin-top:3px">' + formatPct(margem(item)) + "</div>" : "") + "</td>" +
      '<td><button class="btn btn-secondary btn-small" onclick="abrirDetalhes(\'' + esc(item.id) + '\')">Detalhes / Editar</button></td>' +
      "</tr>";
  });

  box.innerHTML = html + "</tbody></table></div>";
}

async function adicionarFrete() {
  const nome = document.getElementById("freteNome").value.trim();
  const valor = num(document.getElementById("freteValor").value);
  if (!nome) return alert("Dê um nome para a remessa.");
  if (valor <= 0) return alert("Informe o valor do frete.");

  const frete = {
    id: crypto.randomUUID(),
    nome: nome,
    valor: valor,
    rateio: document.getElementById("freteRateio").value,
    status: document.getElementById("freteStatus").value,
    pago: document.getElementById("fretePago").value === "1"
  };

  setStatus("Salvando…");
  try {
    await apiFetch("/fretes", { method: "POST", body: JSON.stringify(frete) });
    dados.fretes.push(frete);
    document.getElementById("freteNome").value = "";
    document.getElementById("freteValor").value = "";
    document.getElementById("freteRateio").value = "peso";
    document.getElementById("freteStatus").value = "Montando";
    document.getElementById("fretePago").value = "1";
    render();
    setStatus("Remessa criada");
  } catch (e) {
    setStatus("Falha ao criar remessa", false);
  }
}

function editarFrete(id, campo, valor) {
  const frete = dados.fretes.find(function(x) { return String(x.id) === String(id); });
  if (!frete) return;
  if (campo === "valor") frete.valor = num(valor);
  else if (campo === "pago") frete.pago = String(valor) === "1";
  else frete[campo] = valor;

  schedule("frete-" + frete.id, function() {
    return apiFetch("/fretes/" + encodeURIComponent(frete.id), {
      method: "PUT",
      body: JSON.stringify(frete)
    });
  });
  render();
}

async function excluirFrete(id) {
  const frete = dados.fretes.find(function(x) { return String(x.id) === String(id); });
  if (!frete) return;
  const qtd = dados.itens.filter(function(x) { return String(x.freteId) === String(id); }).length;
  if (!confirm('Excluir a remessa "' + frete.nome + '"? ' + qtd + " produto(s) ficarão sem remessa e os impostos vinculados serão removidos.")) return;

  setStatus("Excluindo…");
  try {
    await apiFetch("/fretes/" + encodeURIComponent(id), { method: "DELETE" });
    dados.fretes = dados.fretes.filter(function(x) { return String(x.id) !== String(id); });
    dados.impostos = dados.impostos.filter(function(x) { return String(x.freteId) !== String(id); });
    dados.itens.forEach(function(item) {
      if (String(item.freteId) === String(id)) item.freteId = "";
    });
    render();
    setStatus("Remessa excluída");
  } catch (e) {
    setStatus("Falha ao excluir remessa", false);
  }
}

function renderFretes() {
  const box = document.getElementById("fretesContainer");
  if (!box) return;
  if (!dados.fretes.length) {
    box.innerHTML = '<div class="empty">Nenhuma remessa criada.</div>';
    return;
  }

  let html = "";
  listaRecente().forEach(function(frete) {
    const grupo = dados.itens.filter(function(item) { return String(item.freteId) === String(frete.id); });
    const impostos = dados.impostos.filter(function(t) { return String(t.freteId) === String(frete.id); });
    const peso = pesoTotal(grupo);
    const impostoTotal = impostos.reduce(function(s, t) { return s + num(t.valor); }, 0);
    const custoGrupo = grupo.reduce(function(s, item) { return s + custo(item); }, 0);
    const custoKg = peso > 0 ? num(frete.valor) / peso : 0;
    const nomes = grupo.map(function(item) { return item.item; }).join(", ") || "Nenhum produto vinculado";
    const progresso = statusProgress(frete.status);

    html += '<div class="remessa-card">' +
      '<div class="remessa-head"><div><div class="remessa-title">' + esc(frete.nome) + '</div><div class="muted" style="font-size:11px;margin-top:3px">' + esc(nomes) + "</div></div>" +
      '<div class="remessa-metrics">' +
      '<span class="pill blue">' + esc(frete.status) + "</span>" +
      '<span class="pill">' + grupo.length + " produto(s)</span>" +
      '<span class="pill">' + numero.format(peso) + " kg</span>" +
      '<span class="pill">' + moeda.format(frete.valor) + " frete</span>" +
      '<span class="pill">' + moeda.format(impostoTotal) + " imposto</span>" +
      '<span class="pill">' + moeda.format(custoGrupo) + " custo</span>" +
      '<span class="pill">' + (peso > 0 ? moeda.format(custoKg) + "/kg" : "sem peso") + "</span>" +
      '<span class="pill ' + (frete.pago ? "green" : "orange") + '">' + (frete.pago ? "Frete pago" : "Frete pendente") + "</span>" +
      "</div></div>" +
      '<div class="remessa-edit"><div class="progress"><span style="width:' + progresso + '%"></span></div><div class="form-grid" style="margin-top:11px">' +
      '<div class="field w4"><label>Nome</label><input value="' + esc(frete.nome) + '" onchange="editarFrete(\'' + esc(frete.id) + '\',\'nome\',this.value)"></div>' +
      '<div class="field"><label>Frete (R$)</label><input type="number" min="0" step="0.01" value="' + num(frete.valor) + '" onchange="editarFrete(\'' + esc(frete.id) + '\',\'valor\',this.value)"></div>' +
      '<div class="field"><label>Rateio</label><select onchange="editarFrete(\'' + esc(frete.id) + '\',\'rateio\',this.value)">' + selectOptions(frete.rateio, ["peso", "igual", "valor"], ["Por peso", "Igual", "Por valor"]) + "</select></div>" +
      '<div class="field"><label>Status</label><select onchange="editarFrete(\'' + esc(frete.id) + '\',\'status\',this.value)">' + selectOptions(frete.status, ["Montando", "Enviado", "Alfândega", "Recebido"]) + "</select></div>" +
      '<div class="field"><label>Pago?</label><select onchange="editarFrete(\'' + esc(frete.id) + '\',\'pago\',this.value)">' + selectOptions(frete.pago ? "1" : "0", ["1", "0"], ["Sim", "Não"]) + "</select></div>" +
      '<div class="field"><label>&nbsp;</label><button class="btn btn-danger" onclick="excluirFrete(\'' + esc(frete.id) + '\')">Excluir remessa</button></div>' +
      "</div></div></div>";
  });
  box.innerHTML = html;
}

async function salvarImposto() {
  const freteId = document.getElementById("impostoFrete").value;
  const valor = num(document.getElementById("impostoValor").value);
  if (!freteId) return alert("Crie ou selecione uma remessa.");
  if (valor <= 0) return alert("Informe o valor do imposto.");

  const imposto = {
    id: crypto.randomUUID(),
    freteId: freteId,
    valor: valor,
    rateio: document.getElementById("impostoRateio").value,
    pago: document.getElementById("impostoPago").value === "1"
  };

  setStatus("Salvando…");
  try {
    await apiFetch("/impostos", { method: "POST", body: JSON.stringify(imposto) });
    dados.impostos.push(imposto);
    document.getElementById("impostoValor").value = "";
    document.getElementById("impostoPago").value = "0";
    render();
    setStatus("Imposto salvo");
  } catch (e) {
    setStatus("Falha ao salvar imposto", false);
  }
}

function editarImposto(id, campo, valor) {
  const imposto = dados.impostos.find(function(x) { return String(x.id) === String(id); });
  if (!imposto) return;
  if (campo === "valor") imposto.valor = num(valor);
  else if (campo === "pago") imposto.pago = String(valor) === "1";
  else imposto[campo] = valor;

  schedule("imposto-" + imposto.id, function() {
    return apiFetch("/impostos/" + encodeURIComponent(imposto.id), {
      method: "PUT",
      body: JSON.stringify(imposto)
    });
  });
  render();
}

async function excluirImposto(id) {
  const imposto = dados.impostos.find(function(x) { return String(x.id) === String(id); });
  if (!imposto) return;
  if (!confirm("Excluir este imposto de " + moeda.format(imposto.valor) + "?")) return;

  setStatus("Excluindo…");
  try {
    await apiFetch("/impostos/" + encodeURIComponent(id), { method: "DELETE" });
    dados.impostos = dados.impostos.filter(function(x) { return String(x.id) !== String(id); });
    render();
    setStatus("Imposto excluído");
  } catch (e) {
    setStatus("Falha ao excluir imposto", false);
  }
}

function renderImpostos() {
  const select = document.getElementById("impostoFrete");
  const box = document.getElementById("impostosContainer");
  if (!select || !box) return;

  const anterior = select.value;
  select.innerHTML = dados.fretes.length ? listaRecente().map(function(f) {
    return '<option value="' + esc(f.id) + '">' + esc(f.nome) + "</option>";
  }).join("") : '<option value="">Crie uma remessa primeiro</option>';
  if ([].slice.call(select.options).some(function(o) { return o.value === anterior; })) select.value = anterior;

  if (!dados.impostos.length) {
    box.innerHTML = '<div class="empty">Nenhum imposto cadastrado.</div>';
    return;
  }

  let html = '<div class="table-wrap"><table><thead><tr><th>Remessa</th><th>Valor</th><th>Rateio</th><th>Pago?</th><th>Ação</th></tr></thead><tbody>';
  dados.impostos.slice().reverse().forEach(function(imposto) {
    const frete = dados.fretes.find(function(f) { return String(f.id) === String(imposto.freteId); });
    html += "<tr>" +
      "<td>" + esc(frete ? frete.nome : "Remessa removida") + "</td>" +
      '<td><input class="table-input" type="number" min="0" step="0.01" value="' + num(imposto.valor) + '" onchange="editarImposto(\'' + esc(imposto.id) + '\',\'valor\',this.value)"></td>' +
      '<td><select class="table-input" onchange="editarImposto(\'' + esc(imposto.id) + '\',\'rateio\',this.value)">' + selectOptions(imposto.rateio, ["peso", "igual", "valor"], ["Por peso", "Igual", "Por valor"]) + "</select></td>" +
      '<td><select class="table-input" onchange="editarImposto(\'' + esc(imposto.id) + '\',\'pago\',this.value)">' + selectOptions(imposto.pago ? "1" : "0", ["1", "0"], ["Sim", "Não"]) + "</select></td>" +
      '<td><button class="btn btn-danger btn-small" onclick="excluirImposto(\'' + esc(imposto.id) + '\')">Excluir</button></td>' +
      "</tr>";
  });
  box.innerHTML = html + "</tbody></table></div>";
}

function gerarAlertas() {
  const alertas = [];
  const semPeso = dados.itens.filter(function(i) { return num(i.peso) <= 0; });
  const semRemessa = dados.itens.filter(function(i) { return !i.freteId; });
  const semVenda = dados.itens.filter(function(i) { return num(i.vendaPrevista) <= 0; });
  const prejuizo = dados.itens.filter(function(i) { return num(i.vendaPrevista) > 0 && lucro(i) < 0; });

  if (semPeso.length) alertas.push({ tipo: "warn", texto: semPeso.length + " produto(s) ainda estão sem peso." });
  if (semRemessa.length) alertas.push({ tipo: "warn", texto: semRemessa.length + " produto(s) ainda estão sem remessa." });
  if (semVenda.length) alertas.push({ tipo: "warn", texto: semVenda.length + " produto(s) não têm preço de venda previsto." });
  if (prejuizo.length) alertas.push({ tipo: "bad", texto: prejuizo.length + " produto(s) estão com venda prevista abaixo do ponto de equilíbrio." });

  dados.fretes.forEach(function(frete) {
    const grupo = dados.itens.filter(function(i) { return String(i.freteId) === String(frete.id); });
    if (frete.rateio === "peso" && grupo.some(function(i) { return num(i.peso) <= 0; })) {
      alertas.push({ tipo: "bad", texto: frete.nome + ": rateio por peso com produto(s) sem peso." });
    }
    const imp = dados.impostos.filter(function(t) { return String(t.freteId) === String(frete.id); });
    if (imp.length && !grupo.length) {
      alertas.push({ tipo: "bad", texto: frete.nome + ": há imposto cadastrado, mas nenhum produto vinculado." });
    }
  });

  const totalGeral = valorTotal(dados.itens) +
    dados.fretes.reduce(function(s, f) { return s + num(f.valor); }, 0) +
    dados.impostos.reduce(function(s, t) { return s + num(t.valor); }, 0);
  const pago = dados.itens.filter(function(i) { return i.pago; }).reduce(function(s, i) { return s + num(i.preco); }, 0) +
    dados.fretes.filter(function(f) { return f.pago; }).reduce(function(s, f) { return s + num(f.valor); }, 0) +
    dados.impostos.filter(function(t) { return t.pago; }).reduce(function(s, t) { return s + num(t.valor); }, 0);
  if (totalGeral - pago > 0.005) alertas.push({ tipo: "warn", texto: "Ainda há " + moeda.format(totalGeral - pago) + " marcado como pendente de pagamento." });

  return alertas;
}

function renderResumoRemessas() {
  const box = document.getElementById("resumoRemessas");
  if (!box) return;
  if (!dados.fretes.length) {
    box.innerHTML = '<div class="empty">Nenhuma remessa criada.</div>';
    return;
  }

  let html = "";
  listaRecente().forEach(function(frete) {
    const grupo = dados.itens.filter(function(i) { return String(i.freteId) === String(frete.id); });
    const imposto = dados.impostos.filter(function(t) { return String(t.freteId) === String(frete.id); }).reduce(function(s, t) { return s + num(t.valor); }, 0);
    const peso = pesoTotal(grupo);
    const custoGrupo = grupo.reduce(function(s, i) { return s + custo(i); }, 0);
    const venda = grupo.reduce(function(s, i) { return s + num(i.vendaPrevista); }, 0);
    const lucroGrupo = grupo.reduce(function(s, i) { return s + (i.vendaPrevista > 0 ? lucro(i) : 0); }, 0);

    html += '<div class="summary-row">' +
      '<div class="name"><div class="strong">' + esc(frete.nome) + '</div><div class="muted" style="font-size:11px">' + esc(frete.status) + " · " + grupo.length + " item(ns)</div></div>" +
      '<div class="summary-metric">Peso<b>' + numero.format(peso) + " kg</b></div>" +
      '<div class="summary-metric">Frete<b>' + moeda.format(frete.valor) + "</b></div>" +
      '<div class="summary-metric">Imposto<b>' + moeda.format(imposto) + "</b></div>" +
      '<div class="summary-metric">Custo<b>' + moeda.format(custoGrupo) + "</b></div>" +
      '<div class="summary-metric">Venda<b>' + moeda.format(venda) + "</b></div>" +
      '<div class="summary-metric">Lucro<b class="' + (lucroGrupo >= 0 ? "profit-pos" : "profit-neg") + '">' + moeda.format(lucroGrupo) + "</b></div>" +
      "</div>";
  });
  box.innerHTML = html;
}

function renderResumo() {
  const totalItens = valorTotal(dados.itens);
  const totalFretes = dados.fretes.reduce(function(s, f) { return s + num(f.valor); }, 0);
  const totalImpostos = dados.impostos.reduce(function(s, t) { return s + num(t.valor); }, 0);
  const custoTotal = totalItens + totalFretes + totalImpostos;
  const vendaTotal = dados.itens.reduce(function(s, i) { return s + num(i.vendaPrevista); }, 0);
  const lucroTotal = dados.itens.reduce(function(s, i) { return s + (i.vendaPrevista > 0 ? lucro(i) : 0); }, 0);

  const pProdutos = dados.itens.filter(function(i) { return i.pago; }).reduce(function(s, i) { return s + num(i.preco); }, 0);
  const pFretes = dados.fretes.filter(function(f) { return f.pago; }).reduce(function(s, f) { return s + num(f.valor); }, 0);
  const pImpostos = dados.impostos.filter(function(t) { return t.pago; }).reduce(function(s, t) { return s + num(t.valor); }, 0);
  const falta = Math.max(0, custoTotal - pProdutos - pFretes - pImpostos);

  document.getElementById("totalItens").textContent = moeda.format(totalItens);
  document.getElementById("totalFretes").textContent = moeda.format(totalFretes);
  document.getElementById("totalImpostos").textContent = moeda.format(totalImpostos);
  document.getElementById("custoFinal").textContent = moeda.format(custoTotal);
  document.getElementById("vendaPrevistaTotal").textContent = moeda.format(vendaTotal);
  document.getElementById("lucroPrevistoTotal").textContent = moeda.format(lucroTotal);
  document.getElementById("lucroPrevistoTotal").className = "value " + (lucroTotal >= 0 ? "profit-pos" : "profit-neg");
  document.getElementById("pagoProdutos").textContent = moeda.format(pProdutos);
  document.getElementById("pagoFretes").textContent = moeda.format(pFretes);
  document.getElementById("pagoImpostos").textContent = moeda.format(pImpostos);
  document.getElementById("faltaPagar").textContent = moeda.format(falta);

  const alertas = gerarAlertas();
  document.getElementById("alertCount").textContent = String(alertas.length);
  const box = document.getElementById("alertasContainer");
  if (!alertas.length) {
    box.innerHTML = '<div class="alert ok">Tudo certo: nenhum alerta encontrado.</div>';
  } else {
    box.innerHTML = alertas.map(function(a) {
      return '<div class="alert ' + (a.tipo === "bad" ? "bad" : "") + '">' + esc(a.texto) + "</div>";
    }).join("");
  }

  renderResumoRemessas();
  document.getElementById("tabCountProdutos").textContent = String(dados.itens.length);
  document.getElementById("tabCountRemessas").textContent = String(dados.fretes.length);
}

function abrirDetalhes(id) {
  const item = dados.itens.find(function(x) { return String(x.id) === String(id); });
  if (!item) return;

  const frete = dados.fretes.find(function(f) { return String(f.id) === String(item.freteId); });
  const compraOrigem = numero.format(item.precoOriginal) + " " + item.moeda;
  const classeLucro = item.vendaPrevista > 0 ? (lucro(item) >= 0 ? "profit-pos" : "profit-neg") : "muted";
  let freteOpts = '<option value="">Sem remessa</option>';
  listaRecente().forEach(function(f) {
    freteOpts += '<option value="' + esc(f.id) + '"' + (String(item.freteId) === String(f.id) ? " selected" : "") + ">" + esc(f.nome) + "</option>";
  });
  const refresh = ";setTimeout(function(){abrirDetalhes('" + esc(item.id) + "')},0)";

  document.getElementById("detalheTitulo").textContent = item.item;
  document.getElementById("detalheSubtitulo").textContent =
    (frete ? frete.nome : "Sem remessa") + " · " + item.status;

  let html = '<div class="section" style="margin-bottom:14px"><div class="section-header">Editar produto</div><div class="section-body"><div class="form-grid">' +
    '<div class="field w4"><label>Produto</label><input value="' + esc(item.item) + '" onchange="editarItem(\'' + esc(item.id) + '\',\'item\',this.value)' + refresh + '"></div>' +
    '<div class="field"><label>Moeda</label><select onchange="editarItem(\'' + esc(item.id) + '\',\'moeda\',this.value)' + refresh + '">' + selectOptions(item.moeda, ["BRL","JPY","USD"]) + '</select></div>' +
    '<div class="field"><label>Preço origem</label><input type="number" min="0" step="0.01" value="' + num(item.precoOriginal) + '" onchange="editarItem(\'' + esc(item.id) + '\',\'precoOriginal\',this.value)' + refresh + '"></div>' +
    '<div class="field"><label>Cotação</label><input type="number" min="0" step="0.000001" value="' + num(item.cotacao) + '"' + (item.moeda === "BRL" ? " disabled" : "") + ' onchange="editarItem(\'' + esc(item.id) + '\',\'cotacao\',this.value)' + refresh + '"></div>' +
    '<div class="field"><label>Peso (g)</label><input type="number" min="0" step="1" value="' + (item.peso ? Math.round(item.peso*1000) : "") + '" onchange="editarItem(\'' + esc(item.id) + '\',\'peso\',this.value)' + refresh + '"></div>' +
    '<div class="field"><label>Status</label><select onchange="editarItem(\'' + esc(item.id) + '\',\'status\',this.value)' + refresh + '">' + selectOptions(item.status, ["Comprado","Na suíte","Consolidado","Recebido BR"]) + '</select></div>' +
    '<div class="field w3"><label>Remessa</label><select onchange="atribuirFrete(\'' + esc(item.id) + '\',this.value)' + refresh + '">' + freteOpts + '</select></div>' +
    '<div class="field"><label>Venda prevista</label><input type="number" min="0" step="0.01" value="' + (item.vendaPrevista || "") + '" onchange="editarItem(\'' + esc(item.id) + '\',\'vendaPrevista\',this.value)' + refresh + '"></div>' +
    '<div class="field"><label>Plataforma</label><select onchange="editarItem(\'' + esc(item.id) + '\',\'plataforma\',this.value)' + refresh + '">' + selectOptions(item.plataforma, ["","Shopee","Mercado Livre","OLX","Outro"], ["Não definida","Shopee","Mercado Livre","OLX","Outro"]) + '</select></div>' +
    '<div class="field"><label>Taxa (%)</label><input type="number" min="0" step="0.01" value="' + num(item.taxaPct) + '" onchange="editarItem(\'' + esc(item.id) + '\',\'taxaPct\',this.value)' + refresh + '"></div>' +
    '<div class="field"><label>Taxa fixa</label><input type="number" min="0" step="0.01" value="' + num(item.taxaFixa) + '" onchange="editarItem(\'' + esc(item.id) + '\',\'taxaFixa\',this.value)' + refresh + '"></div>' +
    '<div class="field"><label>Pago?</label><select onchange="editarItem(\'' + esc(item.id) + '\',\'pago\',this.value)' + refresh + '">' + selectOptions(item.pago ? "1":"0",["1","0"],["Sim","Não"]) + '</select></div>' +
    '</div></div></div>';

  html += '<div class="grid" style="grid-template-columns:repeat(3,1fr)">' +
    '<div class="card"><div class="label">Compra original</div><div class="value">' + esc(compraOrigem) + '</div></div>' +
    '<div class="card"><div class="label">Custo em BRL</div><div class="value">' + moeda.format(item.preco) + '</div></div>' +
    '<div class="card"><div class="label">Frete rateado</div><div class="value">' + moeda.format(freteItem(item)) + '</div></div>' +
    '<div class="card"><div class="label">Imposto rateado</div><div class="value">' + moeda.format(impostoItem(item)) + '</div></div>' +
    '<div class="card"><div class="label">Custo final</div><div class="value">' + moeda.format(custo(item)) + '</div></div>' +
    '<div class="card"><div class="label">Preço mínimo</div><div class="value">' + moeda.format(precoEquilibrio(item)) + '</div></div>' +
    '<div class="card"><div class="label">Venda prevista</div><div class="value">' + (item.vendaPrevista > 0 ? moeda.format(item.vendaPrevista) : "—") + '</div></div>' +
    '<div class="card"><div class="label">Venda líquida</div><div class="value">' + (item.vendaPrevista > 0 ? moeda.format(vendaLiquida(item)) : "—") + '</div></div>' +
    '<div class="card"><div class="label">Lucro / margem</div><div class="value ' + classeLucro + '">' + (item.vendaPrevista > 0 ? moeda.format(lucro(item)) + " · " + formatPct(margem(item)) : "—") + '</div></div>' +
    '</div>';

  html += '<div class="toolbar" style="justify-content:flex-end;margin-top:14px"><button class="btn btn-danger" onclick="fecharDetalhes();excluirItem(\'' + esc(item.id) + '\')">Excluir produto</button></div>';

  document.getElementById("detalheConteudo").innerHTML = html;
  document.getElementById("detalheOverlay").style.display = "flex";
}

function fecharDetalhes() {
  const overlay = document.getElementById("detalheOverlay");
  if (overlay) overlay.style.display = "none";
}

function renderCalculadoraProdutos() {
  ["calcShopeeProduto", "calcMLProduto"].forEach(function(id) {
    const select = document.getElementById(id);
    if (!select) return;
    const atual = select.value;
    let html = '<option value="">Informar manualmente</option>';
    dados.itens.forEach(function(item) {
      html += '<option value="' + esc(item.id) + '">' + esc(item.item) + ' — ' + esc(moeda.format(custo(item))) + '</option>';
    });
    select.innerHTML = html;
    if ([].slice.call(select.options).some(function(o){ return o.value === atual; })) select.value = atual;
  });
}

function carregarProdutoCalc(tipo) {
  const select = document.getElementById(tipo === "shopee" ? "calcShopeeProduto" : "calcMLProduto");
  if (!select || !select.value) return;
  const item = dados.itens.find(function(x){ return String(x.id) === String(select.value); });
  if (!item) return;
  if (tipo === "shopee") {
    document.getElementById("shopeeCusto").value = custo(item).toFixed(2);
    if (item.vendaPrevista > 0) document.getElementById("shopeeVenda").value = item.vendaPrevista.toFixed(2);
  } else {
    document.getElementById("mlCusto").value = custo(item).toFixed(2);
    if (item.vendaPrevista > 0) document.getElementById("mlVenda").value = item.vendaPrevista.toFixed(2);
  }
}

function atualizarModoCalc(tipo) {
  const shopee = tipo === "shopee";
  const modo = document.getElementById(shopee ? "shopeeModo" : "mlModo").value;
  document.getElementById(shopee ? "shopeeVendaField" : "mlVendaField").style.display = modo === "margem" ? "" : "none";
  document.getElementById(shopee ? "shopeeMargemField" : "mlMargemField").style.display = modo === "ideal" ? "" : "none";
}

function atualizarTaxaML() {
  const tipo = document.getElementById("mlTipo").value;
  document.getElementById("mlComissao").value = tipo === "premium" ? "17" : "12";
}

function taxaFixaShopee(preco) {
  if (preco <= 79.99) return { pct: 20, fixa: 4.5, faixa: "Até R$ 79,99" };
  if (preco <= 99.99) return { pct: 14, fixa: 16, faixa: "R$ 80 a R$ 99,99" };
  if (preco <= 199.99) return { pct: 14, fixa: 20, faixa: "R$ 100 a R$ 199,99" };
  return { pct: 14, fixa: 26, faixa: "A partir de R$ 200" };
}

function avaliarShopee(preco, cfg) {
  const regra = taxaFixaShopee(preco);
  const comissao = preco * regra.pct / 100;
  const ads = preco * cfg.ads / 100;
  const impostos = preco * cfg.impostos / 100;
  const descontos = comissao + regra.fixa + ads + impostos + cfg.embalagem + cfg.freteExtra;
  const liquido = preco - descontos;
  const lucro = liquido - cfg.custo;
  return {
    preco: preco, regra: regra, comissao: comissao, ads: ads, impostos: impostos,
    fixa: regra.fixa, embalagem: cfg.embalagem, frete: cfg.freteExtra,
    liquido: liquido, lucro: lucro, margem: preco > 0 ? lucro / preco * 100 : 0
  };
}

function precoIdealShopee(cfg, alvo) {
  const segmentos = [
    { min: 0.01, max: 79.99, pct: 20, fixa: 4.5 },
    { min: 80, max: 99.99, pct: 14, fixa: 16 },
    { min: 100, max: 199.99, pct: 14, fixa: 20 },
    { min: 200, max: 1000000, pct: 14, fixa: 26 }
  ];
  const alvoDecimal = alvo / 100;
  const candidatos = [];
  segmentos.forEach(function(seg) {
    const variavel = 1 - seg.pct/100 - cfg.ads/100 - cfg.impostos/100 - alvoDecimal;
    if (variavel <= 0) return;
    const base = cfg.custo + seg.fixa + cfg.embalagem + cfg.freteExtra;
    let p = base / variavel;
    if (p < seg.min) p = seg.min;
    if (p <= seg.max + 0.0001) {
      const r = avaliarShopee(p, cfg);
      if (r.margem + 0.0001 >= alvo) candidatos.push(r);
    }
  });
  if (!candidatos.length) return null;
  candidatos.sort(function(a,b){ return a.preco-b.preco; });
  return candidatos[0];
}

function avaliarML(preco, cfg) {
  const comissao = preco * cfg.comissao / 100;
  const ads = preco * cfg.ads / 100;
  const impostos = preco * cfg.impostos / 100;
  const descontos = comissao + cfg.fixo + cfg.frete + ads + impostos + cfg.embalagem;
  const liquido = preco - descontos;
  const lucro = liquido - cfg.custo;
  return {
    preco: preco, comissao: comissao, ads: ads, impostos: impostos,
    fixa: cfg.fixo, embalagem: cfg.embalagem, frete: cfg.frete,
    liquido: liquido, lucro: lucro, margem: preco > 0 ? lucro / preco * 100 : 0
  };
}

function precoIdealML(cfg, alvo) {
  const variavel = 1 - cfg.comissao/100 - cfg.ads/100 - cfg.impostos/100 - alvo/100;
  if (variavel <= 0) return null;
  const preco = (cfg.custo + cfg.fixo + cfg.frete + cfg.embalagem) / variavel;
  if (!Number.isFinite(preco) || preco <= 0) return null;
  return avaliarML(preco, cfg);
}

function precoPsicologico(preco) {
  if (!Number.isFinite(preco) || preco <= 0) return 0;
  return Math.ceil(preco - 0.9) + 0.9;
}

function renderResultadoCalc(boxId, titulo, r, extra) {
  const box = document.getElementById(boxId);
  if (!box) return;
  if (!r) {
    box.innerHTML = '<div class="alert bad">Não foi possível atingir essa margem com as taxas informadas.</div>';
    return;
  }
  const cls = r.lucro >= 0 ? "profit-pos" : "profit-neg";
  box.innerHTML =
    '<div class="label">' + esc(titulo) + '</div>' +
    '<div class="big">' + moeda.format(r.preco) + '</div>' +
    (extra || "") +
    '<div class="breakdown">' +
      '<div class="breakdown-row"><span>Comissão</span><strong>− ' + moeda.format(r.comissao) + '</strong></div>' +
      '<div class="breakdown-row"><span>Tarifa/custo fixo</span><strong>− ' + moeda.format(r.fixa) + '</strong></div>' +
      '<div class="breakdown-row"><span>Publicidade</span><strong>− ' + moeda.format(r.ads) + '</strong></div>' +
      '<div class="breakdown-row"><span>Impostos</span><strong>− ' + moeda.format(r.impostos) + '</strong></div>' +
      '<div class="breakdown-row"><span>Embalagem</span><strong>− ' + moeda.format(r.embalagem) + '</strong></div>' +
      '<div class="breakdown-row"><span>Frete/outros</span><strong>− ' + moeda.format(r.frete) + '</strong></div>' +
      '<div class="breakdown-row"><span>Receita líquida antes do produto</span><strong>' + moeda.format(r.liquido) + '</strong></div>' +
      '<div class="breakdown-row"><span>Lucro final</span><strong class="' + cls + '">' + moeda.format(r.lucro) + '</strong></div>' +
      '<div class="breakdown-row"><span>Margem</span><strong class="' + cls + '">' + formatPct(r.margem) + '</strong></div>' +
    '</div>';
}

function calcularShopee() {
  const cfg = {
    custo: num(document.getElementById("shopeeCusto").value),
    ads: num(document.getElementById("shopeeAds").value),
    impostos: num(document.getElementById("shopeeImpostos").value),
    embalagem: num(document.getElementById("shopeeEmbalagem").value),
    freteExtra: num(document.getElementById("shopeeFreteExtra").value)
  };
  const modo = document.getElementById("shopeeModo").value;
  let r;
  let extra = "";
  if (modo === "ideal") {
    const alvo = num(document.getElementById("shopeeMargemAlvo").value);
    r = precoIdealShopee(cfg, alvo);
    if (r) extra = '<div class="pill green">Preço psicológico: ' + moeda.format(precoPsicologico(r.preco)) + '</div>';
    renderResultadoCalc("shopeeResultado", "Preço mínimo para a margem desejada", r, extra);
  } else {
    const venda = num(document.getElementById("shopeeVenda").value);
    if (venda <= 0) return alert("Informe o preço de venda.");
    r = avaliarShopee(venda, cfg);
    extra = '<div class="pill blue">' + esc(r.regra.faixa) + ' · ' + r.regra.pct + '% + ' + moeda.format(r.regra.fixa) + '</div>';
    renderResultadoCalc("shopeeResultado", "Preço de venda analisado", r, extra);
  }
}

function calcularML() {
  const cfg = {
    custo: num(document.getElementById("mlCusto").value),
    comissao: num(document.getElementById("mlComissao").value),
    fixo: num(document.getElementById("mlFixo").value),
    frete: num(document.getElementById("mlFrete").value),
    ads: num(document.getElementById("mlAds").value),
    impostos: num(document.getElementById("mlImpostos").value),
    embalagem: num(document.getElementById("mlEmbalagem").value)
  };
  const modo = document.getElementById("mlModo").value;
  let r;
  let extra = "";
  if (modo === "ideal") {
    const alvo = num(document.getElementById("mlMargemAlvo").value);
    r = precoIdealML(cfg, alvo);
    if (r) extra = '<div class="pill green">Preço psicológico: ' + moeda.format(precoPsicologico(r.preco)) + '</div>';
    renderResultadoCalc("mlResultado", "Preço mínimo para a margem desejada", r, extra);
  } else {
    const venda = num(document.getElementById("mlVenda").value);
    if (venda <= 0) return alert("Informe o preço de venda.");
    r = avaliarML(venda, cfg);
    extra = '<div class="pill orange">' + esc(document.getElementById("mlTipo").selectedOptions[0].textContent) + ' · comissão ' + formatPct(cfg.comissao) + '</div>';
    renderResultadoCalc("mlResultado", "Preço de venda analisado", r, extra);
  }
}

function renderCustos() {
  const box = document.getElementById("custoContainer");
  if (!box) return;
  if (!dados.itens.length) {
    box.innerHTML = '<div class="empty">Cadastre produtos para ver o detalhamento.</div>';
    return;
  }

  let html = '<div class="table-wrap"><table><thead><tr>' +
    "<th>Produto</th><th>Preço BRL</th><th>Frete rateado</th><th>Imposto rateado</th><th>Custo final</th><th>Venda prevista</th><th>Taxas venda</th><th>Venda líquida</th><th>Lucro</th><th>Margem</th><th>Preço mínimo</th>" +
    "</tr></thead><tbody>";

  dados.itens.forEach(function(item) {
    const l = lucro(item);
    const cls = item.vendaPrevista > 0 ? (l >= 0 ? "profit-pos" : "profit-neg") : "muted";
    html += "<tr>" +
      "<td class='strong'>" + esc(item.item) + "</td>" +
      "<td class='num'>" + moeda.format(item.preco) + "</td>" +
      "<td class='num'>" + moeda.format(freteItem(item)) + "</td>" +
      "<td class='num'>" + moeda.format(impostoItem(item)) + "</td>" +
      "<td class='num strong'>" + moeda.format(custo(item)) + "</td>" +
      "<td class='num'>" + (item.vendaPrevista > 0 ? moeda.format(item.vendaPrevista) : "—") + "</td>" +
      "<td class='num'>" + (item.vendaPrevista > 0 ? moeda.format(taxaVenda(item)) : "—") + "</td>" +
      "<td class='num'>" + (item.vendaPrevista > 0 ? moeda.format(vendaLiquida(item)) : "—") + "</td>" +
      "<td class='num " + cls + "'>" + (item.vendaPrevista > 0 ? moeda.format(l) : "—") + "</td>" +
      "<td class='num " + cls + "'>" + (item.vendaPrevista > 0 ? formatPct(margem(item)) : "—") + "</td>" +
      "<td class='num strong'>" + moeda.format(precoEquilibrio(item)) + "</td>" +
      "</tr>";
  });

  box.innerHTML = html + "</tbody></table></div>";
}

function render() {
  renderItens();
  renderFretes();
  renderImpostos();
  renderCustos();
  renderResumo();
  renderCalculadoraProdutos();
  trocarAba(abaAtual);
}

function formatDataHora(valor) {
  if (!valor) return "";
  const d = new Date(String(valor).replace(" ", "T") + (String(valor).indexOf("Z") >= 0 ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return String(valor);
  return d.toLocaleString("pt-BR");
}

async function carregarHistorico() {
  const box = document.getElementById("historicoContainer");
  if (!box || !appKey) return;
  box.innerHTML = '<div class="empty">Carregando histórico…</div>';
  try {
    const lista = await apiFetch("/historico");
    if (!lista.length) {
      box.innerHTML = '<div class="empty">Nenhuma alteração registrada ainda.</div>';
      return;
    }
    box.innerHTML = lista.map(function(h) {
      return '<div class="timeline-row">' +
        "<div>" + esc(formatDataHora(h.criado_em)) + "</div>" +
        '<div><span class="pill">' + esc(h.acao) + "</span></div>" +
        "<div class='strong'>" + esc(h.entidade) + "</div>" +
        "<div class='desc'>" + esc(h.resumo) + "</div>" +
        "</div>";
    }).join("");
  } catch (e) {
    box.innerHTML = '<div class="alert bad">Não foi possível carregar o histórico.</div>';
  }
}

function exportarBackup() {
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "controle-compras-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

async function importarBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const backup = normalize(JSON.parse(await file.text()));
    if (!confirm("Importar este backup substituirá os dados atuais. Um backup automático será criado antes. Continuar?")) return;
    setStatus("Importando backup…");
    await apiFetch("/import", { method: "POST", body: JSON.stringify(backup) });
    dados = backup;
    render();
    carregarBackups();
    setStatus("Backup importado");
  } catch (e) {
    alert("Não foi possível importar o backup.");
    setStatus("Falha ao importar", false);
  } finally {
    event.target.value = "";
  }
}

async function carregarBackups() {
  const box = document.getElementById("backupsContainer");
  if (!box || !appKey) return;
  box.innerHTML = '<div class="empty">Carregando backups…</div>';
  try {
    const lista = await apiFetch("/backups");
    if (!lista.length) {
      box.innerHTML = '<div class="empty">Nenhum backup automático disponível ainda.</div>';
      return;
    }

    box.innerHTML = lista.map(function(b) {
      return '<div class="backup-row"><div><div class="strong">' + esc(formatDataHora(b.criado_em)) + '</div><div class="muted" style="font-size:11px;margin-top:3px">' + esc(b.motivo) + '</div></div>' +
        '<button class="btn btn-secondary btn-small" onclick="restaurarBackup(\'' + esc(b.id) + '\')">Restaurar</button></div>';
    }).join("");
  } catch (e) {
    box.innerHTML = '<div class="alert bad">Não foi possível carregar os backups automáticos.</div>';
  }
}

async function restaurarBackup(id) {
  if (!confirm("Restaurar este backup? O estado atual será salvo automaticamente antes da restauração.")) return;
  setStatus("Restaurando backup…");
  try {
    const resposta = await apiFetch("/backups/" + encodeURIComponent(id) + "/restore", { method: "POST", body: "{}" });
    dados = normalize(resposta.dados);
    render();
    carregarBackups();
    carregarHistorico();
    setStatus("Backup restaurado");
  } catch (e) {
    setStatus("Falha ao restaurar backup", false);
  }
}

document.addEventListener("DOMContentLoaded", function() {
  aplicarTema(temaAtual);
  trocarAba(abaAtual);
  if (appKey) entrar();
  else document.getElementById("appPassword")?.focus();
});
