'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { DownloadOutlined, PlayCircleOutlined, SaveOutlined } from '@ant-design/icons';
import { http, GRADE_TEXT, GRADE_COLOR, RuleSet } from '@/lib/api';

const GRADE_OPTIONS = [
  { label: '全部', value: '' },
  { label: '优先跟进', value: '1' },
  { label: '可跟进', value: '2' },
  { label: '观察', value: '3' },
  { label: '淘汰', value: '0' },
];

const RULE_HINTS: Record<string, string> = {
  salesMin: '月销下限（你的规则：2）',
  salesMax: '月销上限（你的规则：20）',
  sweetMin: '黄金区下限（5）',
  sweetMax: '黄金区上限（10）',
  cartHardMin: '加购率红线，低于此值淘汰（5）',
  cartGood: '加购率优良线（10）',
  cartGreat: '加购率满分线（15）',
  returnMax: '退货取消率上限（20）',
  reviewsMax: '评论数上限（0 = 零评论硬性指标）',
  daysMax: '上架天数上限，超过即淘汰（100）',
  daysPreferredMin: '上架天数优选区间起（45）',
  daysPreferredMax: '上架天数优选区间止（75）',
  organicMinSales: '自然流爆款门槛月销（70）',
  newbieMaxDays: '新品首单的上架天数上限（4）',
  adMax: '广告费占比上限（仅当允许广告时生效）',
  scoreFollow: '达到此分归入「优先跟进」（70）',
  scoreWatch: '达到此分归入「可跟进」（50）',
};

