'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Col, Empty, Form, Input, InputNumber, Row, Select, Space, Table, Tag, message } from 'antd';
import { DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { http } from '@/lib/api';

export default function ProductsPage() {
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [categories, setCategories] = useState<{ label: string; value: string }[]>([]);
  const [form] = Form.useForm();

  const load = async (p = page, s = pageSize) => {
    setLoading(true);
    try {
      const values = form.getFieldsValue();
      const params: any = { page: p, pageSize: s, ...values };
      Object.keys(params).forEach((k) => {
        if (params[k] === undefined || params[k] === null || params[k] === '') delete params[k];
      });
      const { data } = await http.get('/products', { params });
      setList(data.list);
      setTotal(data.total);
      setPage(p);
      setPageSize(s);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const { data } = await http.get('/products/categories');
      setCategories(data.map((c: any) => ({ label: `${c.name}（${c.count}）`, value: c.name })));
    } catch (e) {
      /* ignore */
    }
  };

  useEffect(() => {
    load(1, 20);
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportCsv = () => {
    const head = ['SKU', '标题', '类目', '品牌', '月销', '上架天', '加购%', '退货%', '评论', '广告%', '发货', '链接'];
    const q = (v: any) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [head.join(',')].concat(
      list.map((p) =>
        [p.sku, p.title, p.category3Name, p.brand, p.soldCount, p.createDays, p.convToCartPdp, p.cancelRate, p.reviewsCount, p.drr, p.salesSchema, p.productUrl]
          .map(q)
          .join(','),
      ),
    );
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'products_page' + page + '.csv';
    a.click();
  };

  return (
    <div>
      <h1 className="page-title">商品库</h1>
      <p className="page-sub">所有采集过的商品，可按月销、加购率、退货率、上架天数等多条件查询</p>

      <Card size="small" style={{ marginBottom: 14 }}>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col xs={12} md={5}>
              <Form.Item name="keyword" label="关键字">
                <Input placeholder="标题或 SKU" allowClear />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="category3Name" label="类目">
                <Select options={categories} showSearch allowClear placeholder="全部类目" />
              </Form.Item>
            </Col>
            <Col xs={8} md={2}>
              <Form.Item name="minSold" label="月销≥">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col xs={8} md={2}>
              <Form.Item name="maxSold" label="月销≤">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col xs={8} md={2}>
              <Form.Item name="minCart" label="加购≥%">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col xs={8} md={2}>
              <Form.Item name="maxCancel" label="退货≤%">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col xs={8} md={2}>
              <Form.Item name="maxDays" label="上架≤天">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col xs={8} md={2}>
              <Form.Item name="salesSchema" label="发货">
                <Select allowClear placeholder="全部" options={[{ label: 'FBS', value: 'FBS' }, { label: 'FBO', value: 'FBO' }, { label: 'rFBS', value: 'rFBS' }]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={3}>
              <Form.Item label=" ">
                <Space>
                  <Button type="primary" icon={<SearchOutlined />} onClick={() => load(1)}>
                    查询
                  </Button>
                  <Button icon={<ReloadOutlined />} onClick={() => { form.resetFields(); load(1); }}>
                    重置
                  </Button>
                </Space>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card
        title={`共 ${total} 条`}
        size="small"
        extra={
          <Button size="small" icon={<DownloadOutlined />} onClick={exportCsv} disabled={!list.length}>
            导出当前页
          </Button>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={list}
          locale={{ emptyText: <Empty description="还没有商品，先去「数据采集」跑一轮" /> }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            onChange: (p, s) => load(p, s),
          }}
          columns={[
            {
              title: '商品',
              dataIndex: 'title',
              ellipsis: true,
              render: (t, r: any) => (
                <div>
                  <a href={r.productUrl} target="_blank" rel="noreferrer">
                    {t || '(无标题)'}
                  </a>
                  <div style={{ fontSize: 11, color: '#8c8c8c' }} className="mono">
                    {r.sku}
                  </div>
                </div>
              ),
            },
            { title: '类目', dataIndex: 'category3Name', width: 130, ellipsis: true },
            { title: '品牌', dataIndex: 'brand', width: 100 },
            { title: '月销', dataIndex: 'soldCount', width: 72, align: 'right', sorter: true },
            {
              title: '加购率',
              dataIndex: 'convToCartPdp',
              width: 92,
              align: 'right',
              render: (v) => (v === null ? '—' : <Tag color={Number(v) >= 10 ? 'green' : 'orange'}>{v}%</Tag>),
            },
            {
              title: '退货率',
              dataIndex: 'cancelRate',
              width: 88,
              align: 'right',
              render: (v) => (v === null ? '—' : <span style={{ color: Number(v) > 20 ? '#ff4d4f' : undefined }}>{v}%</span>),
            },
            { title: '评论', dataIndex: 'reviewsCount', width: 66, align: 'right' },
            {
              title: '广告占比',
              dataIndex: 'drr',
              width: 92,
              align: 'right',
              render: (v) => (Number(v) === 0 ? <Tag color="green">零广告</Tag> : v + '%'),
            },
            { title: '上架天', dataIndex: 'createDays', width: 80, align: 'right' },
            { title: '发货', dataIndex: 'salesSchema', width: 70, render: (v) => (v ? <Tag>{v}</Tag> : '—') },
            {
              title: '首次采集',
              dataIndex: 'firstSeenAt',
              width: 160,
              render: (v) => new Date(v).toLocaleString('zh-CN'),
            },
          ]}
        />
      </Card>
    </div>
  );
}
