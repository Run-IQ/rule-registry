import { describe, it, expect } from 'vitest';
import type { RuleInput } from '@run-iq/context-engine';
import { InMemoryRuleStore } from '@run-iq/context-engine';
import { RuleRegistry } from '../../src/RuleRegistry.js';
import { DefaultPermissionChecker } from '../../src/PermissionChecker.js';

const clock = () => '2025-06-15T12:00:00.000Z';

function validInput(overrides?: Partial<RuleInput>): RuleInput {
  const base: RuleInput = {
    model: 'FLAT_RATE',
    tenantId: 'tenant-1',
    scope: 'tenant-specific',
    effectiveFrom: '2025-01-01',
    payload: JSON.stringify({ model: 'FLAT_RATE', id: 'r1', version: 1, params: {} }),
    createdBy: 'alice',
  };
  if (!overrides) return base;
  return { ...base, ...overrides };
}

function setup() {
  const store = new InMemoryRuleStore();
  const permissions = new DefaultPermissionChecker();
  permissions.grantRole('alice', 'tenant-1', 'editor');
  permissions.grantRole('bob', 'tenant-1', 'reviewer');
  permissions.grantRole('admin', 'tenant-1', 'admin');

  const registry = new RuleRegistry({ store, permissions, clock });
  return { store, registry, permissions };
}

