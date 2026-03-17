import { InMemoryRuleStore } from '@run-iq/context-engine';
import type { RuleInput } from '@run-iq/context-engine';
import { RuleManager } from '../../../src/RuleManager.js';
import { RuleValidator, defaultRuleSchemaValidator } from '../../../src/RuleValidator.js';
import { ConflictDetector } from '../../../src/ConflictDetector.js';
import { AuditLogger } from '../../../src/AuditLogger.js';
import { DefaultPermissionChecker } from '../../../src/PermissionChecker.js';
import { RuleValidationError, PermissionDeniedError } from '../../../src/errors.js';

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

describe('RuleManager.createRule', () => {
  it('creates rule with status draft', async () => {
    const { manager } = setup();
    const rule = await manager.createRule(validInput(), 'alice');
    expect(rule.status).toBe('draft');
  });

  it('version = 1 for new ID', async () => {
    const { manager } = setup();
    const rule = await manager.createRule(validInput(), 'alice');
    expect(rule.version).toBe(1);
  });

  it('version = N+1 if ID exists', async () => {
    const { manager } = setup();
    const r1 = await manager.createRule(validInput({ id: 'fixed-id' }), 'alice');
    const r2 = await manager.createRule(
      validInput({ id: 'fixed-id', payload: JSON.stringify({ model: 'FLAT_RATE', v: 2 }) }),
      'alice',
    );
    expect(r1.version).toBe(1);
    expect(r2.version).toBe(2);
  });

  it('records rule.created audit event', async () => {
    const { store, manager } = setup();
    const rule = await manager.createRule(validInput(), 'alice');
    const trail = await store.getAuditTrail(rule.id);
    expect(trail.some((e) => e.type === 'rule.created')).toBe(true);
  });

  it('throws RuleValidationError if model absent', async () => {
    const { manager } = setup();
    await expect(manager.createRule(validInput({ model: '' }), 'alice')).rejects.toThrow(
      RuleValidationError,
    );
  });

  it('throws RuleValidationError if payload invalid JSON', async () => {
    const { manager } = setup();
    await expect(manager.createRule(validInput({ payload: '{bad' }), 'alice')).rejects.toThrow(
      RuleValidationError,
    );
  });

  it('throws RuleValidationError if payload.model mismatch', async () => {
    const { manager } = setup();
    await expect(
      manager.createRule(
        validInput({
          model: 'FLAT_RATE',
          payload: JSON.stringify({ model: 'PROGRESSIVE' }),
        }),
        'alice',
      ),
    ).rejects.toThrow(RuleValidationError);
  });

  it('throws PermissionDeniedError if lacking rule:create', async () => {
    const { manager, permissions } = setup();
    permissions.grantRole('viewer', 'tenant-1', 'viewer');
    await expect(manager.createRule(validInput(), 'viewer')).rejects.toThrow(PermissionDeniedError);
  });
});
