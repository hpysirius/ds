# 闪电ERP（山上跨境 ERP）功能与能力调研报告

> 调研对象：https://sczs.shanshangnet.com/app/ozon/project-overview （你在问的这个站点）
> 官网：https://www.shanshangnet.com ，产品名：**闪电ERP**，定位"更懂 Ozon 经营的跨境电商工作台"
> 调研时间：2026-10-05
> 调研方法：**公开信息逆向**（前端构建产物静态分析 + 官网 SSR 内容 + 全站接口提取），未登录、未调用任何私有接口

---

## 0. 先说三件重要的事

**① 关于名字**
站点里找不到"中实跨境"这四个字。这个系统对外品牌是**闪电ERP**，运营主体域名是 `shanshangnet.com`（山上网络），后台服务器域名是 `sczs.shanshangnet.com`（sczs = 山上跨境 / 生态 cid）。"中实跨境ERP"可能是你那边对接人/服务商的叫法，或者是同一套系统的私有化部署版本。下文统一称"闪电ERP"。

**② 这份报告的可信度**
不是猜的。它的前端是 Vite 打包的 SPA，构建产物（1500+ 个 JS chunk，共约 11MB）**完整暴露了源码目录结构、全部后端接口路径、界面文案**。我做了：

- 抓取全部业务 chunk（1500 个）→ 提取出 **848 个后端接口 URL**，其中 `/ozon/**` 有 **206 个**
- 还原出业务源码目录 `views/ssyk/**` 共 **158 个页面文件**
- 逐个页面提取界面中文文案（按钮/列名/提示语）
- 补充官网 SSR 首页文案、Nuxt 隐藏路由探测、sitemap

**但边界要说清**：我没有账号，没有登录过它的系统，所以**没有看到真实菜单的排列与最终 UI**，也没有验证任何接口的请求/响应参数。报告里的"页面和功能"是源码级的，准确度高；**具体字段类型、鉴权方式、接口出入参是推断的**。

（2026-10-07 更新：已通过运行时 DOM 抓取补齐**真实渲染菜单树**，见第 3.0 节，至此"真实菜单排列"这一空白已填补；接口出入参与字段类型仍未验证。）

**③ 与你的 ds 项目的关系（先给结论）**
它是一条完整的 Ozon 经营链路：**选品 → 刊登 → 订单 → 采购 → 仓储履约 → 利润分析 → 财务/会员**。
你的 ds 目前覆盖的是其中的 **采集选品 + 商品库 + 定价/利润计算** 这三段，且做得比较深（尤其是定价工作台）。
它多出来的部分是：**刊登上架（Listing 编辑器 + 类目属性 + 富内容）、AI 图/文生成与裂变、订单履约与仓储作业、财务与利润报表、多级会员/分站（代理）计费体系**。
最现实的对接位是：**你的商品库/定价数据 ↔ 他的订单履约/仓储/财务**，或者反过来你补齐"刊登"。详见第 7 章。

---

## 1. 技术架构（这决定了你能不能对接、怎么对接）

| 层 | 结论 | 证据 |
| --- | --- | --- |
| 前端 | **Vue 3 + Vite + Vben Admin 5.5.9**（antd 风格），SPA，构建日期 2026-10-01 | 入口 HTML、`_app.config.js`、chunk 头注释 `Vben Admin Version: 5.5.9` |
| 前端部署路径 | `https://sczs.shanshangnet.com/app/` ，静态资源在 `/app/js/*.js` | HTML 里 `<script src="/app/jse/index-index-*.js">` |
| 后端 | **芋道 yudao 框架**（Java Spring Boot），REST 风格，**关键信息见下** | `window._VBEN_ADMIN_PRO_APP_CONF_ = {"VITE_GLOB_API_URL":"https://www.shanshangnet.com/admin-api"}` |
| API 基址 | `https://www.shanshangnet.com/admin-api` | 同上（注意：**业务域名和 API 域名不同**） |
| 未授权响应 | `{"code":401,"msg":"账号未登录","data":null}` | 直接 curl 任何 `/admin-api/**` 均返回此结果 |
| 官网 | Nuxt 3 SSR，只有一个页面（sitemap 仅列首页），`/features` `/pricing` `/help` `/cases` 都 302 回首页锚点 | `sitemap.xml` |
| 多租户 | 是。`system/tenant/*`、`tenant-package`、`tenant-sbean/adjust`（sbean = 平台货币/积分）、`vip-info/tenant-price`、`tenant-visibility`、`tenant-branding` | 接口清单 |
| 鉴权 | 登录 JWT。支持账密、短信、扫码、社交登录（`system/auth/sms-login`、`qrcode-login`、`social-login`、`sso-login` page 存在） | `_core/authentication/*` 页面 |
| 额外集成（框架自带，可能未被启用） | AI（chat/image/knowledge/music/workflow/mindmap）、BPM 工作流引擎、CRM（线索/客户/合同/回款）、IoT 设备管理、商城+优惠券+秒杀+分销、支付（支付宝/微信）、mp 公众号 | `views/ai/**`、`views/bpm/**`、`views/crm/**`、`views/iot/**` 等目录存在 |

> **判断**：它跑在芋道 yudao 商业版全家桶上，Ozon 业务是长在 `/admin-api/ozon/**` 这一层上的定制模块，采购/供应链则直接复用 yudao 自带的 `/admin-api/erp/**`。这意味着它的**权限、租户、菜单、工作流、支付**都是现成框架能力，不是自己写的。

---

## 2. 产品定位与商业模式

官网一句话："从浏览器选品、商品刊登，到订单采购、仓储履约与利润分析，把分散操作连成一套完整经营流程。"

**官网宣称的五步链路**：
`01 浏览器选品（看市场、售价与利润） → 02 AI 刊登（处理内容并批量上架） → 03 订单采购（同步订单并衔接货源） → 04 仓储履约（入库、打包与发货） → 05 经营分析（核对成本与订单利润）`

**目标客群**（官网三段式）：刚起步的 Ozon 卖家 / 稳定增长的多店卖家 / 规模化运营团队（多人多店多仓）。

**变现方式**（这套设计很完整，值得研究）：

| 机制 | 说明 | 来源 |
| --- | --- | --- |
| 会员套餐 | 免费版 / 基础版 / 专业版 / 高级版，**按可绑定店铺数**计价，支持月/年，含"加量包" | `membership-purchase`、`vip-manage` |
| CDK 兑换码 | 兑换会员（`vip-cdk`，生成卡密） | `vip-cdk/GenerateCardModal` |
| **豆**（虚拟币） | AI 计费货币，用于 AI 套图、标题、简介生成；裂变消耗豆 | `ai-billing-config`、`coin-recharge`（豆充值） |
| **币**（虚拟币） | 支付转运费等平台费用 | `tenant-sbean/adjust`、`user-wallet` |
| 充值方式 | **人工**：联系客服微信扫码充值，客服确认后加豆/加币（非在线支付自动到账） | `data-report/coin-recharge` 文案 |
| **分站/代理体系** | 一个总租户下可开多个"分站"，各有域名、转运费（元/单）、订单额度、支付密钥、用户数、仓库数、过期时间 → **明显的招商代理/OEM 模式** | `substation-management` |
| 增值服务 | 单独售卖（`value-added-service`） | 接口 `/ozon/value-added-service/*` |
| 引流 | **免费试用 7 天**、1 对 1 客服指导、新手教程视频 | 官网 + 工作台首页 |

