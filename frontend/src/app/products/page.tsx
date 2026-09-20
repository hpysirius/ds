'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Col, Empty, Form, Input, InputNumber, Row, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import { CalculatorOutlined, DownloadOutlined, PictureOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { API_BASE, http } from '@/lib/api';

/** 标题最多显示多少字（超出省略号，鼠标悬浮看全文） */
const TITLE_MAX = 26;

/** 图片走同源代理：Ozon 图片直链有防盗链，直接 img src 会 403 */
const proxyImage = (u?: string | null) =>
  u ? `${API_BASE}/pricing/sourcing/image-proxy?url=${encodeURIComponent(u)}` : '';

export default function ProductsPage() {
  const router = useRouter();
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [categories, setCategories] = useState<{ label: string; value: string }[]>([]);
  const [form] = Form.useForm();

  const [filling, setFilling] = useState(false);

  /** 补商品主图：先让后端从已有数据里捡，再用调试浏览器抓缺的（每张约 10 秒，分批发） */
  const fillImages = async () => {
    setFilling(true);
    let fromRaw = 0;
    let grabbed = 0;
    let lastDetail: any[] = [];
    try {
      for (let i = 0; i < 8; i++) {
        const { data } = await http.post('/pricing/products/fill-images', { limit: 5 });
        fromRaw += data?.fromRaw || 0;
        lastDetail = data?.failedDetail || [];
        grabbed += (data?.filled || []).length;
        message.loading(`补图中… 浏览器已抓 ${grabbed} 张，还缺 ${data?.remaining ?? '?'} 个`, 0.8);
        await load(1);
        const got = (data?.filled || []).length;
        if (data?.remaining === 0) break;
        if (!got && i > 0) break; // 连续抓不到就别硬循环
      }
      const detail = (lastDetail || []).map((x: any) => `${x.sku}：${x.reason}`).join('；');
      if (grabbed || fromRaw) {
        message.success(`补图完成：从已有数据补回 ${fromRaw} 个，浏览器新抓 ${grabbed} 张${detail ? '｜失败：' + detail : ''}`, 6);
      } else {
        message.warning(`一张都没抓到。${detail ? '原因：' + detail : '请确认调试 Chrome 能正常打开 Ozon 页面（可能被反爬校验挡住）'}`, 8);
      }
      await load(1);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setFilling(false);
    }
  };

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
          <Space>
            <Button size="small" icon={<PictureOutlined />} loading={filling} onClick={fillImages}>
              补商品主图
            </Button>
            <Button size="small" icon={<DownloadOutlined />} onClick={exportCsv} disabled={!list.length}>
              导出当前页
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={list}
          scroll={{ x: 1700 }}
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
              width: 320,
              render: (t: any, r: any) => {
                const title = String(t || '(无标题)');
                const short = title.length > TITLE_MAX ? title.slice(0, TITLE_MAX) + '…' : title;
                return (
                  <Space size={8} align="start">
                    {r.imageUrl ? (
                      <a href={r.productUrl} target="_blank" rel="noreferrer">
                        <img
                          src={proxyImage(r.imageUrl)}
                          alt=""
                          loading="lazy"
                          style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, background: '#f5f5f5' }}
                        />
                      </a>
                    ) : (
                      <Tooltip title="这个商品还没抓到主图（重新采集一次即可带上，或让系统抓一次）">
                        <div
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 4,
                            background: '#f5f5f5',
                            color: '#bbb',
                            fontSize: 10,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          无图
                        </div>
                      </Tooltip>
                    )}
                    <div style={{ maxWidth: 250 }}>
                      <Tooltip title={title}>
                        <a href={r.productUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                          {short}
                        </a>
                      </Tooltip>
                      <div style={{ fontSize: 11, color: '#8c8c8c' }} className="mono">
                        {r.sku}
                      </div>
                    </div>
                  </Space>
                );
              },
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
            {
              title: '操作',
              key: 'op',
              width: 150,
              fixed: 'right',
              render: (_: any, r: any) => (
                <Space size={4}>
                  <Button type="link" size="small" onClick={() => router.push(`/pricing?sku=${r.sku}`)}>
                    核价
                  </Button>
                  <Button type="link" size="small" onClick={() => router.push(`/pricing?sku=${r.sku}&auto=1`)}>
                    自动核价
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
