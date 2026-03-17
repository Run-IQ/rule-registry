import type { RuleInput } from '@run-iq/context-engine';
import { InMemoryRuleStore } from '@run-iq/context-engine';
import { RuleRegistry } from '../../src/RuleRegistry.js';
import { DefaultPermissionChecker } from '../../src/PermissionChecker.js';

const clock = () => '2025-06-15T00:00:00.000Z';

function setup() {
  const store = new InMemoryRuleStore();
  const permissions = new DefaultPermissionChecker();
  permissions.grantRole('alice', 'tenant-1', 'editor');
  permissions.grantRole('bob', 'tenant-1', 'reviewer');
  return { registry: new RuleRegistry({ store, permissions, clock }), store };
}

function makeInput(from: string, until: string | null, v: number): RuleInput {
  const input: RuleInput = {
    model: 'TAX',
    tenantId: 'tenant-1',
    scope: 'tenant-specific',
    effectiveFrom: from,
    payload: JSON.stringify({ model: 'TAX', v }),
    createdBy: 'alice',
  };
  if (until) (input as unknown as Record<string, unknown>)['effectiveUntil'] = until;
  return input;
}

describe('Integration: Effective dates', () => {
  it('resolveAtDate returns rules active at specific date', async () => {
    const { registry } = setup();
    const r1 = await registry.rules.createRule(makeInput('2025-01-01', '2025-06-30', 1), 'alice');
    await registry.rules.submitForReview(r1.id, r1.version, 'alice');
    await registry.rules.approve(r1.id, r1.version, 'bob');

    const rules = await registry.dates.resolveAtDate('tenant-1', '2025-03-15', 'TAX');
    expect(rules.length).toBe(1);
  });

  it('resolveAtDate returns [] after expiry', async () => {
    const { registry } = setup();
    const r1 = await registry.rules.createRule(makeInput('2025-01-01', '2025-03-01', 1), 'alice');
    await registry.rules.submitForReview(r1.id, r1.version, 'alice');
    await registry.rules.approve(r1.id, r1.version, 'bob');

    const rules = await registry.dates.resolveAtDate('tenant-1', '2025-06-01', 'TAX');
    expect(rules.length).toBe(0);
  });

  it('findGaps detects coverage gap', async () => {
    const { registry } = setup();
    const r1 = await registry.rules.createRule(makeInput('2025-01-01', '2025-03-01', 1), 'alice');
    await registry.rules.submitForReview(r1.id, r1.version, 'alice');
    await registry.rules.approve(r1.id, r1.version, 'bob');

    const r2 = await registry.rules.createRule(makeInput('2025-06-01', '2025-12-31', 2), 'alice');
    await registry.rules.submitForReview(r2.id, r2.version, 'alice');
    await registry.rules.approve(r2.id, r2.version, 'bob');

    const gaps = await registry.dates.findGaps('tenant-1', 'TAX', '2025-01-01', '2025-12-31');
    expect(gaps.length).toBeGreaterThan(0);
  });

  it('nextChange returns future effective date', async () => {
    const { registry } = setup();
    const r1 = await registry.rules.createRule(makeInput('2025-09-01', null, 1), 'alice');
    await registry.rules.submitForReview(r1.id, r1.version, 'alice');
    await registry.rules.approve(r1.id, r1.version, 'bob');

    const next = await registry.dates.nextChange('tenant-1', 'TAX');
    expect(next).toBe('2025-09-01');
  });

  it('nextChange returns null when no future dates', async () => {
    const { registry } = setup();
    const r1 = await registry.rules.createRule(makeInput('2024-01-01', null, 1), 'alice');
    await registry.rules.submitForReview(r1.id, r1.version, 'alice');
    await registry.rules.approve(r1.id, r1.version, 'bob');

    const next = await registry.dates.nextChange('tenant-1', 'TAX');
    expect(next).toBeNull();
  });
});
