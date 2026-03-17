import { InMemoryRuleStore, RuleTransitionError, RuleNotFoundError } from '@run-iq/context-engine';
import type { RuleInput } from '@run-iq/context-engine';
import { RuleManager } from '../../../src/RuleManager.js';
import { RuleValidator, defaultRuleSchemaValidator } from '../../../src/RuleValidator.js';
import { ConflictDetector } from '../../../src/ConflictDetector.js';
import { AuditLogger } from '../../../src/AuditLogger.js';
import { DefaultPermissionChecker } from '../../../src/PermissionChecker.js';
import { PermissionDeniedError } from '../../../src/errors.js';

const clock = () => '2025-06-15T12:00:00.000Z';

function setup() {
  const store = new InMemoryRuleStore();
  const validator = new RuleValidator(defaultRuleSchemaValidator);
  const conflictDetector = new ConflictDetector(store);
  const auditLogger = new AuditLogger(store, clock);
  const permissions = new DefaultPermissionChecker();
  permissions.grantRole('alice', 'tenant-1', 'editor');
  permissions.grantRole('bob', 'tenant-1', 'reviewer');
  permissions.grantRole('super', 'tenant-1', 'super-admin');
  const manager = new RuleManager({
    store,
    validator,
    conflictDetector,
    auditLogger,
    permissions,
    clock,
  });
  return { store, manager, permissions };
}

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

async function publishTwoVersions(manager: RuleManager) {
  // Publish v1
  const r1 = await manager.createRule(
    validInput({ id: 'rule-rb', payload: JSON.stringify({ model: 'FLAT_RATE', v: 1 }) }),
    'alice',
  );
  await manager.submitForReview(r1.id, r1.version, 'alice');
  await manager.approve(r1.id, r1.version, 'bob');

  // Manually deprecate v1 so only v2 will be published
  await manager.store.updateRuleStatus(r1.id, r1.version, 'deprecated', 'system', 'replaced by v2');

  // Publish v2
  const r2 = await manager.createRule(
    validInput({ id: 'rule-rb', payload: JSON.stringify({ model: 'FLAT_RATE', v: 2 }) }),
    'alice',
  );
  await manager.submitForReview(r2.id, r2.version, 'alice');
  await manager.approve(r2.id, r2.version, 'bob');

  return { v1: r1, v2: r2 };
}

describe('RuleManager.emergencyRollback', () => {
  it('restores target version to published', async () => {
    const { manager } = setup();
    const { v1 } = await publishTwoVersions(manager);
    const result = await manager.emergencyRollback('rule-rb', v1.version, 'super', 'Emergency');
    expect(result.restored.status).toBe('published');
    expect(result.restored.version).toBe(v1.version);
  });

  it('deprecates current published version', async () => {
    const { manager } = setup();
    const { v2 } = await publishTwoVersions(manager);
    const result = await manager.emergencyRollback('rule-rb', 1, 'super', 'Emergency');
    expect(result.deprecated.status).toBe('deprecated');
    expect(result.deprecated.version).toBe(v2.version);
  });

  it('records rule.emergency_rollback audit with reason', async () => {
    const { store, manager } = setup();
    await publishTwoVersions(manager);
    await manager.emergencyRollback('rule-rb', 1, 'super', 'Critical fix');
    const trail = await store.getAuditTrail('rule-rb');
    const event = trail.find((e) => e.type === 'rule.emergency_rollback');
    expect(event).toBeDefined();
    expect(event?.reason).toBe('Critical fix');
  });

  it('throws if reason empty', async () => {
    const { manager } = setup();
    await publishTwoVersions(manager);
    await expect(manager.emergencyRollback('rule-rb', 1, 'super', '')).rejects.toThrow(
      RuleTransitionError,
    );
  });

  it('throws PermissionDeniedError if lacking emergency_rollback', async () => {
    const { manager } = setup();
    await publishTwoVersions(manager);
    await expect(manager.emergencyRollback('rule-rb', 1, 'alice', 'Emergency')).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it('throws RuleNotFoundError if target version missing', async () => {
    const { manager } = setup();
    await expect(
      manager.emergencyRollback('nonexistent', 99, 'super', 'Emergency'),
    ).rejects.toThrow(RuleNotFoundError);
  });
});
