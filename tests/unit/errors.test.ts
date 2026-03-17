import {
  RegistryError,
  RuleValidationError,
  RuleConflictBlockerError,
  PermissionDeniedError,
  RulePermissionError,
  RulePayloadError,
  RuleSandboxError,
  RegionNotFoundError,
} from '../../src/errors.js';

describe('Error hierarchy', () => {
  it('RegistryError extends Error with correct name', () => {
    const err = new RegistryError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('RegistryError');
    expect(err.message).toBe('test');
  });

  it('RuleValidationError carries errors array', () => {
    const items = [{ field: 'model', message: 'required', code: 'MISSING' }];
    const err = new RuleValidationError('validation failed', items);
    expect(err).toBeInstanceOf(RegistryError);
    expect(err.name).toBe('RuleValidationError');
    expect(err.errors).toEqual(items);
  });

  it('RuleConflictBlockerError carries conflicts array', () => {
    const conflicts = [
      {
        existingRuleId: 'r1',
        existingVersion: 1,
        existingStatus: 'published' as const,
        overlapFrom: '2025-01-01',
        conflictType: 'duplicate_checksum' as const,
        severity: 'critical' as const,
        description: 'dup',
      },
    ];
    const err = new RuleConflictBlockerError('blocked', conflicts);
    expect(err).toBeInstanceOf(RegistryError);
    expect(err.conflicts).toHaveLength(1);
  });

  it('PermissionDeniedError has actor, tenantId, action', () => {
    const err = new PermissionDeniedError('alice', 'tenant-1', 'rule:create');
    expect(err).toBeInstanceOf(RegistryError);
    expect(err.actor).toBe('alice');
    expect(err.tenantId).toBe('tenant-1');
    expect(err.action).toBe('rule:create');
    expect(err.message).toContain('alice');
  });

  it('RulePermissionError extends RegistryError', () => {
    const err = new RulePermissionError('cannot review own rule');
    expect(err).toBeInstanceOf(RegistryError);
    expect(err.name).toBe('RulePermissionError');
  });

  it('RulePayloadError extends RegistryError', () => {
    const err = new RulePayloadError('bad payload');
    expect(err).toBeInstanceOf(RegistryError);
    expect(err.name).toBe('RulePayloadError');
  });

  it('RuleSandboxError extends RegistryError', () => {
    const err = new RuleSandboxError('sandbox failed');
    expect(err).toBeInstanceOf(RegistryError);
    expect(err.name).toBe('RuleSandboxError');
  });

  it('RegionNotFoundError extends RegistryError', () => {
    const err = new RegionNotFoundError('UNKNOWN not found');
    expect(err).toBeInstanceOf(RegistryError);
    expect(err.name).toBe('RegionNotFoundError');
  });
});
