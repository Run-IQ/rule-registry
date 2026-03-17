import { InMemoryRuleStore } from '@run-iq/context-engine';
import { RuleRegistry } from '../../src/RuleRegistry.js';
import { DefaultPermissionChecker } from '../../src/PermissionChecker.js';

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

describe('Integration: Conflict warnings', () => {
  it('warning conflicts returned with submission', async () => {
    const { registry } = setup();
    const r1 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        priority: 10,
        payload: JSON.stringify({ model: 'TAX', v: 1 }),
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
        priority: 5,
        payload: JSON.stringify({ model: 'TAX', v: 2 }),
        createdBy: 'alice',
      },
      'alice',
    );

    const { conflicts } = await registry.rules.submitForReview(r2.id, r2.version, 'alice');
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('reviewer can approve despite warnings', async () => {
    const { registry } = setup();
    const r1 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        priority: 10,
        payload: JSON.stringify({ model: 'TAX', v: 1 }),
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
        priority: 5,
        payload: JSON.stringify({ model: 'TAX', v: 2 }),
        createdBy: 'alice',
      },
      'alice',
    );
    await registry.rules.submitForReview(r2.id, r2.version, 'alice');

    const { published } = await registry.rules.approve(r2.id, r2.version, 'bob');
    expect(published.status).toBe('published');
  });

  it('conflict_acknowledged audit logged on approve with warnings', async () => {
    const { registry, store } = setup();
    const r1 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        priority: 10,
        payload: JSON.stringify({ model: 'TAX', v: 1 }),
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
        priority: 5,
        payload: JSON.stringify({ model: 'TAX', v: 2 }),
        createdBy: 'alice',
      },
      'alice',
    );
    await registry.rules.submitForReview(r2.id, r2.version, 'alice');
    await registry.rules.approve(r2.id, r2.version, 'bob');

    const trail = await store.getAuditTrail(r2.id);
    expect(trail.some((e) => e.type === 'rule.conflict_acknowledged')).toBe(true);
  });

  it('same_priority conflict detected', async () => {
    const { registry } = setup();
    const r1 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        priority: 5,
        payload: JSON.stringify({ model: 'TAX', v: 1 }),
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
        priority: 5,
        payload: JSON.stringify({ model: 'TAX', v: 2 }),
        createdBy: 'alice',
      },
      'alice',
    );

    const { conflicts } = await registry.rules.submitForReview(r2.id, r2.version, 'alice');
    expect(conflicts.some((c) => c.conflictType === 'same_priority')).toBe(true);
  });
});
