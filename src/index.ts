export interface Env {
	DB: D1Database;
	APP_KEY: string;
}

const JSON_HEADERS = {
	"content-type": "application/json; charset=utf-8",
};

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: JSON_HEADERS,
	});
}

function autorizado(request: Request, env: Env) {
	return !!env.APP_KEY && request.headers.get("X-App-Key") === env.APP_KEY;
}

async function lerJson(request: Request) {
	try {
		return await request.json();
	} catch {
		return null;
	}
}

async function carregarDados(env: Env) {
	const [itens, fretes, impostos] = await Promise.all([
		env.DB.prepare(
			"SELECT id,item,preco,peso_g,status,frete_id FROM itens ORDER BY rowid"
		).all(),

		env.DB.prepare(
			"SELECT id,nome,valor,rateio FROM fretes ORDER BY rowid"
		).all(),

		env.DB.prepare(
			"SELECT id,frete_id,valor,rateio FROM impostos ORDER BY rowid"
		).all(),
	]);

	return {
		itens: (itens.results || []).map((x: any) => ({
			id: x.id,
			item: x.item,
			preco: Number(x.preco) || 0,
			peso: (Number(x.peso_g) || 0) / 1000,
			status: x.status || "Comprado",
			freteId: x.frete_id || "",
		})),

		fretes: (fretes.results || []).map((x: any) => ({
			id: x.id,
			nome: x.nome,
			valor: Number(x.valor) || 0,
			rateio: x.rateio || "peso",
		})),

		impostos: (impostos.results || []).map((x: any) => ({
			id: x.id,
			freteId: x.frete_id || "",
			valor: Number(x.valor) || 0,
			rateio: x.rateio || "peso",
		})),
	};
}

