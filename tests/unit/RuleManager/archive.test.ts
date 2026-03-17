import { InMemoryRuleStore, RuleTransitionError } from '@run-iq/context-engine';
import type { RuleInput } from '@run-iq/context-engine';
import { RuleManager } from '../../../src/RuleManager.js';
import { RuleValidator, defaultRuleSchemaValidator } from '../../../src/RuleValidator.js';
import { ConflictDetector } from '../../../src/ConflictDetector.js';
import { AuditLogger } from '../../../src/AuditLogger.js';
import { DefaultPermissionChecker } from '../../../src/PermissionChecker.js';

const clock = () => '2025-06-15T12:00:00.000Z';

function setup() {
  const store = new InMemoryRuleStore();
  const validator = new RuleValidator(defaultRuleSchemaValidator);
  const conflictDetector = new ConflictDetector(store);
  const auditLogger = new AuditLogger(store, clock);
  const permissions = new DefaultPermissionChecker();
  permissions.grantRole('alice', 'tenant-1', 'editor');
  permissions.grantRole('bob', 'tenant-1', 'reviewer');
  permissions.grantRole('admin', 'tenant-1', 'admin');
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

describe('RuleManager.archive', () => {
  it('transitions deprecated → archived', async () => {
    const { manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await manager.submitForReview(r1.id, r1.version, 'alice');
    await manager.approve(r1.id, r1.version, 'bob');
    await manager.deprecate(r1.id, r1.version, 'admin', 'Old');
    const result = await manager.archive(r1.id, r1.version, 'admin', 'Archiving');
    expect(result.status).toBe('archived');
  });

  it('throws RuleTransitionError if status != deprecated', async () => {
    const { manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await expect(manager.archive(r1.id, r1.version, 'admin', 'Nope')).rejects.toThrow(
      RuleTransitionError,
    );
  });

  it('records rule.archived audit with reason', async () => {
    const { store, manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await manager.submitForReview(r1.id, r1.version, 'alice');
    await manager.approve(r1.id, r1.version, 'bob');
    await manager.deprecate(r1.id, r1.version, 'admin', 'Old');
    await manager.archive(r1.id, r1.version, 'admin', 'Done');
    const trail = await store.getAuditTrail(r1.id);
    const event = trail.find((e) => e.type === 'rule.archived');
    expect(event).toBeDefined();
    expect(event?.reason).toBe('Done');
  });
});
