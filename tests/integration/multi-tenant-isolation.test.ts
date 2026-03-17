import { InMemoryRuleStore } from '@run-iq/context-engine';
import { RuleRegistry } from '../../src/RuleRegistry.js';
import { DefaultPermissionChecker } from '../../src/PermissionChecker.js';

function setup() {
  const store = new InMemoryRuleStore();
  const permissions = new DefaultPermissionChecker();
  permissions.grantRole('alice', 'tenant-1', 'editor');
  permissions.grantRole('bob', 'tenant-1', 'reviewer');
  permissions.grantRole('charlie', 'tenant-2', 'editor');
  permissions.grantRole('dave', 'tenant-2', 'reviewer');
  return {
    registry: new RuleRegistry({ store, permissions, clock: () => '2025-06-15T12:00:00.000Z' }),
    store,
  };
}

describe('Integration: Multi-tenant isolation', () => {
  it('tenant-1 rules not visible to tenant-2', async () => {
    const { registry } = setup();
    const r1 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload: JSON.stringify({ model: 'TAX', t: 1 }),
        createdBy: 'alice',
      },
      'alice',
    );
    await registry.rules.submitForReview(r1.id, r1.version, 'alice');
    await registry.rules.approve(r1.id, r1.version, 'bob');

    const resolved = await registry.resolveRules({
      tenantId: 'tenant-2',
      effectiveDate: '2025-06-01',
    });
    expect(resolved.filter((r) => r.tenantId === 'tenant-1')).toHaveLength(0);
  });

  it('listRules scoped to tenantId', async () => {
    const { registry } = setup();
    await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload: JSON.stringify({ model: 'TAX', t: 1 }),
        createdBy: 'alice',
      },
      'alice',
    );
    await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-2',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload: JSON.stringify({ model: 'TAX', t: 2 }),
        createdBy: 'charlie',
      },
      'charlie',
    );

    const t1Rules = await registry.listRules({ tenantId: 'tenant-1' });
    expect(t1Rules.every((r) => r.tenantId === 'tenant-1')).toBe(true);
  });

  it('permission check prevents cross-tenant actions', async () => {
    const { registry } = setup();
    // alice has editor on tenant-1 but not tenant-2
    await expect(
      registry.rules.createRule(
        {
          model: 'TAX',
          tenantId: 'tenant-2',
          scope: 'tenant-specific',
          effectiveFrom: '2025-01-01',
          payload: JSON.stringify({ model: 'TAX' }),
          createdBy: 'alice',
        },
        'alice',
      ),
    ).rejects.toThrow();
  });

  it('both tenants can have rules with same model', async () => {
    const { registry } = setup();
    const r1 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload: JSON.stringify({ model: 'TAX', t: 1 }),
        createdBy: 'alice',
      },
      'alice',
    );
    const r2 = await registry.rules.createRule(
      {
        model: 'TAX',
        tenantId: 'tenant-2',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload: JSON.stringify({ model: 'TAX', t: 2 }),
        createdBy: 'charlie',
      },
      'charlie',
    );

    expect(r1.id).not.toBe(r2.id);
    expect(r1.model).toBe(r2.model);
  });
});
