'use client';

import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, ShopOutlined } from '@ant-design/icons';
import { http } from '@/lib/api';
import { isSuperAdmin } from '@/lib/permissions';
import { useStore } from '@/lib/store-context';

export default function SystemStoresPage() {
  const { reloadStores } = useStore();
  const [me] = useState<any>(() => {
    try {
      return JSON.parse(localStorage.getItem('ds_user') || 'null');
    } catch (e) {
      return null;
    }
  });
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await http.get('/stores');
      setList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      message.error(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isSuperAdmin(me)) {
    return (
      <Card>
        <p>只有超级管理员可以访问店铺管理。</p>
      </Card>
    );
  }

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 1 });
    setOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({ name: r.name, code: r.code || '', remark: r.remark || '', status: r.status ?? 1 });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editing) {
        await http.put(`/stores/${editing.id}`, values);
        message.success('已保存');
      } else {
        await http.post('/stores', values);
        message.success('已创建店铺');
      }
      setOpen(false);
      await load();
      reloadStores();
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (r: any) => {
    try {
      await http.delete(`/stores/${r.id}`);
      message.success(`已删除「${r.name}」（原绑定员工/商品/定价自动解绑为未分配）`);
      await load();
      reloadStores();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 64 },
    { title: '店铺名称', dataIndex: 'name', render: (v: string, r: any) => (
        <Space>
          <ShopOutlined style={{ color: '#1677ff' }} />
          <b>{v}</b>
          {r.code && <Tag>{r.code}</Tag>}
        </Space>
      ) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: number) => (s === 1 ? <Tag color="success">启用</Tag> : <Tag color="default">停用</Tag>),
    },
    { title: '员工数', dataIndex: 'userCount', width: 80, align: 'right' as const, render: (v: number) => v ?? 0 },
    { title: '商品数', dataIndex: 'productCount', width: 80, align: 'right' as const, render: (v: number) => v ?? 0 },
    { title: '定价数', dataIndex: 'recordCount', width: 80, align: 'right' as const, render: (v: number) => v ?? 0 },
    { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v: string) => v || '—' },
    {
      title: '操作',
      width: 150,
      render: (_: any, r: any) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Popconfirm title={`删除店铺「${r.name}」？`} description="员工/商品/定价会自动解绑为未分配，不会删除这些数据。" onConfirm={() => remove(r)} okText="删除" okType="danger" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <h1 className="page-title">店铺管理</h1>
      <p className="page-sub">
        创建店铺、查看各店数据规模；员工与商品/采集/定价数据都按店铺隔离。删除店铺时，原绑定的数据会自动解绑为「未分配」，不会丢失。
      </p>

      <Card
        size="small"
        title="店铺列表"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建店铺
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={list}
          columns={columns}
          pagination={false}
        />
      </Card>

      <Modal
        title={editing ? `编辑店铺：${editing.name}` : '新建店铺'}
        open={open}
        onOk={submit}
        confirmLoading={submitting}
        onCancel={() => setOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="店铺名称" rules={[{ required: true, message: '请输入店铺名称' }]}>
            <Input placeholder="如：莫斯科一号店" maxLength={80} />
          </Form.Item>
          <Form.Item
            name="code"
            label="店铺编码"
            tooltip="唯一标识，可空。只能包含字母/数字/下划线/连字符"
            rules={[{ pattern: /^[A-Za-z0-9_-]*$/, message: '编码只能包含字母/数字/下划线/连字符' }]}
          >
            <Input placeholder="如：msk01" maxLength={40} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <InputNumber min={0} max={1} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea placeholder="可填经营区域、负责人等" maxLength={200} rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
