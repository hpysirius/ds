'use client';

/**
 * 浏览器插件下载入口（顶栏按钮 + 安装说明弹窗）
 *
 * 数据来源：/plugin/plugin-info.json —— 由 scripts/pack-extension.sh 在打包时生成，
 * 随前端静态资源一起发布（deploy.sh 每次部署前都会重新打包一次）。
 * 下载的 zip 固定叫 /plugin/ds-collector.zip，换版本不用改代码；
 * 文件名带上版本号便于用户区分，URL 上带 ?v= 破缓存。
 */

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Modal, Tag, Tooltip } from 'antd';
import { ChromeOutlined, DownloadOutlined, SyncOutlined } from '@ant-design/icons';

const INFO_URL = '/plugin/plugin-info.json';
const ZIP_URL = '/plugin/ds-collector.zip';
/** 记住"上次下载过的版本"，用于顶栏小红点提醒有新版本 */
const SEEN_VERSION_KEY = 'ds_plugin_downloaded_version';

export type PluginInfo = {
  name?: string;
  version?: string;
  description?: string;
  file?: string;
  versionedFile?: string;
  size?: number;
  fileCount?: number | null;
  builtAt?: string;
};

/** 拉取插件包元信息（拉不到就返回 null，界面降级为"下载最新版"） */
export function usePluginInfo(): PluginInfo | null {
  const [info, setInfo] = useState<PluginInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(INFO_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && d.version) setInfo(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}

/** 当前线上包版本 是否比"我上次下载的版本"新 */
function useNewerAvailable(info: PluginInfo | null) {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (!info?.version) return;
    let seen = '';
    try {
      seen = localStorage.getItem(SEEN_VERSION_KEY) || '';
    } catch {}
    setNewer(!!seen && seen !== info.version);
  }, [info?.version]);
  return newer;
}

export function formatSize(n?: number) {
  if (!n) return '—';
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

export function formatTime(s?: string) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 触发下载，并记住本次下载的版本（下次有新版就亮小红点） */
function downloadPlugin(info: PluginInfo | null) {
  const version = info?.version || '';
  const a = document.createElement('a');
  a.href = `${info?.file || ZIP_URL}?v=${encodeURIComponent(version || String(Date.now()))}`;
  a.download = `${info?.name || 'DS-Ozon-采集助手'}${version ? ` v${version}` : ''}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (version) {
    try {
      localStorage.setItem(SEEN_VERSION_KEY, version);
    } catch {}
  }
}

/** 安装 / 更新步骤（顶栏弹窗与使用说明页共用同一份） */
export function PluginInstallSteps() {
  const li = { marginBottom: 6 } as const;
  return (
    <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9, fontSize: 13, color: '#333' }}>
      <li style={li}>
        点下面的「下载插件包」，拿到 <span className="mono">DS-Ozon-采集助手 v…zip</span> 压缩包。
      </li>
      <li style={li}>
        <b>解压</b>到一个固定的目录，得到 <span className="mono">ds-collector</span> 文件夹（装好后别删它）。
      </li>
      <li style={li}>
        Chrome 地址栏输入 <span className="mono">chrome://extensions</span>，打开右上角的「<b>开发者模式</b>」。
      </li>
      <li style={li}>
        点左上角「<b>加载已解压的扩展程序</b>」，选中刚解压出来的 <span className="mono">ds-collector</span> 文件夹。
      </li>
      <li style={li}>
        插件装好后，先在浏览器<b>登录本系统</b>（决定「采集归属」），再点插件图标把服务器地址填成{' '}
        <span className="mono">http://ozon.qinxianty.com/api</span>。
      </li>
    </ol>
  );
}

export function PluginDownloadModal({
  open,
  onClose,
  info,
}: {
  open: boolean;
  onClose: () => void;
  info: PluginInfo | null;
}) {
  const newer = useNewerAvailable(info);
  // 「上次下载的版本」只能在挂载后读（SSR 阶段没有 localStorage）
  const [seen, setSeen] = useState('');
  useEffect(() => {
    try {
      setSeen(localStorage.getItem(SEEN_VERSION_KEY) || '');
    } catch {}
  }, [open]);
  return (
    <Modal open={open} onCancel={onClose} footer={null} width={620} title="下载浏览器插件" destroyOnClose>
      <div
        style={{
          border: '1px solid #eef0f3',
          borderRadius: 10,
          padding: '12px 14px',
          marginBottom: 14,
          background: '#fafcff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ChromeOutlined style={{ color: '#1677ff', fontSize: 16 }} />
          <b style={{ fontSize: 14 }}>{info?.name || 'DS Ozon 采集助手'}</b>
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            当前版本 {info?.version ? `v${info.version}` : '读取中…'}
          </Tag>
        </div>
        <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 6 }}>
          打包时间 {formatTime(info?.builtAt)} · 体积 {formatSize(info?.size)}
          {info?.fileCount ? ` · ${info.fileCount} 个文件` : ''}
          {seen ? ` · 你上次下载的是 v${seen}` : ''}
        </div>
      </div>

      {newer && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message={<span style={{ fontSize: 12 }}>插件已更新到 v{info?.version}，建议重新下载覆盖安装。</span>}
        />
      )}

      <Button type="primary" block icon={<DownloadOutlined />} onClick={() => downloadPlugin(info)}>
        下载插件包（zip）
      </Button>

      <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 10, marginBottom: 16 }}>
        下载后按下面 5 步安装；<b>已经是旧版本</b>的话，重复这 5 步即可覆盖（解压时选「替换」，再回{' '}
        <span className="mono">chrome://extensions</span> 点一下插件卡片上的刷新）。
      </div>

      <PluginInstallSteps />
    </Modal>
  );
}

/** 顶栏 / 页面用的下载按钮：有新版本时亮小红点 */
export function PluginDownloadButton({
  size = 'small',
  type = 'default',
  label = '下载插件',
  showVersion = false,
  block = false,
}: {
  size?: 'small' | 'middle' | 'large';
  type?: 'default' | 'primary' | 'text' | 'link';
  label?: string;
  showVersion?: boolean;
  block?: boolean;
}) {
  const info = usePluginInfo();
  const newer = useNewerAvailable(info);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip
        title={
          info?.version
            ? newer
              ? `插件已更新到 v${info.version}，点此下载`
              : `当前版本 v${info.version}（打包于 ${formatTime(info.builtAt)}）`
            : '下载最新版采集插件'
        }
      >
        <Badge dot={newer} offset={[-4, 4]}>
          <Button
            size={size}
            type={type}
            block={block}
            icon={newer ? <SyncOutlined /> : <DownloadOutlined />}
            onClick={() => setOpen(true)}
          >
            {label}
            {showVersion && info?.version ? ` v${info.version}` : ''}
          </Button>
        </Badge>
      </Tooltip>
      <PluginDownloadModal open={open} onClose={() => setOpen(false)} info={info} />
    </>
  );
}
