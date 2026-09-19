'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, Col, Empty, Progress, Row, Space, Statistic, Table, Tag, message } from 'antd';
import { http, GRADE_TEXT } from '@/lib/api';

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setData((await http.get('/stats/overview')).data);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const counts = data?.lastRun?.counts || {};

  return (
    <div>
      <h1 className="page-title">数据概览</h1>
      <p className="page-sub">采集概况、销量分布与最近一轮筛选结果</p>

      <Row gutter={[14, 14]}>
        <Col xs={12} md={6}>
          <Card className="stat-card" loading={loading}>
            <div className="stat-label">商品库总量</div>
            <div className="stat-value">{data?.productTotal ?? 0}</div>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>
              24 小时内新增 {data?.newToday ?? 0}
            </div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="stat-card" loading={loading}>
            <div className="stat-label">无评论占比</div>
            <div className="stat-value">{data?.noReviewRatio ?? 0}%</div>
            <Progress percent={data?.noReviewRatio ?? 0} size="small" showInfo={false} strokeColor="#52c41a" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="stat-card" loading={loading}>
            <div className="stat-label">FBS 占比</div>
            <div className="stat-value">{data?.fbsRatio ?? 0}%</div>
            <Progress percent={data?.fbsRatio ?? 0} size="small" showInfo={false} strokeColor="#1677ff" />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card className="stat-card" loading={loading}>
            <div className="stat-label">采集任务</div>
            <div className="stat-value">
              {data?.taskTotal ?? 0}
              {(data?.runningTasks ?? 0) > 0 && (
                <Tag color="processing" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                  {data.runningTasks} 个进行中
                </Tag>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={14}>
          <Card title="月销量分布" loading={loading} size="small">
            {data?.salesDistribution?.length ? (
              <div>
                {data.salesDistribution.map((s: any) => {
                  const max = Math.max(...data.salesDistribution.map((x: any) => x.count), 1);
                  return (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                      <div style={{ width: 84, fontSize: 13, color: '#595959' }}>{s.label}</div>
                      <Progress
                        percent={Math.round((s.count / max) * 100)}
                        showInfo={false}
                        strokeColor={s.label.includes('5-10') ? '#52c41a' : '#1677ff'}
                        style={{ flex: 1 }}
                      />
                      <div style={{ width: 46, textAlign: 'right', fontSize: 13 }}>{s.count}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty description="还没有数据，先去采集" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            title="最近一轮筛选"
            size="small"
            loading={loading}
            extra={
              data?.lastRun ? (
                <Link href="/screening">
                  <a style={{ fontSize: 13 }}>查看明细</a>
                </Link>
              ) : null
            }
          >
            {data?.lastRun ? (
              <>
                <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 12 }}>
                  {data.lastRun.name} · 共 {data.lastRun.total} 条
                </div>
                <Space size="middle" wrap>
                  <Statistic title="优先跟进" value={counts.follow ?? 0} valueStyle={{ color: '#52c41a', fontSize: 20 }} />
                  <Statistic title="可跟进" value={counts.watch ?? 0} valueStyle={{ color: '#1677ff', fontSize: 20 }} />
                  <Statistic title="观察" value={counts.observe ?? 0} valueStyle={{ color: '#fa8c16', fontSize: 20 }} />
                  <Statistic title="淘汰" value={counts.out ?? 0} valueStyle={{ color: '#ff4d4f', fontSize: 20 }} />
                </Space>
              </>
            ) : (
              <Empty description="还没执行过筛选" />
            )}
          </Card>
        </Col>
      </Row>

      <Card title="高潜商品（无评论 · FBS · 按加购率排序）" size="small" style={{ marginTop: 14 }} loading={loading}>
        <Table
          rowKey="sku"
          size="small"
          pagination={false}
          dataSource={data?.topProducts || []}
          locale={{ emptyText: <Empty description="暂无数据" /> }}
          columns={[
            {
              title: '商品',
              dataIndex: 'title',
              ellipsis: true,
              render: (t, r: any) => (
                <a href={r.productUrl} target="_blank" rel="noreferrer">
                  {t || r.sku}
                </a>
              ),
            },
            { title: '类目', dataIndex: 'category3Name', width: 120, ellipsis: true },
            { title: '月销', dataIndex: 'soldCount', width: 70, align: 'right' },
            {
              title: '加购率',
              dataIndex: 'convToCartPdp',
              width: 90,
              align: 'right',
              render: (v) => (v === null ? '—' : <Tag color="green">{v}%</Tag>),
            },
            { title: '退货率', dataIndex: 'cancelRate', width: 90, align: 'right', render: (v) => (v === null ? '—' : v + '%') },
            { title: '上架天', dataIndex: 'createDays', width: 80, align: 'right' },
            { title: '广告占比', dataIndex: 'drr', width: 90, align: 'right', render: (v) => (Number(v) === 0 ? <Tag>零广告</Tag> : v + '%') },
          ]}
        />
      </Card>
    </div>
  );
}
