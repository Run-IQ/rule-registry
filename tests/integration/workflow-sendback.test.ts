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

describe('Integration: Sendback workflow', () => {
  it('review → draft → review → published', async () => {
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
    const draft = await registry.rules.sendBackToDraft(rule.id, rule.version, 'bob', 'Fix payload');
    expect(draft.status).toBe('draft');

    await registry.rules.submitForReview(rule.id, rule.version, 'alice');
    const { published } = await registry.rules.approve(rule.id, rule.version, 'bob');
    expect(published.status).toBe('published');
  });

  it('sendback audit includes comment', async () => {
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
    await registry.rules.sendBackToDraft(rule.id, rule.version, 'bob', 'Needs work');

    const trail = await store.getAuditTrail(rule.id);
    const event = trail.find((e) => e.type === 'rule.sent_back_to_draft');
    expect(event?.reason).toBe('Needs work');
  });

  it('multiple sendbacks create proper audit chain', async () => {
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
    await registry.rules.sendBackToDraft(rule.id, rule.version, 'bob', 'First review');
    await registry.rules.submitForReview(rule.id, rule.version, 'alice');
    await registry.rules.sendBackToDraft(rule.id, rule.version, 'bob', 'Second review');

    const trail = await store.getAuditTrail(rule.id);
    const sendbacks = trail.filter((e) => e.type === 'rule.sent_back_to_draft');
    expect(sendbacks.length).toBe(2);
  });

  it('sendback preserves rule data', async () => {
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
    const draft = await registry.rules.sendBackToDraft(rule.id, rule.version, 'bob', 'Fix');
    expect(draft.model).toBe('TAX');
    expect(draft.payload).toBe(payload);
  });
});