async function api(request: Request, env: Env) {
	if (!autorizado(request, env)) {
		return json({ error: "unauthorized" }, 401);
	}

	const url = new URL(request.url);
	const partes = url.pathname.split("/").filter(Boolean);

	const recurso = partes[1];
	const id = partes[2];

	// CARREGAR TUDO
	if (request.method === "GET" && recurso === "data") {
		return json(await carregarDados(env));
	}

	// =========================
	// ITENS
	// =========================

	if (recurso === "items" && request.method === "POST") {
		const x: any = await lerJson(request);

		if (!x?.id || !x?.item) {
			return json({ error: "invalid" }, 400);
		}

		await env.DB.prepare(
			`INSERT INTO itens
			(id,item,preco,peso_g,status,frete_id)
			VALUES (?,?,?,?,?,?)`
		)
			.bind(
				String(x.id),
				String(x.item || ""),
				Number(x.preco) || 0,
				Number(x.peso_g) || 0,
				String(x.status || "Comprado"),
				x.freteId ? String(x.freteId) : null
			)
			.run();

		return json({ ok: true });
	}

	if (recurso === "items" && request.method === "PUT" && id) {
		const x: any = await lerJson(request);

		await env.DB.prepare(
			`UPDATE itens
			SET item=?,preco=?,peso_g=?,status=?,frete_id=?
			WHERE id=?`
		)
			.bind(
				String(x.item || ""),
				Number(x.preco) || 0,
				Number(x.peso_g) || 0,
				String(x.status || "Comprado"),
				x.freteId ? String(x.freteId) : null,
				id
			)
			.run();

		return json({ ok: true });
	}

	if (recurso === "items" && request.method === "DELETE" && id) {
		await env.DB.prepare(
			"DELETE FROM itens WHERE id=?"
		)
			.bind(id)
			.run();

		return new Response(null, { status: 204 });
	}

	// =========================
	// FRETES
	// =========================

	if (recurso === "fretes" && request.method === "POST") {
		const x: any = await lerJson(request);

		if (!x?.id || !x?.nome) {
			return json({ error: "invalid" }, 400);
		}

		await env.DB.prepare(
			`INSERT INTO fretes
			(id,nome,valor,rateio)
			VALUES (?,?,?,?)`
		)
			.bind(
				String(x.id),
				String(x.nome || ""),
				Number(x.valor) || 0,
				String(x.rateio || "peso")
			)
			.run();

		return json({ ok: true });
	}

	if (recurso === "fretes" && request.method === "PUT" && id) {
		const x: any = await lerJson(request);

		await env.DB.prepare(
			`UPDATE fretes
			SET nome=?,valor=?,rateio=?
			WHERE id=?`
		)
			.bind(
				String(x.nome || ""),
				Number(x.valor) || 0,
				String(x.rateio || "peso"),
				id
			)
			.run();

		return json({ ok: true });
	}

	if (recurso === "fretes" && request.method === "DELETE" && id) {
		await env.DB.batch([
			env.DB.prepare(
				"DELETE FROM impostos WHERE frete_id=?"
			).bind(id),

			env.DB.prepare(
				"UPDATE itens SET frete_id=NULL WHERE frete_id=?"
			).bind(id),

			env.DB.prepare(
				"DELETE FROM fretes WHERE id=?"
			).bind(id),
		]);

		return new Response(null, { status: 204 });
	}

	// =========================
	// IMPOSTOS
	// =========================

	if (recurso === "impostos" && request.method === "POST") {
		const x: any = await lerJson(request);

		if (!x?.id || !x?.freteId) {
			return json({ error: "invalid" }, 400);
		}

		await env.DB.prepare(
			`INSERT INTO impostos
			(id,frete_id,valor,rateio)
			VALUES (?,?,?,?)`
		)
			.bind(
				String(x.id),
				String(x.freteId),
				Number(x.valor) || 0,
				String(x.rateio || "peso")
			)
			.run();

		return json({ ok: true });
	}

	if (recurso === "impostos" && request.method === "DELETE" && id) {
		await env.DB.prepare(
			"DELETE FROM impostos WHERE id=?"
		)
			.bind(id)
			.run();

		return new Response(null, { status: 204 });
	}

	// =========================
	// IMPORTAR BACKUP
	// =========================

	if (recurso === "import" && request.method === "POST") {
		const x: any = await lerJson(request);

		if (!x) {
			return json({ error: "invalid" }, 400);
		}

		const comandos = [
			env.DB.prepare("DELETE FROM impostos"),
			env.DB.prepare("DELETE FROM itens"),
			env.DB.prepare("DELETE FROM fretes"),

			...(x.fretes || []).map((f: any) =>
				env.DB.prepare(
					`INSERT INTO fretes
					(id,nome,valor,rateio)
					VALUES (?,?,?,?)`
				).bind(
					String(f.id),
					String(f.nome || ""),
					Number(f.valor) || 0,
					String(f.rateio || "peso")
				)
			),

			...(x.itens || []).map((i: any) =>
				env.DB.prepare(
					`INSERT INTO itens
					(id,item,preco,peso_g,status,frete_id)
					VALUES (?,?,?,?,?,?)`
				).bind(
					String(i.id),
					String(i.item || ""),
					Number(i.preco) || 0,
					Number(i.peso || 0) * 1000,
					String(i.status || "Comprado"),
					i.freteId ? String(i.freteId) : null
				)
			),

			...(x.impostos || [])
				.filter((t: any) => t.freteId)
				.map((t: any) =>
					env.DB.prepare(
						`INSERT INTO impostos
						(id,frete_id,valor,rateio)
						VALUES (?,?,?,?)`
					).bind(
						String(t.id),
						String(t.freteId),
						Number(t.valor) || 0,
						String(t.rateio || "peso")
					)
				),
		];

		await env.DB.batch(comandos);

		return json({ ok: true });
	}

	return json({ error: "not_found" }, 404);
}

export default {
	async fetch(request: Request, env: Env) {
		const url = new URL(request.url);

		if (url.pathname.startsWith("/api/")) {
			return api(request, env);
		}

		return new Response(
			"Controle de Compras - API funcionando.",
			{
				headers: {
					"content-type": "text/plain; charset=utf-8",
				},
			}
		);
	},
} satisfies ExportedHandler<Env>;
