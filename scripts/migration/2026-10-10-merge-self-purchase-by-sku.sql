-- ============================================================================
-- 按 (storeId, sku) 合并重复的自采购记录
-- ============================================================================
-- 背景：SKU 是这条记录关联 Ozon ↔ 1688 的主标识，同一店铺下「一个 SKU 只应有一条记录」。
--       修复前在 1688 页记一笔、又在 Ozon 页记一笔 → 会产生两条同 SKU 记录。
--       Node 侧的合并逻辑（新写入不再产生重复）见：
--       backend/src/modules/self-purchase/self-purchase.service.ts 的 mergeBySku()
--
-- 本脚本做的事：把重复组里「非最老那条」的非空字段补到最老那条上（**不覆盖已有非空值**），
--              再把被合并掉的记录删掉。名称不同时把被合并的名称存进备注，避免信息丢失。
--
-- 用法：docker exec -i playlish-mysql mysql -uroot -proot123 --default-character-set=utf8mb4 ds < 本文件
-- ============================================================================

-- 0) 执行前先看有没有重复组（有输出才需要跑本脚本）
SELECT sku, storeId, COUNT(*) AS c, GROUP_CONCAT(id ORDER BY id) AS ids
FROM self_purchases
WHERE sku IS NOT NULL AND sku <> ''
GROUP BY sku, storeId
HAVING c > 1;

-- 1) 备份
CREATE TABLE IF NOT EXISTS self_purchases_sku_merge_bak_20261010 AS SELECT * FROM self_purchases;

-- 2) 把「非最老那条」的非空字段补到最老那条（COALESCE = 已有非空值优先，不覆盖）
--    注：同一组只有 2 条时结果精确；3 条以上时逐条 COALESCE 的顺序不保证，请人工核对。
UPDATE self_purchases keep
JOIN (
  SELECT sku, storeId, MIN(id) AS keep_id
  FROM self_purchases
  WHERE sku IS NOT NULL AND sku <> ''
  GROUP BY sku, storeId
  HAVING COUNT(*) > 1
) g ON keep.id = g.keep_id
JOIN self_purchases dup
  ON dup.sku <=> g.sku AND dup.storeId <=> g.storeId AND dup.id <> g.keep_id
SET keep.name         = COALESCE(keep.name, dup.name),
    keep.supplyUrl    = COALESCE(keep.supplyUrl, dup.supplyUrl),
    keep.retailUrl    = COALESCE(keep.retailUrl, dup.retailUrl),
    keep.imageUrl     = COALESCE(keep.imageUrl, dup.imageUrl),
    keep.purchaseCost = COALESCE(keep.purchaseCost, dup.purchaseCost),
    keep.weightKg     = COALESCE(keep.weightKg, dup.weightKg),
    keep.lengthCm     = COALESCE(keep.lengthCm, dup.lengthCm),
    keep.widthCm      = COALESCE(keep.widthCm, dup.widthCm),
    keep.heightCm     = COALESCE(keep.heightCm, dup.heightCm),
    keep.weightText   = COALESCE(keep.weightText, dup.weightText),
    keep.sizeText     = COALESCE(keep.sizeText, dup.sizeText),
    keep.sellPrice    = COALESCE(keep.sellPrice, dup.sellPrice),
    keep.sellPriceRub = COALESCE(keep.sellPriceRub, dup.sellPriceRub),
    keep.shippingFee  = COALESCE(keep.shippingFee, dup.shippingFee),
    keep.billWeightKg = COALESCE(keep.billWeightKg, dup.billWeightKg),
    keep.grossProfit  = COALESCE(keep.grossProfit, dup.grossProfit),
    keep.netProfit    = COALESCE(keep.netProfit, dup.netProfit),
    keep.profitRate   = COALESCE(keep.profitRate, dup.profitRate),
    keep.markupRate   = COALESCE(keep.markupRate, dup.markupRate),
    keep.channelId    = COALESCE(keep.channelId, dup.channelId),
    keep.channelName  = COALESCE(keep.channelName, dup.channelName),
    keep.shipMode     = COALESCE(keep.shipMode, dup.shipMode),
    keep.logistics    = COALESCE(keep.logistics, dup.logistics),
    keep.remark       = COALESCE(keep.remark, dup.remark),
    keep.updatedAt    = NOW();

-- 3) 删掉已被合并的重复记录
DELETE dup FROM self_purchases dup
JOIN (
  SELECT sku, storeId, MIN(id) AS keep_id
  FROM self_purchases
  WHERE sku IS NOT NULL AND sku <> ''
  GROUP BY sku, storeId
  HAVING COUNT(*) > 1
) g ON dup.sku <=> g.sku AND dup.storeId <=> g.storeId AND dup.id <> g.keep_id;

-- 4) 两边名称不同时，把被合并掉的那个名字存进备注（信息不丢，用户可在页面上改）
UPDATE self_purchases keep
JOIN self_purchases_sku_merge_bak_20261010 dup
  ON dup.sku <=> keep.sku
 AND dup.storeId <=> keep.storeId
 AND dup.id <> keep.id
 AND dup.name IS NOT NULL
 AND dup.name <> COALESCE(keep.name, '')
SET keep.remark = SUBSTRING(
      CONCAT('别名：', dup.name, IF(keep.remark IS NULL OR keep.remark = '', '', CONCAT(' | ', keep.remark))),
      1, 500
    )
WHERE keep.sku IS NOT NULL AND keep.sku <> '';

-- 5) 核对：同一 SKU 应只剩一条，且 1688 / Ozon 链接都在同一条上
SELECT id, sku, name,
       supplyUrl IS NOT NULL AS has1688,
       retailUrl IS NOT NULL AS hasOzon,
       remark
FROM self_purchases
ORDER BY id;

SELECT sku, storeId, COUNT(*) AS c
FROM self_purchases
WHERE sku IS NOT NULL AND sku <> ''
GROUP BY sku, storeId
HAVING c > 1;  -- 应无输出
