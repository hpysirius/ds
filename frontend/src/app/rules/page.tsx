'use client';

/**
 * 规则标签管理（/rules）
 *
 * 插件弹窗里的「🏷 采集规则」会同步到后端（POST /rules/sync），这里只读展示：
 * 每个规则标签一条数据，点开看具体条件；同时列出商品数据里已有、但规则表里没有的标签。
 * 本页对所有登录用户可见（不纳入权限体系，见 AppShell 里无条件 push 的菜单项）。
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Drawer, Empty, Input, Space, Table, Tag, Tooltip, message } from 'antd';
import { ReloadOutlined, TagsOutlined } from '@ant-design/icons';
import { http } from '@/lib/api';
import { useStore } from '@/lib/store-context';
import { CondSummary, RuleTagChip, RuleTagDetail, type RuleLike } from '@/components/RuleTagDetail';

export default function RulesPage() {
  const { storeParam } = useStore();
  const [list, setList] = useState<RuleLike[]>([]);
  const [taggedProducts, setTaggedProducts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [kw, setKw] = useState('');
  const [detail, setDetail] = useState<RuleLike | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await http.get('/rules', { params: { ...storeParam } });
      setList(data.list || []);
      setTaggedProducts(data.taggedProducts || 0);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [storeParam]);

  useEffect(() => {
    load();
  }, [load]);

  /** 打开详情：plugin 规则行直接用手上的数据；商品兜底行没有 id，也用列表数据 */
  const open = (r: RuleLike) => setDetail(r);

  const filtered = kw.trim()
    ? list.filter((r) => `${r.tag} ${r.name || ''} ${r.condText || ''}`.toLowerCase().includes(kw.trim().toLowerCase()))
    : list;
  const pluginCount = list.filter((r) => r.source === 'plugin').length;

  return (
    <div>
      <h1 className="page-title">规则标签管理</h1>
      <p className="page-sub">
        插件「采集规则」里配置的标签规则，会自动同步到这里；点开一条可查看它的全部命中条件与命中商品数
      </p>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="规则由浏览器插件维护，这里是只读视图"
        description={
          <span style={{ fontSize: 12 }}>
            在插件弹窗点「🏷 采集规则」新增 / 修改 / 启停后会自动同步；也可以打开一次插件弹窗手动触发同步。
            采集时命中规则的商品会打上对应标签，随数据一起入库，在「商品库 → 规则标签」里可以看到，点标签名同样能看详情。
          </span>
        }
      />

      <Card
        size="small"
        title={
          <Space size={16}>
            <span>
              共 <b>{list.length}</b> 个标签
            </span>
            <span style={{ color: '#8c8c8c', fontSize: 12, fontWeight: 400 }}>
              其中插件同步规则 {pluginCount} 条 · 已打标签商品 {taggedProducts} 个
            </span>
          </Space>
        }
        extra={
          <Space>
            <Input.Search
              allowClear
              size="small"
              placeholder="搜标签 / 规则名 / 条件"
              style={{ width: 220 }}
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
            <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table
          rowKey={(r) => (r.id != null ? `r${r.id}` : `t_${r.tag}`)}
          size="small"
          loading={loading}
          dataSource={filtered}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{
            emptyText: (
              <Empty
                description={
                  <span style={{ color: '#8c8c8c' }}>
                    还没有规则标签。先在浏览器插件里配置「采集规则」并采集一次，规则会自动同步过来。
                  </span>
                }
              />
            ),
          }}
          columns={[
            {
              title: '标签',
              dataIndex: 'tag',
              width: 160,
              render: (tag: string, r: RuleLike) => <RuleTagChip tag={tag} color={r.color} />,
            },
            {
              title: '规则名称',
              dataIndex: 'name',
              width: 160,
              ellipsis: true,
              render: (name: string | null, r: RuleLike) =>
                name || (
                  <Tooltip title="只在商品数据里出现过，规则表里没有对应规则（旧数据或规则已删除）">
                    <span style={{ color: '#bbb' }}>—（仅商品数据）</span>
                  </Tooltip>
                ),
            },
            {
              title: '优先级',
              dataIndex: 'priority',
              width: 80,
              align: 'center',
              render: (v: number | null) => (v == null ? <span style={{ color: '#bbb' }}>—</span> : v),
            },
            {
              title: '状态',
              dataIndex: 'enabled',
              width: 80,
              render: (v: boolean | null) =>
                v == null ? <span style={{ color: '#bbb' }}>—</span> : v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
            },
            {
              title: '命中条件',
              dataIndex: 'condText',
              render: (t: string | null) => <CondSummary text={t} />,
            },
            {
              title: '命中商品',
              dataIndex: 'productCount',
              width: 90,
              align: 'right',
              render: (v: number | null) => <b>{v ?? 0}</b>,
            },
            {
              title: '同步时间',
              dataIndex: 'updatedAt',
              width: 160,
              render: (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : <span style={{ color: '#bbb' }}>—</span>),
            },
            {
              title: '操作',
              key: 'op',
              width: 80,
              fixed: 'right',
              render: (_: any, r: RuleLike) => (
                <Button type="link" size="small" onClick={() => open(r)}>
                  查看
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        width={620}
        open={!!detail}
        onClose={() => setDetail(null)}
        title={
          detail ? (
            <Space>
              <TagsOutlined style={{ color: '#1677ff' }} />
              标签详情
              <RuleTagChip tag={detail.tag} color={detail.color} size="small" />
            </Space>
          ) : (
            ''
          )
        }
      >
        {detail && <RuleTagDetail rule={detail} />}
      </Drawer>
    </div>
  );
}
