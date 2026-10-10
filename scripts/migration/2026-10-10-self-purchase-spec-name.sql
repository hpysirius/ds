-- 2026-10-10：self_purchases 增加「1688 规格名」列
-- 背景：插件「记一笔 → 抓 1688 页」新增规格下拉（与回填核价区同款），
--       选中的规格名（如「蓝色」「2合1款双片装」）随 memo 上报存库。
-- 幂等：重复执行会报 Duplicate column，忽略即可。
ALTER TABLE self_purchases ADD COLUMN specName VARCHAR(255) NULL AFTER name;
