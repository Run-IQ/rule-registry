import { InMemoryRuleStore } from '@run-iq/context-engine';
import { RuleRegistry } from '../../src/RuleRegistry.js';
import { DefaultPermissionChecker } from '../../src/PermissionChecker.js';
import { RuleConflictBlockerError } from '../../src/errors.js';

function setup() {
  const store = new InMemoryRuleStore();
  const permissions = new DefaultPermissionChecker();
  permissions.grantRole('alice', 'tenant-1', 'editor');
  permissions.grantRole('bob', 'tenant-1', 'reviewer');
  return {
    registry: new RuleRegistry({ store, permissions, clock: () => '2025-06-15T12:00:00.000Z' }),
    store,
  };
}

const payload = JSON.stringify({ model: 'TAX', id: 't1', version: 1, params: {} });

describe('Integration: Conflict blocking', () => {
  it('critical conflict blocks submission', async () => {
    const { registry } = setup();
    // Publish first rule
    const r1 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload,
        createdBy: 'alice',
      },
      'alice',
    );
    await registry.rules.submitForReview(r1.id, r1.version, 'alice');
    await registry.rules.approve(r1.id, r1.version, 'bob');

    // Create duplicate (same payload = duplicate_checksum = critical)
    const r2 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload,
        createdBy: 'alice',
      },
      'alice',
    );

    await expect(registry.rules.submitForReview(r2.id, r2.version, 'alice')).rejects.toThrow(
      RuleConflictBlockerError,
    );
  });

  it('conflict audit event recorded when blocked', async () => {
    const { registry, store } = setup();
    const r1 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload,
        createdBy: 'alice',
      },
      'alice',
    );
    await registry.rules.submitForReview(r1.id, r1.version, 'alice');
    await registry.rules.approve(r1.id, r1.version, 'bob');

    const r2 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload,
        createdBy: 'alice',
      },
      'alice',
    );

    try {
      await registry.rules.submitForReview(r2.id, r2.version, 'alice');
    } catch {
      // expected
    }

    const trail = await store.getAuditTrail(r2.id);
    expect(trail.some((e) => e.type === 'rule.conflict_detected')).toBe(true);
  });

  it('RuleConflictBlockerError carries conflicts array', async () => {
    const { registry } = setup();
    const r1 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload,
        createdBy: 'alice',
      },
      'alice',
    );
    await registry.rules.submitForReview(r1.id, r1.version, 'alice');
    await registry.rules.approve(r1.id, r1.version, 'bob');

    const r2 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload,
        createdBy: 'alice',
      },
      'alice',
    );

    try {
      await registry.rules.submitForReview(r2.id, r2.version, 'alice');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RuleConflictBlockerError);
      expect((err as RuleConflictBlockerError).conflicts.length).toBeGreaterThan(0);
    }
  });

  it('different payload is not a critical conflict', async () => {
    const { registry } = setup();
    const r1 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload,
        createdBy: 'alice',
      },
      'alice',
    );
    await registry.rules.submitForReview(r1.id, r1.version, 'alice');
    await registry.rules.approve(r1.id, r1.version, 'bob');

    const r2 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload: JSON.stringify({ model: 'TAX', id: 't2', params: {} }),
        createdBy: 'alice',
      },
      'alice',
    );

    // Should not throw — only warning-level conflict
    const { conflicts } = await registry.rules.submitForReview(r2.id, r2.version, 'alice');
    expect(conflicts.every((c) => c.severity === 'warning')).toBe(true);
  });
});
