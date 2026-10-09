-- 自采购：新增「Ozon 跟卖价」字段（插件在 Ozon 商品页采集时带上）
-- 落库口径统一为卢布（retailPriceRub）+ 元（retailPriceCny）两个字段，
-- 避免像 products.price 那样把页面渲染的人民币当卢布存（2026-10-09 修过一次）。
ALTER TABLE `self_purchases`
  ADD COLUMN `retailPriceRub` DOUBLE NULL COMMENT 'Ozon 跟卖价（卢布）',
  ADD COLUMN `retailPriceCny` DOUBLE NULL COMMENT 'Ozon 跟卖价（元）',
  ADD COLUMN `retailPriceAt` DATETIME(3) NULL COMMENT '最近一次抓到/更新跟卖价的时间';
