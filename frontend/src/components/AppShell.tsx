'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Avatar, Button, Form, Input, Layout, Menu, Modal, Space, Tag, message } from 'antd';
import {
  AppstoreOutlined,
  CalculatorOutlined,
  CloudDownloadOutlined,
  DashboardOutlined,
  FilterOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { http } from '@/lib/api';

const { Header, Sider, Content } = Layout;

const MENUS = [
  { key: '/', icon: <DashboardOutlined />, label: '数据概览' },
  { key: '/collect', icon: <CloudDownloadOutlined />, label: '数据采集' },
  { key: '/products', icon: <AppstoreOutlined />, label: '商品库' },
  { key: '/screening', icon: <FilterOutlined />, label: '智能筛选' },
  {
    key: 'pricing-group',
    icon: <CalculatorOutlined />,
    label: '定价',
    children: [
      { key: '/pricing', label: '定价工作台' },
      { key: '/pricing/records', label: '定价记录' },
    ],
  },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [openKeys, setOpenKeys] = useState<string[]>(pathname.startsWith('/pricing') ? ['pricing-group'] : []);
  const [user, setUser] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('ds_user') : null;
    if (raw) {
      try {
        setUser(JSON.parse(raw));
      } catch (e) {
        /* ignore */
      }
    }
  }, []);

  // 进入定价分组下的任意路由时，自动展开该子菜单
  useEffect(() => {
    if (pathname.startsWith('/pricing')) {
      setOpenKeys((k) => (k.includes('pricing-group') ? k : [...k, 'pricing-group']));
    }
  }, [pathname]);

  const login = async () => {
    const values = await form.validateFields();
    setLoading(true);
    try {
      const { data } = await http.post('/auth/login', values);
      localStorage.setItem('ds_token', data.accessToken);
      localStorage.setItem('ds_user', JSON.stringify(data.user));
      setUser(data.user);
      setOpen(false);
      message.success('登录成功');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('ds_token');
    localStorage.removeItem('ds_user');
    setUser(null);
    message.success('已退出');
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light" width={208} style={{ borderRight: '1px solid #f0f0f0' }}>
        <div style={{ padding: '18px 20px 14px' }}>
          <div style={{ fontSize: 16, fontWeight: 500 }}>电商选品分析</div>
          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>Ozon Selection</div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[pathname]}
          openKeys={openKeys}
          onOpenChange={setOpenKeys}
          items={MENUS}
          style={{ borderInlineEnd: 'none' }}
          onClick={(e) => {
            if (e.key.startsWith('/')) router.push(e.key);
          }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            height: 56,
          }}
        >
          {user ? (
            <Space>
              <Tag color="blue">{user.role === 'admin' ? '管理员' : '用户'}</Tag>
              <Avatar size="small" icon={<UserOutlined />} />
              <span style={{ fontSize: 13 }}>{user.nickname || user.username}</span>
              <Button type="link" size="small" onClick={logout}>
                退出
              </Button>
            </Space>
          ) : (
            <Button type="primary" size="small" onClick={() => setOpen(true)}>
              登录
            </Button>
          )}
        </Header>
        <Content style={{ padding: 20 }}>{children}</Content>
      </Layout>

      <Modal title="登录" open={open} onOk={login} onCancel={() => setOpen(false)} confirmLoading={loading} okText="登录">
        <Form form={form} layout="vertical" initialValues={{ username: 'admin', password: 'admin123' }}>
          <Form.Item name="username" label="登录名" rules={[{ required: true, message: '请输入登录名' }]}>
            <Input placeholder="请输入" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="请输入" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
