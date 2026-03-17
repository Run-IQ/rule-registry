import { InMemoryRuleStore } from '@run-iq/context-engine';
import { RuleRegistry } from '../../src/RuleRegistry.js';
import { DefaultPermissionChecker } from '../../src/PermissionChecker.js';

function setup() {
  const store = new InMemoryRuleStore();
  const permissions = new DefaultPermissionChecker();
  permissions.grantRole('alice', 'tenant-1', 'editor');
  permissions.grantRole('bob', 'tenant-1', 'reviewer');
  permissions.grantRole('admin', 'tenant-1', 'admin');
  const registry = new RuleRegistry({
    store,
    permissions,
    clock: () => '2025-06-15T12:00:00.000Z',
  });
  return { registry, store };
}

const payload = JSON.stringify({ model: 'TAX', id: 't1', version: 1, params: {} });

describe('Integration: Complete workflow', () => {
  it('draft → review → published with two actors', async () => {
    const { registry } = setup();
    const rule = await registry.rules.createRule(
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
    expect(rule.status).toBe('draft');

    const { rule: reviewed } = await registry.rules.submitForReview(rule.id, rule.version, 'alice');
    expect(reviewed.status).toBe('review');

    const { published } = await registry.rules.approve(rule.id, rule.version, 'bob');
    expect(published.status).toBe('published');
  });

  it('published rule visible in resolveRules', async () => {
    const { registry } = setup();
    const rule = await registry.rules.createRule(
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
    await registry.rules.submitForReview(rule.id, rule.version, 'alice');
    await registry.rules.approve(rule.id, rule.version, 'bob');

    const resolved = await registry.resolveRules({
      tenantId: 'tenant-1',
      effectiveDate: '2025-06-01',
    });
    expect(resolved.some((r) => r.id === rule.id)).toBe(true);
  });

  it('full lifecycle: draft → review → published → deprecated → archived', async () => {
    const { registry } = setup();
    const rule = await registry.rules.createRule(
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

    await registry.rules.submitForReview(rule.id, rule.version, 'alice');
    await registry.rules.approve(rule.id, rule.version, 'bob');
    await registry.rules.deprecate(rule.id, rule.version, 'admin', 'Replaced');
    const archived = await registry.rules.archive(rule.id, rule.version, 'admin', 'Cleanup');
    expect(archived.status).toBe('archived');
  });

  it('audit trail captures all transitions', async () => {
    const { registry, store } = setup();
    const rule = await registry.rules.createRule(
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

    await registry.rules.submitForReview(rule.id, rule.version, 'alice');
    await registry.rules.approve(rule.id, rule.version, 'bob');

    const trail = await store.getAuditTrail(rule.id);
    expect(trail.some((e) => e.type === 'rule.created')).toBe(true);
    expect(trail.some((e) => e.type === 'rule.submitted_for_review')).toBe(true);
    expect(trail.some((e) => e.type === 'rule.published')).toBe(true);
  });

  it('updateRule creates new version in draft', async () => {
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

    const r2 = await registry.rules.updateRule(r1.id, r1.version, { priority: 5 }, 'alice');
    expect(r2.version).toBe(r1.version + 1);
    expect(r2.status).toBe('draft');
  });

  it('getRuleHistory returns all versions', async () => {
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

    await registry.rules.updateRule(r1.id, r1.version, { priority: 5 }, 'alice');
    const history = await registry.getRuleHistory(r1.id);
    expect(history.length).toBe(2);
  });
});
