'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Avatar, Button, Layout, Menu, Space, Tag, message } from 'antd';
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

function FullScreenLoading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#999',
        fontSize: 14,
      }}
    >
      正在跳转登录…
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [openKeys, setOpenKeys] = useState<string[]>(pathname.startsWith('/pricing') ? ['pricing-group'] : []);
  const [user, setUser] = useState<any>(null);
  // null = 仍在检测登录态；true/false = 已确定
  const [authed, setAuthed] = useState<boolean | null>(null);

  // 初始化：读取本地登录态
  useEffect(() => {
    const token = localStorage.getItem('ds_token');
    const rawUser = localStorage.getItem('ds_user');
    if (token) {
      setAuthed(true);
      if (rawUser) {
        try {
          setUser(JSON.parse(rawUser));
        } catch (e) {
          /* ignore */
        }
      }
    } else {
      setAuthed(false);
    }
  }, []);

  // 路由守卫：未登录强制跳登录页；已登录访问登录页则回首页
  useEffect(() => {
    if (authed === null) return;
    if (!authed && pathname !== '/login') {
      const target = window.location.pathname + window.location.search;
      router.replace('/login?redirect=' + encodeURIComponent(target));
    } else if (authed && pathname === '/login') {
      router.replace('/');
    }
  }, [authed, pathname, router]);

  const logout = () => {
    localStorage.removeItem('ds_token');
    localStorage.removeItem('ds_user');
    setUser(null);
    setAuthed(false);
    message.success('已退出');
  };

  // 检测中：先不渲染任何内容，避免闪烁
  if (authed === null) return <FullScreenLoading />;

  // 登录页：不渲染后台布局，直接展示登录页自身
  if (pathname === '/login') return <>{children}</>;

  // 未登录（守卫已触发跳转）：占位，避免内容短暂泄露
  if (!authed) return <FullScreenLoading />;

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
            <Button type="primary" size="small" onClick={() => router.push('/login')}>
              登录
            </Button>
          )}
        </Header>
        <Content style={{ padding: 20 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
