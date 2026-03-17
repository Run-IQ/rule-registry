import { DefaultPermissionChecker, ROLE_PERMISSIONS } from '../../src/PermissionChecker.js';
import { PermissionDeniedError } from '../../src/errors.js';

describe('DefaultPermissionChecker', () => {
  let checker: DefaultPermissionChecker;

  beforeEach(() => {
    checker = new DefaultPermissionChecker();
  });

  it('viewer can only rule:read', () => {
    expect(ROLE_PERMISSIONS['viewer']).toEqual(['rule:read']);
  });

  it('editor can create, update, submit, read', async () => {
    checker.grantRole('alice', 't1', 'editor');
    expect(await checker.hasPermission('alice', 't1', 'rule:create')).toBe(true);
    expect(await checker.hasPermission('alice', 't1', 'rule:update')).toBe(true);
    expect(await checker.hasPermission('alice', 't1', 'rule:submit')).toBe(true);
    expect(await checker.hasPermission('alice', 't1', 'rule:read')).toBe(true);
    expect(await checker.hasPermission('alice', 't1', 'rule:approve')).toBe(false);
  });

  it('reviewer adds review, approve, audit', async () => {
    checker.grantRole('bob', 't1', 'reviewer');
    expect(await checker.hasPermission('bob', 't1', 'rule:review')).toBe(true);
    expect(await checker.hasPermission('bob', 't1', 'rule:approve')).toBe(true);
    expect(await checker.hasPermission('bob', 't1', 'rule:audit')).toBe(true);
    expect(await checker.hasPermission('bob', 't1', 'rule:deprecate')).toBe(false);
  });

  it('admin adds deprecate, archive', async () => {
    checker.grantRole('admin', 't1', 'admin');
    expect(await checker.hasPermission('admin', 't1', 'rule:deprecate')).toBe(true);
    expect(await checker.hasPermission('admin', 't1', 'rule:archive')).toBe(true);
    expect(await checker.hasPermission('admin', 't1', 'rule:emergency_rollback')).toBe(false);
  });

  it('super-admin has emergency_rollback', async () => {
    checker.grantRole('super', 't1', 'super-admin');
    expect(await checker.hasPermission('super', 't1', 'rule:emergency_rollback')).toBe(true);
  });

  it('check() throws PermissionDeniedError when missing', async () => {
    checker.grantRole('alice', 't1', 'viewer');
    await expect(checker.check('alice', 't1', 'rule:create')).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it('check() passes when permission present', async () => {
    checker.grantRole('alice', 't1', 'editor');
    await expect(checker.check('alice', 't1', 'rule:create')).resolves.toBeUndefined();
  });

  it('actor without any grant returns false', async () => {
    expect(await checker.hasPermission('nobody', 't1', 'rule:read')).toBe(false);
  });

  it('grants for different tenants are isolated', async () => {
    checker.grantRole('alice', 't1', 'admin');
    checker.grantRole('alice', 't2', 'viewer');
    expect(await checker.hasPermission('alice', 't1', 'rule:deprecate')).toBe(true);
    expect(await checker.hasPermission('alice', 't2', 'rule:deprecate')).toBe(false);
  });

  it('ROLE_PERMISSIONS has all 5 roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS)).toHaveLength(5);
  });
});
