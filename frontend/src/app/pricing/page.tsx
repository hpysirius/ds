'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Tabs,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { CalculatorOutlined, DownloadOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { API_BASE, http } from '@/lib/api';

// ==================== 常量 ====================
const COUNTRIES = [
  { value: 'RU', label: '俄罗斯' },
  { value: 'BY', label: '白俄罗斯' },
  { value: 'KZ', label: '哈萨克斯坦' },
  { value: 'KG', label: '吉尔吉斯斯坦' },
];
const VENDORS = [
  { value: 'GUOO', label: 'GUOO（黑河国欧）' },
  { value: 'XY', label: '兴远国际 XY' },
];
const CATEGORIES = ['Extra Small', 'Budget', 'Small', 'Big', 'Premium Small', 'Premium Big'];

const pct = (v: any) => `${((Number(v) || 0) * 100).toFixed(2)}%`;
const money = (v: any, d = 2) => (Number(v) || 0).toFixed(d);
const countryLabel = (v: string) => COUNTRIES.find((c) => c.value === v)?.label || v || '-';
const vendorLabel = (v: string) => (v === 'GUOO' ? 'GUOO' : v === 'XY' ? '兴远 XY' : v || '-');

// ==================== 核价计算 ====================
function CalcTab({ settings, onReloadSettings }: { settings: any; onReloadSettings: () => void }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sku, setSku] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveForm] = Form.useForm();

  useEffect(() => {
    if (!settings) return;
    form.setFieldsValue({
      country: settings.defaultCountry || 'RU',
      vendor: settings.defaultVendor || 'GUOO',
      exchangeRate: settings.exchangeRate,
      labelFee: settings.labelFee,
      commissionRate: Number((settings.commissionRate * 100).toFixed(2)),
      agentRate: Number((settings.agentRate * 100).toFixed(2)),
      withdrawRate: Number((settings.withdrawRate * 100).toFixed(2)),
      priceMode: 'RUB',
      targetProfitRate: 35,
      weightKg: 0.3,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 8,
      purchaseCost: 20,
      priceValue: 2000,
    });
  }, [settings, form]);

  const priceMode = Form.useWatch('priceMode', form) || 'RUB';
  const exchangeRate = Form.useWatch('exchangeRate', form) || 0.0862;
  const priceValue = Form.useWatch('priceValue', form) || 0;

  const sellPriceCny = useMemo(
    () => (priceMode === 'RUB' ? Number((priceValue * exchangeRate).toFixed(2)) : priceValue),
    [priceMode, priceValue, exchangeRate],
  );
  const sellPriceRub = useMemo(
    () => (priceMode === 'RUB' ? priceValue : exchangeRate > 0 ? Number((priceValue / exchangeRate).toFixed(2)) : 0),
    [priceMode, priceValue, exchangeRate],
  );

  const runCalc = async () => {
    let v: any;
    try {
      v = await form.validateFields();
    } catch (e) {
      return;
    }
    setLoading(true);
    try {
      const body: any = {
        country: v.country,
        vendor: v.vendor,
        category: v.category || undefined,
        weightKg: v.weightKg ?? 0,
        lengthCm: v.lengthCm ?? 0,
        widthCm: v.widthCm ?? 0,
        heightCm: v.heightCm ?? 0,
        valueRub: v.priceMode === 'RUB' ? v.priceValue : (v.priceValue || 0) / (v.exchangeRate || 0.0862),
        sellPriceCny: v.priceMode === 'CNY' ? v.priceValue : undefined,
        sellPriceRub: v.priceMode === 'RUB' ? v.priceValue : undefined,
        exchangeRate: v.exchangeRate,
        purchaseCost: v.purchaseCost ?? 0,
        labelFee: v.labelFee ?? 0,
        commissionRate: (v.commissionRate ?? 0) / 100,
        agentRate: (v.agentRate ?? 0) / 100,
        withdrawRate: (v.withdrawRate ?? 0) / 100,
        manualShippingFee: v.manualShippingFee ?? undefined,
        targetProfitRate: (v.targetProfitRate ?? 0) / 100,
        includeUnavailable: true,
      };
      const { data } = await http.post('/pricing/calc', body);
      setResult(data);
      const best = data.list?.find((r: any) => r.ok);
      setSelectedId(best ? best.channelId : null);
      if (!data.list?.filter((r: any) => r.ok).length) {
        message.warning('没有可用渠道：重量 / 货值或尺寸超出了所选国家的渠道限制');
      }
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fillFromProduct = async () => {
    if (!sku.trim()) {
      message.warning('先填 SKU');
      return;
    }
    try {
      const { data } = await http.get(`/pricing/from-product/${encodeURIComponent(sku.trim())}`);
      const dims = [data.lengthCm, data.widthCm, data.heightCm]
        .filter((n: number) => n > 0)
        .sort((a: number, b: number) => b - a);
      form.setFieldsValue({
        weightKg: data.weightKg || undefined,
        lengthCm: dims[0] || undefined,
        widthCm: dims[1] || undefined,
        heightCm: dims[2] || undefined,
        priceValue: data.priceRub || undefined,
        priceMode: 'RUB',
      });
      message.success(`已带出 ${data.sku} 的重量与尺寸`);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const selected = useMemo(() => {
    if (!result) return null;
    if (result.manual) return { ...result.manual, name: '手填运费', shipMode: '手填' };
    return result.list?.find((r: any) => r.channelId === selectedId) || null;
  }, [result, selectedId]);

  const openSave = () => {
    if (!result) {
      message.warning('先算一次再保存');
      return;
    }
    saveForm.setFieldsValue({ name: '', supplyUrl: '', retailUrl: '', remark: '' });
    setSaveOpen(true);
  };

  const doSave = async () => {
    const extra = await saveForm.validateFields();
    const v = await form.getFieldsValue();
    const ch: any = selected || {};
    setSaving(true);
    try {
      await http.post('/pricing/records', {
        name: extra.name || null,
        sku: sku || null,
        purchaseCost: v.purchaseCost ?? 0,
        weightKg: v.weightKg ?? 0,
        lengthCm: v.lengthCm ?? 0,
        widthCm: v.widthCm ?? 0,
        heightCm: v.heightCm ?? 0,
        sellPrice: sellPriceCny,
        sellPriceRub: sellPriceRub,
        exchangeRate: v.exchangeRate,
        labelFee: v.labelFee ?? 0,
        commissionRate: (v.commissionRate ?? 0) / 100,
        agentRate: (v.agentRate ?? 0) / 100,
        withdrawRate: (v.withdrawRate ?? 0) / 100,
        country: v.country,
        vendor: v.vendor,
        channelId: ch.channelId ?? null,
        channelName: ch.name ?? null,
        shipMode: ch.shipMode ?? null,
        logistics: ch.shipMode ?? null,
        shippingFee: ch.shippingFee ?? 0,
        billWeightKg: ch.billWeightKg ?? 0,
        supplyUrl: extra.supplyUrl || null,
        retailUrl: extra.retailUrl || null,
        remark: extra.remark || null,
      });
      message.success('已保存到核价记录');
      setSaveOpen(false);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: '渠道',
      dataIndex: 'name',
      key: 'name',
      width: 250,
      render: (t: string, r: any) => (
        <Space size={4} direction="vertical">
          <span style={{ fontWeight: r.channelId === selectedId ? 600 : 400 }}>{t}</span>
          <Space size={4}>
            <Tag color="blue">{r.categoryLabel}</Tag>
            {r.shipMode ? <Tag>{r.shipMode}</Tag> : null}
            {r.delivery ? <Tag color="geekblue">{r.delivery}</Tag> : null}
            {r.etaDays ? <Tag color="green">{r.etaDays}</Tag> : null}
          </Space>
        </Space>
      ),
    },
    {
      title: '计费重(kg)',
      dataIndex: 'billWeightKg',
      key: 'billWeightKg',
      width: 100,
      render: (v: any, r: any) => (
        <Tooltip title={r.volumetric && r.volumetricWeightKg > 0 ? `体积重 ${money(r.volumetricWeightKg, 3)}kg（抛比 12000）` : ''}>
          {money(v, 3)}
        </Tooltip>
      ),
    },
    { title: '运费(¥)', dataIndex: 'shippingFee', key: 'shippingFee', width: 90, render: (v: any) => money(v) },
    { title: '毛利润(¥)', dataIndex: 'grossProfit', key: 'grossProfit', width: 95, render: (v: any) => money(v) },
    {
      title: '净利润(¥)',
      dataIndex: 'netProfit',
      key: 'netProfit',
      width: 100,
      render: (v: any) => <span style={{ color: v >= 0 ? '#cf1322' : '#389e0d', fontWeight: 600 }}>{money(v)}</span>,
    },
    { title: '利润率', dataIndex: 'profitRate', key: 'profitRate', width: 90, render: (v: any) => pct(v) },
    { title: '运费利润比', dataIndex: 'freightProfitRatio', key: 'freightProfitRatio', width: 100, render: (v: any) => pct(v) },
    {
      title: '建议定价',
      key: 'suggested',
      width: 130,
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <span>¥{money(r.suggestedSellPrice)}</span>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>{money(r.suggestedSellPriceRub, 0)}₽</span>
        </Space>
      ),
    },
    {
      title: '原因',
      key: 'reason',
      render: (_: any, r: any) => (r.ok ? '' : <span style={{ color: '#8c8c8c' }}>{r.reason}</span>),
    },
  ];

  return (
    <Row gutter={16}>
      <Col xs={24} lg={9}>
        <Card title="核价参数" size="small">
          <Form form={form} layout="vertical" size="small">
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="country" label="国家" rules={[{ required: true }]}>
                  <Select options={COUNTRIES} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="vendor" label="物流商" rules={[{ required: true }]}>
                  <Select options={VENDORS} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="category" label="品类（不选=全部）">
              <Select allowClear options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
            </Form.Item>

            <Divider orientation="left" plain style={{ margin: '4px 0' }}>
              商品
            </Divider>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="weightKg" label="实重 (kg)" rules={[{ required: true }]}>
                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} precision={4} placeholder="0.3" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="purchaseCost" label="采购成本 (¥)" rules={[{ required: true }]}>
                  <InputNumber style={{ width: '100%' }} min={0} step={1} precision={2} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="lengthCm" label="长 (cm)" tooltip="请填最长边">
                  <InputNumber style={{ width: '100%' }} min={0} step={1} precision={2} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="widthCm" label="宽 (cm)">
                  <InputNumber style={{ width: '100%' }} min={0} step={1} precision={2} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="heightCm" label="高 (cm)">
                  <InputNumber style={{ width: '100%' }} min={0} step={1} precision={2} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="从商品库带出（可选）">
              <Space.Compact style={{ width: '100%' }}>
                <Input placeholder="Ozon SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
                <Button onClick={fillFromProduct}>带出</Button>
              </Space.Compact>
            </Form.Item>

            <Divider orientation="left" plain style={{ margin: '4px 0' }}>
              售价与费率
            </Divider>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="priceMode" label="定价币种">
                  <Segmented
                    options={[
                      { label: '₽', value: 'RUB' },
                      { label: '¥', value: 'CNY' },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col span={16}>
                <Form.Item name="priceValue" label={priceMode === 'RUB' ? '定价 (₽)' : '定价 (¥)'} rules={[{ required: true }]}>
                  <InputNumber style={{ width: '100%' }} min={0} step={10} precision={2} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="exchangeRate" label="汇率（1₽=?¥）" rules={[{ required: true }]}>
                  <InputNumber style={{ width: '100%' }} min={0} step={0.0001} precision={6} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="labelFee" label="贴单费 (¥)">
                  <InputNumber style={{ width: '100%' }} min={0} step={0.5} precision={2} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="commissionRate" label="平台佣金 %">
                  <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.5} precision={2} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="agentRate" label="代理佣金 %">
                  <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} precision={2} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="withdrawRate" label="提现 %">
                  <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} precision={2} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="manualShippingFee" label="手填运费 (¥)" tooltip="填了就不按渠道算运费">
                  <InputNumber style={{ width: '100%' }} min={0} step={1} precision={2} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="targetProfitRate" label="目标利润率 %" tooltip="用于反算建议定价">
                  <InputNumber style={{ width: '100%' }} min={0} max={1000} step={5} precision={2} />
                </Form.Item>
              </Col>
            </Row>

            <Space>
              <Button type="primary" icon={<CalculatorOutlined />} loading={loading} onClick={runCalc}>
                核价
              </Button>
              <Button icon={<SaveOutlined />} onClick={openSave}>
                保存
              </Button>
            </Space>
          </Form>
        </Card>
      </Col>

      <Col xs={24} lg={15}>
        <Card
          size="small"
          title="核价结果"
          extra={
            result ? (
              <span style={{ fontSize: 12, color: '#8c8c8c' }}>
                定价 ¥{money(result.input?.sellPriceCny)} ≈ {money(result.input?.sellPriceRub, 0)}₽ · 可用渠道 {result.available}/{result.total}
              </span>
            ) : null
          }
        >
          {!result ? (
            <Empty description="填好参数后点「核价」" />
          ) : (
            <>
              {selected ? (
                <>
                  <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
                    <Descriptions.Item label="选用渠道" span={2}>
                      {selected.name}
                      {selected.shipMode ? ` · ${selected.shipMode}` : ''}
                      {selected.delivery ? ` · ${selected.delivery}` : ''}
                    </Descriptions.Item>
                  </Descriptions>
                  <Row gutter={12}>
                    <Col span={8}>
                      <Statistic title="国际运费 (¥)" value={money(selected.shippingFee)} />
                    </Col>
                    <Col span={8}>
                      <Statistic title="毛利润 (¥)" value={money(selected.grossProfit)} />
                    </Col>
                    <Col span={8}>
                      <Statistic
                        title="净利润 (¥)"
                        value={money(selected.netProfit)}
                        valueStyle={{ color: selected.netProfit >= 0 ? '#cf1322' : '#389e0d' }}
                      />
                    </Col>
                  </Row>
                  <Row gutter={12} style={{ marginTop: 12 }}>
                    <Col span={6}>
                      <Statistic title="利润率" value={pct(selected.profitRate)} />
                    </Col>
                    <Col span={6}>
                      <Statistic title="运费利润比" value={pct(selected.freightProfitRatio)} />
                    </Col>
                    <Col span={6}>
                      <Statistic title="加35%" value={money(selected.markup35)} />
                    </Col>
                    <Col span={6}>
                      <Statistic
                        title={`目标利润率 ${pct(result.input?.targetProfitRate)} 建议定价`}
                        value={money(selected.suggestedSellPrice)}
                        suffix={`¥ / ${money(selected.suggestedSellPriceRub, 0)}₽`}
                      />
                    </Col>
                  </Row>
                </>
              ) : (
                <Alert type="warning" showIcon message="没有可用渠道，请看下表的原因列" />
              )}

              <Divider style={{ margin: '12px 0' }} />
              <Table
                size="small"
                rowKey="channelId"
                dataSource={result.list}
                columns={columns as any}
                pagination={false}
                scroll={{ x: 1100, y: 420 }}
                onRow={(r: any) => ({
                  onClick: () => r.ok && setSelectedId(r.channelId),
                  style: { cursor: r.ok ? 'pointer' : 'default', background: r.channelId === selectedId ? '#e6f4ff' : undefined },
                })}
                rowClassName={(r: any) => (r.ok ? '' : 'row-disabled')}
              />
              <style>{`.row-disabled{opacity:.5}`}</style>
            </>
          )}
        </Card>
      </Col>

      <Modal title="保存核价记录" open={saveOpen} onOk={doSave} confirmLoading={saving} onCancel={() => setSaveOpen(false)} okText="保存">
        <Form form={saveForm} layout="vertical">
          <Form.Item name="name" label="产品备注">
            <Input placeholder="如：对半花架" />
          </Form.Item>
          <Form.Item name="supplyUrl" label="货源链接">
            <Input placeholder="1688 / 拼多多 等" />
          </Form.Item>
          <Form.Item name="retailUrl" label="跟卖链接">
            <Input placeholder="Ozon 商品链接" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Row>
  );
}

