import { InMemoryRuleStore, RuleTransitionError } from '@run-iq/context-engine';
import type { RuleInput } from '@run-iq/context-engine';
import { RuleManager } from '../../../src/RuleManager.js';
import { RuleValidator, defaultRuleSchemaValidator } from '../../../src/RuleValidator.js';
import { ConflictDetector } from '../../../src/ConflictDetector.js';
import { AuditLogger } from '../../../src/AuditLogger.js';
import { DefaultPermissionChecker } from '../../../src/PermissionChecker.js';
import { RuleConflictBlockerError } from '../../../src/errors.js';

const clock = () => '2025-06-15T12:00:00.000Z';

function setup() {
  const store = new InMemoryRuleStore();
  const validator = new RuleValidator(defaultRuleSchemaValidator);
  const conflictDetector = new ConflictDetector(store);
  const auditLogger = new AuditLogger(store, clock);
  const permissions = new DefaultPermissionChecker();
  permissions.grantRole('alice', 'tenant-1', 'editor');
  permissions.grantRole('bob', 'tenant-1', 'reviewer');
  const manager = new RuleManager({
    store,
    validator,
    conflictDetector,
    auditLogger,
    permissions,
    clock,
  });
  return { store, manager };
}

const payload1 = JSON.stringify({ model: 'FLAT_RATE', id: 'r1', version: 1, params: {} });

function validInput(overrides?: Partial<RuleInput>): RuleInput {
  const base: RuleInput = {
    model: 'FLAT_RATE',
    tenantId: 'tenant-1',
    scope: 'tenant-specific',
    effectiveFrom: '2025-01-01',
    payload: payload1,
    createdBy: 'alice',
  };
  if (!overrides) return base;
  return { ...base, ...overrides };
}

describe('RuleManager.submitForReview', () => {
  it('transitions draft → review', async () => {
    const { manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    const { rule } = await manager.submitForReview(r1.id, r1.version, 'alice');
    expect(rule.status).toBe('review');
  });

  it('throws RuleConflictBlockerError on critical conflict', async () => {
    const { store, manager } = setup();
    // Publish a rule with payload1
    const r1 = await manager.createRule(validInput(), 'alice');
    await store.updateRuleStatus(r1.id, r1.version, 'review', 'alice');
    await store.publishRule(r1.id, r1.version, 'bob');

    // Create another draft with the EXACT same payload
    const r2 = await manager.createRule(validInput({ payload: payload1 }), 'alice');
    await expect(manager.submitForReview(r2.id, r2.version, 'alice')).rejects.toThrow(
      RuleConflictBlockerError,
    );
  });

  it('returns warning conflicts without blocking', async () => {
    const { store, manager } = setup();
    // Publish a rule
    const r1 = await manager.createRule(
      validInput({ priority: 10, payload: JSON.stringify({ model: 'FLAT_RATE', v: 1 }) }),
      'alice',
    );
    await store.updateRuleStatus(r1.id, r1.version, 'review', 'alice');
    await store.publishRule(r1.id, r1.version, 'bob');

    // Create overlapping draft with different priority
    const r2 = await manager.createRule(
      validInput({ priority: 5, payload: JSON.stringify({ model: 'FLAT_RATE', v: 2 }) }),
      'alice',
    );
    const { conflicts } = await manager.submitForReview(r2.id, r2.version, 'alice');
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.every((c) => c.severity === 'warning')).toBe(true);
  });

  it('records rule.submitted_for_review audit event', async () => {
    const { store, manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await manager.submitForReview(r1.id, r1.version, 'alice');
    const trail = await store.getAuditTrail(r1.id);
    expect(trail.some((e) => e.type === 'rule.submitted_for_review')).toBe(true);
  });

  it('records rule.conflict_detected if warnings present', async () => {
    const { store, manager } = setup();
    const r1 = await manager.createRule(
      validInput({ priority: 10, payload: JSON.stringify({ model: 'FLAT_RATE', v: 1 }) }),
      'alice',
    );
    await store.updateRuleStatus(r1.id, r1.version, 'review', 'alice');
    await store.publishRule(r1.id, r1.version, 'bob');

    const r2 = await manager.createRule(
      validInput({ priority: 5, payload: JSON.stringify({ model: 'FLAT_RATE', v: 2 }) }),
      'alice',
    );
    await manager.submitForReview(r2.id, r2.version, 'alice');
    const trail = await store.getAuditTrail(r2.id);
    expect(trail.some((e) => e.type === 'rule.conflict_detected')).toBe(true);
  });

  it('throws RuleTransitionError if status != draft', async () => {
    const { store, manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await store.updateRuleStatus(r1.id, r1.version, 'review', 'alice');
    await expect(manager.submitForReview(r1.id, r1.version, 'alice')).rejects.toThrow(
      RuleTransitionError,
    );
  });
});
