'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { http, PRESETS } from '@/lib/api';

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '排队中' },
  running: { color: 'processing', text: '采集中' },
  success: { color: 'success', text: '成功' },
  failed: { color: 'error', text: '失败' },
};

export default function CollectPage() {
  const [browser, setBrowser] = useState<any>(null);
  const [starting, setStarting] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [form] = Form.useForm();
  const timer = useRef<any>(null);

  const loadBrowser = async () => {
    try {
      setBrowser((await http.get('/browser/status')).data);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const loadTasks = async (p = page) => {
    try {
      const { data } = await http.get('/collect/tasks', { params: { page: p, pageSize: 10 } });
      setTasks(data.list);
      setTotal(data.total);
    } catch (e: any) {
      /* 静默，避免轮询刷屏 */
    }
  };

  useEffect(() => {
    form.setFieldsValue({ url: PRESETS[0].url, scrolls: 20, step: 900 });
    loadBrowser();
    loadTasks(1);
    timer.current = setInterval(() => {
      loadTasks();
      loadBrowser();
    }, 4000);
    return () => clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!detail?.id) return;
    const t = setInterval(async () => {
      try {
        setDetail((await http.get(`/collect/tasks/${detail.id}`)).data);
      } catch (e) {
        /* ignore */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [detail?.id]);

  const startBrowser = async () => {
    setStarting(true);
    try {
      const { data } = await http.post('/browser/start');
      message[data.ok ? 'success' : 'warning'](data.msg);
      await loadBrowser();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setStarting(false);
    }
  };

  const createTask = async () => {
    const values = await form.validateFields();
    setCreating(true);
    try {
      await http.post('/collect/tasks', values);
      message.success('采集任务已创建，正在后台执行');
      loadTasks(1);
      setPage(1);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const openDetail = async (id: number) => {
    try {
      setDetail((await http.get(`/collect/tasks/${id}`)).data);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const removeTask = async (id: number) => {
    try {
      await http.delete(`/collect/tasks/${id}`);
      message.success('已删除');
      loadTasks();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  return (
    <div>
      <h1 className="page-title">数据采集</h1>
      <p className="page-sub">
        数据来自「中实跨境ERP」插件注入在商品卡片上的属性，因此需要接管你本机装了插件、登了号的 Chrome
      </p>

      {browser?.supported === false && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message="浏览器接管功能当前不可用"
          description={
            browser?.msg ||
            '此功能仅支持 macOS 桌面环境（需本机已登录插件的 Chrome），当前运行环境为服务器，无法启动。请在你的 Mac 上运行本服务后再使用。'
          }
        />
      )}

      <Card size="small" style={{ marginBottom: 14 }}>
        <Row align="middle" gutter={12}>
          <Col flex="auto">
            <Space size={12} wrap>
              <Tag color={browser?.portUp ? 'success' : 'error'}>
                {browser?.portUp ? `调试端口 ${browser.port} 已就绪` : '调试端口未连接'}
              </Tag>
              {browser?.browser && <span style={{ color: '#8c8c8c', fontSize: 13 }}>{browser.browser}</span>}
              <span style={{ color: '#8c8c8c', fontSize: 13 }}>
                配置目录：{browser?.profileReady ? '已就绪' : '未准备（首次会自动复制）'}
              </span>
              {browser?.chromeRunning && !browser?.portUp && (
                <span style={{ color: '#fa8c16', fontSize: 13 }}>Chrome 正在运行，需先 Cmd+Q 退出</span>
              )}
            </Space>
          </Col>
          <Col>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={loadBrowser}>
                刷新状态
              </Button>
              <Button type="primary" loading={starting} onClick={startBrowser}>
                启动 / 检查浏览器
              </Button>
            </Space>
          </Col>
        </Row>
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="首次使用：先完全退出 Chrome（Cmd+Q），再点「启动 / 检查浏览器」。程序会复制一份配置（保留插件与登录态）并拉起带调试端口的 Chrome。"
        />
      </Card>

      <Card title="新建采集任务" size="small" style={{ marginBottom: 14 }}>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col xs={24} md={9}>
              <Form.Item label="榜单预设">
                <Select
                  options={PRESETS.map((p) => ({ label: p.name, value: p.url }))}
                  onChange={(v) => form.setFieldValue('url', v)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={15}>
              <Form.Item name="url" label="榜单地址" rules={[{ required: true, message: '请填写榜单地址' }]}>
                <Input placeholder="https://www.ozon.ru/highlight/..." />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item name="name" label="任务名称">
                <Input placeholder="可留空自动生成" />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item name="scrolls" label="滚动屏数">
                <InputNumber min={1} max={200} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item name="step" label="每屏像素">
                <InputNumber min={300} step={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item label=" ">
                <Button type="primary" icon={<ThunderboltOutlined />} loading={creating} onClick={createTask} block>
                  开始采集
                </Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card title="采集任务" size="small">
        <Table
          rowKey="id"
          size="small"
          dataSource={tasks}
          pagination={{ current: page, pageSize: 10, total, onChange: (p) => { setPage(p); loadTasks(p); } }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 60 },
            { title: '任务名称', dataIndex: 'name', ellipsis: true },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (s) => <Tag color={STATUS_MAP[s]?.color}>{STATUS_MAP[s]?.text || s}</Tag>,
            },
            { title: '采到商品', dataIndex: 'total', width: 100, align: 'right' },
            { title: '滚动屏数', dataIndex: 'scrolls', width: 90, align: 'right' },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              width: 165,
              render: (v) => new Date(v).toLocaleString('zh-CN'),
            },
            {
              title: '操作',
              width: 140,
              render: (_, r: any) => (
                <Space>
                  <Button type="link" size="small" onClick={() => openDetail(r.id)}>
                    日志
                  </Button>
                  <Popconfirm title="确认删除该任务？" onConfirm={() => removeTask(r.id)}>
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

      <Drawer
        title={detail ? `任务 #${detail.id} · ${detail.name}` : ''}
        width={760}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_MAP[detail.status]?.color}>{STATUS_MAP[detail.status]?.text || detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="采到商品">{detail.total}</Descriptions.Item>
              <Descriptions.Item label="入库明细">{detail.productCount ?? 0}</Descriptions.Item>
              <Descriptions.Item label="滚动屏数">{detail.scrolls}</Descriptions.Item>
              <Descriptions.Item label="开始">
                {detail.startedAt ? new Date(detail.startedAt).toLocaleString('zh-CN') : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="结束">
                {detail.finishedAt ? new Date(detail.finishedAt).toLocaleString('zh-CN') : '—'}
              </Descriptions.Item>
            </Descriptions>
            {detail.error && <Alert type="error" showIcon message={detail.error} style={{ marginBottom: 12 }} />}
            <div className="log-box">{detail.logs || '暂无日志'}</div>
          </>
        )}
      </Drawer>
    </div>
  );
}
