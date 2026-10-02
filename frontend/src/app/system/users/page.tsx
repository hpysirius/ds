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
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tree,
  Typography,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { http } from '@/lib/api';
import { PERMISSIONS, ROLE_TEXT, canManageUsers } from '@/lib/permissions';

interface PermOption {
  key: string;
  label: string;
  group: string;
}

const ROLE_OPTIONS = [
  { value: 'user', label: '员工' },
  { value: 'admin', label: '管理员' },
  { value: 'super_admin', label: '超级管理员' },
];

export default function SystemUsersPage() {
  const [me, setMe] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [permOptions, setPermOptions] = useState<PermOption[]>(PERMISSIONS);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [perms, setPerms] = useState<string[]>([]);
  const [role, setRole] = useState<string>('user');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [form] = Form.useForm();

  // 重置密码弹窗
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<any>(null);
  const [pwdValue, setPwdValue] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [u, r, p] = await Promise.all([
        http.get('/users'),
        http.get('/roles'),
        http.get('/users/permissions'),
      ]);
      setUsers(u.data || []);
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

  // 页面权限树：一级是分组，二级是具体页面
  const GROUP_PREFIX = 'g:';
  const permTree = useMemo(
    () =>
      groups.map((g) => ({
        title: g,
        key: GROUP_PREFIX + g,
        children: permOptions.filter((o) => o.group === g).map((o) => ({ title: o.label, key: o.key })),
      })),
    [groups, permOptions],
  );

  // 当前选中角色对应的权限（用于只读展示「继承自角色」的权限）
  const selectedRolePerms = useMemo(() => {
    if (roleId == null) return null;
    const r = roles.find((x) => x.id === roleId);
    return r && Array.isArray(r.permissions) ? r.permissions : [];
  }, [roleId, roles]);

  const openCreate = () => {
    setEditing(null);
    setRole('user');
    setRoleId(null);
    setPerms(['dashboard', 'products']);
    form.resetFields();
    form.setFieldsValue({ role: 'user', status: 1, roleId: undefined });
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    setRole(row.role);
    setRoleId(row.roleId ?? null);
    setPerms(Array.isArray(row.permissions) ? row.permissions : []);
    form.resetFields();
    form.setFieldsValue({
      username: row.username,
      nickname: row.nickname,
      role: row.role,
      status: row.status,
      roleId: row.roleId ?? undefined,
      password: '',
    });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const payload: any = {
        username: values.username,
        nickname: values.nickname,
        role: values.role,
        status: values.status ? 1 : 0,
        permissions: perms,
        roleId: values.roleId ?? null,
      };
      if (values.password) payload.password = values.password;

      if (editing) {
        await http.patch(`/users/${editing.id}`, payload);
        message.success('已保存');
      } else {
        if (!values.password) {
          message.error('请设置初始密码');
          setSubmitting(false);
          return;
        }
        await http.post('/users', payload);
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

  const toggleStatus = async (row: any, next: boolean) => {
    try {
      await http.patch(`/users/${row.id}`, { status: next ? 1 : 0 });
      message.success(next ? '已启用' : '已停用');
      load();
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  const remove = async (row: any) => {
    try {
      await http.delete(`/users/${row.id}`);
      message.success('已删除');
      load();
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const resetPassword = async () => {
    if (!pwdValue || pwdValue.length < 6) {
      message.error('新密码至少 6 位');
      return;
    }
    try {
      await http.patch(`/users/${pwdTarget.id}/password`, { password: pwdValue });
      message.success('密码已重置');
      setPwdOpen(false);
      setPwdValue('');
    } catch (e: any) {
      message.error(e?.message || '重置失败');
    }
  };

  if (me && !canManageUsers(me)) {
    return (
      <Card>
        <Alert type="warning" showIcon message="当前账号没有员工管理权限，请联系超级管理员。" />
      </Card>
    );
  }

  const isSuper = role === 'super_admin';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <h1 className="page-title">员工账号</h1>
          <p className="page-sub">创建/停用员工账号，并为每个账号勾选可访问的页面</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增员工
        </Button>
      </div>

      <Card size="small">
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={users}
          pagination={false}
          columns={[
            { title: '登录名', dataIndex: 'username', width: 140 },
            {
              title: '昵称',
              dataIndex: 'nickname',
              width: 120,
              render: (v) => v || '—',
            },
            {
              title: '系统角色',
              dataIndex: 'role',
              width: 110,
              render: (v) => (
                <Tag color={v === 'super_admin' ? 'red' : v === 'admin' ? 'blue' : 'default'}>
                  {ROLE_TEXT[v] || v}
                </Tag>
              ),
            },
            {
              title: '岗位角色',
              dataIndex: 'roleName',
              width: 130,
              render: (v, row: any) =>
                row.role === 'super_admin' ? (
                  <Typography.Text type="secondary">—</Typography.Text>
                ) : v ? (
                  <Tag color="blue">{v}</Tag>
                ) : (
                  <Typography.Text type="secondary">未分配</Typography.Text>
                ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (v, row: any) => (
                <Switch
                  size="small"
                  checked={v === 1}
                  checkedChildren="启用"
                  unCheckedChildren="停用"
                  onChange={(next) => toggleStatus(row, next)}
                />
              ),
            },
            {
              title: '页面权限',
              dataIndex: 'permissions',
              render: (v, row: any) => {
                if (row.role === 'super_admin') return <Tag color="red">全部页面</Tag>;
                const list: string[] = Array.isArray(v) ? v : [];
                if (!list.length) return <Typography.Text type="secondary">未分配</Typography.Text>;
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
              title: '最后登录',
              dataIndex: 'lastLoginAt',
              width: 170,
              render: (v) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—'),
            },
            {
              title: '操作',
              width: 190,
              render: (_v, row: any) => (
                <Space size="small">
                  <Button type="link" size="small" onClick={() => openEdit(row)}>
                    编辑
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setPwdTarget(row);
                      setPwdValue('');
                      setPwdOpen(true);
                    }}
                  >
                    重置密码
                  </Button>
                  <Popconfirm title="确认删除该账号？" onConfirm={() => remove(row)} okText="删除" cancelText="取消">
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
        title={editing ? '编辑员工' : '新增员工'}
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={submitting}
        okText="保存"
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ role: 'user', status: 1 }}>
          <Form.Item name="username" label="登录名" rules={[{ required: true, message: '请输入登录名' }]}>
            <Input placeholder="用于登录，创建后建议不再改动" />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing ? '密码（留空表示不修改）' : '初始密码'}
            rules={editing ? [] : [{ required: true, message: '请设置初始密码' }]}
            extra={editing ? undefined : '至少 6 位'}
          >
            <Input.Password placeholder={editing ? '不修改请留空' : '至少 6 位'} />
          </Form.Item>
          <Form.Item name="nickname" label="昵称">
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select
              options={ROLE_OPTIONS}
              onChange={(v) => setRole(v)}
              disabled={!!editing && editing.id === me?.id}
            />
          </Form.Item>
          <Form.Item name="status" label="状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>

          <Form.Item
            name="roleId"
            label="岗位角色"
            extra="页面权限由所选角色决定；不选则可在下方直接勾选"
          >
            <Select
              allowClear
              placeholder="未分配（直接指定页面权限）"
              options={roles.map((r) => ({ value: r.id, label: r.name }))}
              onChange={(v) => setRoleId(v ?? null)}
            />
          </Form.Item>

          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 14, marginBottom: 6 }}>页面权限</div>
            {isSuper ? (
              <Alert type="info" showIcon message="超级管理员默认拥有全部页面权限，无需单独勾选。" />
            ) : roleId != null ? (
              <>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message="已由岗位角色决定，如需调整请到「系统管理 → 角色管理」修改该角色的权限。"
                />
                <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 12px' }}>
                  <Tree
                    checkable
                    selectable={false}
                    disabled
                    defaultExpandAll
                    treeData={permTree}
                    checkedKeys={selectedRolePerms || []}
                  />
                </div>
              </>
            ) : (
              <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 12px' }}>
                <Tree
                  checkable
                  selectable={false}
                  defaultExpandAll
                  treeData={permTree}
                  checkedKeys={perms}
                  onCheck={(checked) => {
                    const keys = (Array.isArray(checked) ? checked : checked.checked) as string[];
                    // 过滤掉分组节点（g:xxx），只保留真实页面 key
                    setPerms(keys.filter((k) => !String(k).startsWith(GROUP_PREFIX)));
                  }}
                />
              </div>
            )}
          </div>
        </Form>
      </Modal>

      <Modal
        title={`重置密码 · ${pwdTarget?.username || ''}`}
        open={pwdOpen}
        onOk={resetPassword}
        onCancel={() => setPwdOpen(false)}
        okText="确认重置"
      >
        <Input.Password
          placeholder="输入新密码（至少 6 位）"
          value={pwdValue}
          onChange={(e) => setPwdValue(e.target.value)}
        />
      </Modal>
    </div>
  );
}
