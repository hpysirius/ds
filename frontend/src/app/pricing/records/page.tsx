'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { DownloadOutlined, ImportOutlined, ReloadOutlined } from '@ant-design/icons';
import { API_BASE, http } from '@/lib/api';
import { COUNTRIES, VENDORS, pct, money } from '../constants';
import { useStore } from '@/lib/store-context';

export default function PricingRecords() {
  const { storeParam } = useStore();
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPath, setImportPath] = useState('/Users/huanghui/Downloads/9月定价表.xlsx');
  const [importSheet, setImportSheet] = useState('定价表');
  const [importReplace, setImportReplace] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  /** 上架状态筛选：all / yes / no */
  const [listedFilter, setListedFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [higherFilter, setHigherFilter] = useState<'all' | 'yes' | 'no'>('all');
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [listing, setListing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  // 点击"产品"查看中实跨境ERP插件数据的弹窗
  const [cardRec, setCardRec] = useState<any>(null);
  const [editForm] = Form.useForm();

  // 导出 CSV 时带上当前筛选条件（与列表一致）
  const exportHref = (() => {
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (listedFilter !== 'all') params.set('listed', listedFilter === 'yes' ? 'true' : 'false');
    if (higherFilter !== 'all') params.set('higherThanRetail', higherFilter === 'yes' ? 'true' : 'false');
    if (storeParam.storeId != null) params.set('storeId', String(storeParam.storeId));
    const qs = params.toString();
    return `${API_BASE}/pricing/records/export${qs ? `?${qs}` : ''}`;
  })();

  /** 从 Excel《定价表》导入（按「工作表!行号」幂等，可勾选替换重导） */
  const doImport = async () => {
    if (!importPath.trim()) {
      message.warning('请填 xlsx 的绝对路径');
      return;
    }
    setImporting(true);
    try {
      const { data } = await http.post('/pricing/records/import-excel', {
        path: importPath.trim(),
        sheet: importSheet.trim() || '定价表',
        replace: importReplace,
      });
      setImportResult(data);
      message.success(`导入完成：新增 ${data.created} 条，跳过 ${data.skipped} 条${data.removed ? `，先清掉 ${data.removed} 条旧导入` : ''}`);
      await load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setImporting(false);
    }
  };

  const load = useCallback(async () => {
    const { data } = await http.get('/pricing/records', {
      params: {
        page,
        pageSize: 20,
        keyword: keyword || undefined,
        listed: listedFilter === 'all' ? undefined : listedFilter === 'yes',
        higherThanRetail: higherFilter === 'all' ? undefined : higherFilter === 'yes',
        ...storeParam,
      },
    });
    setList(data.list);
    setTotal(data.total);
  }, [page, keyword, listedFilter, higherFilter, storeParam]);

  useEffect(() => {
    load().catch((e) => message.error(e.message));
  }, [load]);

  /** 上架 / 下架（单条传 [id]，批量传选中项） */
  const doListing = async (ids: number[], listed: boolean, tip?: string) => {
    if (!ids.length) {
      message.warning('请先选择记录');
      return;
    }
    setListing(true);
    try {
      const { data } = await http.post('/pricing/records/listing', { ids, listed });
      message.success(`${listed ? '已上架' : '已下架'} ${data?.count ?? ids.length} 条${tip || ''}`);
      setSelectedKeys([]);
      await load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setListing(false);
    }
  };

  /** 打开「修改」弹窗 */
  const openEdit = (r: any) => {
    setEditing(r);
    editForm.setFieldsValue({
      name: r.name || '',
      sku: r.sku || '',
      purchaseCost: r.purchaseCost ?? 0,
      weightKg: r.weightKg ?? 0,
      lengthCm: r.lengthCm ?? 0,
      widthCm: r.widthCm ?? 0,
      heightCm: r.heightCm ?? 0,
      sellPrice: r.sellPrice ?? 0,
      exchangeRate: r.exchangeRate ?? 0.0862,
      shippingFee: r.shippingFee ?? 0,
      billWeightKg: r.billWeightKg ?? 0,
      labelFee: r.labelFee ?? 2,
      commissionRate: Number(((r.commissionRate ?? 0) * 100).toFixed(2)),
      agentRate: Number(((r.agentRate ?? 0) * 100).toFixed(2)),
      withdrawRate: Number(((r.withdrawRate ?? 0) * 100).toFixed(2)),
      markupRate: Number(((r.markupRate ?? 0.1) * 100).toFixed(2)),
      channelName: r.channelName || '',
      shipMode: r.shipMode || '',
      country: r.country || 'RU',
      vendor: r.vendor || 'GUOO',
      supplyUrl: r.supplyUrl || '',
      retailUrl: r.retailUrl || '',
      remark: r.remark || '',
      listed: !!r.listed,
    });
    setEditOpen(true);
  };

  const submitEdit = async () => {
    const v = await editForm.validateFields();
    setSaving(true);
    try {
      const rate = Number(v.exchangeRate) || 0;
      await http.patch(`/pricing/records/${editing.id}`, {
        ...v,
        // 百分数 → 小数
        commissionRate: Number(v.commissionRate || 0) / 100,
        agentRate: Number(v.agentRate || 0) / 100,
        withdrawRate: Number(v.withdrawRate || 0) / 100,
        markupRate: Number(v.markupRate || 0) / 100,
        // 卢布定价跟人民币定价 + 汇率联动
        sellPriceRub: rate > 0 ? Number((Number(v.sellPrice || 0) / rate).toFixed(2)) : 0,
      });
      message.success('已保存，利润已按新参数重算');
      setEditOpen(false);
      await load();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: '标记',
      dataIndex: 'mark',
      key: 'mark',
      width: 92,
      render: (v: any, r: any) =>
        v ? (
          <span>
            <Tag color={r.source === 'excel' ? 'blue' : 'green'} style={{ marginRight: 4 }}>
              {r.source === 'excel' ? '表' : '台'}
            </Tag>
            {v}
          </span>
        ) : r.source === 'excel' ? (
          <Tag color="blue">表</Tag>
        ) : (
          '—'
        ),
    },
    {
      title: '产品',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (v: any, r: any) => (
        <Space size={6}>
          {r.imageUrl ? <img src={r.imageUrl} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 3 }} /> : null}
          <div>
            <div>
              {v ? (
                <a onClick={() => setCardRec(r)} title="点击查看中实跨境ERP插件数据">
                  {v}
                </a>
              ) : (
                <span style={{ color: '#bfbfbf' }}>—</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#999' }}>{r.sku || ''}</div>
          </div>
        </Space>
      ),
    },
    { title: '渠道', dataIndex: 'channelName', key: 'channelName', width: 200, render: (v: any, r: any) => v ? `${v}${r.shipMode ? ' · ' + r.shipMode : ''}` : '—' },
    {
      title: '定价(¥)',
      dataIndex: 'sellPrice',
      key: 'sellPrice',
      width: 100,
      render: (v: any, r: any) => {
        // 定价高于跟卖价格 → 标红（跟卖价缺失则不变色）
        const red = r.retailPrice > 0 && (r.sellPriceRub > 0 ? r.sellPriceRub > r.retailPrice : v > r.retailPriceCny);
        return <span style={red ? { color: '#cf1322', fontWeight: 600 } : undefined}>{`${money(v)} / ${money(r.sellPriceRub, 0)}₽`}</span>;
      },
    },
    {
      title: '跟卖价(₽)',
      dataIndex: 'retailPrice',
      key: 'retailPrice',
      width: 90,
      render: (v: any, r: any) =>
        v > 0 ? (
          <span>{`${r.retailPriceCny ? `${money(r.retailPriceCny)} / ` : ''}${money(v, 0)}₽`}</span>
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
        ),
    },
    {
      title: '月销量',
      dataIndex: 'monthlySales',
      key: 'monthlySales',
      width: 76,
      render: (v: any) => (v != null ? <span>{v}</span> : <span style={{ color: '#bfbfbf' }}>—</span>),
    },
    {
      title: '高于跟卖价',
      dataIndex: 'higherThanRetail',
      key: 'higherThanRetail',
      width: 96,
      render: (v: any) =>
        v === true ? (
          <Tag color="red">是</Tag>
        ) : v === false ? (
          <Tag>否</Tag>
        ) : (
          <span style={{ color: '#bfbfbf' }}>—</span>
        ),
    },
    { title: '运费(¥)', dataIndex: 'shippingFee', key: 'shippingFee', width: 80, render: (v: any) => money(v) },
    { title: '采购(¥)', dataIndex: 'purchaseCost', key: 'purchaseCost', width: 80, render: (v: any) => money(v) },
    { title: '毛利润', dataIndex: 'grossProfit', key: 'grossProfit', width: 80, render: (v: any) => money(v) },
    {
      title: '净利润',
      dataIndex: 'netProfit',
      key: 'netProfit',
      width: 90,
      render: (v: any) => <span style={{ color: v >= 0 ? '#cf1322' : '#389e0d', fontWeight: 600 }}>{money(v)}</span>,
    },
    { title: '利润率', dataIndex: 'profitRate', key: 'profitRate', width: 80, render: (v: any) => pct(v) },
    { title: '运费利润比', dataIndex: 'freightProfitRatio', key: 'freightProfitRatio', width: 100, render: (v: any) => pct(v) },
    { title: '加35%', dataIndex: 'markup35', key: 'markup35', width: 80, render: (v: any) => money(v) },
    {
      title: '重量',
      dataIndex: 'weightText',
      key: 'weightText',
      width: 86,
      render: (v: any, r: any) => v || `${money(r.weightKg, 3)}kg`,
    },
    {
      title: '尺寸',
      key: 'size',
      width: 130,
      render: (_: any, r: any) =>
        r.sizeText || `${r.lengthCm || 0}×${r.widthCm || 0}×${r.heightCm || 0}cm`,
    },
    {
      title: '链接',
      key: 'links',
      width: 110,
      render: (_: any, r: any) => (
        <Space size={4}>
          {r.retailUrl ? (
            <Button type="link" size="small" href={r.retailUrl} target="_blank" rel="noreferrer">
              Ozon
            </Button>
          ) : null}
          {r.supplyUrl ? (
            <Button type="link" size="small" href={r.supplyUrl} target="_blank" rel="noreferrer">
              1688
            </Button>
          ) : null}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'listed',
      key: 'listed',
      width: 92,
      render: (v: any, r: any) =>
        v ? (
          <Tooltip title={r.listedAt ? `上架于 ${String(r.listedAt).slice(0, 19).replace('T', ' ')}` : '已上架'}>
            <Tag color="green">已上架</Tag>
          </Tooltip>
        ) : (
          <Tag>未上架</Tag>
        ),
    },
    {
      title: '操作',
      key: 'op',
      width: 150,
      fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => openEdit(r)}>
            修改
          </Button>
          <Popconfirm
            title={r.listed ? '把这条记录标记为下架？' : '把这条记录标记为已上架？'}
            onConfirm={() => doListing([r.id], !r.listed)}
          >
            <Button type="link" size="small" style={{ color: r.listed ? '#d46b08' : '#389e0d' }}>
              {r.listed ? '下架' : '上架'}
            </Button>
          </Popconfirm>
          <Popconfirm
            title="删除这条记录？"
            onConfirm={async () => {
              await http.delete(`/pricing/records/${r.id}`);
              message.success('已删除');
              load();
            }}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const importModal = (
    <Modal
      open={importOpen}
      onCancel={() => setImportOpen(false)}
      onOk={doImport}
      okText="开始导入"
      confirmLoading={importing}
      title="从 Excel《定价表》导入定价记录"
      width={680}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="导入规则"
        description={
          <div style={{ fontSize: 13 }}>
            读第 2 行表头、从第 3 行起逐行导入（A~T 列：序号/标记、加35%、定价、采购成本、国际运费、贴单费、
            平台佣金、代理佣金、提现费率、净利润、毛利润、利润率、运费利润比、物流方式、重量、尺寸、产品备注、
            跟卖链接、货源链接、跟卖链接URL）。<b>重复导入不会产生重复数据</b>（按「工作表!行号」判重）。
          </div>
        }
      />
      <Form layout="vertical">
        <Form.Item label="xlsx 文件路径（本机绝对路径）" required>
          <Input value={importPath} onChange={(e) => setImportPath(e.target.value)} placeholder="/Users/xxx/Downloads/9月定价表.xlsx" />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="工作表名">
              <Input value={importSheet} onChange={(e) => setImportSheet(e.target.value)} placeholder="定价表" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="替换重导">
              <Switch checked={importReplace} onChange={setImportReplace} />
              <span style={{ marginLeft: 8, fontSize: 12, color: '#999' }}>
                开启后会先清掉之前从 Excel 导入的记录（工作台手工存的保留）
              </span>
            </Form.Item>
          </Col>
        </Row>
      </Form>
      {importResult ? (
        <Alert
          type="success"
          showIcon
          message={`工作表「${importResult.sheet}」共 ${importResult.total} 行：新增 ${importResult.created}，跳过 ${importResult.skipped}`}
          description={
            <div style={{ fontSize: 12 }}>
              {(importResult.samples || []).map((x: any, i: number) => (
                <div key={i}>
                  第 {x.row} 行：SKU {x.sku || '—'} · 定价 {x.sellPrice ?? '—'} · 成本 {x.purchaseCost ?? '—'} ·
                  重量 {x.weightText || '—'} · 尺寸 {x.sizeText || '—'}
                </div>
              ))}
            </div>
          }
        />
      ) : null}
    </Modal>
  );

  const editModal = (
    <Modal
      open={editOpen}
      onCancel={() => setEditOpen(false)}
      onOk={submitEdit}
      okText="保存并重算"
      confirmLoading={saving}
      title={editing ? `修改定价记录 #${editing.id}` : '修改定价记录'}
      width={800}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="改完采购成本 / 运费 / 尺寸 / 费率后，毛利润、净利润、利润率会按当前口径重算；上架状态也可在这里改。"
      />
      <Form form={editForm} layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={14}>
            <Form.Item name="name" label="产品备注">
              <Input placeholder="产品名称 / 备注" />
            </Form.Item>
          </Col>
          <Col span={10}>
            <Form.Item name="sku" label="SKU">
              <Input placeholder="Ozon SKU" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={6}>
            <Form.Item name="purchaseCost" label="采购成本 ¥" rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={0} step={0.1} precision={2} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="weightKg" label="重量 kg">
              <InputNumber style={{ width: '100%' }} min={0} step={0.001} precision={4} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="lengthCm" label="长 cm">
              <InputNumber style={{ width: '100%' }} min={0} step={0.1} precision={2} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="widthCm" label="宽 cm">
              <InputNumber style={{ width: '100%' }} min={0} step={0.1} precision={2} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="heightCm" label="高 cm">
              <InputNumber style={{ width: '100%' }} min={0} step={0.1} precision={2} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={6}>
            <Form.Item name="sellPrice" label="定价 ¥" rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={0} step={1} precision={2} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="定价 ₽（自动）">
              <Form.Item noStyle shouldUpdate={(a: any, b: any) => a.sellPrice !== b.sellPrice || a.exchangeRate !== b.exchangeRate}>
                {() => {
                  const sp = Number(editForm.getFieldValue('sellPrice') || 0);
                  const rate = Number(editForm.getFieldValue('exchangeRate') || 0);
                  const rub = rate > 0 ? sp / rate : 0;
                  return <span style={{ lineHeight: '30px', fontWeight: 600 }}>{rub ? `${rub.toFixed(0)} ₽` : '—'}</span>;
                }}
              </Form.Item>
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="exchangeRate" label="汇率 1₽=?¥">
              <InputNumber style={{ width: '100%' }} min={0} step={0.0001} precision={6} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="labelFee" label="贴单费 ¥">
              <InputNumber style={{ width: '100%' }} min={0} step={0.5} precision={2} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={6}>
            <Form.Item name="shippingFee" label="国际运费 ¥">
              <InputNumber style={{ width: '100%' }} min={0} step={0.5} precision={2} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="billWeightKg" label="计费重量 kg">
              <InputNumber style={{ width: '100%' }} min={0} step={0.001} precision={4} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="commissionRate" label="平台佣金 %">
              <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.5} precision={2} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="agentRate" label="代理佣金 %">
              <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} precision={2} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="withdrawRate" label="提现费率 %">
              <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} precision={2} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={6}>
            <Form.Item name="markupRate" label="成本加价 %">
              <InputNumber style={{ width: '100%' }} min={0} max={300} step={1} precision={2} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="channelName" label="物流渠道">
              <Input placeholder="GUOO Economy Extra Small" />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="shipMode" label="运输方式">
              <Input placeholder="陆运" />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="country" label="国家">
              <Select options={COUNTRIES} />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item name="vendor" label="物流商">
              <Select options={VENDORS} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="supplyUrl" label="1688 货源链接">
              <Input placeholder="https://detail.1688.com/offer/....html" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="retailUrl" label="Ozon 跟卖链接">
              <Input placeholder="https://www.ozon.ru/product/...." />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={18}>
            <Form.Item name="remark" label="备注">
              <Input placeholder="备注" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="listed" label="上架状态" valuePropName="checked">
              <Switch checkedChildren="已上架" unCheckedChildren="未上架" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );

  return (
    <Card
      size="small"
      title="定价记录"
      extra={
        <Space>
          <Select
            value={listedFilter}
            onChange={(v) => {
              setListedFilter(v);
              setPage(1);
              setSelectedKeys([]);
            }}
            style={{ width: 110 }}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'yes', label: '已上架' },
              { value: 'no', label: '未上架' },
            ]}
          />
          <Select
            value={higherFilter}
            onChange={(v) => {
              setHigherFilter(v);
              setPage(1);
              setSelectedKeys([]);
            }}
            style={{ width: 170 }}
            popupMatchSelectWidth={false}
            options={[
              { value: 'all', label: '高于跟卖价·全部' },
              { value: 'yes', label: '高于跟卖价·是' },
              { value: 'no', label: '高于跟卖价·否' },
            ]}
          />
          <Input.Search placeholder="产品/渠道" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} onSearch={() => setPage(1)} style={{ width: 200 }} />
          <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
            导入定价表
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load} />
          <Button type="primary" icon={<DownloadOutlined />} href={exportHref}>
            导出 CSV
          </Button>
        </Space>
      }
    >
      {importModal}
      {editModal}
      <Space style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 13, color: '#666' }}>已选 {selectedKeys.length} 条</span>
        <Button size="small" loading={listing} disabled={!selectedKeys.length} onClick={() => doListing(selectedKeys, true, '（所选）')}>
          批量上架
        </Button>
        <Button size="small" loading={listing} disabled={!selectedKeys.length} onClick={() => doListing(selectedKeys, false, '（所选）')}>
          批量下架
        </Button>
      </Space>
      <Table
        size="small"
        rowKey="id"
        dataSource={list}
        columns={columns as any}
        scroll={{ x: 1500 }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys as number[]),
        }}
        pagination={{ current: page, pageSize: 20, total, onChange: setPage }}
      />
      {/* 中实跨境ERP 插件数据弹窗（点击"产品"打开） */}
      <Modal
        open={!!cardRec}
        onCancel={() => setCardRec(null)}
        footer={null}
        width={640}
        title={
          <Space size={8}>
            <span>中实跨境ERP 插件数据</span>
            {cardRec?.imageUrl ? <img src={cardRec.imageUrl} alt="" style={{ width: 24, height: 24, borderRadius: 3, objectFit: 'cover' }} /> : null}
            <span style={{ fontSize: 13, color: '#666', fontWeight: 400 }}>{cardRec?.name || cardRec?.sku || ''}</span>
          </Space>
        }
      >
        {cardRec?.pluginCard ? (
          <>
            <Descriptions
              size="small"
              column={2}
              bordered
              labelStyle={{ width: 130 }}
              items={(
                [
                  ['category', '类目'],
                  ['rfbsCommission', 'rFBS佣金'],
                  ['sku', 'SKU'],
                  ['brand', '品牌'],
                  ['soldCount', '月销量'],
                  ['soldSum', '月销售额'],
                  ['salesDynamics', '月周转动态(%)'],
                  ['drr', '广告费占比(%)'],
                  ['daysInPromo', '参与促销天数'],
                  ['discount', '参与促销折扣(%)'],
                  ['promoRevenueShare', '促销活动转化(%)'],
                  ['daysWithTrafarets', '付费推广天数'],
                  ['qtyViewPdp', '商品卡浏览量'],
                  ['convToCartPdp', '商品卡加购率(%)'],
                  ['sessionCountSearch', '搜索浏览量'],
                  ['convToCartSearch', '搜索加购率(%)'],
                  ['convViewToOrder', '展示转化率(%)'],
                  ['customClickRate', '商品点击率(%)'],
                  ['salesSchema', '发货模式'],
                  ['redemptionRate', '退货取消率(%)'],
                  ['volume', '长宽高'],
                  ['weight', '重量(g)'],
                  ['createDate', '上架时间'],
                  ['offers', '跟卖列表'],
                  ['offerMinPrice', '跟卖最低价(¥)'],
                  ['historicalAvgPrice', '历史平均价格(¥)'],
                ] as [string, string][]
              )
                .filter(([k]) => cardRec.pluginCard[k] !== undefined && cardRec.pluginCard[k] !== null)
                .map(([k, label]) => ({
                  key: k,
                  label,
                  children:
                    cardRec.pluginCard[k] === '暂无数据' ? (
                      <span style={{ color: '#bfbfbf' }}>暂无数据</span>
                    ) : (
                      <span>{String(cardRec.pluginCard[k])}</span>
                    ),
                }))}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: '#999' }}>
              数据来源：浏览器「中实跨境ERP」插件浮层，随商品采集时自动存档（采集时间点快照，非实时）。
            </div>
          </>
        ) : (
          <Empty description="该产品暂无插件数据（需安装中实跨境ERP插件后重新采集此商品 / 或其跟卖链接未被采集进商品库）" />
        )}
      </Modal>
    </Card>
  );
}

