'use client';

/**
 * 使用说明书（/guide）
 *
 * 面向一线操作同事：从「插件采集」到「1688 回填核价」再到「保存定价记录」的完整链路。
 * 本页所有登录用户都能看，所以不挂在权限体系里（见 AppShell 菜单里直接 push 的那一项）。
 */

import { Fragment } from 'react';
import { Alert, Card, Collapse, Tag } from 'antd';
import {
  AppstoreOutlined,
  BulbOutlined,
  CheckCircleFilled,
  ChromeOutlined,
  CloudDownloadOutlined,
  CopyOutlined,
  EditOutlined,
  ExportOutlined,
  LoginOutlined,
  RocketOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { PluginDownloadButton, PluginInstallSteps, usePluginInfo, formatTime, formatSize } from '@/components/PluginDownload';

/** 流程总览：5 个大步骤 */
const FLOW = [
  {
    n: 1,
    icon: <CloudDownloadOutlined />,
    title: '采集商品',
    from: '浏览器插件',
    color: '#1677ff',
    lines: ['Ozon 列表页点「采集当前列表页」', '商品自动入库到商品库'],
  },
  {
    n: 2,
    icon: <AppstoreOutlined />,
    title: '选品 · 点核价',
    from: '商品库页面',
    color: '#722ed1',
    lines: ['商品库列表里找到目标商品', '操作列点「核价」打开定价工作台'],
  },
  {
    n: 3,
    icon: <CopyOutlined />,
    title: '复制图片找货源',
    from: '定价工作台 → 1688',
    color: '#13c2c2',
    lines: ['工作台点「复制图片」', '到 1688 以图搜款，打开同款货源页'],
  },
  {
    n: 4,
    icon: <SearchOutlined />,
    title: '抓取 1688 数据',
    from: '浏览器插件',
    color: '#fa8c16',
    lines: ['插件里填「核价页地址」', '点「抓当前 1688 页」并选规格'],
  },
  {
    n: 5,
    icon: <ThunderboltOutlined />,
    title: '回填并定价',
    from: '插件 → 定价工作台',
    color: '#52c41a',
    lines: ['点「回填到核价页」自动填表', '算定价 → 保存到定价记录'],
  },
];

/** 详细步骤 */
const STEPS: {
  n: number;
  icon: React.ReactNode;
  title: string;
  where: string;
  color: string;
  todo: React.ReactNode[];
  tips?: React.ReactNode;
}[] = [
  {
    n: 1,
    icon: <CloudDownloadOutlined />,
    title: '用插件采集商品，落到商品库',
    where: '浏览器插件（Ozon 列表页 / 商品页）',
    color: '#1677ff',
    todo: [
      <>在 Ozon 的<b>列表页</b>（榜单 <span className="mono">/highlight/…</span>、搜索页、类目页）打开插件，点 <span className="btn-chip">采集当前列表页</span>。</>,
      <>右侧数字是<b>往下滚几屏</b>（Ozon 是无限滚动，一屏约 36 个商品，填 3 大概能拿 100+），抓完会自动去重、新商品自动入库。</>,
      <>想按条件挑商品，先点 <span className="btn-chip grey">🏷 采集规则（自动打标签）</span> 配好规则；勾上 <b>过滤模式</b> 就只采集命中规则的商品，不勾则全部入库、仅给命中的打标签。</>,
      <>只在某一个商品页时，用 <span className="btn-chip grey">采集当前商品页</span>；库里商品缺类目/主图时，用 <span className="btn-chip grey">补详情(批量)</span> 逐条补齐（可随时点 <span className="btn-chip grey">停止</span>）。</>,
    ],
    tips: (
      <>
        弹窗里的 <b>采集归属</b> 决定数据算谁的：先用<b>员工自己的账号</b>在浏览器里登录一次本系统，插件才能读到身份；
        否则会显示「未登录（归超管全部）」。
      </>
    ),
  },
  {
    n: 2,
    icon: <AppstoreOutlined />,
    title: '进商品库，点「核价」',
    where: '商品库页面',
    color: '#722ed1',
    todo: [
      <>左侧菜单进 <span className="btn-chip grey">商品库</span>，用 SKU / 标题 / 类目 / 规则标签筛选出要定价的商品。</>,
      <>在列表最右侧「操作」列点 <span className="btn-chip">核价</span> —— 会新开一个标签页，直接进入<b>定价工作台</b>并自动带出这个商品（地址形如 <span className="mono">/pricing?sku=4922070443</span>）。</>,
      <>也可以先进「定价 → 定价工作台」，在 <b>① 选品</b> 里搜 SKU 或关键词选品，效果一样。</>,
    ],
    tips: <>「核价」标签页<b>不要关</b>，第 5 步插件要回填到它上面。</>,
  },
  {
    n: 3,
    icon: <CopyOutlined />,
    title: '复制图片，去 1688 找同款货源',
    where: '定价工作台 → 1688 图搜页',
    color: '#13c2c2',
    todo: [
      <>在定价工作台 <b>① 选品</b> 卡片里，点 <span className="btn-chip">复制图片</span>（把商品主图复制到剪贴板）。没显示图片时点 <span className="btn-chip grey">抓商品主图</span> 抓一次。</>,
      <>打开 <b>1688 以图搜款</b>页，在搜索区按 <span className="kbd">⌘</span> + <span className="kbd">V</span>（Windows 用 <span className="kbd">Ctrl</span> + <span className="kbd">V</span>）粘贴图片搜同款。</>,
      <>从结果里选一家靠谱的，进入它的 <b>1688 商品详情页</b>（<span className="mono">detail.1688.com/offer/xxx.html</span>）—— 这就是「当前 1688 页」。</>,
    ],
    tips: <>找不到图搜入口时，也可以用 1688 搜索框里的相机图标上传图片，或直接用商品标题关键词搜索。</>,
  },
  {
    n: 4,
    icon: <SearchOutlined />,
    title: '把核价页地址填进插件，抓取 1688 数据',
    where: '浏览器插件弹窗（停在 1688 商品页）',
    color: '#fa8c16',
    todo: [
      <>先<b>复制第 2 步那张核价页的地址</b>（浏览器地址栏里的 <span className="mono">http://ozon.qinxianty.com/pricing?sku=xxx</span>，本地则是 <span className="mono">http://localhost:3100/pricing?sku=xxx</span>）。</>,
      <>打开插件弹窗，滚到最下面 <b>1688 回填核价页</b> 区块，把这个地址<b>粘到下面的输入框</b>里（插件会记住上次填的，下次自动带上）。</>,
      <>点 <span className="btn-chip">抓当前 1688 页</span> —— 插件会读取当前标签页的 1688 商品，抓到规格、价格、件重尺、另需运费等信息。</>,
      <>在下拉里<b>选一个规格</b>（默认选最便宜那档），勾 <b>成本里加上另需运费</b>（如需要），成本 / 重量 / 长宽高会自动填好，<b>缺尺寸或想修正时可手动微调</b>。</>,
    ],
    tips: (
      <>
        抓取结果里出现 <b style={{ color: '#d46b08' }}>⚠ 包装尺寸缺失</b> 是商家没填，请手动补；手动补过的尺寸会被插件记住，
        下次抓同一货品自动带上。
      </>
    ),
  },
  {
    n: 5,
    icon: <ThunderboltOutlined />,
    title: '回填到核价页，算定价并保存',
    where: '插件 → 定价工作台',
    color: '#52c41a',
    todo: [
      <>点 <span className="btn-chip green">回填到核价页</span> —— 插件会自动打开/刷新你填的那张核价页，并把<b>成本、重量、长宽高</b>填进表单（工作台会提示「已从 1688 插件回填…」）。</>,
      <>回到定价工作台核对参数：汇率、平台佣金、代理佣金、加价率等默认值可在 <b>定价 → 参数设置</b> 里统一维护。</>,
      <>点 <span className="btn-chip">算定价</span>，会按各物流渠道算出运费与建议售价；<b>挑一个渠道</b>，可手动改售价，右侧实时看利润与利润率。</>,
      <>确认后点 <span className="btn-chip">保存</span>，本条就进了 <b>定价记录</b>，可在那里按店铺查看、导出 CSV。</>,
    ],
    tips: <>保存后会跳到定价记录页；想连续核价就回商品库再点下一个商品的「核价」。</>,
  },
];

/** 插件面板速查 */
const PLUGIN_HELP: { name: string; chip: string; color: string; desc: string }[] = [
  { name: '后端地址', chip: '填服务器 / 填本地', color: 'blue', desc: '线上填 http://ozon.qinxianty.com/api；本机开发填 http://localhost:3101。填完点「保存」，状态区出现绿点「已连接」即可。' },
  { name: '采集归属', chip: '自动读取', color: 'green', desc: '从你浏览器里打开的本系统页面读取登录身份，决定数据归到哪个店铺。先登录再采集。' },
  { name: '采集当前列表页', chip: '采集当前列表页', color: 'blue', desc: '列表页批量发现商品，右侧数字是往下滚几屏。最常用的入口。' },
  { name: '采集当前商品页', chip: '采集当前商品页', color: 'default', desc: '在单个 Ozon 商品详情页采集当前这一条。' },
  { name: '补详情(批量)', chip: '补详情(批量)', color: 'default', desc: '给库里缺类目/主图/价格的商品逐条打开详情页补全，填数量后点按钮，可随时停止、断点续跑。' },
  { name: '过滤模式', chip: '过滤模式', color: 'orange', desc: '勾上=只采集命中规则的商品（未命中的直接丢弃）；不勾=全部入库，仅给命中的商品打标签。' },
  { name: '采集规则', chip: '🏷 采集规则', color: 'default', desc: '配置筛选条件（评论数、月销、价格区间等），命中后打标签；配合「过滤模式」可只采符合要求的商品。规则会自动同步到后台的「规则标签管理」，在那里可以查看每个标签的条件明细。' },
  { name: '1688 回填核价页', chip: '抓当前 1688 页 / 回填到核价页', color: 'blue', desc: '在 1688 商品页抓取价格与件重尺，再一键回填到定价工作台表单。' },
];

/** 常见问题 */
const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: '插件显示「未登录（归超管全部）」，采集的数据跑哪去了？',
    a: (
      <>
        插件读取的是你浏览器里本系统的登录态。请先用<b>自己的账号</b>在浏览器打开一次本系统（<span className="mono">http://ozon.qinxianty.com</span>）并登录，
        再重新打开插件弹窗，状态区的「采集归属」就会变成「你的名字 · 你的店铺」。
      </>
    ),
  },
  {
    q: '列表页采集到 0 条 / 条数很少？',
    a: (
      <>
        ① 确认当前在 Ozon 的<b>列表页</b>而不是详情页；② 页面要先加载出来（往下滚一下让商品卡渲染）；
        ③ 开了「过滤模式」时，检查采集规则的条件是不是太苛刻，未命中会被直接丢弃；④ 试试把「往下滚几屏」调大一点。
      </>
    ),
  },
  {
    q: '插件提示「抓取失败」或抓到一半断了（1688 风控）？',
    a: (
      <>
        1688 对机房 IP 和<strong>高频请求</strong>比较敏感。请放慢节奏、不要连续大批量抓取，必要时换网络再试。
        定价工作台在抓取被风控时会自动改用「本机后端」出口（前提是本机也跑着一套服务）。这也正是系统不再做「自动核价 / 自动补信息」的原因。
      </>
    ),
  },
  {
    q: '点「回填到核价页」没反应、没打开页面？',
    a: (
      <>
        检查输入框里的地址是不是<b>完整</b>（要带 <span className="mono">http://</span>，且指向 <span className="mono">/pricing?sku=…</span>）。
        地址没问题时，插件会打开或刷新那张核价页，并在表单里看到回填后的成本与尺寸。
      </>
    ),
  },
  {
    q: '商品库里商品的图片不显示？',
    a: <>图片是经后端代理加载的，若整批都不显示多为图片域名未在放行名单内，请联系管理员补充。</>,
  },
  {
    q: '后台「规则标签管理」里没有我的规则？',
    a: (
      <>
        规则存在浏览器插件里，需要同步才能被后台看到。触发同步的方式：<b>打开一次插件弹窗</b>、在「🏷 采集规则」里<b>保存/删除/启停</b>，或<b>采集一次商品</b>。
        同步失败只会往插件日志里写一行、不影响采集。没同步过来的标签会以「仅商品数据」的形式列出来（只统计数量，看不到条件）。
      </>
    ),
  },
  {
    q: '商品库「规则标签」列里的标签能点吗？',
    a: <>可以。点标签名会弹出这个小标签对应的规则与全部命中条件；完整列表在左侧菜单「规则标签管理」里。</>,
  },
  {
    q: '插件有新版了，怎么更新？',
    a: (
      <>
        点顶部栏右侧（或本页上方）的「<b>下载插件</b>」，会显示当前最新版本号与打包时间；有新版时按钮上会亮小红点。
        下载后解压覆盖原来的 <span className="mono">ds-collector</span> 文件夹，再回到{' '}
        <span className="mono">chrome://extensions</span> 点插件卡片上的刷新按钮即可。
      </>
    ),
  },
  {
    q: '改了插件设置/代码，为什么没生效？',
    a: (
      <>
        插件改动需要在浏览器地址栏打开 <span className="mono">chrome://extensions</span>，找到「DS Ozon 采集助手」点<b>刷新</b>按钮重新加载；
        网页端改动按 <span className="kbd">⌘</span> + <span className="kbd">⇧</span> + <span className="kbd">R</span> 强制刷新一次。
      </>
    ),
  },
];

