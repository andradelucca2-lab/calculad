export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_KEY: string;
  PREVIEW_MODE?: string;
}

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

function autorizado(request: Request, env: Env) {
  if (env.PREVIEW_MODE === "true") return true;
  return !!env.APP_KEY && request.headers.get("X-App-Key") === env.APP_KEY;
}

async function lerJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function n(v: any) {
  const valor = Number(v);
  return Number.isFinite(valor) ? valor : 0;
}

function b(v: any, padrao = false) {
  if (v === undefined || v === null || v === "") return padrao;
  return v === true || v === 1 || v === "1" || v === "true";
}

async function carregarDados(env: Env) {
  const [itens, fretes, impostos] = await Promise.all([
    env.DB.prepare(
      "SELECT id,item,preco,peso_g,status,frete_id,moeda,preco_original,cotacao,venda_prevista,plataforma,taxa_pct,taxa_fixa,pago FROM itens ORDER BY rowid"
    ).all(),
    env.DB.prepare(
      "SELECT id,nome,valor,rateio,status,pago FROM fretes ORDER BY rowid"
    ).all(),
    env.DB.prepare(
      "SELECT id,frete_id,valor,rateio,pago FROM impostos ORDER BY rowid"
    ).all(),
  ]);

  return {
    itens: (itens.results || []).map((x: any) => ({
      id: x.id,
      item: x.item,
      preco: n(x.preco),
      peso: n(x.peso_g) / 1000,
      status: x.status || "Comprado",
      freteId: x.frete_id || "",
      moeda: x.moeda || "BRL",
      precoOriginal: n(x.preco_original) || n(x.preco),
      cotacao: n(x.cotacao) || 1,
      vendaPrevista: n(x.venda_prevista),
      plataforma: x.plataforma || "",
      taxaPct: n(x.taxa_pct),
      taxaFixa: n(x.taxa_fixa),
      pago: b(x.pago, true),
    })),
    fretes: (fretes.results || []).map((x: any) => ({
      id: x.id,
      nome: x.nome,
      valor: n(x.valor),
      rateio: x.rateio || "peso",
      status: x.status || "Montando",
      pago: b(x.pago, true),
    })),
    impostos: (impostos.results || []).map((x: any) => ({
      id: x.id,
      freteId: x.frete_id || "",
      valor: n(x.valor),
      rateio: x.rateio || "peso",
      pago: b(x.pago, false),
    })),
  };
}

async function registrarHistorico(
  env: Env,
  acao: string,
  entidade: string,
  entidadeId: string | null,
  resumo: string
) {
  await env.DB.prepare(
    "INSERT INTO historico (acao,entidade,entidade_id,resumo) VALUES (?,?,?,?)"
  ).bind(acao, entidade, entidadeId, resumo).run();
}

async function salvarBackup(env: Env, motivo: string, forcar = false) {
  if (!forcar) {
    const ultimo = await env.DB.prepare(
      "SELECT criado_em FROM backups ORDER BY id DESC LIMIT 1"
    ).first<any>();

    if (ultimo?.criado_em) {
      const quando = Date.parse(String(ultimo.criado_em).replace(" ", "T") + "Z");
      if (Number.isFinite(quando) && Date.now() - quando < 5 * 60 * 1000) return;
    }
  }

  const dados = await carregarDados(env);
  await env.DB.prepare(
    "INSERT INTO backups (motivo,dados_json) VALUES (?,?)"
  ).bind(motivo, JSON.stringify(dados)).run();

  await env.DB.prepare(
    "DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT 30)"
  ).run();
}

async function substituirDados(env: Env, x: any) {
  const fretes = Array.isArray(x?.fretes) ? x.fretes : [];
  const itens = Array.isArray(x?.itens) ? x.itens : [];
  const impostos = Array.isArray(x?.impostos) ? x.impostos : [];

  const comandos: D1PreparedStatement[] = [
    env.DB.prepare("DELETE FROM impostos"),
    env.DB.prepare("DELETE FROM itens"),
    env.DB.prepare("DELETE FROM fretes"),
  ];

  for (const f of fretes) {
    comandos.push(
      env.DB.prepare(
        "INSERT INTO fretes (id,nome,valor,rateio,status,pago) VALUES (?,?,?,?,?,?)"
      ).bind(
        String(f.id),
        String(f.nome || ""),
        n(f.valor),
        String(f.rateio || "peso"),
        String(f.status || "Montando"),
        b(f.pago, true) ? 1 : 0
      )
    );
  }

  for (const i of itens) {
    const moeda = String(i.moeda || "BRL");
    const precoOriginal = n(i.precoOriginal ?? i.preco);
    const cotacao = n(i.cotacao) || 1;
    const preco = n(i.preco) || precoOriginal * cotacao;

    comandos.push(
      env.DB.prepare(
        "INSERT INTO itens (id,item,preco,peso_g,status,frete_id,moeda,preco_original,cotacao,venda_prevista,plataforma,taxa_pct,taxa_fixa,pago) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      ).bind(
        String(i.id),
        String(i.item || ""),
        preco,
        n(i.peso) * 1000,
        String(i.status || "Comprado"),
        i.freteId ? String(i.freteId) : null,
        moeda,
        precoOriginal,
        cotacao,
        n(i.vendaPrevista),
        String(i.plataforma || ""),
        n(i.taxaPct),
        n(i.taxaFixa),
        b(i.pago, true) ? 1 : 0
      )
    );
  }

  for (const t of impostos.filter((x: any) => x.freteId)) {
    comandos.push(
      env.DB.prepare(
        "INSERT INTO impostos (id,frete_id,valor,rateio,pago) VALUES (?,?,?,?,?)"
      ).bind(
        String(t.id),
        String(t.freteId),
        n(t.valor),
        String(t.rateio || "peso"),
        b(t.pago, false) ? 1 : 0
      )
    );
  }

  await env.DB.batch(comandos);
}