---

## 3. 功能全景：12 大模块

下面按**源码目录**组织（`views/ssyk/**` 是它的业务代码根目录）。每个模块的"页面清单"是源码真实存在的路径。

### 3.0 真实功能菜单树（运行时渲染，权威来源）

> **来源**：2026-10-07 从系统运行时 DOM 抓取（用户称该系统为「中实跨境ERP」，实际运营主体为山上网络「闪电ERP」）。这是登录后实际看到的左侧导航，**比 3.1–3.13 的源码反推更准确、更完整**，可直接作为功能清单基线。
>
> 共 **15 个一级菜单项**（其中 5 个为可展开分组），展开后可见 **34 个末级功能页**。

- 运营首页
- 经营看板
- 经营大屏
- 店铺授权
- 选品中心
  - 大盘总览
  - 类目分析
  - 榜单选品
  - 标签查询
- 商品中心
  - 在线商品
  - 上架记录
  - 仓库商品
  - 采集配置
  - 采集箱
  - AI 生图记录
- 商品优化
  - AI 商品优化
  - 批量修改
  - 修改记录
- 订单中心
- 智营爆单
  - 轻品爆单
  - 爆款裂变
  - 弹性运营
- 售后处理
- 资金中心
  - 消耗明细
- 仓配管理
  - 仓库列表
  - 入库记录
  - 出库记录
- 利润分析
- 个人中心
- 工具
  - 定价工具
  - 利润计算器
  - 采集工具

> **与源码反推的对照**：本菜单印证了第 3 章绝大部分模块；同时明确了若干此前仅以"接口/页面文件"形式存在、未作为独立菜单项列出的功能，例如：**经营大屏、店铺授权、上架记录、仓库商品、AI 生图记录、轻品爆单、弹性运营、消耗明细、利润分析**。这些在后续对接评估时应并入对应模块。

### 3.1 项目概览工作台 `/ozon/project-overview`（你发我的就是这个）
数据来源：接口 `/ozon/home/dashboard-stats`、`/ozon/personal-center/overview`、`/ozon/project-overview`

- **数据概览卡**：今日销售额、本月销售额、上月销售额、今日订单、待发货、店铺数量、待退款、销售额、实收金额、订单数、采购订单、已采购订单、利润率、预估利润率
- **待处理事项**：待发货订单 / 缺货预警（库存不足商品数）/ 退款申请 / 客户消息未读
- **快捷入口**：授权店铺、采集商品、批量发布、订单处理、数据分析
- **上手指引（三段式，很有产品感）**
  - 开店前：了解俄罗斯市场、了解 OZON 平台、开店入驻、开店教程、收款方式
  - 出单前：**数据选品**（大盘市场分析/行业分析/商品分析/关键词分析）、**产品定价**（各种成本拆解/同行比价）、上传产品（手动/批量/ERP）、创建仓库、产品测评、报广告/活动
  - 出单后：物流发货、商品采购、打包发货、资金回款、分析优化、数据监控中心、店铺产品优化、爆单大卖、优化供应链、本土化/品牌化
- **工具行**：采集选品、刊登、中国馆、运费模板、物流、订单管理、客服消息、翻译、关税计算

### 3.2 选品中心 `selection-center/` ← **与你的 ds 重叠度最高**
接口：`/ozon/selection-center/tags/browser-result`、`/ozon/selection-center/tags/query`、统计类 `/statistics/product/analyse|list|rank-page|export-excel`

**榜单列表（榜单选品）**（`ranking/index.vue`，由 `listType` 参数切换）：
- 从源码推断为**多张榜单**（热销 / 热销新品 / 潜力 / 蓝海 / 中国专区）；本次 HAR 仅捕获到 `listType=HOT`（热销榜），其余类型按页面 Tab 同参切换。**注意大小写**：请求参数 `listType` 用大写 `HOT`，而返回体里的同义字段 `mainType` 用小写 `hot` —— 后端字段归一化不一致，对接时务必注意。
- 榜单字段（源码推断）：月销量、月销售额、单价、月销售额环比、月浏览量、日均销量/销售额、点击率、**商品卡加购率**、**搜索和目录加购率**、转化率、发货模式（FBO/FBS）、交货时间、体积、重量、可用性、**可跟卖**、商品创建日期。以下 3.2.1 用真实响应补全了完整字段表。

榜单页可直接操作：选店铺 + 仓库 → **批量设售价（支持按"原售价倍数"）**、设划线价、生成货号 → **批量上架（创建上架任务）**，会自动跳过重复项。

另有 `overview`（大盘总览：销量/销售额、类目月销量占比、类目月销售额占比、品牌销量占比、FBO/FBS 销量占比，支持年度/季度切换）、`category-analysis`（一级类目下钻）、`CategoryLevelSelector`（多级类目选择器）。

> **真实接口契约（2026-10-07 从「大盘总览」页 HAR 验证；此前为源码推断，现已用真实响应确认）**
>
> - `GET /ozon/selection-center/access` → `{"code":0,"data":{"member":true,"rankWindowLimit":5000}}`：进入选品中心前的**会员/权限校验**；`rankWindowLimit` = 榜单可查看的商品窗口上限（5000）。报告此前未记录此接口。
> - `GET /ozon/selection-center/overview` → **全平台市场大盘（非单店数据，用于选品参考）**：
>   - `summaries[]`：按周期 `period`（WEEK / MONTH / QUARTER / YEAR）给出 `salesVolume`（销量）、`salesAmountRub`（销售额·卢布）、`salesAmountCny`（销售额·人民币）。例（MONTH）：销量 ≈7.61 亿件，金额 ≈6394 亿₽ ≈505.9 亿¥；YEAR 销售额 ≈4780 亿¥。
>   - `categoryShares[]`：30 个一级类目占比，每项 `key`=Ozon 类目数字 ID（如 `15621031`=服装）、`name`、销量比 `volumeRatio`(%)、金额比 `amountRatio`(%)。**销量前三**：住宅和花园(13.62%)、服装(12.34%)、美容和卫生(11.02%)；**金额前三**：服装(18.48%)、住宅和花园(9.80%)、电子产品(9.25%)。
>   - `brandShares[]`：有品牌 73.41% / 无品牌 26.59%（仅销量比，`amountRatio` 为 null）。
>   - `fulfillmentShares[]`：FBO 72.04% / FBS 28.32%（仅销量比）。
>   - `sourceUpdatedAt` / `syncTime`：数据来源更新与同步时间戳（毫秒）。本次采样 `sourceUpdatedAt≈2026-09-14`、`syncTime≈2026-09-18`（UTC；HAR 捕获于 2026-10-07，说明大盘数据约半月同步一次）。
>
> 注：此前 3.2 节对 overview 字段的描述（销量/销售额、类目占比、品牌占比、FBO/FBS 占比、周期切换）与真实响应**完全吻合**，推断准确；仅多出 `access` 前置校验接口与 `categoryShares` 的 Ozon 类目 ID 映射需要补记。