export default function GuidePage() {
  const pluginInfo = usePluginInfo();
  return (
    <div>
      <div className="guide-hero">
        <h1>使用说明书 · 从采集到定价一条龙</h1>
        <p>
          这篇说明带你把完整链路跑通一遍：用浏览器插件把 Ozon 商品采进<b>商品库</b> → 选品点<b>核价</b> → 复制主图去 <b>1688</b> 找同款 →
          在插件里抓取 1688 的价格与件重尺 → <b>回填</b>到定价工作台算价 → 保存成<b>定价记录</b>。
        </p>
        <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Tag color="rgba(255,255,255,.22)" style={{ color: '#fff', border: 0 }}>
            5 分钟上手
          </Tag>
          <Tag color="rgba(255,255,255,.22)" style={{ color: '#fff', border: 0 }}>
            图文 + 流程图
          </Tag>
          <Tag color="rgba(255,255,255,.22)" style={{ color: '#fff', border: 0 }}>
            含常见问题
          </Tag>
        </div>
      </div>

      <Card
        size="small"
        title="下载浏览器插件"
        style={{ marginBottom: 14 }}
        extra={
          <span style={{ fontSize: 12, color: '#8c8c8c' }}>
            {pluginInfo?.version
              ? `最新版 v${pluginInfo.version} · ${formatTime(pluginInfo.builtAt)} 打包 · ${formatSize(pluginInfo.size)}`
              : '正在读取版本…'}
          </span>
        }
      >
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '0 0 230px', minWidth: 200 }}>
            <PluginDownloadButton size="middle" type="primary" block label="下载插件包（zip）" />
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 8, lineHeight: 1.75 }}>
              插件每次更新后，重新下载最新包按右侧步骤覆盖安装即可；顶部栏的「下载插件」按钮在有新版时会亮<span style={{ color: '#ff4d4f' }}>小红点</span>提醒。
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 300 }}>
            <PluginInstallSteps />
          </div>
        </div>
      </Card>

      <Card size="small" title="一、整体流程总览" style={{ marginBottom: 14 }}>
        <div className="flow-wrap">
          {FLOW.map((s, i) => (
            <Fragment key={s.n}>
              <div className="flow-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      background: `${s.color}1a`,
                      color: s.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 15,
                    }}
                  >
                    {s.icon}
                  </div>
                  <div style={{ fontSize: 13, color: '#8c8c8c' }}>
                    第 {s.n} 步
                  </div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{s.title}</div>
                <div style={{ fontSize: 12, color: s.color, marginBottom: 6 }}>{s.from}</div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#595959', lineHeight: 1.8 }}>
                  {s.lines.map((l, k) => (
                    <li key={k}>{l}</li>
                  ))}
                </ul>
              </div>
              {i < FLOW.length - 1 && <div className="flow-arrow">➜</div>}
            </Fragment>
          ))}
        </div>
      </Card>

      <Card size="small" title="二、开始之前：准备 3 件事" style={{ marginBottom: 14 }}>
        <div className="plugin-grid">
          <div style={{ border: '1px solid #eef0f3', borderRadius: 10, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <ChromeOutlined style={{ color: '#1677ff', fontSize: 16 }} />
              <b>① 装好采集插件</b>
            </div>
            <div style={{ fontSize: 12, color: '#595959', lineHeight: 1.75 }}>
              点页面上方「<b>下载插件包</b>」拿到 zip → 解压出 <span className="mono">ds-collector</span> 文件夹 → 打开
              <span className="mono"> chrome://extensions</span> → 打开右上角「开发者模式」→ 点「加载已解压的扩展程序」选中该文件夹 → 建议固定到工具栏。
            </div>
          </div>
          <div style={{ border: '1px solid #eef0f3', borderRadius: 10, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <RocketOutlined style={{ color: '#13c2c2', fontSize: 16 }} />
              <b>② 给插件填后端地址</b>
            </div>
            <div style={{ fontSize: 12, color: '#595959', lineHeight: 1.75 }}>
              点插件里 <span className="btn-chip">填服务器</span> 一键填 <span className="mono">http://ozon.qinxianty.com/api</span>（本机开发用
              <span className="btn-chip">填本地</span>）→ 点「保存」。状态区出现绿点「已连接」就通了。
            </div>
          </div>
          <div style={{ border: '1px solid #eef0f3', borderRadius: 10, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <LoginOutlined style={{ color: '#fa8c16', fontSize: 16 }} />
              <b>③ 在浏览器登录本系统</b>
            </div>
            <div style={{ fontSize: 12, color: '#595959', lineHeight: 1.75 }}>
              打开本系统并<b>用你自己的账号登录</b>一次。插件会据此判断「采集归属」，数据才会落到你所在的店铺，而不是超管的「全部」。
            </div>
          </div>
        </div>
      </Card>

      <Card size="small" title="三、分步操作详解" style={{ marginBottom: 14 }}>
        {STEPS.map((s, i) => (
          <div
            key={s.n}
            style={{
              display: 'flex',
              gap: 14,
              padding: '16px 4px',
              borderTop: i === 0 ? 'none' : '1px dashed #eef0f3',
            }}
          >
            <div className="step-num" style={{ background: s.color, marginTop: 2 }}>
              {s.n}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: s.color, fontSize: 15 }}>{s.icon}</span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{s.title}</span>
                <Tag style={{ marginInlineEnd: 0 }} color="default">
                  {s.where}
                </Tag>
              </div>
              <ol style={{ margin: '10px 0 0', paddingLeft: 18, lineHeight: 2, fontSize: 13, color: '#333' }}>
                {s.todo.map((t, k) => (
                  <li key={k}>{t}</li>
                ))}
              </ol>
              {s.tips && (
                <Alert
                  style={{ marginTop: 10 }}
                  type="warning"
                  showIcon
                  message={<span style={{ fontSize: 12 }}>{s.tips}</span>}
                />
              )}
            </div>
          </div>
        ))}
      </Card>

      <Card size="small" title="四、插件面板速查" style={{ marginBottom: 14 }}>
        <div className="plugin-grid">
          {PLUGIN_HELP.map((p) => (
            <div key={p.name} style={{ border: '1px solid #eef0f3', borderRadius: 10, padding: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span className={`btn-chip ${p.color === 'blue' ? '' : p.color === 'green' ? 'green' : p.color === 'orange' ? 'orange' : 'grey'}`}>
                  {p.chip}
                </span>
                <b style={{ fontSize: 13 }}>{p.name}</b>
              </div>
              <div style={{ fontSize: 12, color: '#595959', lineHeight: 1.75 }}>{p.desc}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card size="small" title="五、常见问题" style={{ marginBottom: 14 }}>
        <Collapse
          ghost
          items={FAQ.map((f, i) => ({
            key: String(i),
            label: (
              <span style={{ fontSize: 13 }}>
                <BulbOutlined style={{ color: '#faad14', marginRight: 6 }} />
                {f.q}
              </span>
            ),
            children: <div style={{ fontSize: 13, color: '#595959', lineHeight: 1.85 }}>{f.a}</div>,
          }))}
        />
      </Card>

      <Card size="small" title="六、几点提醒">
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 2, fontSize: 13, color: '#333' }}>
          <li>
            <b>合规范使用 1688 数据</b>：不要高频、大批量抓取，避免触发风控；系统已不再提供自动核价/自动补信息功能。
          </li>
          <li>
            <b>让插件读到身份</b>：换账号或清了浏览器缓存后，重新打开一次本系统页面再采集。
          </li>
          <li>
            <b>定位问题看日志</b>：插件弹窗底部日志、以及「数据采集」页的任务日志，都会写明失败原因。
          </li>
          <li>
            <b>需要帮忙</b>：把对应截图（插件弹窗状态区、报错日志）发给管理员，能最快定位。
          </li>
        </ul>
        <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Tag icon={<CheckCircleFilled />} color="success">
            采集：插件 → 商品库
          </Tag>
          <Tag icon={<EditOutlined />} color="processing">
            核价：商品库 → 定价工作台
          </Tag>
          <Tag icon={<ExportOutlined />} color="purple">
            归档：定价记录 / 导出 CSV
          </Tag>
        </div>
      </Card>
    </div>
  );
}
