CREATE TABLE IF NOT EXISTS fretes (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  valor REAL NOT NULL DEFAULT 0,
  rateio TEXT NOT NULL DEFAULT 'peso'
);

CREATE TABLE IF NOT EXISTS itens (
  id TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  preco REAL NOT NULL DEFAULT 0,
  peso_g REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Comprado',
  frete_id TEXT
);

CREATE TABLE IF NOT EXISTS impostos (
  id TEXT PRIMARY KEY,
  frete_id TEXT NOT NULL,
  valor REAL NOT NULL DEFAULT 0,
  rateio TEXT NOT NULL DEFAULT 'peso'
);

CREATE INDEX IF NOT EXISTS idx_itens_frete ON itens(frete_id);
CREATE INDEX IF NOT EXISTS idx_impostos_frete ON impostos(frete_id);