async function api(request: Request, env: Env) {
  if (!autorizado(request, env)) return json({ error: "unauthorized" }, 401);

  const partes = new URL(request.url).pathname.split("/").filter(Boolean);
  const recurso = partes[1];
  const id = partes[2];

  if (env.PREVIEW_MODE === "true") {
    if (request.method === "GET" && recurso === "data") {
      return json({ itens: [], fretes: [], impostos: [] });
    }
    if (request.method === "GET" && recurso === "historico") return json([]);
    if (request.method === "GET" && recurso === "backups") return json([]);
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    if (request.method === "POST" || request.method === "PUT") return json({ ok: true });
  }

  if (request.method === "GET" && recurso === "data") {
    return json(await carregarDados(env));
  }

  if (request.method === "GET" && recurso === "historico") {
    const rows = await env.DB.prepare(
      "SELECT id,criado_em,acao,entidade,entidade_id,resumo FROM historico ORDER BY id DESC LIMIT 100"
    ).all();
    return json(rows.results || []);
  }

  if (request.method === "GET" && recurso === "backups") {
    const rows = await env.DB.prepare(
      "SELECT id,criado_em,motivo FROM backups ORDER BY id DESC LIMIT 30"
    ).all();
    return json(rows.results || []);
  }

  if (recurso === "backups" && id && partes[3] === "restore" && request.method === "POST") {
    const row = await env.DB.prepare(
      "SELECT dados_json FROM backups WHERE id=?"
    ).bind(id).first<any>();
    if (!row?.dados_json) return json({ error: "not_found" }, 404);

    await salvarBackup(env, "Antes de restaurar backup", true);
    await substituirDados(env, JSON.parse(String(row.dados_json)));
    await registrarHistorico(env, "restaurou", "backup", id, "Backup automático restaurado");
    return json({ ok: true, dados: await carregarDados(env) });
  }

  if (recurso === "items" && request.method === "POST") {
    const x = await lerJson(request);
    if (!x?.id || !x?.item) return json({ error: "invalid" }, 400);

    const moeda = String(x.moeda || "BRL");
    const precoOriginal = n(x.precoOriginal ?? x.preco);
    const cotacao = n(x.cotacao) || 1;
    const preco = n(x.preco) || precoOriginal * cotacao;

    await env.DB.prepare(
      "INSERT INTO itens (id,item,preco,peso_g,status,frete_id,moeda,preco_original,cotacao,venda_prevista,plataforma,taxa_pct,taxa_fixa,pago) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      String(x.id),
      String(x.item),
      preco,
      n(x.peso_g),
      String(x.status || "Comprado"),
      x.freteId ? String(x.freteId) : null,
      moeda,
      precoOriginal,
      cotacao,
      n(x.vendaPrevista),
      String(x.plataforma || ""),
      n(x.taxaPct),
      n(x.taxaFixa),
      b(x.pago, true) ? 1 : 0
    ).run();

    await registrarHistorico(env, "criou", "produto", String(x.id), "Produto criado: " + String(x.item));
    await salvarBackup(env, "Alteração de produtos");
    return json({ ok: true });
  }

  if (recurso === "items" && request.method === "PUT" && id) {
    const x = await lerJson(request);
    const moeda = String(x.moeda || "BRL");
    const precoOriginal = n(x.precoOriginal ?? x.preco);
    const cotacao = n(x.cotacao) || 1;
    const preco = n(x.preco) || precoOriginal * cotacao;

    await env.DB.prepare(
      "UPDATE itens SET item=?,preco=?,peso_g=?,status=?,frete_id=?,moeda=?,preco_original=?,cotacao=?,venda_prevista=?,plataforma=?,taxa_pct=?,taxa_fixa=?,pago=? WHERE id=?"
    ).bind(
      String(x.item || ""),
      preco,
      n(x.peso_g),
      String(x.status || "Comprado"),
      x.freteId ? String(x.freteId) : null,
      moeda,
      precoOriginal,
      cotacao,
      n(x.vendaPrevista),
      String(x.plataforma || ""),
      n(x.taxaPct),
      n(x.taxaFixa),
      b(x.pago, true) ? 1 : 0,
      id
    ).run();

    await registrarHistorico(env, "editou", "produto", id, "Produto atualizado: " + String(x.item || id));
    await salvarBackup(env, "Alteração de produtos");
    return json({ ok: true });
  }

  if (recurso === "items" && request.method === "DELETE" && id) {
    const atual = await env.DB.prepare("SELECT item FROM itens WHERE id=?").bind(id).first<any>();
    await env.DB.prepare("DELETE FROM itens WHERE id=?").bind(id).run();
    await registrarHistorico(env, "excluiu", "produto", id, "Produto excluído: " + String(atual?.item || id));
    await salvarBackup(env, "Exclusão de produto");
    return new Response(null, { status: 204 });
  }

  if (recurso === "fretes" && request.method === "POST") {
    const x = await lerJson(request);
    if (!x?.id || !x?.nome) return json({ error: "invalid" }, 400);

    await env.DB.prepare(
      "INSERT INTO fretes (id,nome,valor,rateio,status,pago) VALUES (?,?,?,?,?,?)"
    ).bind(
      String(x.id),
      String(x.nome),
      n(x.valor),
      String(x.rateio || "peso"),
      String(x.status || "Montando"),
      b(x.pago, true) ? 1 : 0
    ).run();

    await registrarHistorico(env, "criou", "remessa", String(x.id), "Remessa criada: " + String(x.nome));
    await salvarBackup(env, "Alteração de remessas");
    return json({ ok: true });
  }

  if (recurso === "fretes" && request.method === "PUT" && id) {
    const x = await lerJson(request);
    await env.DB.prepare(
      "UPDATE fretes SET nome=?,valor=?,rateio=?,status=?,pago=? WHERE id=?"
    ).bind(
      String(x.nome || ""),
      n(x.valor),
      String(x.rateio || "peso"),
      String(x.status || "Montando"),
      b(x.pago, true) ? 1 : 0,
      id
    ).run();

    await registrarHistorico(env, "editou", "remessa", id, "Remessa atualizada: " + String(x.nome || id));
    await salvarBackup(env, "Alteração de remessas");
    return json({ ok: true });
  }

  if (recurso === "fretes" && request.method === "DELETE" && id) {
    const atual = await env.DB.prepare("SELECT nome FROM fretes WHERE id=?").bind(id).first<any>();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM impostos WHERE frete_id=?").bind(id),
      env.DB.prepare("UPDATE itens SET frete_id=NULL WHERE frete_id=?").bind(id),
      env.DB.prepare("DELETE FROM fretes WHERE id=?").bind(id),
    ]);
    await registrarHistorico(env, "excluiu", "remessa", id, "Remessa excluída: " + String(atual?.nome || id));
    await salvarBackup(env, "Exclusão de remessa");
    return new Response(null, { status: 204 });
  }

  if (recurso === "impostos" && request.method === "POST") {
    const x = await lerJson(request);
    if (!x?.id || !x?.freteId) return json({ error: "invalid" }, 400);

    await env.DB.prepare(
      "INSERT INTO impostos (id,frete_id,valor,rateio,pago) VALUES (?,?,?,?,?)"
    ).bind(
      String(x.id),
      String(x.freteId),
      n(x.valor),
      String(x.rateio || "peso"),
      b(x.pago, false) ? 1 : 0
    ).run();

    await registrarHistorico(env, "criou", "imposto", String(x.id), "Imposto adicionado: R$ " + n(x.valor).toFixed(2));
    await salvarBackup(env, "Alteração de impostos");
    return json({ ok: true });
  }

  if (recurso === "impostos" && request.method === "PUT" && id) {
    const x = await lerJson(request);
    await env.DB.prepare(
      "UPDATE impostos SET frete_id=?,valor=?,rateio=?,pago=? WHERE id=?"
    ).bind(
      String(x.freteId || ""),
      n(x.valor),
      String(x.rateio || "peso"),
      b(x.pago, false) ? 1 : 0,
      id
    ).run();
    await registrarHistorico(env, "editou", "imposto", id, "Imposto atualizado");
    await salvarBackup(env, "Alteração de impostos");
    return json({ ok: true });
  }

  if (recurso === "impostos" && request.method === "DELETE" && id) {
    await env.DB.prepare("DELETE FROM impostos WHERE id=?").bind(id).run();
    await registrarHistorico(env, "excluiu", "imposto", id, "Imposto excluído");
    await salvarBackup(env, "Exclusão de imposto");
    return new Response(null, { status: 204 });
  }

  if (recurso === "import" && request.method === "POST") {
    const x = await lerJson(request);
    if (!x || !Array.isArray(x.itens) || !Array.isArray(x.fretes) || !Array.isArray(x.impostos)) {
      return json({ error: "invalid" }, 400);
    }

    await salvarBackup(env, "Antes de importar backup", true);
    await substituirDados(env, x);
    await registrarHistorico(env, "importou", "backup", null, "Backup manual importado");
    await salvarBackup(env, "Depois de importar backup", true);
    return json({ ok: true });
  }

  return json({ error: "not_found" }, 404);
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
