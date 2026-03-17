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

describe('RuleManager.approve', () => {
  it('transitions review → published', async () => {
    const { manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await manager.submitForReview(r1.id, r1.version, 'alice');
    const result = await manager.approve(r1.id, r1.version, 'bob');
    expect(result.published.status).toBe('published');
  });

  it('throws RulePermissionError if actor == createdBy', async () => {
    // Give alice reviewer permissions too
    const store2 = new InMemoryRuleStore();
    const p = new DefaultPermissionChecker();
    p.grantRole('alice', 'tenant-1', 'reviewer');
    const mgr = new RuleManager({
      store: store2,
      validator: new RuleValidator(defaultRuleSchemaValidator),
      conflictDetector: new ConflictDetector(store2),
      auditLogger: new AuditLogger(store2, clock),
      permissions: p,
      clock,
    });
    const r1 = await mgr.createRule(validInput(), 'alice');
    await mgr.submitForReview(r1.id, r1.version, 'alice');
    await expect(mgr.approve(r1.id, r1.version, 'alice')).rejects.toThrow(RulePermissionError);
  });

  it('auto-deprecates overlapping published rules', async () => {
    const { store, manager } = setup();
    // Publish r1
    const r1 = await manager.createRule(
      validInput({ payload: JSON.stringify({ model: 'FLAT_RATE', v: 1 }) }),
      'alice',
    );
    await manager.submitForReview(r1.id, r1.version, 'alice');
    await manager.approve(r1.id, r1.version, 'bob');

    // Publish r2 overlapping — should deprecate r1
    const r2 = await manager.createRule(
      validInput({ payload: JSON.stringify({ model: 'FLAT_RATE', v: 2 }) }),
      'alice',
    );
    await manager.submitForReview(r2.id, r2.version, 'alice');
    const result = await manager.approve(r2.id, r2.version, 'bob');
    expect(result.deprecated.length).toBeGreaterThan(0);

    const old = await store.getRule(r1.id, r1.version);
    expect(old?.status).toBe('deprecated');
  });

  it('records rule.published audit event', async () => {
    const { store, manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await manager.submitForReview(r1.id, r1.version, 'alice');
    await manager.approve(r1.id, r1.version, 'bob');
    const trail = await store.getAuditTrail(r1.id);
    expect(trail.some((e) => e.type === 'rule.published')).toBe(true);
  });

  it('records rule.conflict_acknowledged if warnings', async () => {
    const { store, manager } = setup();
    // Publish r1
    const r1 = await manager.createRule(
      validInput({ priority: 10, payload: JSON.stringify({ model: 'FLAT_RATE', v: 1 }) }),
      'alice',
    );
    await manager.submitForReview(r1.id, r1.version, 'alice');
    await manager.approve(r1.id, r1.version, 'bob');

    // Submit r2 with different priority (warning-level overlap)
    const r2 = await manager.createRule(
      validInput({ priority: 5, payload: JSON.stringify({ model: 'FLAT_RATE', v: 2 }) }),
      'alice',
    );
    await manager.submitForReview(r2.id, r2.version, 'alice');
    await manager.approve(r2.id, r2.version, 'bob');

    const trail = await store.getAuditTrail(r2.id);
    expect(trail.some((e) => e.type === 'rule.conflict_acknowledged')).toBe(true);
  });

  it('throws RuleTransitionError if status != review', async () => {
    const { manager } = setup();
    const r1 = await manager.createRule(validInput(), 'alice');
    await expect(manager.approve(r1.id, r1.version, 'bob')).rejects.toThrow(RuleTransitionError);
  });
});
