-- ============ 0) 备份将受影响的行 ============
DROP TABLE IF EXISTS ds.products_price_migrate_bak_20261009;
CREATE TABLE ds.products_price_migrate_bak_20261009 AS
SELECT id, sku, price, raw, updatedAt FROM ds.products
WHERE JSON_UNQUOTE(JSON_EXTRACT(raw, '$.priceSymbol')) = '¥';

SELECT '备份行数' AS k, COUNT(*) AS v FROM ds.products_price_migrate_bak_20261009;
SELECT '其中 price 为空' AS k, COUNT(*) AS v FROM ds.products_price_migrate_bak_20261009 WHERE price IS NULL;

-- ============ 1) 汇率 ============
SET @rate = (SELECT rubPerCny FROM ds.pricing_settings WHERE id = 1);
SET @rate = IFNULL(@rate, 12.69);
SELECT '使用汇率(1¥=N₽)' AS k, @rate AS v;

-- ============ 2) 人民币 → 卢布 ============
--   注意顺序：先写 raw（此时 price 还是旧的人民币值，存进 priceCny 存档），再更新 price。
--   MySQL 单表 UPDATE 的赋值从左到右求值，后面的赋值能看到前面已更新的值。
UPDATE ds.products
SET raw = JSON_SET(COALESCE(raw, JSON_OBJECT()),
                   '$.priceCny', price,
                   '$.priceFrom', '¥',
                   '$.priceSymbol', '₽'),
    price = ROUND(price * @rate, 2)
WHERE JSON_UNQUOTE(JSON_EXTRACT(raw, '$.priceSymbol')) = '¥' AND price IS NOT NULL;

-- 价格为空的 ¥ 行：只归一符号，不动 price
UPDATE ds.products
SET raw = JSON_SET(COALESCE(raw, JSON_OBJECT()), '$.priceFrom', '¥', '$.priceSymbol', '₽')
WHERE JSON_UNQUOTE(JSON_EXTRACT(raw, '$.priceSymbol')) = '¥';

-- ============ 3) 校验 ============
SELECT '迁移后 priceSymbol 分布' AS title;
SELECT JSON_UNQUOTE(JSON_EXTRACT(raw, '$.priceSymbol')) AS sym, COUNT(*) AS c, ROUND(AVG(price), 1) AS avgp
FROM ds.products GROUP BY sym ORDER BY c DESC;

SELECT '抽 4 个已核实的 SKU' AS title;
SELECT sku, price AS price_rub_now,
       JSON_UNQUOTE(JSON_EXTRACT(raw, '$.priceCny')) AS price_cny_original,
       JSON_UNQUOTE(JSON_EXTRACT(raw, '$.priceSymbol')) AS sym
FROM ds.products WHERE sku IN ('2133960348', '1968422017', '3016657131', '4892112468');

SELECT '纠错前后对比（应接近页面卢布价 789/262/199/464）' AS title;
