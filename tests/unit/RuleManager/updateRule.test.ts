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

describe('RuleManager.updateRule', () => {
  it('creates new version (never overwrites)', async () => {
    const { manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    const r2 = await manager.updateRule(r1.id, r1.version, { priority: 5 }, 'alice');
    expect(r2.version).toBe(r1.version + 1);
  });

  it('throws RuleTransitionError if status != draft', async () => {
    const { store, manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await store.updateRuleStatus(r1.id, r1.version, 'review', 'alice');
    await expect(manager.updateRule(r1.id, r1.version, { priority: 5 }, 'alice')).rejects.toThrow(
      RuleTransitionError,
    );
  });

  it('records rule.updated audit event', async () => {
    const { store, manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    const r2 = await manager.updateRule(r1.id, r1.version, { priority: 5 }, 'alice');
    const trail = await store.getAuditTrail(r2.id);
    expect(trail.some((e) => e.type === 'rule.updated')).toBe(true);
  });

  it('re-validates payload if updates.payload present', async () => {
    const { manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await expect(
      manager.updateRule(r1.id, r1.version, { payload: '{invalid' }, 'alice'),
    ).rejects.toThrow();
  });
});
