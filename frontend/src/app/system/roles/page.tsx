'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tree,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { http } from '@/lib/api';
import { PERMISSIONS, canManageUsers } from '@/lib/permissions';

interface PermOption {
  key: string;
  label: string;
  group: string;
}

const GROUP_PREFIX = 'g:';

export default function SystemRolesPage() {
  const [me, setMe] = useState<any>(null);
  const [roles, setRoles] = useState<any[]>([]);
  const [permOptions, setPermOptions] = useState<PermOption[]>(PERMISSIONS);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [perms, setPerms] = useState<string[]>([]);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([http.get('/roles'), http.get('/users/permissions')]);
      setRoles(r.data || []);
      if (Array.isArray(p.data) && p.data.length) setPermOptions(p.data);
    } catch (e: any) {
      message.error(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const raw = localStorage.getItem('ds_user');
    if (raw) {
      try {
        setMe(JSON.parse(raw));
      } catch (e) {
        /* ignore */
      }
    }
    load();
  }, []);

  const groups = useMemo(() => {
    const g: string[] = [];
    permOptions.forEach((o) => {
      if (!g.includes(o.group)) g.push(o.group);
    });
    return g;
  }, [permOptions]);

  // 权限树：一级分组，二级页面
  const permTree = useMemo(
    () =>
      groups.map((g) => ({
        title: g,
        key: GROUP_PREFIX + g,
        children: permOptions.filter((o) => o.group === g).map((o) => ({ title: o.label, key: o.key })),
      })),
    [groups, permOptions],
  );

  const openCreate = () => {
    setEditing(null);
    setPerms(['dashboard', 'products']);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    setPerms(Array.isArray(row.permissions) ? row.permissions : []);
    form.resetFields();
    form.setFieldsValue({ name: row.name, code: row.code, remark: row.remark });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const payload = { ...values, permissions: perms };
      if (editing) {
        await http.patch(`/roles/${editing.id}`, payload);
        message.success('已保存');
      } else {
        await http.post('/roles', payload);
        message.success('已创建');
      }
      setOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (row: any) => {
    try {
      await http.delete(`/roles/${row.id}`);
      message.success('已删除');
      load();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  if (me && !canManageUsers(me)) {
    return (
      <Card>
        <Alert type="warning" showIcon message="当前账号没有角色管理权限，请联系超级管理员。" />
      </Card>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <h1 className="page-title">角色管理</h1>
          <p className="page-sub">按岗位建角色、给角色勾选页面权限，再把角色分配给员工</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增角色
        </Button>
      </div>

      <Card size="small">
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={roles}
          pagination={false}
          columns={[
            { title: '角色名', dataIndex: 'name', width: 160 },
            { title: '编码', dataIndex: 'code', width: 130 },
            {
              title: '页面权限',
              dataIndex: 'permissions',
              render: (v: any) => {
                const list: string[] = Array.isArray(v) ? v : [];
                if (!list.length) return <span style={{ color: '#8c8c8c' }}>未分配</span>;
                return (
                  <Space size={[4, 4]} wrap>
                    {list.map((k) => (
                      <Tag key={k}>{permOptions.find((o) => o.key === k)?.label || k}</Tag>
                    ))}
                  </Space>
                );
              },
            },
            {
              title: '员工数',
              dataIndex: 'userCount',
              width: 90,
              align: 'right',
              render: (v: number) => v ?? 0,
            },
            {
              title: '备注',
              dataIndex: 'remark',
              width: 160,
              render: (v) => v || '—',
            },
            {
              title: '操作',
              width: 150,
              render: (_v, row: any) => (
                <Space size="small">
                  <Button type="link" size="small" onClick={() => openEdit(row)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除后，该角色下的员工会变成「未分配角色」"
                    onConfirm={() => remove(row)}
                    okText="删除"
                    cancelText="取消"
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

      <Modal
        title={editing ? '编辑角色' : '新增角色'}
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={submitting}
        okText="保存"
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="角色名" rules={[{ required: true, message: '请输入角色名' }]}>
            <Input placeholder="如：选品专员、核价员" />
          </Form.Item>
          <Form.Item
            name="code"
            label="角色编码"
            rules={[
              { required: true, message: '请输入角色编码' },
              { pattern: /^[A-Za-z0-9_]+$/, message: '只能包含字母、数字和下划线' },
            ]}
            extra="唯一标识，创建后建议不再改动"
          >
            <Input placeholder="如：selector" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="选填" />
          </Form.Item>

          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 14, marginBottom: 6 }}>页面权限</div>
            <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 12px' }}>
              <Tree
                checkable
                selectable={false}
                defaultExpandAll
                treeData={permTree}
                checkedKeys={perms}
                onCheck={(checked) => {
                  const keys = (Array.isArray(checked) ? checked : checked.checked) as string[];
                  setPerms(keys.filter((k) => !String(k).startsWith(GROUP_PREFIX)));
                }}
              />
            </div>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
