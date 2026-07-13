import type { UserRole } from '@prisma/client';

/**
 * RBAC (billing spec §9.2): roles are compositions of explicit permission
 * strings — endpoints check permissions, never emails or role names.
 * Elevated identities come from SUPER_ADMIN_EMAILS / OWNER_EMAILS env config,
 * never from source code.
 */

export type Permission =
  | 'billing:view'
  | 'billing:refund'
  | 'wallet:adjust'
  | 'admin:users'
  | 'admin:audit-logs'
  | 'admin:revenue'
  | 'admin:providers'
  | 'admin:pricing'
  | 'admin:trial'
  | 'admin:jobs'
  | 'admin:flags';

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlyArray<Permission>> = {
  SUPER_ADMIN: ['billing:view', 'billing:refund', 'wallet:adjust', 'admin:users', 'admin:audit-logs', 'admin:revenue', 'admin:providers', 'admin:pricing', 'admin:trial', 'admin:jobs', 'admin:flags'],
  OWNER: ['billing:view', 'admin:revenue', 'admin:providers'],
  MEMBER: [],
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

function parseEmailList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Resolve a user's effective role from the env allow-lists (§9.2/§9.9:
 * "Super Admin emails configurable via env var … never hardcoded in source").
 * Returns null when the env config grants nothing — the stored role stands.
 */
export function resolveElevatedRole(
  email: string,
  env: { superAdmins?: string; owners?: string } = {
    superAdmins: process.env['SUPER_ADMIN_EMAILS'],
    owners: process.env['OWNER_EMAILS'],
  },
): Extract<UserRole, 'SUPER_ADMIN' | 'OWNER'> | null {
  const normalized = email.trim().toLowerCase();
  if (parseEmailList(env.superAdmins).has(normalized)) return 'SUPER_ADMIN';
  if (parseEmailList(env.owners).has(normalized)) return 'OWNER';
  return null;
}