export default function ScreeningPage() {
  const [presets, setPresets] = useState<any[]>([]);
  const [presetId, setPresetId] = useState<number>();
  const [rules, setRules] = useState<RuleSet | null>(null);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<number | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [grade, setGrade] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveForm] = Form.useForm();

  const loadPresets = async () => {
    const { data } = await http.get('/screening/presets');
    setPresets(data);
    const def = data.find((p: any) => p.isDefault) || data[0];
    if (def) {
      setPresetId(def.id);
      setRules({ ...(await http.get('/screening/rules/default')).data, ...def.rules });
    }
  };

  const loadRuns = async () => {
    const { data } = await http.get('/screening/runs', { params: { pageSize: 10 } });
    setRuns(data.list);
  };

  const loadItems = async (id = runId, g = grade, p = page) => {
    if (!id) return;
    const { data } = await http.get(`/screening/runs/${id}`, { params: { grade: g, page: p, pageSize: 20 } });
    setItems(data.list);
    setTotal(data.total);
    if (data.run) setRunId(data.run.id);
  };

  useEffect(() => {
    loadPresets().catch((e) => message.error(e.message));
    loadRuns().catch(() => void 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (runId) loadItems(runId, grade, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, grade]);

  const runScreening = async () => {
    if (!rules) return;
    setRunning(true);
    try {
      const { data } = await http.post('/screening/run', { rules });
      message.success(
        `筛选完成：优先跟进 ${data.counts['优先跟进']}、可跟进 ${data.counts['可跟进']}、观察 ${data.counts['观察']}、淘汰 ${data.counts['淘汰']}`,
      );
      setRunId(data.runId);
      setGrade('');
      loadRuns();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setRunning(false);
    }
  };

  const savePreset = async () => {
    const values = await saveForm.validateFields();
    if (!rules) return;
    try {
      await http.post('/screening/presets', { ...values, rules });
      message.success('已保存为新预设');
      setSaveOpen(false);
      saveForm.resetFields();
      loadPresets();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const totalFromRun = runs.find((r) => r.id === runId)?.total;

  const rulesForm = rules && (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="规则分两层：下面带「上限/红线」的字段是硬性指标，命中直接淘汰；其余参与加权打分，加购率权重最高。"
      />
      <div className="rule-grid">
        {(
          [
            ['salesMin', '月销下限'],
            ['salesMax', '月销上限'],
            ['sweetMin', '黄金区下限'],
            ['sweetMax', '黄金区上限'],
            ['cartHardMin', '加购率红线 %'],
            ['cartGood', '加购率优良 %'],
            ['cartGreat', '加购率满分 %'],
            ['returnMax', '退货率上限 %'],
            ['reviewsMax', '评论数上限'],
            ['daysMax', '上架天数上限'],
            ['daysPreferredMin', '上架优选起'],
            ['daysPreferredMax', '上架优选止'],
            ['organicMinSales', '自然流月销门槛'],
            ['newbieMaxDays', '新品首单天数'],
            ['adMax', '广告占比上限 %'],
            ['scoreFollow', '优先跟进分数线'],
            ['scoreWatch', '可跟进分数线'],
          ] as [keyof RuleSet, string][]
        ).map(([key, label]) => (
          <div key={String(key)}>
            <div style={{ fontSize: 13, color: '#595959', marginBottom: 4 }}>
              <Tooltip title={RULE_HINTS[String(key)]}>
                <span style={{ borderBottom: '1px dashed #d9d9d9', cursor: 'help' }}>{label}</span>
              </Tooltip>
            </div>
            <InputNumber
              style={{ width: '100%' }}
              value={rules[key] as number}
              onChange={(v) => setRules({ ...rules, [key]: v as any })}
            />
          </div>
        ))}
      </div>

      <Divider style={{ margin: '16px 0 12px' }} />

      <Space size={24} wrap>
        <Checkbox checked={rules.requireNoBrand} onChange={(e) => setRules({ ...rules, requireNoBrand: e.target.checked })}>
          必须无品牌
        </Checkbox>
        <Checkbox checked={rules.requireFbs} onChange={(e) => setRules({ ...rules, requireFbs: e.target.checked })}>
          必须 FBS 发货
        </Checkbox>
        <Checkbox checked={!rules.allowAds} onChange={(e) => setRules({ ...rules, allowAds: !e.target.checked })}>
          只保留零广告
        </Checkbox>
        <Checkbox checked={rules.allowNewbie} onChange={(e) => setRules({ ...rules, allowNewbie: e.target.checked })}>
          启用新品首单档（月销 1 且上架很短）
        </Checkbox>
        <Checkbox checked={rules.allowOrganic} onChange={(e) => setRules({ ...rules, allowOrganic: e.target.checked })}>
          启用自然流爆款档（高月销 + 零广告）
        </Checkbox>
      </Space>
    </>
  );

  return (
    <div>
      <h1 className="page-title">智能筛选</h1>
      <p className="page-sub">按规则对商品库打分分级：优先跟进 / 可跟进 / 观察 / 淘汰</p>

      <Card size="small" style={{ marginBottom: 14 }}>
        <Row gutter={12} align="middle">
          <Col xs={24} md={7}>
            <Space>
              <span style={{ fontSize: 13, color: '#595959' }}>规则预设</span>
              <Select
                style={{ width: 300 }}
                value={presetId}
                onChange={async (v) => {
                  setPresetId(v);
                  const p = presets.find((x) => x.id === v);
                  if (p) setRules({ ...(await http.get('/screening/rules/default')).data, ...p.rules });
                }}
                options={presets.map((p) => ({ label: p.name, value: p.id }))}
              />
            </Space>
          </Col>
          <Col flex="auto" />
          <Col>
            <Space>
              <Button icon={<SaveOutlined />} onClick={() => setSaveOpen(true)}>
                另存为预设
              </Button>
              <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={runScreening}>
                执行筛选
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card title="规则设置" size="small" style={{ marginBottom: 14 }}>
        {rulesForm || <Empty description="加载中…" />}
      </Card>

      <Row gutter={[14, 14]}>
        <Col xs={24} lg={17}>
          <Card
            title={runId ? `筛选结果（批次 #${runId}）` : '筛选结果'}
            size="small"
            extra={
              <Space>
                <Select style={{ width: 130 }} value={grade} onChange={setGrade} options={GRADE_OPTIONS} />
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  disabled={!runId}
                  onClick={() => window.open(`${(http.defaults.baseURL as string)}/screening/runs/${runId}/export?grade=${grade}`, '_blank')}
                >
                  导出 CSV
                </Button>
              </Space>
            }
          >
            {runId ? (
              <Table
                rowKey="id"
                size="small"
                dataSource={items}
                pagination={{ current: page, pageSize: 20, total, onChange: (p) => { setPage(p); loadItems(runId, grade, p); } }}
                columns={[
                  {
                    title: '商品',
                    dataIndex: ['product', 'title'],
                    ellipsis: true,
                    render: (t, r: any) => (
                      <div>
                        <a href={r.product.productUrl} target="_blank" rel="noreferrer">
                          {t || r.product.sku}
                        </a>
                        <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                          {r.product.category3Name} · {r.product.sku}
                        </div>
                      </div>
                    ),
                  },
                  { title: '月销', width: 66, align: 'right', render: (_, r: any) => r.product.soldCount ?? '—' },
                  { title: '加购%', width: 78, align: 'right', render: (_, r: any) => r.product.convToCartPdp ?? '—' },
                  { title: '退货%', width: 78, align: 'right', render: (_, r: any) => r.product.cancelRate ?? '—' },
                  { title: '上架天', width: 78, align: 'right', render: (_, r: any) => r.product.createDays ?? '—' },
                  {
                    title: '档位',
                    width: 62,
                    align: 'center',
                    render: (_, r: any) => <Tag>{r.tier}</Tag>,
                  },
                  { title: '得分', dataIndex: 'score', width: 66, align: 'right' },
                  {
                    title: '分级',
                    dataIndex: 'grade',
                    width: 96,
                    render: (g) => <Tag color={GRADE_COLOR[g]}>{GRADE_TEXT[g]}</Tag>,
                  },
                  {
                    title: '判定依据',
                    render: (_, r: any) => (
                      <Space size={4} wrap>
                        {(r.hardRules || []).map((t: string, i: number) => (
                          <Tag key={'h' + i} color="red">
                            ✕ {t}
                          </Tag>
                        ))}
                        {(r.reasons || []).map((t: string, i: number) => (
                          <Tag key={'r' + i}>{t}</Tag>
                        ))}
                        {(r.notes || []).map((t: string, i: number) => (
                          <Tag key={'n' + i} color="orange">
                            {t}
                          </Tag>
                        ))}
                      </Space>
                    ),
                  },
                ]}
              />
            ) : (
              <Empty description="还没有筛选结果，点右上角「执行筛选」" />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={7}>
          <Card title="历史批次" size="small">
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={runs}
              onRow={(r: any) => ({ onClick: () => setRunId(r.id), style: { cursor: 'pointer' } })}
              columns={[
                { title: 'ID', dataIndex: 'id', width: 50 },
                { title: '预设', dataIndex: 'presetName', ellipsis: true },
                { title: '总数', dataIndex: 'total', width: 60, align: 'right' },
                {
                  title: '时间',
                  dataIndex: 'createdAt',
                  width: 108,
                  render: (v) => new Date(v).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
                },
              ]}
            />
            {totalFromRun ? (
              <div style={{ marginTop: 10, fontSize: 12, color: '#8c8c8c' }}>当前批次共筛选 {totalFromRun} 条商品</div>
            ) : null}
          </Card>
        </Col>
      </Row>

      <Drawer title="另存为规则预设" width={420} open={saveOpen} onClose={() => setSaveOpen(false)}>
        <Form form={saveForm} layout="vertical">
          <Form.Item name="name" label="预设名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如：圣诞季 · 零广告主筛" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} placeholder="记录这套阈值的用途" />
          </Form.Item>
          <Form.Item name="isDefault" valuePropName="checked">
            <Checkbox>设为默认预设</Checkbox>
          </Form.Item>
          <Button type="primary" block icon={<SaveOutlined />} onClick={savePreset}>
            保存（当前左侧阈值会一并存入）
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