// ==================== 渠道管理 ====================
function ChannelTab() {
  const [list, setList] = useState<any[]>([]);
  const [country, setCountry] = useState<string>('RU');
  const [vendor, setVendor] = useState<string>('GUOO');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    const { data } = await http.get('/pricing/channels', { params: { country, vendor } });
    setList(data);
  }, [country, vendor]);

  useEffect(() => {
    load().catch((e) => message.error(e.message));
  }, [load]);

  const openEdit = (row?: any) => {
    setEditing(row || null);
    form.setFieldsValue(
      row || {
        country,
        vendor,
        category: 'Extra Small',
        enabled: true,
        volumetric: false,
        roundUp: vendor === 'XY',
        divisor: 12000,
        maxSumCm: 90,
        maxSideLongCm: 60,
        maxSideShortCm: 60,
      },
    );
    setOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    try {
      if (editing) await http.patch(`/pricing/channels/${editing.id}`, v);
      else await http.post('/pricing/channels', v);
      message.success('已保存');
      setOpen(false);
      load();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const columns = [
    { title: '品类', dataIndex: 'category', key: 'category', width: 120 },
    {
      title: '渠道',
      dataIndex: 'name',
      key: 'name',
      render: (t: string, r: any) => (
        <Space size={4} direction="vertical">
          <span>{t}</span>
          {r.note ? <span style={{ color: '#8c8c8c', fontSize: 12 }}>{r.note}</span> : null}
        </Space>
      ),
    },
    { title: '运输', dataIndex: 'shipMode', key: 'shipMode', width: 90 },
    { title: '到门/到点', dataIndex: 'delivery', key: 'delivery', width: 90, render: (v: any) => v || <span style={{ color: '#bfbfbf' }}>均可</span> },
    { title: '元/kg', dataIndex: 'pricePerKg', key: 'pricePerKg', width: 80 },
    { title: '元/票', dataIndex: 'pricePerOrder', key: 'pricePerOrder', width: 80 },
    {
      title: '重量区间(kg)',
      key: 'w',
      width: 120,
      render: (_: any, r: any) => `${r.minWeightKg} ~ ${r.maxWeightKg}`,
    },
    {
      title: '货值区间(₽)',
      key: 'v',
      width: 150,
      render: (_: any, r: any) => `${r.minValueRub} ~ ${r.maxValueRub}`,
    },
    { title: '三边和', dataIndex: 'maxSumCm', key: 'maxSumCm', width: 80 },
    {
      title: '单边',
      key: 'side',
      width: 100,
      render: (_: any, r: any) => `${r.maxSideLongCm}/${r.maxSideShortCm}`,
    },
    {
      title: '计抛',
      dataIndex: 'volumetric',
      key: 'volumetric',
      width: 70,
      render: (v: boolean) => (v ? <Tag color="orange">收抛</Tag> : <span style={{ color: '#bfbfbf' }}>实重</span>),
    },
    { title: '时效', dataIndex: 'etaDays', key: 'etaDays', width: 90 },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 70,
      render: (v: boolean) => (v ? <Tag color="green">是</Tag> : <Tag>否</Tag>),
    },
    {
      title: '操作',
      key: 'op',
      width: 120,
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Popconfirm
            title="删除这条渠道？"
            onConfirm={async () => {
              await http.delete(`/pricing/channels/${r.id}`);
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

  return (
    <Card
      size="small"
      title="物流渠道（来自定价表模版）"
      extra={
        <Space>
          <Select value={country} onChange={setCountry} options={COUNTRIES} style={{ width: 130 }} />
          <Select value={vendor} onChange={setVendor} options={VENDORS} style={{ width: 180 }} />
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button type="primary" onClick={() => openEdit()}>
            新增渠道
          </Button>
          <Popconfirm
            title="清空并恢复内置渠道？自定义改动会丢失"
            onConfirm={async () => {
              await http.post('/pricing/channels/reset');
              message.success('已恢复内置渠道');
              load();
            }}
          >
            <Button>恢复内置</Button>
          </Popconfirm>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="运费 = 计费重量 × 元/kg + 元/票；计抛渠道的计费重量取实重与体积重（长×宽×高/12000）的较大值。渠道价格会变动，请在这里维护。"
      />
      <Table size="small" rowKey="id" dataSource={list} columns={columns as any} pagination={false} scroll={{ x: 1500 }} />

      <Modal
        title={editing ? '编辑渠道' : '新增渠道'}
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        width={760}
        okText="保存"
      >
        <Form form={form} layout="vertical" size="small">
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item name="country" label="国家" rules={[{ required: true }]}>
                <Select options={COUNTRIES} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="vendor" label="物流商" rules={[{ required: true }]}>
                <Select options={VENDORS} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="category" label="品类" rules={[{ required: true }]}>
                <Select options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="shipMode" label="运输方式">
                <Input placeholder="陆运 / 陆空联运 / 空运" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="name" label="渠道名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item name="pricePerKg" label="元/kg" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={0.1} precision={4} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="pricePerOrder" label="元/票（挂号费）" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={0.1} precision={4} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="minWeightKg" label="最小重量(kg)">
                <InputNumber style={{ width: '100%' }} min={0} step={0.001} precision={4} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="maxWeightKg" label="最大重量(kg)">
                <InputNumber style={{ width: '100%' }} min={0} step={1} precision={4} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item name="minValueRub" label="最小货值(₽)">
                <InputNumber style={{ width: '100%' }} min={0} step={100} precision={2} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="maxValueRub" label="最大货值(₽)">
                <InputNumber style={{ width: '100%' }} min={0} step={1000} precision={2} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="maxSumCm" label="三边和上限">
                <InputNumber style={{ width: '100%' }} min={0} step={10} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="maxSideLongCm" label="最长边">
                <InputNumber style={{ width: '100%' }} min={0} step={10} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="maxSideShortCm" label="其余边">
                <InputNumber style={{ width: '100%' }} min={0} step={10} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={4}>
              <Form.Item name="volumetric" label="计抛" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="roundUp" label="向上取整" valuePropName="checked" tooltip="兴远 XY 走 ROUNDUP(x,2)">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="divisor" label="抛比">
                <InputNumber style={{ width: '100%' }} min={1} step={1000} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="etaDays" label="时效">
                <Input placeholder="13-18天" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="delivery" label="到点/到门">
                <Input placeholder="PUDO / Courier" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="priceText" label="价格描述">
            <Input placeholder="28.1元/千克+3.37元/票" />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

// ==================== 核价记录 ====================
function RecordTab({ reloadKey }: { reloadKey: number }) {
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');

  const load = useCallback(async () => {
    const { data } = await http.get('/pricing/records', { params: { page, pageSize: 20, keyword: keyword || undefined } });
    setList(data.list);
    setTotal(data.total);
  }, [page, keyword]);

  useEffect(() => {
    load().catch((e) => message.error(e.message));
  }, [load, reloadKey]);

  const columns = [
    { title: '产品', dataIndex: 'name', key: 'name', width: 140, render: (v: any) => v || <span style={{ color: '#bfbfbf' }}>—</span> },
    { title: '渠道', dataIndex: 'channelName', key: 'channelName', width: 200, render: (v: any, r: any) => v ? `${v}${r.shipMode ? ' · ' + r.shipMode : ''}` : '—' },
    { title: '定价(¥)', dataIndex: 'sellPrice', key: 'sellPrice', width: 90, render: (v: any, r: any) => `${money(v)} / ${money(r.sellPriceRub, 0)}₽` },
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
    { title: '重量', dataIndex: 'weightKg', key: 'weightKg', width: 80, render: (v: any, r: any) => `${money(v, 3)}kg` },
    { title: '尺寸(cm)', key: 'size', width: 110, render: (_: any, r: any) => `${r.lengthCm}×${r.widthCm}×${r.heightCm}` },
    {
      title: '操作',
      key: 'op',
      width: 70,
      render: (_: any, r: any) => (
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
      ),
    },
  ];

  return (
    <Card
      size="small"
      title="核价记录"
      extra={
        <Space>
          <Input.Search placeholder="产品/渠道" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} onSearch={() => setPage(1)} style={{ width: 200 }} />
          <Button icon={<ReloadOutlined />} onClick={load} />
          <Button type="primary" icon={<DownloadOutlined />} href={`${API_BASE}/pricing/records/export`}>
            导出 CSV
          </Button>
        </Space>
      }
    >
      <Table
        size="small"
        rowKey="id"
        dataSource={list}
        columns={columns as any}
        scroll={{ x: 1400 }}
        pagination={{ current: page, pageSize: 20, total, onChange: setPage }}
      />
    </Card>
  );
}

// ==================== 参数设置 ====================
function SettingTab({ settings, onSaved }: { settings: any; onSaved: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    form.setFieldsValue({
      exchangeRate: settings.exchangeRate,
      rubPerCny: settings.rubPerCny,
      labelFee: settings.labelFee,
      commissionRate: Number((settings.commissionRate * 100).toFixed(2)),
      agentRate: Number((settings.agentRate * 100).toFixed(2)),
      withdrawRate: Number((settings.withdrawRate * 100).toFixed(2)),
      defaultCountry: settings.defaultCountry,
      defaultVendor: settings.defaultVendor,
    });
  }, [settings, form]);

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await http.patch('/pricing/settings', {
        exchangeRate: v.exchangeRate,
        rubPerCny: v.rubPerCny,
        labelFee: v.labelFee,
        commissionRate: v.commissionRate / 100,
        agentRate: v.agentRate / 100,
        withdrawRate: v.withdrawRate / 100,
        defaultCountry: v.defaultCountry,
        defaultVendor: v.defaultVendor,
      });
      message.success('已保存');
      onSaved();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card size="small" title="核价默认参数" style={{ maxWidth: 640 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="这里的汇率与费率会作为核价页的默认值；每次核价仍可在页面里临时改。"
      />
      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="exchangeRate" label="汇率（1 卢布 = ? 人民币）" rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={0} step={0.0001} precision={6} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="rubPerCny" label="参考：1 人民币 = ? 卢布">
              <InputNumber style={{ width: '100%' }} min={0} step={0.1} precision={4} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="labelFee" label="贴单费（元/单）" rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={0} step={0.5} precision={2} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="commissionRate" label="平台佣金 %" rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.5} precision={2} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="agentRate" label="Ozon 代理佣金 %" rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} precision={2} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="withdrawRate" label="提现费率 %" rules={[{ required: true }]}>
              <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} precision={2} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="defaultCountry" label="默认国家">
              <Select options={COUNTRIES} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="defaultVendor" label="默认物流商">
              <Select options={VENDORS} />
            </Form.Item>
          </Col>
        </Row>
        <Button type="primary" loading={saving} onClick={save}>
          保存参数
        </Button>
      </Form>
    </Card>
  );
}

// ==================== 页面 ====================
export default function PricingPage() {
  const [settings, setSettings] = useState<any>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const loadSettings = async () => {
    const { data } = await http.get('/pricing/settings');
    setSettings(data);
  };

  useEffect(() => {
    loadSettings().catch((e) => message.error(e.message));
  }, []);

  return (
    <Tabs
      defaultActiveKey="calc"
      items={[
        {
          key: 'calc',
          label: '核价计算',
          children: settings ? <CalcTab settings={settings} onReloadSettings={loadSettings} /> : null,
        },
        { key: 'channels', label: '物流渠道', children: <ChannelTab /> },
        { key: 'records', label: '核价记录', children: <RecordTab reloadKey={reloadKey} /> },
        {
          key: 'settings',
          label: '参数设置',
          children: settings ? (
            <SettingTab
              settings={settings}
              onSaved={() => {
                loadSettings();
                setReloadKey((k) => k + 1);
              }}
            />
          ) : null,
        },
      ]}
    />
  );
}
