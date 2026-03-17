import { PermissionDeniedError } from './errors.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Permission =
  | 'rule:create'
  | 'rule:update'
  | 'rule:submit'
  | 'rule:review'
  | 'rule:approve'
  | 'rule:deprecate'
  | 'rule:archive'
  | 'rule:emergency_rollback'
  | 'rule:read'
  | 'rule:audit';

export type UserRole = 'viewer' | 'editor' | 'reviewer' | 'admin' | 'super-admin';

export interface PermissionChecker {
  check(actor: string, tenantId: string, permission: Permission): Promise<void>;
  hasPermission(actor: string, tenantId: string, permission: Permission): Promise<boolean>;
}

// ─── Role → Permission mapping ───────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  viewer: ['rule:read'],
  editor: ['rule:read', 'rule:create', 'rule:update', 'rule:submit'],
  reviewer: [
    'rule:read',
    'rule:create',
    'rule:update',
    'rule:submit',
    'rule:review',
    'rule:approve',
    'rule:audit',
  ],
  admin: [
    'rule:read',
    'rule:create',
    'rule:update',
    'rule:submit',
    'rule:review',
    'rule:approve',
    'rule:deprecate',
    'rule:archive',
    'rule:audit',
  ],
  'super-admin': [
    'rule:read',
    'rule:create',
    'rule:update',
    'rule:submit',
    'rule:review',
    'rule:approve',
    'rule:deprecate',
    'rule:archive',
    'rule:audit',
    'rule:emergency_rollback',
  ],
};

// ─── Default implementation ──────────────────────────────────────────────────

export class DefaultPermissionChecker implements PermissionChecker {
  private readonly roles: Map<string, Set<Permission>> = new Map();

  grantRole(actor: string, tenantId: string, role: UserRole): void {
    const key = `${actor}:${tenantId}`;
    const perms = ROLE_PERMISSIONS[role];
    this.roles.set(key, new Set(perms));
  }

  async check(actor: string, tenantId: string, permission: Permission): Promise<void> {
    const has = await this.hasPermission(actor, tenantId, permission);
    if (!has) throw new PermissionDeniedError(actor, tenantId, permission);
  }

  async hasPermission(actor: string, tenantId: string, permission: Permission): Promise<boolean> {
    return this.roles.get(`${actor}:${tenantId}`)?.has(permission) ?? false;
  }
}
