-- Vincula o frete real do BTS 2021 Winter Package ao produto existente.
-- Pagamento do frete/taxa: R$ 251,40.

INSERT INTO fretes (id, nome, valor, rateio)
SELECT
  'frete-bts-winter-2021-20260727',
  'BTS 2021 Winter Package - frete 27/07/2026',
  251.40,
  'igual'
WHERE EXISTS (
  SELECT 1
  FROM itens
  WHERE item LIKE '%Winter Package%'
    AND proxy = 'KuroGeek'
    AND preco BETWEEN 96 AND 98
)
AND NOT EXISTS (
  SELECT 1
  FROM fretes
  WHERE id = 'frete-bts-winter-2021-20260727'
);

UPDATE itens
SET frete_id = 'frete-bts-winter-2021-20260727'
WHERE id = (
  SELECT id
  FROM itens
  WHERE item LIKE '%Winter Package%'
    AND proxy = 'KuroGeek'
    AND preco BETWEEN 96 AND 98
  ORDER BY rowid DESC
  LIMIT 1
)
AND (frete_id IS NULL OR frete_id = '');