#### 3.2.1 榜单选品 `products/page`（2026-10-07 从「榜单选品」页 HAR 验证）

这是**榜单选品功能的核心列表接口**，真实响应确认如下：

- **请求**：`POST /ozon/selection-center/products/page`，body：
  ```json
  { "listType": "HOT", "pageNo": 1, "pageSize": 10 }
  ```
  - `listType`：榜单类型（本次仅 `HOT`；其余类型见上方说明，按 Tab 切换同参）。
  - `pageNo` / `pageSize`：分页。返回的 `total` 恒为 **5000**，正好等于 `access` 返回的 `rankWindowLimit` —— 即榜单**最多可看 5000 条**，分页数 = 5000 / pageSize（pageSize=10 时共 500 页）。
- **响应**：`{ "code": 0, "data": { "total": 5000, "list": [ ... ] } }`，单条商品含 **62 个字段**（全平台公开行情，非单店数据）。完整字段表（按语义分组）：

| 分组 | 字段 | 含义 / 样例 |
| --- | --- | --- |
| 标识 | `id` `sku` `offerId` `title` `imageUrl` | 内部ID / Ozon SKU `149222760` / Offer `877` / 标题 / 图（`ir-*.ozonstatic.cn`） |
| 类目 | `category1/2/3Id` `category1/2/3Name` `categoryPath` `typeId` | 三级类目 + 路径（如 `文具>纸>打印纸`） |
| 品牌/卖家 | `brandName` `sellerId` `sellerName` `sellerType` `mainType` `mainTypeRank` | 品牌 `SvetoCopy`；卖家 `Ozon`；`sellerType=FBO`（另有 FBS）；`mainType=hot` |
| 销量/金额 | `salesCount` `orderedAmountRub` `orderedAmountCny` `salesDynamicPercent` `dailySales` `dailySalesAmountRub` `dailySalesAmountCny` | 销量 `59130`；人民币销售额 `8268685.85`；销量环比 `+40.3%` |
| 价格 | `averagePriceRub/Cny` `minimumPriceCny` `currentPriceRub/Cny` `discountPercent` | 均价/最低价/现价（卢布+人民币双币种）；折扣% |
| 库存/履约 | `endingStock` `stockDays` `averageDeliveryDays` `availabilityPercent` `workMode` `commissionPercent` | 剩余库存 `0`；可售率 `0%`；佣金% `10.81` |
| 流量/转化 | `productVisits` `totalImpressions` `searchImpressions` `exposureConversionPercent` `searchToCartPercent` `cardToCartPercent` `clickThroughPercent` `conversionPercent` `displayCount` `clickCount` `displayOrderCount` | 访客、曝光、搜索曝光、曝光转化%、搜索加购%、商品卡加购%、点击率%、转化% |
| 尺寸/重量 | `productWeightG` `productVolumeL` `productFeature` | 重量 `12520`g、体积 `18.79`L |
| 推广 | `promotionSharePercent` `promotionDays` `advertisingDays` `advertisingRoi` `lostSalesAmountRub` `subscriptionSharePercent` | 促销占比、促销天数、广告天数、广告ROI |
| 跟卖/关注 | `canFollow` `followSellerCount` | 是否可跟卖、关注该卖家的商家数 `29` |
| 时间 | `productCreatedAt` `sourceUpdatedAt` | 创建时间（样本为 null）、数据更新时间戳（毫秒，`1789747200000`≈2026-09-17） |

- **商品样本**（HOT 榜第 1 条，`id=17308`）：`SvetoCopy Printer Paper A4, 500 pcs`｜类目 `文具>纸>打印纸`｜销量 `59130`｜人民币销售额 `¥8,268,685.85`｜均价 `¥139.84`｜佣金 `10.81%`｜重量 `12.52kg`｜卖家类型 `FBO`｜数据源更新 `2026-09-17`。

**配套接口（同一页加载时一起请求）：**
- `GET /ozon/selection-center/categories` → 类目树，**26 个一级类目**，每项 `{id, name, level, children[]}`（二级/三级嵌套，如 `儿童用品` 下 30 个二级）。对接时类目筛选用这套 Ozon 数字 ID。
- `GET /ozon/extension/listing-options` → 上架选项：`shops[]`（**11 个店铺**，每项含 `id/name/currency/warehouses[]/warehouseLastSyncedAt`）+ `groups[]`（本次为空）。每个店铺挂多个仓库（如 `COCO` 店下有 `GUOO陆空`/`guoo陆运`/`轻小件陆空`/`轻小件陆运`，含 `warehouseId` + `enabled` + `lastSyncedAt`）。这是榜单页"选店铺→选仓库→批量上架"的数据来源。

> **与 ds 的对标价值**：`products/page` 的 62 字段基本覆盖了 ds 商品库（`products` 表）所需的**选品维度**——销量、双币种价格、重量体积、类目路径、佣金、转化率、跟卖标记。后续若要把榜单商品一键导入 ds，映射关系以 `offerId/sku` 为主键、`categoryPath` 映射 ds 类目、`productWeightG/productVolumeL` 直接落 ds 包装字段即可。

**标签查询**（`tag-query`，会员功能，有 `SelectionMemberGate` 门槛）：
输入 Ozon 商品 ID → **通过浏览器插件读取该商品的隐藏标签** → 返回"标签 + 中文翻译结果" → 支持复制全部标签 / 搜索产品。
插件不可用时提示"请安装或更新采集插件"。

> 这个设计跟你 ds 的采集插件思路同源：**用浏览器插件在真实页面里拿数据，绕开 API**。

### 3.3 浏览器插件 + 工具箱 `ozon-toolbox/`
接口：`/ozon/extension/plugin-release`、`/ozon/extension/listing-options`、`/ozon/extension/listing-warehouse/refresh`、`/ozon/extension/exchange-rates`

- 插件不是上架应用商店，而是 **下载 zip → 解压 → Chrome/Edge 开发者模式 → 加载已解压的扩展程序**（工具箱页面有完整图文安装指引）
- 安装后需配置：**域名**、**ERP 后台账密**、**Ozon 卖家后台登录**、采集价格配置、店铺配置
- 插件能力：在 OZON 商城页面**直接展示销量/销售额/转化率**等核心数据；**一键跟卖 / 编辑跟卖到 OZON 店铺**；采集商品 → ERP 后台看到采集记录；商品标签查询（见 3.2）
- 版本管理：`/ozon/extension/plugin-release`（后端下发插件版本/下载地址）

### 3.4 商品上传 / 刊登 `product-upload/`、`product-editor/`
接口：`/ozon/product-upload-record/**`（19 个）、`/ozon/description-category/sync-from-ozon`

**采集箱**（`collection-box`）：采集来源平台包含 **淘宝 / 天猫 / 拼多多**（+1688 等）；
状态机：`未上架 → 资料准备中 → 资料异常 → 待上架 → 上架中 → 导入中 → **洗图中** → 待平台核实 → 已上架 / 上架失败`

