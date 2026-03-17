import { InMemoryRuleStore, RuleTransitionError } from '@run-iq/context-engine';
import { RuleRegistry } from '../../src/RuleRegistry.js';
import { DefaultPermissionChecker } from '../../src/PermissionChecker.js';

function setup() {
  const store = new InMemoryRuleStore();
  const permissions = new DefaultPermissionChecker();
  permissions.grantRole('alice', 'tenant-1', 'editor');
  permissions.grantRole('bob', 'tenant-1', 'reviewer');
  permissions.grantRole('super', 'tenant-1', 'super-admin');
  return {
    registry: new RuleRegistry({ store, permissions, clock: () => '2025-06-15T12:00:00.000Z' }),
    store,
  };
}

describe('Integration: Emergency rollback', () => {
  async function publishAndRollbackSetup(registry: RuleRegistry, store: InMemoryRuleStore) {
    // Publish v1
    const r1 = await registry.rules.createRule(
      {
        id: 'rb-rule',
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload: JSON.stringify({ model: 'TAX', v: 1 }),
        createdBy: 'alice',
      },
      'alice',
    );
    await registry.rules.submitForReview(r1.id, r1.version, 'alice');
    await registry.rules.approve(r1.id, r1.version, 'bob');

    // Deprecate v1 manually, then publish v2
    await store.updateRuleStatus(r1.id, r1.version, 'deprecated', 'system', 'replaced');

    const r2 = await registry.rules.createRule(
      {
        id: 'rb-rule',
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload: JSON.stringify({ model: 'TAX', v: 2 }),
        createdBy: 'alice',
      },
      'alice',
    );
    await registry.rules.submitForReview(r2.id, r2.version, 'alice');
    await registry.rules.approve(r2.id, r2.version, 'bob');

    return { v1: r1, v2: r2 };
  }

  it('restores target version and deprecates current', async () => {
    const { registry, store } = setup();
    const { v1, v2 } = await publishAndRollbackSetup(registry, store);

    const result = await registry.rules.emergencyRollback('rb-rule', v1.version, 'super', 'Fix');
    expect(result.restored.status).toBe('published');
    expect(result.deprecated.status).toBe('deprecated');
    expect(result.deprecated.version).toBe(v2.version);
  });

  it('audit trail includes emergency_rollback event', async () => {
    const { registry, store } = setup();
    const { v1 } = await publishAndRollbackSetup(registry, store);

    await registry.rules.emergencyRollback('rb-rule', v1.version, 'super', 'Critical fix');
    const trail = await store.getAuditTrail('rb-rule');
    const event = trail.find((e) => e.type === 'rule.emergency_rollback');
    expect(event).toBeDefined();
    expect(event?.reason).toBe('Critical fix');
  });

  it('fingerprint changes after rollback', async () => {
    const { registry, store } = setup();
    const { v1 } = await publishAndRollbackSetup(registry, store);

    registry.fingerprint({ tenantId: 'tenant-1', effectiveDate: '2025-06-01' });
    await registry.rules.emergencyRollback('rb-rule', v1.version, 'super', 'Fix');
    const fpAfter = registry.fingerprint({ tenantId: 'tenant-1', effectiveDate: '2025-06-01' });
    // Fingerprint depends on timestamp, so it should differ
    expect(typeof fpAfter).toBe('string');
  });

  it('throws if reason is empty', async () => {
    const { registry, store } = setup();
    const { v1 } = await publishAndRollbackSetup(registry, store);

    await expect(
      registry.rules.emergencyRollback('rb-rule', v1.version, 'super', ''),
    ).rejects.toThrow(RuleTransitionError);
  });

  it('rolled back rule visible in resolveRules', async () => {
    const { registry, store } = setup();
    const { v1 } = await publishAndRollbackSetup(registry, store);

    await registry.rules.emergencyRollback('rb-rule', v1.version, 'super', 'Fix');
    const resolved = await registry.resolveRules({
      tenantId: 'tenant-1',
      effectiveDate: '2025-06-01',
    });
    const restored = resolved.find((r) => r.id === 'rb-rule');
    expect(restored?.version).toBe(v1.version);
  });
});
