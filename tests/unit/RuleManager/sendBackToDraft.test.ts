import { InMemoryRuleStore, RuleTransitionError } from '@run-iq/context-engine';
import type { RuleInput } from '@run-iq/context-engine';
import { RuleManager } from '../../../src/RuleManager.js';
import { RuleValidator, defaultRuleSchemaValidator } from '../../../src/RuleValidator.js';
import { ConflictDetector } from '../../../src/ConflictDetector.js';
import { AuditLogger } from '../../../src/AuditLogger.js';
import { DefaultPermissionChecker } from '../../../src/PermissionChecker.js';
import { RulePermissionError } from '../../../src/errors.js';

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

function validInput(): RuleInput {
  return {
    model: 'FLAT_RATE',
    tenantId: 'tenant-1',
    scope: 'tenant-specific',
    effectiveFrom: '2025-01-01',
    payload: JSON.stringify({ model: 'FLAT_RATE', id: 'r1', version: 1, params: {} }),
    createdBy: 'alice',
  };
}

describe('RuleManager.sendBackToDraft', () => {
  it('transitions review → draft', async () => {
    const { manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await manager.submitForReview(r1.id, r1.version, 'alice');
    const result = await manager.sendBackToDraft(r1.id, r1.version, 'bob', 'Needs changes');
    expect(result.status).toBe('draft');
  });

  it('throws RuleTransitionError if status != review', async () => {
    const { manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await expect(manager.sendBackToDraft(r1.id, r1.version, 'bob', 'Nope')).rejects.toThrow(
      RuleTransitionError,
    );
  });

  it('throws RulePermissionError if actor == createdBy', async () => {
    const { manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await manager.submitForReview(r1.id, r1.version, 'alice');
    // alice is also reviewer role for this test
    const { store } = setup();
    const p = new DefaultPermissionChecker();
    p.grantRole('alice', 'tenant-1', 'reviewer');
    const mgr = new RuleManager({
      store,
      validator: new RuleValidator(defaultRuleSchemaValidator),
      conflictDetector: new ConflictDetector(store),
      auditLogger: new AuditLogger(store, clock),
      permissions: p,
      clock,
    });
    const rule = await mgr.createRule(validInput(), 'alice');
    await mgr.submitForReview(rule.id, rule.version, 'alice');
    await expect(mgr.sendBackToDraft(rule.id, rule.version, 'alice', 'Nope')).rejects.toThrow(
      RulePermissionError,
    );
  });

  it('records rule.sent_back_to_draft audit with comment', async () => {
    const { store, manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await manager.submitForReview(r1.id, r1.version, 'alice');
    await manager.sendBackToDraft(r1.id, r1.version, 'bob', 'Missing description');
    const trail = await store.getAuditTrail(r1.id);
    const event = trail.find((e) => e.type === 'rule.sent_back_to_draft');
    expect(event).toBeDefined();
    expect(event?.reason).toBe('Missing description');
  });
});