**Listing 编辑器**（相当完整，这是它的核心竞争力之一）：
- 中性编辑层（`NeutralListingEditor`）：商品标题、类目、商品类型、**富内容（RichContent）**、**内容完整度建议**、商品视频、变体 SKU 设置、售价/划线价、包装重量与三维、**卖家代码**、**条形码**、**HS 编码（欧亚经济联盟对外经济活动商品命名代码）**、生产国、材料、目标受众、原厂包装数量…
- Ozon 适配层：`listing-editor/category-tree` 类目树、`category-match` **AI 类目匹配**、`category-attributes` 类目属性、`attribute-values` 属性值、`OzonAttributeField` 属性控件
- 流程：`manual-create` 手工建 → `draft/save` 存草稿 → `preflight` **上架前体检** → `submit` 提交 → `submission/status` 查状态 → `submission/reconcile` **对账（ reconcile 很重要，防止提交成功但店铺没上架）** → `submission/history` 历史
- **AI 图片套件**（`AiImageSuite*`，8 个组件）：配置面板 → 生成 → 进度 → 结果卡 → 富预览；接口 `/ozon/ai-image-suite/{generate,history,capability,active,content/generate,content/tasks/all,image-translation/*}`；**失败会退豆**（"帮写失败，费用已退回"）

### 3.5 在线商品 `product-list/`
接口：`/ozon/goods/**`（30 个）

- 列表 `/goods/page`、`sync-by-id` 单品同步、`sync-task` 批量同步、`content-sync(+status)` 内容同步
- **在线编辑** `online-edit`（含 `image-sources`、`save-status`、`recover`）、**卡片编辑** `card-edit`（含 `reconcile` 对账）
- 批量操作：`batch/alter-price`、`alter-stocks`、`alter-trans`、`archive`；v2 版 `batch-archive / batch-relist / batch-repair / batch-unarchive`
- 单品操作：`set-elastic-price`（弹性价格比例）、`set-actual-weight`（实重）、`repair-replica`（修复副本）、`updateLogistics`、`edit-default-trans`、`specification`
- 弹窗：`batchPriceEditModal`、`batchStockEditModal`、`batchTransEditModal`、`batchElasticRatioEditModal`
- `OzonEditorPriceTools`：商品列表里直接调用定价工具

#### 3.5.1 在线商品 `goods/page`（2026-10-07 从「在线商品」页 HAR 验证）

这是**最贴合你 ds 商品库**的页面——它不是选品行情，而是**你自己在 Ozon 的 1470 个在售/在管商品**（每个店铺一条记录，按 `storeId` 归店）。真实响应确认如下：

- **请求**：`GET /ozon/goods/page?pageNo=1&pageSize=10&filter=ALL&sortBy=createdAt&sortDir=desc`
  - `filter`：状态筛选（枚举见下方 `get-conut-list`）；`sortBy/sortDir` 排序。
- **响应**：`{ "code": 0, "data": { "total": 1470, "list": [ ... ] } }`，单条商品 **67 个字段**。完整字段表（按语义分组）：

| 分组 | 字段 | 含义 / 样例 |
| --- | --- | --- |
| 标识 | `id` `name` `productId` `skuId` `offerId` | 内部ID `642853599` / 俄文标题 / Ozon 商品ID `6301108489` / SKU `5764921803` / Offer `GH-5591500425` |
| 价格(双币种) | `price` `rubPrice` `oldPrice` `marketingSellerPrice` `priceCurrencyCode` `platformCommission` `buyPrice` `minPrice` `discountPercentage` | 本店价 `42`(CNY) / 卢布 `530.88`；佣金 `12%`；成本价 `buyPrice`（可空）；折扣 `12%` |
| 状态 | `status` `filter` | `status`=俄文（如 `Готов к продаже`=待售）；`filter`=英文枚举（见计数） |
| 图片 | `primaryImage` `images[]` | 主图（`ir-*.ozonstatic.cn`）+ 图集 |
| 尺寸/重量 | `height` `depth` `width` `dimensionUnit` `weight` `weightUnit` `volumeWeight` `actualWeight` | `80×75×75 mm`、重 `50 g`、体积重 `37.5`、实重（可空） |
| 店铺/仓 | `storeId` `storeName` `warehouseMode` `account` `warehouseId` `warehouseName` | 店铺 `yuezhidongfang`；`warehouseMode=rFbs`；账号 `cqy/156...` |
| 物流 | `simulateLogisticsId` `logisticsFee` `simulateLogisticsName` `userSelectedLogistics` `forwardingFee` | 物流 `GUOO Economy Extra Small PUDO` 运费 `4.78`；转发费 `forwardingFee=3.0` |
| 销售/库存 | `salesCount` `stocks` | 销量 `0`、库存 `2` |
| 采购/货源 | `purchasePlatform` `purchaseLink` `specification` | 货源平台/链接（可空）、规格 `银色/1/s2m-...` |
| 类目 | `category{cate1/2/3_name}` `descriptionCategoryId` `descriptionTypeId` | 类目**中文名**（`小百货和配饰>服装首饰>饰品配件`）+ Ozon 描述类目ID |
| 弹性运营 | `elasticJoined` `elasticRatioPercent` `elasticPrice` `elasticPriceSource` `elasticPriceSyncTime` | 弹性比例 `12%`、弹性价 `36.96` |
| 爆单 | `explosiveOrderStatus` `explosiveFloorPrice` | 爆单状态/保底价 |
| 错误/同步 | `errorMessage` `errorCount` `errorList` `stockSyncStatus` `stockSyncMsg` `stockSyncTime` | 上架错误、库存同步状态 |
| 时间 | `createdAt` `createTime` | 创建时间戳（毫秒） |

- **商品样本**（第 1 条，`id=642853599`）：`Аксессуар для бижутерии`（饰品配件）｜Ozon 商品ID `6301108489`｜Offer `GH-5591500425`｜价 `42 CNY / 530.88₽`、佣金 `12%`、折扣 `12%`｜状态 `Готов к продаже`｜`80×75×75 mm`、重 `50g`、体积重 `37.5`｜店铺 `yuezhidongfang`、模式 `rFbs`｜物流 `GUOO Economy Extra Small PUDO`(费4.78)、转发费 `3.0`｜库存 `2`、销量 `0`｜类目 `小百货和配饰>服装首饰>饰品配件`｜弹性 `12%`→`36.96`｜`filter=TO_SUPPLY`。

**配套接口（同一页加载）：**
- `GET /ozon/goods/get-conut-list`（同参）→ **按状态计数**，返回 6 类：`ALL=1470`、`IN_SALE=681`（在售）、`REMOVED_FROM_SALE=255`（已下架）、`ARCHIVED=422`（已归档）、`PARTIAL_APPROVED=30`（部分通过）、`STATE_FAILED=13`（审核失败）。**注意**：商品记录里还出现 `filter=TO_SUPPLY`（待供货）等值，说明 `filter` 枚举不止这 6 个，前端 Tab 可能只展示部分。
- `GET /ozon/store/getStoreList` → **11 个店铺**，字段极细：店铺名/币种(`currency=CNY`)/`apiKeyStatus`(VALID)/`apiKeyExpiresAt`/`ozonAccountStatus`(NORMAL)/`sellerCookieStatus`(BOUND)/`defaultTransTypeId`/`forwardingFee`/`syncOrderEnable`/`dailyCreateLimit`/`dailyUpdateLimit`/`totalLimit`/水印配置(`watermark*`)/`warehouses[]` 等。这是多店铺隔离与 Ozon API 凭证管理的核心表。
- `GET /ozon/store-group/list` → 店铺分组（本次 **0 条**，该账号未用分组）。
- `GET /ozon/trans-type/getAll` → **12 个物流方式**：`GUOO`/`CEL`/`ABT`/`China Post` 各 ×`Economy`/`Standard`/`Express`，默认 `GUOO Economy`(id=1)。对应商品里的 `simulateLogisticsId`/`userSelectedLogistics`。

