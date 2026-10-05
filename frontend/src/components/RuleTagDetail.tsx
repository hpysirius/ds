'use client';

/**
 * 规则标签的展示组件（「规则标签管理」页与商品库点标签名时共用）。
 *
 * 数据来自后端 `/rules`、`/rules/:id`、`/rules/by-tag/:tag`。
 * 注意 `source`：plugin = 插件同步上来的规则；product = 只在商品数据里出现、
 * 规则表里没有的标签（老数据 / 规则已被删），这种没有条件信息。
 */

import { Descriptions, Empty, Tag, Tooltip } from 'antd';

export interface RuleCondition {
  label: string;
  value: string;
}

export interface RuleLike {
  id?: number | null;
  source?: 'plugin' | 'product' | string;
  name?: string | null;
  tag: string;
  color?: string | null;
  priority?: number | null;
  enabled?: boolean | null;
  condText?: string | null;
  conditions?: RuleCondition[];
  productCount?: number | null;
  updatedAt?: string | null;
}

/** 标签胶囊（颜色来自插件规则，缺省用 antd 默认蓝） */
export function RuleTagChip({ tag, color, size }: { tag: string; color?: string | null; size?: 'small' | 'default' }) {
  const c = color && /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#1677ff';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: size === 'small' ? '0 7px' : '1px 10px',
        borderRadius: 6,
        background: c,
        color: '#fff',
        fontSize: size === 'small' ? 11 : 12,
        fontWeight: 500,
        lineHeight: size === 'small' ? '18px' : '20px',
        whiteSpace: 'nowrap',
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        verticalAlign: 'middle',
      }}
    >
      {tag}
    </span>
  );
}

const fmtTime = (v?: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '—');

/** 单条规则详情（不含外层容器/标题） */
export function RuleTagDetail({ rule }: { rule: RuleLike }) {
  const isPlugin = rule.source !== 'product';
  const conditions = rule.conditions || [];

  return (
    <div>
      <Descriptions size="small" column={2} bordered style={{ marginBottom: 14 }}>
        <Descriptions.Item label="标签名称">
          <RuleTagChip tag={rule.tag} color={rule.color} />
        </Descriptions.Item>
        <Descriptions.Item label="规则名称">{rule.name || <span style={{ color: '#bbb' }}>未命名</span>}</Descriptions.Item>
        <Descriptions.Item label="优先级">
          {rule.priority == null ? <span style={{ color: '#bbb' }}>—</span> : rule.priority}
          <span style={{ color: '#999', fontSize: 12, marginLeft: 6 }}>数字小的先匹配</span>
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          {rule.enabled == null ? (
            <span style={{ color: '#bbb' }}>—</span>
          ) : rule.enabled ? (
            <Tag color="green">启用</Tag>
          ) : (
            <Tag>已停用</Tag>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="命中商品">
          <b>{rule.productCount ?? 0}</b> 个
        </Descriptions.Item>
        <Descriptions.Item label="同步时间">{fmtTime(rule.updatedAt)}</Descriptions.Item>
      </Descriptions>

      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>命中条件</div>
      {!isPlugin ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>
              这个标签只出现在商品数据里，规则表里没有对应规则（可能是旧数据，或规则已被删除）。
              <br />
              在插件的「采集规则」里保存一次规则，就会同步到系统里来。
            </span>
          }
        />
      ) : !conditions.length ? (
        <div style={{ color: '#8c8c8c', fontSize: 13 }}>无条件（命中全部商品）</div>
      ) : (
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
          {conditions.map((c, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                padding: '7px 12px',
                fontSize: 13,
                background: i % 2 ? '#fafafa' : '#fff',
              }}
            >
              <span style={{ width: 130, color: '#8c8c8c', flex: '0 0 130px' }}>{c.label}</span>
              <span style={{ fontWeight: 500 }}>{c.value}</span>
            </div>
          ))}
        </div>
      )}

      {isPlugin && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#8c8c8c', lineHeight: 1.8 }}>
          条件来自插件的「采集规则」，采集时逐条匹配；字段读不到的商品判为不命中。
          后台这里只做展示，改规则请到插件弹窗的「🏷 采集规则」。
        </div>
      )}
    </div>
  );
}

/** 表格里用的条件摘要（超长省略，悬浮看全文） */
export function CondSummary({ text }: { text?: string | null }) {
  if (!text) return <span style={{ color: '#bbb' }}>—</span>;
  const short = text.length > 46 ? text.slice(0, 46) + '…' : text;
  return (
    <Tooltip title={text}>
      <span style={{ fontSize: 12 }}>{short}</span>
    </Tooltip>
  );
}
