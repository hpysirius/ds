'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Col, Empty, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Tooltip, message } from 'antd';
import { CalculatorOutlined, DeleteOutlined, DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { http, proxyImageUrl } from '@/lib/api';
import { useStore } from '@/lib/store-context';

/** 标题最多显示多少字（超出省略号，鼠标悬浮看全文） */
const TITLE_MAX = 26;

export default function ProductsPage() {
  const router = useRouter();
  const { storeParam } = useStore();
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [categories, setCategories] = useState<{ label: string; value: string }[]>([]);
  const [form] = Form.useForm();

  /** 勾选要批量删除的行（存的是商品 id） */
  const [selected, setSelected] = useState<number[]>([]);
  const [deleting, setDeleting] = useState(false);

  /** 卢布→人民币 汇率（1₽=¥），默认 0.0862，从定价设置读取当前值 */
  const [rate, setRate] = useState(0.0862);

  /** 规则标签筛选项（从当前已加载列表里的 tags 汇总去重，供筛选下拉用） */
  // 表头排序（后端支持 sortBy + order）。不记下来的话，翻页时排序会丢
  const [sortBy, setSortBy] = useState<string | undefined>();
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>();
  const [tagOptions, setTagOptions] = useState<{ label: string; value: string }[]>([]);

  /** 删除失败时给出人话提示（未登录要单独说，否则只看到一句 Unauthorized） */
  const delError = (e: any, what: string) => {
    const status = e?.response?.status;
    message.error(status === 401 ? `${what}失败：请先登录（右上角登录）再操作` : `${what}失败：${e.message}`);
  };

  /** 删除单个商品 */
  const deleteOne = async (r: any) => {
    try {
      await http.delete(`/products/${r.id}`);
      message.success(`已删除 ${r.sku}`);
      setSelected((s) => s.filter((x) => x !== r.id));
      await load();
    } catch (e: any) {
      delError(e, '删除');
    }
  };

  /** 批量删除勾选的商品 */
  const deleteSelected = async () => {
    if (!selected.length) return;
    Modal.confirm({
      title: `删除所选 ${selected.length} 个商品？`,
      content: '删除后不可恢复（商品记录及其指标历史会一起清掉）。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setDeleting(true);
        try {
          const { data } = await http.post('/products/bulk-delete', { ids: selected, ...storeParam });
          message.success(`已删除 ${data.deleted} 个商品`);
          setSelected([]);
          await load(1);
        } catch (e: any) {
          delError(e, '批量删除');
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  /** 按当前筛选条件删除（"清空当前筛选结果"） */
  const deleteByFilter = async () => {
    const values = form.getFieldsValue();
    const filter: any = { ...values };
    Object.keys(filter).forEach((k) => {
      if (filter[k] === undefined || filter[k] === null || filter[k] === '') delete filter[k];
    });
    if (!Object.keys(filter).length) {
      message.warning('请至少设置一个筛选条件，避免误删整个商品库');
      return;
    }
    Modal.confirm({
      title: `删除当前筛选结果的全部 ${total} 个商品？`,
      content: `筛选条件：${JSON.stringify(filter)}（删除后不可恢复）`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setDeleting(true);
        try {
          const { data } = await http.post('/products/bulk-delete', { filter, ...storeParam });
          message.success(`已删除 ${data.deleted} 个商品`);
          setSelected([]);
          await load(1);
        } catch (e: any) {
          delError(e, '删除');
        } finally {
          setDeleting(false);
        }
      },
    });
  };

  const load = async (
    p = page,
    s = pageSize,
    sorting?: { sortBy?: string; sortOrder?: 'asc' | 'desc' },
  ) => {
    const sb = sorting ? sorting.sortBy : sortBy;
    const so = sorting ? sorting.sortOrder : sortOrder;
    setSortBy(sb);
    setSortOrder(so);
    setLoading(true);
    try {
      const values = form.getFieldsValue();
      const params: any = { page: p, pageSize: s, ...values, ...storeParam };
      if (sb) {
        params.sortBy = sb;
        params.order = so || 'desc';
      }
      Object.keys(params).forEach((k) => {
        if (params[k] === undefined || params[k] === null || params[k] === '') delete params[k];
      });
      const { data } = await http.get('/products', { params });
      setList(data.list);
      setTotal(data.total);
      setTagOptions(
        Array.from(
          new Set(
            (data.list || [])
              .flatMap((p: any) => (p.tags || []).map((t: any) => t.name))
              .filter(Boolean),
          ),
        ).map((n: any) => ({ label: n, value: n })),
      );
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
      const { data } = await http.get('/products/categories', { params: storeParam });
      setCategories(data.map((c: any) => ({ label: `${c.name}（${c.count}）`, value: c.name })));
    } catch (e) {
      /* ignore */
    }
  };

  /** 读取定价设置里的卢布→人民币汇率，用于把商品价（₽）换算成人民币显示 */
  const loadRate = async () => {
    try {
      const { data } = await http.get('/pricing/settings');
      setRate(Number(data.exchangeRate) || 0.0862);
    } catch (e) {
      /* 读不到就用默认汇率，不影响列表 */
    }
  };

  useEffect(() => {
    load(1, 20);
    loadCategories();
    loadRate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeParam]);

  const exportCsv = () => {
    const head = ['SKU', '标题', '类目', '品牌', '月销', '上架天', '加购%', '退货%', '评论', '广告%', '发货', '价格(₽)', '人民币(¥)', '规则标签', '链接'];
    const q = (v: any) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [head.join(',')].concat(
      list.map((p) =>
        [
          p.sku,
          p.title,
          p.category3Name,
          p.brand,
          p.soldCount,
          p.createDays,
          p.convToCartPdp,
          p.cancelRate,
          p.reviewsCount,
          p.drr,
          p.salesSchema,
          p.price,
          rate > 0 ? (Number(p.price) * rate).toFixed(2) : '',
          (p.tags || []).map((t: any) => t.name).join('/'),
          p.productUrl,
        ]
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
            <Col xs={12} md={3}>
              <Form.Item name="tag" label="规则标签">
                <Select
                  allowClear
                  showSearch
                  placeholder="全部标签"
                  notFoundContent="当前列表无标签（重新采集后才有）"
                  options={tagOptions}
                />
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
          <Space wrap>
            <Button size="small" icon={<DownloadOutlined />} onClick={exportCsv} disabled={!list.length}>
              导出当前页
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={!selected.length}
              loading={deleting}
              onClick={deleteSelected}
            >
              删除所选{selected.length ? `(${selected.length})` : ''}
            </Button>
            <Button size="small" danger disabled={!total || deleting} onClick={deleteByFilter}>
              删除筛选结果({total})
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={list}
          scroll={{ x: 1800 }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: (keys) => setSelected(keys as number[]),
          }}
          locale={{ emptyText: <Empty description="还没有商品，先去「数据采集」跑一轮" /> }}
          pagination={{ current: page, pageSize, total, showSizeChanger: true }}
          /*
           * 分页和排序统一走 Table 的 onChange。
           * 原来只在 pagination.onChange 里翻页，却给价格/月销列写了 sorter: true
           * （sorter: true 表示「服务端排序」），没有任何地方处理它 ——
           * 结果点表头只有箭头在变，数据顺序永远不动。
           */
          onChange={(pag: any, _filters: any, sorter: any) => {
            const s = Array.isArray(sorter) ? sorter[0] : sorter;
            const order = s?.order;
            load(pag.current ?? 1, pag.pageSize ?? pageSize, {
              sortBy: order ? String(s.field) : undefined,
              sortOrder: order === 'ascend' ? 'asc' : order === 'descend' ? 'desc' : undefined,
            });
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
                          src={proxyImageUrl(r.imageUrl)}
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
            {
              title: '价格(₽/¥)',
              dataIndex: 'price',
              width: 110,
              align: 'right',
              sorter: true,
              render: (v: any) => {
                if (v === null || v === undefined) return '—';
                const cny = rate > 0 ? Number(v) * rate : 0;
                return (
                  <span className="mono">
                    {Number(v).toLocaleString('ru-RU')} ₽
                    <br />
                    <span style={{ color: '#8c8c8c' }}>¥{cny.toFixed(2)}</span>
                  </span>
                );
              },
            },
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
              title: '规则标签',
              dataIndex: 'tags',
              width: 150,
              render: (tags: any) =>
                tags && tags.length
                  ? tags.map((t: any, i: number) => (
                      <Tag key={i} color={t.color || 'blue'} style={{ marginBottom: 2 }}>
                        {t.name}
                      </Tag>
                    ))
                  : <span style={{ color: '#bbb' }}>—</span>,
            },
            {
              title: '首次采集',
              dataIndex: 'firstSeenAt',
              width: 160,
              render: (v) => new Date(v).toLocaleString('zh-CN'),
            },
            {
              title: '操作',
              key: 'op',
              width: 120,
              fixed: 'right',
              render: (_: any, r: any) => (
                <Space size={4} wrap>
                  <Button type="link" size="small" onClick={() => window.open(`/pricing?sku=${r.sku}`, '_blank')}>
                    核价
                  </Button>
                  <Popconfirm
                    title={`删除「${r.sku}」？`}
                    description="删除后不可恢复"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    onConfirm={() => deleteOne(r)}
                  >
                    <Button type="link" size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