> **与 ds 商品库（`products` 表）的直接对标**（这是对接价值最高的一页）：
> | 竞品 `goods/page` | ds `products` | 备注 |
> | --- | --- | --- |
> | `offerId` / `skuId` | 商品唯一键 | 主键映射 |
> | `name` | `title` | 标题（竞品存俄文原名） |
> | `primaryImage` / `images` | 商品图 | 走 ds 图片代理 |
> | `price` / `rubPrice` | 售价 | 双币种 |
> | `buyPrice` | 成本价 | ds 核价里的采购价 |
> | `platformCommission` | 佣金% | 利润计算 |
> | `weight` / `volumeWeight` / `height/depth/width` | 重量/体积 | 物流计费 |
> | `category.cate1/2/3_name` | 类目 | 中文类目路径 |
> | `purchaseLink` / `purchasePlatform` | 1688 货源 | 与 ds 采集回填同源 |
> | `storeId` / `storeName` | `storeId` | 多店铺隔离（与 ds 一致） |
> | `stocks` / `salesCount` | 库存/销量 | |
> | `elasticPrice` / `explosiveOrderStatus` | — | ds 暂无对应（弹性运营/爆单是其独有能力） |
>
> 反向看：竞品**没有** ds 的"采集规则标签(`CollectRule`)""核价工作台""1688 回填"概念——它靠 `purchaseLink` 直接关联货源，是个更"电商 ERP"的形态；ds 更偏"选品→核价→上架辅助"。

### 3.6 商品优化 / 批量修改 `product-optimization/`
接口：`/ozon/batch-task/**`（16 个）

- **AI 优化**：标题优化、简介(intro)优化、主题标签优化、批量图片优化 → 都有 `preview` 预览 + **计费预览**
- **批量修改**（`batch-modify`，带 6 种规则表单，跟你的 ds 规则引擎很像）：
  - `PriceRuleForm`：固定金额 / 百分比 / 加减三种模式
  - `StockRuleForm`：固定设置 / 增加 / 减少
  - `TransRuleForm`：切换物流预设（GUI 估计是 GUOO 等承运商）
  - `ArchiveRuleForm`：按店铺/状态/库存/售价筛选后归档（下架）
  - `DeleteRuleForm`：仅可删"已归档且未创建 xxx"的商品
  - `ElasticRatioRuleForm`：弹性价格比例规则
  - **约束**：每种修改类型同时只能运行 1 个任务（异步），可在"修改历史"看进度
- **修改记录** `revision-record`（含详情）
- 批量任务接口：`create`、`page`、`detail`、`detail/item/page`、`item/status-count`、`type-count`、`get`

### 3.7 爆款玩法 / 裂变 `explosive-play/`
接口：`/ozon/explosive-order/**`、`/ozon/hot-fission-task/**`、`/ozon/gameplay-config/**`

- 三个页面：`explosive-hit`（爆款命中）、`flexible-play`（灵活玩法）、`play-list`、`small-explosive`（小爆款）
- **爆款裂变**（这块做得很有特点）：选源商品 → 设置**最多裂变数** → AI 重新生成 **裂变标题 / 裂变标签 / 裂变简介 / 裂变图片** → 价格设置（原价/新价）→ 水印设置（可复用上货配置水印）→ 提交 → 异步任务
  - 状态：生成中 / 完成 / 部分成功 / 失败（有失败原因 + 下次自动重试）
  - **消耗豆**：提交前显示"预计消耗"，余额不足直接拦截；有"豆消耗明细"
- `explosive-order`：`auto-join-exit/{save,stores}` **自动加入/退出**、`batch-exit` 批量退出、`join-elastic` 加入弹性、`tab-counts/status-tab-counts`
- **`gameplay-config`**：`check-access`、`unlock-condition-options`、`update-unlock` —— 配合前端 `GameplayColumnMask`、`GameplayUnlockCard`、`GameplayUnlockButton`：**某些数据列/功能是"锁定"的，满足条件/付费才解锁**（典型的"能力即商品"设计）

### 3.8 订单管理 `order-management/`
接口：`/ozon/order/**`（32 个）

- 列表 `/order/page`、`getStatusCount`、`export-excel`
- 发货：`shipPackage`、`batch-ship-package`、`label-preview`（面单预览）、`getPdf`（面单 PDF）、`saveActualWeight`（回填实重）、`update-remarks`
- **采购衔接**：`submitPurchase` 提交采购、`purchase-info/void` 作废、`purchase-batch/cancel` 批量取消、`getPurOrder/getPurOrderCout`
- **同步**：`sync-task`、`sync-task/active`、`/api/ssyk/order/scan-shipment`（扫码发货）
- **异常/售后**：`cancelled-service-refund`（取消服务退单 + options）、`warehouse-value-added-fee`（仓储增值费 + options）
- 组件：`BatchFillLogisticsModal`（批量填物流）、`OrderLabelPreviewButton`、`SubmitPurchaseModal`（**采购平台下拉：1688 / 拼多多 / 淘宝 / 其他**）、`BatchPurchaseModal`
- 售后订单独立模块 `after-sale-order/`（接口 `/ozon/after-order/{page,create,update,getStatusCount}`）
- **抢单/认领** `claim-list/`（接口 `/ozon/claimed-order/{page,claim,getStatusCount}`）— 多运营分摊处理订单

> **注意**：它的 1688 对接是**半自动**的 —— 系统只记录"采购来源平台 = 1688/拼多多/淘宝/其他"，实际下单仍由人去平台完成。这跟你在 ds 里"人工去 1688、不做自动抓取"的选择是一致的。

#### 3.8.1 订单中心 `order/page`（2026-10-07 从「订单中心」页截图+HAR 验证）

