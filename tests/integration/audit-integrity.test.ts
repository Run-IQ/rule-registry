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

const payload = JSON.stringify({ model: 'TAX', id: 't1', version: 1, params: {} });

describe('Integration: Audit integrity', () => {
  it('audit chain has prevChecksum linking events', async () => {
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

    const trail = await store.getAuditTrail(rule.id);
    expect(trail.length).toBeGreaterThan(1);
    // Second event should have prevChecksum
    const second = trail[1]!;
    expect(
      (second.metadata as Record<string, unknown> | undefined)?.['prevChecksum'],
    ).toBeDefined();
  });

  it('verifyIntegrity passes on untampered trail', async () => {
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

    const result = await registry.audit.verifyIntegrity(rule.id);
    expect(result.valid).toBe(true);
  });

  it('verifyIntegrity detects tampered event', async () => {
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

    // Tamper: insert a rogue event with wrong prevChecksum
    await store.recordAuditEvent({
      id: 'tampered',
      ruleId: rule.id,
      version: rule.version,
      tenantId: 'tenant-1',
      type: 'rule.updated',
      actor: 'evil',
      recordedAt: '2025-06-15T12:00:00.000Z',
      metadata: { prevChecksum: 'wrong-hash' },
    });

    const result = await registry.audit.verifyIntegrity(rule.id);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('exportForAudit returns formatted timeline', async () => {
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

    const report = await registry.audit.exportForAudit(rule.id, 'tenant-1');
    expect(report.ruleId).toBe(rule.id);
    expect(report.timeline.length).toBeGreaterThan(0);
    expect(report.summary.totalVersions).toBe(1);
  });
});
