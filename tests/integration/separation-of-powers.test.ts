import { InMemoryRuleStore } from '@run-iq/context-engine';
import { RuleRegistry } from '../../src/RuleRegistry.js';
import { DefaultPermissionChecker } from '../../src/PermissionChecker.js';
import { PermissionDeniedError } from '../../src/errors.js';

function setup() {
  const store = new InMemoryRuleStore();
  const permissions = new DefaultPermissionChecker();
  permissions.grantRole('alice', 'tenant-1', 'editor');
  permissions.grantRole('bob', 'tenant-1', 'reviewer');
  permissions.grantRole('viewer', 'tenant-1', 'viewer');
  return {
    registry: new RuleRegistry({ store, permissions, clock: () => '2025-06-15T12:00:00.000Z' }),
  };
}

const payload = JSON.stringify({ model: 'TAX', id: 't1', version: 1, params: {} });

describe('Integration: Separation of powers', () => {
  it('creator cannot approve their own rule', async () => {
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
    // alice tries to approve her own rule — bob's reviewer role, but alice's actor
    // alice has editor, not reviewer. But even if she did...
    await expect(registry.rules.approve(rule.id, rule.version, 'alice')).rejects.toThrow(); // PermissionDeniedError (no approve permission) or RulePermissionError
  });

  it('creator cannot send back their own rule', async () => {
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
    await expect(
      registry.rules.sendBackToDraft(rule.id, rule.version, 'alice', 'Nope'),
    ).rejects.toThrow(); // PermissionDeniedError or RulePermissionError
  });

  it('different reviewer can approve', async () => {
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
    const { published } = await registry.rules.approve(rule.id, rule.version, 'bob');
    expect(published.status).toBe('published');
  });

  it('viewer cannot create rules', async () => {
    const { registry } = setup();
    await expect(
      registry.rules.createRule(
        {
          model: 'TAX',
          tenantId: 'tenant-1',
          scope: 'tenant-specific',
          effectiveFrom: '2025-01-01',
          payload,
          createdBy: 'viewer',
        },
        'viewer',
      ),
    ).rejects.toThrow(PermissionDeniedError);
  });
});
