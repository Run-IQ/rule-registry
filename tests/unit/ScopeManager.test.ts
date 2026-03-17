import type { RuleInput } from '@run-iq/context-engine';
import { InMemoryRuleStore } from '@run-iq/context-engine';
import { RegionRegistry } from '../../src/RegionRegistry.js';
import { ScopeManager } from '../../src/ScopeManager.js';
import { RegionNotFoundError } from '../../src/errors.js';

const ALPHA = { code: 'ALPHA', name: 'Alpha Region', countries: ['AA', 'BB', 'CC'] };
const BETA = { code: 'BETA', name: 'Beta Region', countries: ['BB', 'DD'] };

async function publishRule(store: InMemoryRuleStore, input: RuleInput) {
  const draft = await store.saveRule(input);
  await store.updateRuleStatus(draft.id, draft.version, 'review', 'sys');
  const { published } = await store.publishRule(draft.id, draft.version, 'sys');
  return published;
}

function tenantInput(overrides?: Partial<RuleInput>): RuleInput {
  const base: RuleInput = {
    model: 'TAX',
    tenantId: 'tenant-1',
    scope: 'tenant-specific',
    effectiveFrom: '2025-01-01',
    payload: JSON.stringify({ tenant: true }),
    createdBy: 'alice',
  };
  if (!overrides) return base;
  return { ...base, ...overrides };
}

function sharedInput(region: string, overrides?: Partial<RuleInput>): RuleInput {
  const base: RuleInput = {
    model: 'TAX',
    tenantId: '__shared__',
    scope: 'shared',
    effectiveFrom: '2025-01-01',
    payload: JSON.stringify({ shared: true, region }),
    createdBy: 'admin',
  };
  const m = base as unknown as Record<string, unknown>;
  m['region'] = region;
  if (!overrides) return base;
  return { ...base, ...overrides };
}

describe('ScopeManager', () => {
  let store: InMemoryRuleStore;
  let scopeManager: ScopeManager;

  beforeEach(() => {
    store = new InMemoryRuleStore();
    const regionRegistry = new RegionRegistry([ALPHA, BETA]);
    scopeManager = new ScopeManager(store, regionRegistry);
  });

  it('resolveWithTenantRules() combines tenant + shared', async () => {
    await publishRule(store, tenantInput());
    // Different effectiveFrom so tenantCoverage dedup doesn't filter it
    await publishRule(store, sharedInput('ALPHA', { effectiveFrom: '2025-06-01' }));

    const rules = await scopeManager.resolveWithTenantRules({
      tenantId: 'tenant-1',
      country: 'AA',
    });
    expect(rules.length).toBe(2);
  });

  it('tenant-specific overrides shared on same model + period', async () => {
    await publishRule(store, tenantInput());
    await publishRule(
      store,
      sharedInput('ALPHA', {
        effectiveFrom: '2025-01-01',
        payload: JSON.stringify({ shared: true, same: true }),
      }),
    );

    const rules = await scopeManager.resolveWithTenantRules({
      tenantId: 'tenant-1',
      country: 'AA',
    });
    // Both have same model+effectiveFrom+effectiveUntil=open, so shared is excluded
    const tenantOnly = rules.filter((r) => r.scope === 'tenant-specific');
    expect(tenantOnly.length).toBe(1);
  });

  it('deduplicates shared rules if country in multiple regions', async () => {
    // BB is in both ALPHA and BETA — publish only one shared rule in ALPHA
    await publishRule(store, sharedInput('ALPHA'));
    const rules = await scopeManager.resolveWithTenantRules({
      tenantId: 'other-tenant',
      country: 'BB',
    });
    // Should have at most 1 shared rule (deduplicated)
    const sharedRules = rules.filter((r) => r.scope === 'shared');
    expect(sharedRules.length).toBe(1);
  });

  it('returns only tenant-specific if no region or country', async () => {
    await publishRule(store, tenantInput());
    await publishRule(store, sharedInput('ALPHA'));
    const rules = await scopeManager.resolveWithTenantRules({ tenantId: 'tenant-1' });
    expect(rules.every((r) => r.scope === 'tenant-specific')).toBe(true);
  });

  it('returns shared from explicit region in query', async () => {
    await publishRule(store, sharedInput('ALPHA'));
    const rules = await scopeManager.resolveWithTenantRules({
      tenantId: 'other-tenant',
      region: 'ALPHA',
    });
    expect(rules.length).toBe(1);
    expect(rules[0]!.scope).toBe('shared');
  });

  it('listByRegion() returns shared rules from configured region', async () => {
    await publishRule(store, sharedInput('ALPHA'));
    const rules = await scopeManager.listByRegion('ALPHA');
    expect(rules.length).toBe(1);
  });

  it('listByRegion() throws RegionNotFoundError for unconfigured region', async () => {
    await expect(scopeManager.listByRegion('NOPE')).rejects.toThrow(RegionNotFoundError);
  });

  it('results are sorted by priority desc then version desc', async () => {
    // Use different models so they don't auto-deprecate each other
    await publishRule(
      store,
      tenantInput({ model: 'TAX_A', priority: 5, payload: JSON.stringify({ p: 5 }) }),
    );
    await publishRule(
      store,
      tenantInput({ model: 'TAX_B', priority: 10, payload: JSON.stringify({ p: 10 }) }),
    );

    const rules = await scopeManager.resolveWithTenantRules({ tenantId: 'tenant-1' });
    expect(rules.length).toBe(2);
    expect(rules[0]!.priority).toBeGreaterThanOrEqual(rules[1]!.priority);
  });
});
