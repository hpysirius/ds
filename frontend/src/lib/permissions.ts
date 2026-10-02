/**
 * 页面权限目录（与后端 common/constants/permissions.ts 保持一致）。
 *
 * key：权限标识；path：对应前端路由；group：管理页里分组展示用。
 * 超级管理员(super_admin)恒等于全部权限；其它角色按账号上分配的 permissions 列表。
 */

export const SUPER_ADMIN_ROLE = 'super_admin';
export const ADMIN_ROLE = 'admin';

export interface PermissionOption {
  key: string;
  label: string;
  path: string;
  group: string;
}

export const PERMISSIONS: PermissionOption[] = [
  { key: 'dashboard', label: '数据概览', path: '/', group: '选品分析' },
  { key: 'collect', label: '数据采集', path: '/collect', group: '选品分析' },
  { key: 'products', label: '商品库', path: '/products', group: '选品分析' },
  { key: 'screening', label: '智能筛选', path: '/screening', group: '选品分析' },
  { key: 'pricing', label: '定价工作台', path: '/pricing', group: '定价' },
  { key: 'pricing_records', label: '定价记录', path: '/pricing/records', group: '定价' },
  { key: 'system_users', label: '员工账号管理', path: '/system/users', group: '系统' },
  { key: 'system_roles', label: '角色管理', path: '/system/roles', group: '系统' },
  { key: 'system_stores', label: '店铺管理', path: '/system/stores', group: '系统' },
];

/** 路由 → 权限 key（路由守卫用） */
export const ROUTE_PERMISSION: Record<string, string> = PERMISSIONS.reduce(
  (acc, p) => {
    acc[p.path] = p.key;
    return acc;
  },
  {} as Record<string, string>,
);

export const ROLE_TEXT: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '管理员',
  user: '员工',
};

/** 是否超级管理员 */
export function isSuperAdmin(user: any): boolean {
  return user?.role === SUPER_ADMIN_ROLE;
}

/** 是否能管理员工账号（后端 /users 接口也按这两个角色放行） */
export function canManageUsers(user: any): boolean {
  return user?.role === SUPER_ADMIN_ROLE || user?.role === ADMIN_ROLE;
}

/** 该账号实际拥有的权限 key 列表 */
export function userPermissions(user: any): string[] {
  if (!user) return [];
  if (user.role === SUPER_ADMIN_ROLE) return PERMISSIONS.map((p) => p.key);
  const list: string[] = Array.isArray(user.permissions) ? [...user.permissions] : [];
  // 管理员默认拥有系统管理能力（与后端 @Roles('super_admin','admin') 对齐）
  if (user.role === ADMIN_ROLE) {
    ['system_users', 'system_roles'].forEach((k) => {
      if (!list.includes(k)) list.push(k);
    });
  }
  return list;
}

/** 是否能访问某个权限 key 对应的页面 */
export function canAccess(user: any, key: string): boolean {
  return userPermissions(user).includes(key);
}

/** 第一个有权访问的页面路由（无权限时兜底跳转用） */
export function firstAllowedPath(user: any): string | null {
  const perms = userPermissions(user);
  const hit = PERMISSIONS.find((p) => perms.includes(p.key));
  return hit ? hit.path : null;
}
