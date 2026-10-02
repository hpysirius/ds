'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Avatar, Button, Layout, Menu, Result, Space, Tag, message } from 'antd';
import {
  AppstoreOutlined,
  CalculatorOutlined,
  CloudDownloadOutlined,
  DashboardOutlined,
  FilterOutlined,
  ReadOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { http } from '@/lib/api';
import {
  ROLE_TEXT,
  ROUTE_PERMISSION,
  canAccess,
  canManageUsers,
  firstAllowedPath,
  isSuperAdmin,
  userPermissions,
} from '@/lib/permissions';
import { StoreProvider, useStore, STORAGE_KEY } from '@/lib/store-context';
import { Select } from 'antd';
import { ShopOutlined } from '@ant-design/icons';

const { Header, Sider, Content } = Layout;

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
      加载中…
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  // null = 仍在检测登录态；true/false = 已确定
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  // 初始化：有 token 就向后端校验一次，并拉最新用户信息（含页面权限）
  useEffect(() => {
    const token = localStorage.getItem('ds_token');
    if (!token) {
      setUser(null);
      setAuthed(false);
      return;
    }
    let cancelled = false;
    http
      .get('/auth/profile')
      .then(({ data }) => {
        if (cancelled) return;
        setUser(data);
        localStorage.setItem('ds_user', JSON.stringify(data));
        setAuthed(true);
      })
      .catch(() => {
        if (cancelled) return;
        // token 失效/账号被禁用：清掉本地登录态，交给下面的守卫跳登录页
        localStorage.removeItem('ds_token');
        localStorage.removeItem('ds_user');
        setUser(null);
        setAuthed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 进入某个分组下的路由时，自动展开对应子菜单
  useEffect(() => {
    const group = pathname.startsWith('/pricing')
      ? 'pricing-group'
      : pathname.startsWith('/system')
        ? 'system-group'
        : null;
    if (group) setOpenKeys((k) => (k.includes(group) ? k : [...k, group]));
  }, [pathname]);

  // 路由守卫：① 未登录跳登录页 ② 已登录访问登录页回首页 ③ 无页面权限跳到第一个有权页面
  useEffect(() => {
    if (authed === null) return;

    if (!authed) {
      if (pathname !== '/login') {
        const target = window.location.pathname + window.location.search;
        router.replace('/login?redirect=' + encodeURIComponent(target));
      }
      return;
    }

    if (pathname === '/login') {
      router.replace('/');
      return;
    }

    const need = ROUTE_PERMISSION[pathname];
    if (need && !canAccess(user, need)) {
      const first = firstAllowedPath(user);
      if (first && first !== pathname) router.replace(first);
    }
  }, [authed, user, pathname, router]);

  // 菜单按当前账号的权限动态生成
  const menus = useMemo(() => {
    const perms = userPermissions(user);
    const items: any[] = [];

    const add = (path: string, label: string, icon: React.ReactNode) => {
      const key = ROUTE_PERMISSION[path];
      if (key && !perms.includes(key)) return;
      items.push({ key: path, icon, label });
    };

    add('/', '数据概览', <DashboardOutlined />);
    add('/collect', '数据采集', <CloudDownloadOutlined />);
    add('/products', '商品库', <AppstoreOutlined />);
    add('/screening', '智能筛选', <FilterOutlined />);

    const pricingChildren: any[] = [];
    if (perms.includes('pricing')) pricingChildren.push({ key: '/pricing', label: '定价工作台' });
    if (perms.includes('pricing_records')) pricingChildren.push({ key: '/pricing/records', label: '定价记录' });
    if (pricingChildren.length) {
      items.push({ key: 'pricing-group', icon: <CalculatorOutlined />, label: '定价', children: pricingChildren });
    }

    if (canManageUsers(user)) {
      const systemChildren: any[] = [
        { key: '/system/users', label: '员工账号' },
        { key: '/system/roles', label: '角色管理' },
      ];
      if (isSuperAdmin(user)) {
        systemChildren.push({ key: '/system/stores', label: '店铺管理' });
      }
      items.push({
        key: 'system-group',
        icon: <SettingOutlined />,
        label: '系统管理',
        children: systemChildren,
      });
    }

    // 使用说明：面向所有登录用户，不纳入权限体系（没在 ROUTE_PERMISSION 里 → 不做页面校验）
    items.push({ key: '/guide', icon: <ReadOutlined />, label: '使用说明' });

    return items;
  }, [user]);

  const logout = () => {
    localStorage.removeItem('ds_token');
    localStorage.removeItem('ds_user');
    // 也要清店铺选择，否则换账号登录后会沿用上一个人选的店铺
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setAuthed(false);
    message.success('已退出');
  };

  // 检测中：先不渲染，避免内容闪烁
  if (authed === null) return <FullScreenLoading />;

  // 登录页：不渲染后台布局，直接展示登录页自身
  if (pathname === '/login') return <>{children}</>;

  // 未登录（守卫已触发跳转）
  if (!authed) return <FullScreenLoading />;

  // 当前页面没权限，且没有任何可跳转的页面：提示无权限
  const need = ROUTE_PERMISSION[pathname];
  if (need && !canAccess(user, need)) {
    return (
      <Result
        status="403"
        title="无访问权限"
        subTitle="当前账号没有被授权访问这个页面，请联系超级管理员开通。"
        extra={
          <Button type="primary" onClick={logout}>
            切换账号
          </Button>
        }
        style={{ minHeight: '100vh', paddingTop: 80 }}
      />
    );
  }

  return (
    <StoreProvider user={user}>
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
            items={menus}
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
              justifyContent: 'space-between',
              height: 56,
              // antd Layout.Header 默认 line-height: 64px，会被子元素继承；
              // 行内元素的基线对齐会被这个超大的行高放大，导致图标/标签错位，这里重置掉
              lineHeight: 'normal',
              gap: 12,
            }}
          >
            <StoreSwitcher user={user} />
            {user ? (
              <Space>
                <Tag color={user.role === 'super_admin' ? 'red' : user.role === 'admin' ? 'blue' : 'default'}>
                  {ROLE_TEXT[user.role] || '用户'}
                </Tag>
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
    </StoreProvider>
  );
}

/**
 * 顶部左侧「店铺」区域：
 * - 超级管理员：可切换的店铺选择器（全部店铺 / 具体店铺）；
 * - 普通员工：只读展示其所属店铺（员工锁定本店，不能切换），保证左侧不再空白。
 *
 * 对齐说明：图标（anticon）自带 `vertical-align: -0.125em`，且其基线取自身底边；
 * 而 Tag 的基线取内部文字基线。两者若放在行内流里按基线对齐，图标会高出约 2px，
 * 看起来就是「图标没和店名对齐」。所以这里统一用 flex + align-items:center，
 * 并把图标的 display 设为 block（脱离行内基线体系），保证图标与店名严格垂直居中。
 */
function StoreSwitcher({ user }: { user: any }) {
  const { isSuper, stores, loading, currentStoreId, setCurrentStoreId } = useStore();

  const iconStyle: React.CSSProperties = { display: 'block', color: '#8c8c8c' };

  // 员工：左只读显示所属店铺，右侧仍是用户信息
  if (!isSuper) {
    const name = user?.storeName;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ShopOutlined style={iconStyle} />
        {name ? (
          <Tag
            color="blue"
            style={{ margin: 0, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}
            title="你所属的店铺；如需变更请联系超级管理员"
          >
            {name}
          </Tag>
        ) : (
          <span
            style={{ fontSize: 13, color: '#bfbfbf', lineHeight: '20px' }}
            title="当前账号还未分配店铺，请联系超级管理员"
          >
            未分配店铺
          </span>
        )}
      </div>
    );
  }

  const options = [
    { value: 'all', label: '全部店铺' },
    ...stores.map((s) => ({ value: String(s.id), label: s.name })),
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <ShopOutlined style={iconStyle} />
      <Select
        size="small"
        style={{ width: 180 }}
        loading={loading}
        value={currentStoreId == null ? 'all' : String(currentStoreId)}
        options={options}
        onChange={(v: string) => setCurrentStoreId(v === 'all' ? null : Number(v))}
        placeholder="选择店铺"
      />
    </div>
  );
}
