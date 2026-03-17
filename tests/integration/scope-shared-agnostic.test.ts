import type { RuleInput } from '@run-iq/context-engine';
import { InMemoryRuleStore } from '@run-iq/context-engine';
import { RuleRegistry } from '../../src/RuleRegistry.js';
import { DefaultPermissionChecker } from '../../src/PermissionChecker.js';

// Fictional regions — no UEMOA/OHADA
const regions = [
  { code: 'NORD', name: 'Northern Alliance', countries: ['AA', 'BB', 'CC'] },
  { code: 'SUD', name: 'Southern Pact', countries: ['BB', 'DD', 'EE'] },
];

function setup() {
  const store = new InMemoryRuleStore();
  const permissions = new DefaultPermissionChecker();
  permissions.grantRole('alice', 'tenant-1', 'editor');
  permissions.grantRole('alice', '__shared__', 'editor');
  permissions.grantRole('bob', 'tenant-1', 'reviewer');
  permissions.grantRole('bob', '__shared__', 'reviewer');
  return {
    registry: new RuleRegistry({
      store,
      permissions,
      regions,
      clock: () => '2025-06-15T12:00:00.000Z',
    }),
    store,
  };
}

describe('Integration: Scope shared agnostic', () => {
  it('shared rules visible to tenant in matching region', async () => {
    const { registry } = setup();
    const shared = await registry.rules.createRule(
      {
        model: 'VAT',
        tenantId: '__shared__',
        scope: 'shared',
        effectiveFrom: '2025-01-01',
        region: 'NORD',
        payload: JSON.stringify({ model: 'VAT', shared: true }),
        createdBy: 'alice',
      } as RuleInput,
      'alice',
    );
    await registry.rules.submitForReview(shared.id, shared.version, 'alice');
    await registry.rules.approve(shared.id, shared.version, 'bob');

    const resolved = await registry.resolveRules({
      tenantId: 'tenant-1',
      country: 'AA',
      effectiveDate: '2025-06-01',
    });
    expect(resolved.some((r) => r.scope === 'shared')).toBe(true);
  });

  it('shared rules not visible to country outside region', async () => {
    const { registry } = setup();
    const shared = await registry.rules.createRule(
      {
        model: 'VAT',
        tenantId: '__shared__',
        scope: 'shared',
        effectiveFrom: '2025-01-01',
        region: 'NORD',
        payload: JSON.stringify({ model: 'VAT', shared: true }),
        createdBy: 'alice',
      } as RuleInput,
      'alice',
    );
    await registry.rules.submitForReview(shared.id, shared.version, 'alice');
    await registry.rules.approve(shared.id, shared.version, 'bob');

    const resolved = await registry.resolveRules({
      tenantId: 'tenant-1',
      country: 'DD',
      effectiveDate: '2025-06-01',
    });
    // DD is only in SUD, not NORD
    const nordShared = resolved.filter((r) => r.scope === 'shared' && r.region === 'NORD');
    expect(nordShared).toHaveLength(0);
  });

  it('tenant-specific overrides shared rule', async () => {
    const { registry } = setup();
    // Publish shared rule
    const shared = await registry.rules.createRule(
      {
        model: 'VAT',
        tenantId: '__shared__',
        scope: 'shared',
        effectiveFrom: '2025-01-01',
        region: 'NORD',
        payload: JSON.stringify({ model: 'VAT', shared: true }),
        createdBy: 'alice',
      } as RuleInput,
      'alice',
    );
    await registry.rules.submitForReview(shared.id, shared.version, 'alice');
    await registry.rules.approve(shared.id, shared.version, 'bob');

    // Publish tenant-specific with same model+period
    const tenant = await registry.rules.createRule(
      {
        model: 'VAT',
        tenantId: 'tenant-1',
        scope: 'tenant-specific',
        effectiveFrom: '2025-01-01',
        payload: JSON.stringify({ model: 'VAT', tenant: true }),
        createdBy: 'alice',
      },
      'alice',
    );
    await registry.rules.submitForReview(tenant.id, tenant.version, 'alice');
    await registry.rules.approve(tenant.id, tenant.version, 'bob');

    const resolved = await registry.resolveRules({
      tenantId: 'tenant-1',
      country: 'AA',
      effectiveDate: '2025-06-01',
    });
    // Shared should be excluded — tenant overrides
    expect(resolved.every((r) => r.scope === 'tenant-specific')).toBe(true);
  });

  it('country in multiple regions deduplicates shared', async () => {
    const { registry } = setup();
    // BB is in both NORD and SUD — publish shared rule in NORD
    const shared = await registry.rules.createRule(
      {
        model: 'VAT',
        tenantId: '__shared__',
        scope: 'shared',
        effectiveFrom: '2025-01-01',
        region: 'NORD',
        payload: JSON.stringify({ model: 'VAT', shared: true }),
        createdBy: 'alice',
      } as RuleInput,
      'alice',
    );
    await registry.rules.submitForReview(shared.id, shared.version, 'alice');
    await registry.rules.approve(shared.id, shared.version, 'bob');

    const resolved = await registry.resolveRules({
      tenantId: 'other',
      country: 'BB',
      effectiveDate: '2025-06-01',
    });
    expect(resolved.filter((r) => r.id === shared.id)).toHaveLength(1);
  });

  it('regions are accessible via registry.regions', async () => {
    const { registry } = setup();
    expect(registry.regions.list()).toHaveLength(2);
    expect(registry.regions.get('NORD')?.countries).toContain('AA');
  });

  it('listSharedRules returns only shared for region', async () => {
    const { registry } = setup();
    const shared = await registry.rules.createRule(
      {
        model: 'VAT',
        tenantId: '__shared__',
        scope: 'shared',
        effectiveFrom: '2025-01-01',
        region: 'NORD',
        payload: JSON.stringify({ model: 'VAT', shared: true }),
        createdBy: 'alice',
      } as RuleInput,
      'alice',
    );
    await registry.rules.submitForReview(shared.id, shared.version, 'alice');
    await registry.rules.approve(shared.id, shared.version, 'bob');

    const rules = await registry.listSharedRules('NORD');
    expect(rules.length).toBe(1);
  });
});