describe('RuleRegistry — facade', () => {
  // ─── Read operations ───────────────────────────────────────────────────

  it('saveRule delegates to RuleManager.createRule', async () => {
    const { registry } = setup();
    const rule = await registry.saveRule(validInput());
    expect(rule.id).toBeDefined();
    expect(rule.status).toBe('draft');
    expect(rule.model).toBe('FLAT_RATE');
  });

  it('getRule returns saved rule', async () => {
    const { registry } = setup();
    const rule = await registry.saveRule(validInput());
    const found = await registry.getRule(rule.id, rule.version);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(rule.id);
  });

  it('getRule returns null for nonexistent', async () => {
    const { registry } = setup();
    const found = await registry.getRule('nope', 1);
    expect(found).toBeNull();
  });

  it('listRules returns metadata', async () => {
    const { registry } = setup();
    await registry.saveRule(validInput());
    const list = await registry.listRules({ tenantId: 'tenant-1' });
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('getRuleHistory returns all versions', async () => {
    const { registry } = setup();
    const rule = await registry.saveRule(validInput());
    const history = await registry.getRuleHistory(rule.id);
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it('getRulesAtDate returns matching rules', async () => {
    const { store, registry } = setup();
    const rule = await registry.saveRule(validInput());
    // Publish through store directly so it's visible at-date
    await store.updateRuleStatus(rule.id, rule.version, 'review', 'alice');
    await store.publishRule(rule.id, rule.version, 'admin');

    const atDate = await registry.getRulesAtDate('tenant-1', '2025-06-01');
    expect(atDate.length).toBeGreaterThanOrEqual(1);
  });

  it('fingerprint returns a string', async () => {
    const { registry } = setup();
    const fp = registry.fingerprint({
      tenantId: 'tenant-1',
      model: 'FLAT_RATE',
      effectiveDate: '2025-01-01',
    });
    expect(typeof fp).toBe('string');
  });

  it('resolveRules returns matching rules', async () => {
    const { store, registry } = setup();
    const rule = await registry.saveRule(validInput());
    await store.updateRuleStatus(rule.id, rule.version, 'review', 'alice');
    await store.publishRule(rule.id, rule.version, 'admin');

    const resolved = await registry.resolveRules({
      tenantId: 'tenant-1',
      model: 'FLAT_RATE',
      effectiveDate: '2025-06-01',
    });
    expect(resolved.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Status transitions via updateRuleStatus ─────────────────────────

  it('updateRuleStatus to review submits for review', async () => {
    const { registry } = setup();
    const rule = await registry.saveRule(validInput());
    const updated = await registry.updateRuleStatus(rule.id, rule.version, 'review', 'alice');
    expect(updated.status).toBe('review');
  });

  it('updateRuleStatus to draft sends back to draft', async () => {
    const { store, registry } = setup();
    const rule = await registry.saveRule(validInput());
    await store.updateRuleStatus(rule.id, rule.version, 'review', 'alice');
    const updated = await registry.updateRuleStatus(
      rule.id,
      rule.version,
      'draft',
      'bob',
      'needs changes',
    );
    expect(updated.status).toBe('draft');
  });

  it('updateRuleStatus to published approves', async () => {
    const { store, registry } = setup();
    const rule = await registry.saveRule(validInput());
    await store.updateRuleStatus(rule.id, rule.version, 'review', 'alice');
    const updated = await registry.updateRuleStatus(rule.id, rule.version, 'published', 'bob');
    expect(updated.status).toBe('published');
  });

  it('updateRuleStatus to deprecated requires reason', async () => {
    const { registry } = setup();
    const rule = await registry.saveRule(validInput());

    await expect(
      registry.updateRuleStatus(rule.id, rule.version, 'deprecated', 'admin'),
    ).rejects.toThrow(/Reason is required/);
  });

  it('updateRuleStatus to deprecated with reason works', async () => {
    const { store, registry } = setup();
    const rule = await registry.saveRule(validInput());
    await store.updateRuleStatus(rule.id, rule.version, 'review', 'alice');
    await store.publishRule(rule.id, rule.version, 'admin');
    const updated = await registry.updateRuleStatus(
      rule.id,
      rule.version,
      'deprecated',
      'admin',
      'end of life',
    );
    expect(updated.status).toBe('deprecated');
  });

  it('updateRuleStatus to archived requires reason', async () => {
    const { registry } = setup();
    const rule = await registry.saveRule(validInput());

    await expect(
      registry.updateRuleStatus(rule.id, rule.version, 'archived', 'admin'),
    ).rejects.toThrow(/Reason is required/);
  });

  it('updateRuleStatus to archived with reason works', async () => {
    const { store, registry } = setup();
    const rule = await registry.saveRule(validInput());
    await store.updateRuleStatus(rule.id, rule.version, 'review', 'alice');
    await store.publishRule(rule.id, rule.version, 'admin');
    await store.updateRuleStatus(rule.id, rule.version, 'deprecated', 'admin', 'eol');
    const updated = await registry.updateRuleStatus(
      rule.id,
      rule.version,
      'archived',
      'admin',
      'cleanup',
    );
    expect(updated.status).toBe('archived');
  });

  // ─── publishRule and rollbackRule ─────────────────────────────────────

  it('publishRule returns published + deprecated list', async () => {
    const { store, registry } = setup();
    const rule = await registry.saveRule(validInput());
    await store.updateRuleStatus(rule.id, rule.version, 'review', 'alice');
    const result = await registry.publishRule(rule.id, rule.version, 'bob');
    expect(result.published.status).toBe('published');
    expect(Array.isArray(result.deprecated)).toBe(true);
  });

  it('rollbackRule performs emergency rollback', async () => {
    const { store, registry, permissions } = setup();
    permissions.grantRole('admin', 'tenant-1', 'super-admin');

    const v1 = await registry.saveRule(validInput());
    await store.updateRuleStatus(v1.id, v1.version, 'review', 'alice');
    await store.publishRule(v1.id, v1.version, 'admin');

    // Create v2
    const v2Input = validInput({ id: v1.id });
    const v2 = await store.saveRule(v2Input);
    await store.updateRuleStatus(v2.id, v2.version, 'review', 'alice');
    await store.publishRule(v2.id, v2.version, 'admin');

    const result = await registry.rollbackRule(v1.id, 1, 'admin', 'critical issue');
    expect(result.restored).toBeDefined();
    expect(result.deprecated).toBeDefined();
  });

  // ─── Audit ────────────────────────────────────────────────────────────

  it('recordAuditEvent and getAuditTrail work', async () => {
    const { registry } = setup();
    const rule = await registry.saveRule(validInput());

    await registry.recordAuditEvent({
      id: 'evt-1',
      ruleId: rule.id,
      version: rule.version,
      tenantId: 'tenant-1',
      type: 'rule.created',
      actor: 'alice',
      recordedAt: clock(),
    });

    const trail = await registry.getAuditTrail(rule.id);
    expect(trail.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Conflict detection ───────────────────────────────────────────────

  it('detectConflicts delegates to store', async () => {
    const { registry } = setup();
    const conflicts = await registry.detectConflicts(validInput());
    expect(Array.isArray(conflicts)).toBe(true);
  });

  // ─── listSharedRules ──────────────────────────────────────────────────

  it('listSharedRules delegates to store', async () => {
    const { registry } = setup();
    const shared = await registry.listSharedRules('WEST_AFRICA');
    expect(Array.isArray(shared)).toBe(true);
  });

  // ─── Management API getters ───────────────────────────────────────────

  it('rules getter returns RuleManager', async () => {
    const { registry } = setup();
    expect(registry.rules).toBeDefined();
    expect(typeof registry.rules.createRule).toBe('function');
  });

  it('regions getter returns RegionRegistry', async () => {
    const { registry } = setup();
    expect(registry.regions).toBeDefined();
  });

  it('sandbox getter returns RuleSandbox', async () => {
    const { registry } = setup();
    expect(registry.sandbox).toBeDefined();
    expect(typeof registry.sandbox.simulate).toBe('function');
  });

  it('importer getter returns RuleImporter', async () => {
    const { registry } = setup();
    expect(registry.importer).toBeDefined();
  });

  it('audit getter returns AuditLogger', async () => {
    const { registry } = setup();
    expect(registry.audit).toBeDefined();
    expect(typeof registry.audit.getTrail).toBe('function');
  });

  it('dates getter returns EffectiveDateManager', async () => {
    const { registry } = setup();
    expect(registry.dates).toBeDefined();
  });
});
