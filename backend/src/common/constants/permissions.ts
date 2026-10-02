/**
 * 页面权限目录。
 *
 * key 与前端路由一一对应（前端用同一套 key 渲染菜单、做路由守卫）。
 * 后端只负责校验「存的 key 是否合法」+ 把登录态里的权限透传给前端。
 */

export const SUPER_ADMIN_ROLE = 'super_admin';
export const ADMIN_ROLE = 'admin';

/** 拥有员工账号与权限管理能力的角色 */
export const USER_MANAGE_ROLES = [SUPER_ADMIN_ROLE, ADMIN_ROLE];

export interface PermissionOption {
  key: string;
  label: string;
  /** 所属分组，方便前端/管理页归类展示 */
  group: string;
}

export const PERMISSIONS: PermissionOption[] = [
  { key: 'dashboard', label: '数据概览', group: '选品分析' },
  { key: 'collect', label: '数据采集', group: '选品分析' },
  { key: 'products', label: '商品库', group: '选品分析' },
  { key: 'screening', label: '智能筛选', group: '选品分析' },
  { key: 'pricing', label: '定价工作台', group: '定价' },
  { key: 'pricing_records', label: '定价记录', group: '定价' },
  { key: 'system_users', label: '员工账号管理', group: '系统' },
  { key: 'system_roles', label: '角色管理', group: '系统' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/** 数据库里存的 permissions 列是 JSON 字符串，这里解析回数组 */
export function parsePermissions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && PERMISSION_KEYS.includes(x)) : [];
  } catch (e) {
    return [];
  }
}

/** 写库前把权限数组序列化，并过滤掉非法 key */
export function serializePermissions(list: unknown): string | null {
  if (!Array.isArray(list)) return null;
  const valid = list.filter((x) => typeof x === 'string' && PERMISSION_KEYS.includes(x));
  return JSON.stringify(valid);
}

/**
 * 计算一个账号「最终生效」的页面权限，优先级：
 *   1. 超级管理员 → 全部页面
 *   2. 分配了角色 → 角色的权限
 *   3. 都没有     → 账号自己的 permissions（兜底，老数据/未分配角色场景）
 *
 * 传入的 user 需要带 roleRef（Prisma include roleRef 才会解析到第 2 级）。
 */
export function resolvePermissions(user: any): string[] {
  if (!user) return [];
  if (user.role === SUPER_ADMIN_ROLE) return [...PERMISSION_KEYS];
  if (user.roleRef) return parsePermissions(user.roleRef.permissions);
  return parsePermissions(user.permissions);
}
