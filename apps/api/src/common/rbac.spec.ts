import { ROLE_PERMISSIONS, resolveElevatedRole, roleHasPermission } from './rbac';

describe('roleHasPermission', () => {
  it('grants SUPER_ADMIN every defined permission', () => {
    for (const p of ROLE_PERMISSIONS.SUPER_ADMIN) {
      expect(roleHasPermission('SUPER_ADMIN', p)).toBe(true);
    }
  });

  it('denies MEMBER all admin/billing permissions', () => {
    expect(roleHasPermission('MEMBER', 'billing:refund')).toBe(false);
    expect(roleHasPermission('MEMBER', 'admin:audit-logs')).toBe(false);
  });

  it('gives OWNER read-side billing but never refunds or wallet adjustment', () => {
    expect(roleHasPermission('OWNER', 'billing:view')).toBe(true);
    expect(roleHasPermission('OWNER', 'billing:refund')).toBe(false);
    expect(roleHasPermission('OWNER', 'wallet:adjust')).toBe(false);
  });
});

describe('resolveElevatedRole', () => {
  const env = {
    superAdmins: 'admin1@test.example, admin2@test.example',
    owners: 'owner1@test.example,owner2@test.example',
  };

  it('resolves super admins from the env list', () => {
    expect(resolveElevatedRole('admin1@test.example', env)).toBe('SUPER_ADMIN');
    expect(resolveElevatedRole('admin2@test.example', env)).toBe('SUPER_ADMIN');
  });

  it('resolves owners from the env list', () => {
    expect(resolveElevatedRole('owner1@test.example', env)).toBe('OWNER');
    expect(resolveElevatedRole('owner2@test.example', env)).toBe('OWNER');
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(resolveElevatedRole('  Admin1@Test.Example ', env)).toBe('SUPER_ADMIN');
  });

  it('super-admin list wins when an email is in both lists', () => {
    expect(resolveElevatedRole('x@y.com', { superAdmins: 'x@y.com', owners: 'x@y.com' })).toBe('SUPER_ADMIN');
  });

  it('returns null for unknown emails and empty config', () => {
    expect(resolveElevatedRole('random@user.com', env)).toBeNull();
    expect(resolveElevatedRole('random@user.com', {})).toBeNull();
  });
});