页面形态（截图确认）：顶部 Tab「手动录单 / 入库预报记录」；筛选条件：订单编号、SKU、采购单号、物流单号、账号、店铺分组、店铺、付款时间区间、签收时间排序；操作：查询/重置/**导出 Excel**/手动同步订单/批量操作/**开启自动同步**。状态 Tab（与 `getStatusCount` 一一对应）。

- **核心接口**：
  - `GET /ozon/order/page?pageNo=1&pageSize=10` → `data.total=3032`，单条订单 **50 个顶层字段** + 嵌套 `orderDetailDOList[]`（商品明细，内嵌完整 `goodsDO` 商品快照）+ `storeDO`（店铺快照）。
  - `GET /ozon/order/getStatusCount` → 双维计数：
    - `ozonStatus`：`awaiting_packaging=124`（等待备货）、`awaiting_deliver=164`（等待装运）、`delivering=1030`（Ozon运输中）、`delivered=1165`（已签收）、`cancelled=549`（已取消）。
    - `status`（内部状态）：`'0'=288`（**待采购**，对应截图 Tab）、`'6'=549`（取消，与 ozonStatus.cancelled 一致）、`'7'=2195`（=delivered 1165 + delivering 1030，应为"已发货后"的归并态）。
  - `GET /ozon/order/sync-task/active` → 当前是否有进行中的订单同步任务（响应 data 为空=无）。
  - `GET /ozon/gameplay-config/check-access` → **玩法权限校验**，3 项：`ELASTIC`（弹性玩法）/ `SMALL_EXPLOSIVE`（小件爆单）/ `HOT_FISSION`（爆款裂变），均 `allowed=true`、会员等级"专业版 开通年卡"——证实智营爆单三玩法是 VIP 门槛功能。
- **订单顶层字段（分组）**：

| 分组 | 字段 |
| --- | --- |
| 标识 | `id` `orderId`(Ozon, `39003241808`) `orderNumber`(`26797840-0461`) `postNumber`(=`...-2`，货件号) |
| 状态 | `status`(内部0/6/7) `ozonStatus` `ozonSubstatus`(`posting_created`) `orderType` |
| 时间 | `inProcessAt` `shipmentDate` `deliveringDate` `signedTime` `purchaseTime` `cancelTime` `cancelReason` |
| 客户/收货 | `customerName` `customerAddress` `mobile` `postNumber` `pickupCode` |
| 物流 | `trackingNumber` `logisticsCompany` `deliveryName`(`GUOO Economy Extra Small Chengdu PUDO`) `warehouse`(`LIUXIA GUOO陆运`) `logisticsFee`(11.8) `forwardingFee`(3.0) `warehouseIoStatus/IoId/IoImage` |
| 采购 | `purchaseAmount` `purchaseOrderNo` `purchaseTrackingNumber` `purchaseType` `purchaseWarehouseId/Name` `systemPurchased`(False) `purchaseProgress` `purchaseDataComplete` |
| 店铺 | `storeId` `accountName`(`15692590810`) `storeDO{...}`（快照同 store/getStoreList） |
| 增值服务 | `valueAddedServices` `billing` `valueAddedRefundNo/Amount/edAt/edBy/Reason` |
| 其他 | `remarks` |

- **`orderDetailDOList[]`（商品明细）**：`offerId`(`Lx-4916565678-yinse`) `skuId`(`5287005151`) `price`(43.0, CNY) `quantity` `name`(俄文) `platformCommissionPrice` `purchaseNo` `trackingNo` `purchasePrice` `purchaseInfos` + **`goodsDO`** = 该 SKU 在"在线商品"里的**完整商品快照**（与 3.5.1 `goods/page` 同构：双币种价格/佣金12%/尺寸重量/弹性价/爆单保底价等全带）。**这意味着订单-商品是内嵌快照而非实时 join**——下单瞬间的价格/佣金被固化，改价不影响历史订单。对接 ds 时建议同样做快照。
- **利润公式（截图 + 数据互相印证）**：`利润 = 售价 − 平台费 − 物流费 − 转运费`。样本：`43.00 − 5.16 − 11.80 − 3.00 = 23.04`，利润率 `23.04/43 = 53.6%` ✓；平台费 `43 × 12%(佣金) = 5.16` ✓；`成本利润率 2304.0%` 是因为采购金额为 0（未采购）时的展示态。rFbs 模式佣金 12%。

### 3.9 仓储履约 `warehouse-operations/`、`warehouse/`、`stock-*`
接口：`/ozon/warehouse-io/**`、`/ozon/warehouse-inventory/**`、`/ozon/warehouse-shelf/**`、`/ozon/electronic-scale/**`、`/ozon/warehouse/**`

- **入库单**：`in-page`、`in-export-excel`、`getInCount`、`cancel-io`、取消出入库
- **出库单**：`out-page`、`out-export-excel`、`getOutCount`
- **库存**：`warehouse-inventory/{page,inbound,update,log,order-stock}`，含 `InventoryInboundModal`（入库）、`InventoryLogDrawer`（库存变动日志）、`ShelfAssignModal`（货架分配）
- **货架**：`warehouse-shelf/{page,create,update,delete,assign}`
- **打包/发货**：`pending-packing`（待打包）、`PackingCompleteButton` / `PackingReopenButton`（打包完成/重开）、`scan-shipment`（扫码发货 + `waybill-template` 面单模板）、`warehouse-dispatch`（仓库调度 `{page,count,process}`）
- **电子秤**：`electronic-scale/{page,create,update,latest}`（接硬件称重复核重量）
- **仓库基础**：`warehouse/{page,create,update,options,get-enabled-warehouse-list}`
- 另有 `stock-inbound/`（入库中心：StockInboundCenter/Card/ProductList/PhotoModal）、`stock-product/`（库存商品：StockCatalog）

### 3.10 采购 / 利润
- **供应链单据用的是芋道 ERP 通用模块**：`/admin-api/erp/purchase-order`（采购订单）、`erp/purchase-in`（采购入库）、`erp/purchase-return`（采购退货）、`erp/sale-order`、`erp/sale-out`、`erp/sale-return`、`erp/supplier`（供应商）、`erp/warehouse`、`erp/stock-record`、`erp/product*`、`erp/customer`
- **采购利润** `purchase-profit/`（`/ozon/order/purchase-profit/export-excel`）：
  汇总口径 = 总收款、采购实付金额、采购支出、平台费用、物流费用、**预估利润、净利润、利润率、利润占比**
  明细字段 = 店铺、订单编号、商品件数、订单状态、实收金额、平台抽成、运费、采购金额、利润、采购单号、采购时间、支付时间、订单时间
  导出文件名："采购利润签收明细.xls"
- `profit-statistics/` 目前是"页面开发中"占位

### 3.11 数据 / 报表
- `data-workbench/` 数据工作台（StatisticCard、TrendChart、DataTable）
- `data-screen/` 数据大屏（DataScreenChart）
- `data-report/`：`index`、`accountLog`、`balance-change`、`coin-recharge`、`recharge`、`recharge-management`、`modules/{form,distribution,add-qrcode}`
- 接口还有 `/ozon/pay-trade-order/{page,my-recharge-stats}`、`/ozon/user-balance-detail/{page,export-excel,getBalanceCount}`、`/ozon/user-vip/{getUserPage,getStatistics,updateUser}`、`/ozon/home/random-title`
- `/statistics/product/{list,analyse,rank-page,export-excel}`（选品/商品统计）

### 3.12 工具箱 `tools/`
- **`tools/pricing` + `PricingWorkbench`（跨境定价 / 利润计算器）** ← 跟你的 ds 定价工作台几乎一模一样，细节见第 6 章对照
  - 接口：`/ozon/pricing-tool/{categories,commission,logistics,exchange-rate,calculate,lookup}`
  - 可"打开独立计算页面"（路由 `/calculate`）
- `tools/profit-calculator` 利润计算器、`tools/calculate` 计算器
- 工作台首页工具行里还有：翻译、关税计算、运费模板

### 3.13 系统 / 租户 / 会员
`store-management/`（店铺 + 店铺分组）、`user-manage/`（用户 + 余额 + 改密）、`vip-manage/`（会员套餐 + 加量包）、`vip-cdk/`（卡密生成）、`membership-purchase/`（开通/兑换）、`value-added-service/`（增值服务）、`substation-management/`（分站列表 + 分站权限）、`message-center/`（客服消息）、`watermark/`（水印配置）、`personal-center/`

店铺字段很有参考价值：店铺名称、账号、**密钥过期时间**（Ozon Client ID/API Key 授权）、平台、商品限额（`get-store-goods-count` / `sync-product-limit`）、货币类型、仓库数量、公司信息、分组、状态。
状态包含：`密钥失效 / 验证失败 / 已过期 / 未验证 / 即将到期 / 验证有效 / 到期时间未知`、`已绑定 / 已失效 / 未添加 / 已封禁 / 正常`，还有 **`restore-ozon-account-status`（封禁后人工确认恢复）**。

---

## 4. 完整接口清单（按模块，共 206 个 `/ozon/**`）

> 这些是从产物里实拉的，按前缀分组。省略了 yudao 框架自带的 `/system`、`/infra`、`/bpm`、`/crm`、`/erp`、`/pay` 等 640+ 个。

| 模块 | 接口（省略 `/ozon/` 前缀） |
| --- | --- |
| order (32) | page, export-excel, getStatusCount, getPdf, label-preview, shipPackage, batch-ship-package, saveActualWeight, update-remarks, submitPurchase, purchase-info/void, purchase-batch/cancel, purchase-profit/export-excel, getOrderAll, getPurOrder, getPurOrderCout, sync-task, sync-task/active, cancelled-service-refund(+options), warehouse-scan, warehouse-value-added-fee(+options), warehouse-dispatch/{page,count,process}, warehouse-packing/{lookup,pending-page,pending-count,complete,outbound,reopen} |
| goods (30) | page, update, sync-by-id, sync-task, content-sync(+status), specification, repair-replica, updateLogistics, edit-default-trans, set-elastic-price, set-actual-weight, warehouse/list, get-conut-list, card-edit(+info,+reconcile), online-edit(+info,+image-sources,+save-status,+recover), batch/{alter-price,alter-stocks,alter-trans,archive}, v2/{batch-archive,batch-relist,batch-repair,batch-unarchive} |
| product-upload-record (19) | getPage, delete, getStageCount, v2/retry-follow-sell, listing-editor/{detail, manual-create, draft/save, preflight, submit, category-tree, category-match, category-attributes, attribute-values, submission/{status,history,reconcile}, ai/{content/generate, content/tasks/all, image-suite}} |
| batch-task (16) | create, page, get, detail, detail/item/page, item/status-count, type-count, {ai-title,ai-desc,ai-image,ai-tag,price,stock,trans,archive,delete}/preview |
| store (11) | page, create, update, batch-update, getStoreList, export-excel, get-store-goods-count, sync-product-limit, sync-seller-info, **verify-authorization**, **restore-ozon-account-status** |
| ai-image-suite (9) | generate, active, capability, history, content/generate, content/tasks/all, image-translation/{capability,history,tasks} |
| vip-info (8) | page, current, create, update, delete, redeem, tenant-price/update, tenant-visibility/update |
| explosive-order (7) | page, tab-counts, status-tab-counts, join-elastic, batch-exit, auto-join-exit/{save,stores} |
| warehouse (6) | page, create, update, options, get-enabled-warehouse-list, list-latest-enabled-by-type |
| pricing-tool (6) | calculate, lookup, categories, commission, logistics, exchange-rate |
| warehouse-io (6) | in-page, in-export-excel, out-page, out-export-excel, getInCount, getOutCount, cancel-io, update-image |
| warehouse-inventory (5) | page, inbound, update, log, order-stock |
| warehouse-shelf (5) | page, create, update, delete, assign |
| hot-fission-task (5) | page, start, get, retry, tab-counts |
| value-added-service (5) | page, list, create, update, delete |
| gameplay-config (4) | list, **check-access**, **unlock-condition-options**, **update-unlock** |
| extension (4) | plugin-release, listing-options, listing-warehouse/refresh, exchange-rates |
| after-order (4) | page, create, update, getStatusCount |
| electron-scale (3) | page, create, update, latest |
| claimed-order (3) | page, claim, getStatusCount |
| store-group (3) | list, create, update |
| cdk (3) | page, create, update |
| user-balance-detail (3) | page, export-excel, getBalanceCount |
| user-vip (3) | getUserPage, getStatistics, updateUser |
| user-wallet (2) | get-wallet, update-balance |
| selection-center (2) | **tags/browser-result**, **tags/query** |
| home (2) | dashboard-stats, random-title |
| pay-trade-order (2) | page, my-recharge-stats |
| product (3) | list, ai/edit, ai/image-records |
| trans-type (2) | getAll, getByCarrierId |
| carrier (1) | getAll |
| trans-detail (1) | getTransDetailList |
| translation (1) | text/batch |
| description-category (1) | sync-from-ozon |
| personal-center (1) | overview |
| project-overview (1) | （工作台） |
| stock-inbound (1) | （入库中心） |
| tenant-sbean (1) | adjust |
| ai-billing-config (1) | enabled-unit-cost-map |
| data-report (1) | recharge-page |
| product-list (1) | record |

---

## 5. 业务源码目录（`views/ssyk/**` 158 个页面）

```
ssyk/
├── index.vue                     系统首页（营销引导页：能力地图/更新日志/客户案例/新手教程）
├── project-overview/             工作台首页（数据概览+待办+指引+快捷入口）
├── selection-center/             选品中心
│   ├── overview/  ranking/  category-analysis/  tag-query/
│   └── components/CategoryLevelSelector, SelectionMemberGate
├── product-upload/               商品上传
│   ├── collection-box/{index,edit}/       采集箱（含 NeutralListingEditor、AI图抽屉、视频编辑）
│   ├── config/    record/
├── product-editor/               Listing 编辑器（OzonListingEditorCore + AI Image Suite + 富内容）
├── product-list/                 在线商品（online-edit, ai-image-records, batch 弹窗, 玩法解锁）
├── product-optimization/         商品优化
│   ├── ai-optimization/{title,intro,theme-tag,batch-image}
│   ├── batch-modify/{Price,Stock,Trans,Archive,Delete,ElasticRatio}RuleForm + revision-record
├── explosive-play/               爆款玩法：explosive-hit / flexible-play / play-list / small-explosive
├── order-management/             订单（list, one-click, BatchPurchase, SubmitPurchase, 面单预览）
├── after-sale-order/             售后订单
├── claim-list/                   订单认领（抢单）
├── purchase-profit/              采购利润
├── profit-statistics/            利润统计（开发中）
├── warehouse-operations/         仓储作业：入库单/出库单/库存/货架/待打包/调度/扫码发货/电子秤
├── stock-inbound/  stock-product/ stock-product/StockCatalog
├── warehouse/                    仓库基础资料
├── logistics-management/         物流管理（开发中）
├── membership-purchase/  vip-manage/  vip-cdk/   会员购买/套餐管理/卡密
├── value-added-service/          增值服务
├── substation-management/        分站（代理）列表 + 分站权限
├── tools/                        定价工具（PricingWorkbench）/ 利润计算器 / 关税计算
├── ozon-toolbox/                 采集插件下载 + 安装指引 + 使用教程
├── store-management/             店铺管理 + 店铺分组
├── user-manage/                  用户管理（余额/改密/编辑）
├── data-report/                  数据报表（账单/余额变动/豆币充值/充值管理/充值码）
├── data-screen/  data-workbench/ 数据大屏 / 数据工作台
├── message-center/               客服消息
├── personal-center/  watermark/  个人中心 / 水印配置
```

---

## 6. 重点拆解：它的跨境定价 / 利润计算器（与你的 ds 对比）

这是跟你的项目最直接对标的模块，值得逐字段抄作业。

**来源**：`tools/pricing/index.vue` + `components/PricingWorkbench.vue`，接口 `/ozon/pricing-tool/{lookup,calculate,commission,logistics,exchange-rate,categories}`

| 维度 | 闪电ERP | 你的 ds 定价工作台 |
| --- | --- | --- |
| 输入入口 | **SKU 或商品链接 → 自动识别类目**（识别失败才手动选） | 同（1688/定价记录带参） |
| 采购成本 | 采购成本（¥） | 同 |
| 佣金 | **按商品类目取 Ozon 佣金比例**（`/pricing-tool/categories` + `/commission`），加载失败可重试 | 按类目/设置表 |
| 物流 | 跨境物流商下拉 + **物流类型（超级轻小件/低客单轻小件/轻小件/大件/高客单小件/高客单大件）+ 方式（空运/陆运/陆空/邮政）**，逐案提示"物流方式货值限制按人民币匹配" | 物流渠道管理（同思路） |
| 包裹信息 | 包裹重量（含产品+包装+运输包装）、包裹体积（长宽高）、**计抛 / 不计抛** | 重量/体积、计抛规则 |
| 其他费用 | 国内运费、代贴单、广告费占比、尾程、**其他（提现、货损等）** | 参数设置里的各项费用 |
| 价格 | 售价（=预期实际售价/折后售价）、划线价（必须 > 售价）、**期望利润率反推** | 期望利润率反推售价（同） |
| 汇率 | `/pricing-tool/exchange-rate` 取实时汇率 | 设置里的 exchangeRate |
| 输出 | 售价、划线价、利润（毛利）、平台佣金、跨境物流费 | 类似 |

**它比你多做的两点值得借鉴**：
1. **`lookup`**：粘贴商品链接/SKU → 自动带出图片、类目、类目佣金，减少手填
2. **`reconcile`/`preflight` 思路**（在刊登模块）：提交前体检 + 提交后对账，明确区分"我方提交成功"和"店铺已上架"

---

## 7. 对接建议：三条路径 + 风险

### 7.1 先明确一件事
它**没有开放 API**，也没有开发者文档。`/admin-api/**` 全部返回 401，接口是它自家 SPA 用的私有接口。所以"系统对系统直连通命名为 Management 的私有接口"这条路，技术上能调但**不合规**——要走就得走商务合作，让对方给你正式的对接账号/密钥。

### 7.2 三条可选路径（按性价比排序）

**路径 A：数据层单向同步（推荐起步）**
- 你的 ds 产出商品 + 定价 → **导出结构化数据（Excel/CSV）** 或对方提供导入模板
- 闪电ERP 很多列表都自带 `export-excel` / `get-import-template`（yudao 通用能力），导入通道是现成的
- 优点：零开发风险、不需要对方改代码；缺点：非实时

**路径 B：浏览器插件层复用（最贴合你们双方的现有能力）**
- 两边都有浏览器插件（你 ds-collector，它"闪电采集插件"），都在 Ozon 页面里注入取数
- 可以让你的插件同时"醒酶"到它的 ERP 页面：把它的榜单/店铺数据摘出来喂给你的商品库，或反向
- 优点：不需要它的服务端权限；缺点：依赖页面 DOM 结构，对方改版就崩（这就是为什么它自己也做 `plugin-release` 版本下发）

**路径 C：正式商务对接**
- 它的 `/ozon/extension/*` 和 `/system/oauth2` 说明它内部有给第三方/插件留的接口规范；且它有"**分站**"体系（转运费/订单额度/支付密钥/自定义域名），**天然支持给别人开一个接入站点**
- 如果目标是长期，谈"分站/合作伙伴"身份比谈 API 更现实

### 7.3 结合你现状的具体建议

| 你缺的 | 从它那儿学什么 |
| --- | --- |
| 刊登/上架 | Listing 三段式：`类目匹配 → 属性填充 → preflight 体检 → submit → reconcile 对账`，以及 `unlock`（某些能力付费解锁）的产品化思路 |
| 定价工作台 | 加 `lookup`（链接/SKU 自动识别类目+佣金）、"其他费用（提现/货损）"、独立计算页 `/calculate` |
| AI 能力 | 它的 AI 全部接了**计费 + 失败退豆 + 单价配置**（`ai-billing-config/enabled-unit-cost-map`）—— 你要上 AI 的话这套必须配套 |
| 商业化 | 会员套餐按**店铺数**计价 + 加量包 + CDK + 两种虚拟币（AI 豆 / 平台币）+ 分站代理，是一套很完整的跨境 SaaS 收银方案 |
| 数据闭环 | 你的数据在"商品-定价"就断了；它的链路一路到"订单-采购-仓储-利润"，这也是你后续可以自然延伸的方向 |

### 7.4 风险提示
1. **合规**：不要直接调用对方的 `/admin-api/**`，未授权调用私有接口有法律风险
2. **耦合**：如果走插件层，对方前端一改版你的采集逻辑就失效（它 10-01 刚构建过，迭代很勤）
3. **1688 风控**：它同样**没有做 1688 自动抓取** —— 采购来源只是个下拉框（1688/拼多多/淘宝/其他），实际靠人工。这印证了你之前下线自动抓取的决定是对的：**这不是技术问题，是行业共识**
4. 报告里的接口路径可能随版本变化；需要我长期跟踪的话，可以定期重跑这套抽取脚本

---

## 附录：调研命令备忘

```bash
# 抓首屏拿入口
curl -s "https://sczs.shanshangnet.com/app/ozon/project-overview" -o index.html
# 拿运行时配置（API 基址）
curl -s "https://sczs.shanshangnet.com/app/_app.config.js?v=5.5.9-7c2ec7cd"
# 下载主 bundle（含全部 chunk 名清单）
curl -s "https://sczs.shanshangnet.com/app/js/bootstrap-BF3cinYo.js" -o boot.js
# 全站接口：下载 1500 个 chunk 后正则提取 "/xxx/yyy" 字符串
curl -s "https://www.shanshangnet.com/admin-api/system/auth/login"   # → 401 {"code":401,"msg":"账号未登录"}
```

> 完整提取产物（接口清单 848 条、中文界面文案、views 目录树 940 项）留存于本次调研的临时目录 `/tmp`（`all-apis-all.txt`、`views.txt`、`map.json`）。
