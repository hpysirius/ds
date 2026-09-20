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
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import WorkbenchTab from './Workbench';
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
    {
      title: '产品',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (v: any, r: any) => (
        <Space size={6}>
          {r.imageUrl ? <img src={r.imageUrl} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 3 }} /> : null}
          <div>
            <div>{v || <span style={{ color: '#bfbfbf' }}>—</span>}</div>
            <div style={{ fontSize: 11, color: '#999' }}>{r.sku || ''}</div>
          </div>
        </Space>
      ),
    },
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
      title="定价记录"
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
      markupRate: Number(((settings.markupRate ?? 0.1) * 100).toFixed(2)),
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
        markupRate: v.markupRate / 100,
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
    <Card size="small" title="定价默认参数" style={{ maxWidth: 640 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="汇率、费率与成本加价率会作为定价工作台的默认值；定价时仍可在页面里临时改。"
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
            <Form.Item name="markupRate" label="成本加价 %" tooltip="定价 =（成本×(1+加价率) + 运费 + 贴单费）÷（1−佣金−代理佣金）">
              <InputNumber style={{ width: '100%' }} min={0} max={300} step={1} precision={2} />
            </Form.Item>
          </Col>
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
  const [tab, setTab] = useState('workbench');

  const loadSettings = async () => {
    const { data } = await http.get('/pricing/settings');
    setSettings(data);
  };

  useEffect(() => {
    loadSettings().catch((e) => message.error(e.message));
  }, []);

  return (
    <Tabs
      activeKey={tab}
      onChange={setTab}
      items={[
        {
          key: 'workbench',
          label: '定价工作台',
          children: settings ? (
            <WorkbenchTab
              settings={settings}
              onSaved={() => {
                setReloadKey((k) => k + 1);
                setTab('records');
              }}
            />
          ) : null,
        },
        { key: 'records', label: '定价记录', children: <RecordTab reloadKey={reloadKey} /> },
        { key: 'channels', label: '物流渠道', children: <ChannelTab /> },
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
