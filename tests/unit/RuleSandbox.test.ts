import { describe, it, expect } from 'vitest';
import type { RuleInput } from '@run-iq/context-engine';
import { InMemoryRuleStore } from '@run-iq/context-engine';
import { RuleManager } from '../../src/RuleManager.js';
import { RuleValidator, defaultRuleSchemaValidator } from '../../src/RuleValidator.js';
import { ConflictDetector } from '../../src/ConflictDetector.js';
import { AuditLogger } from '../../src/AuditLogger.js';
import { DefaultPermissionChecker } from '../../src/PermissionChecker.js';
import { RuleSandbox } from '../../src/RuleSandbox.js';
import type { RuleValidator } from '../../src/RuleValidator.js';

const clock = () => '2025-06-15T12:00:00.000Z';

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
  const sandbox = new RuleSandbox(store, manager);
  return { store, manager, sandbox };
}

describe('RuleSandbox', () => {
  it('simulate returns success for a valid rule', async () => {
    const { manager, sandbox } = setup();
    const rule = await manager.createRule(validInput(), 'alice');

    const result = await sandbox.simulate({
      ruleId: rule.id,
      version: rule.version,
      input: { amount: 1000 },
      meta: { tenantId: 'tenant-1', effectiveDate: '2025-06-01' },
    });

    expect(result.status).toBe('success');
    expect(result.ruleId).toBe(rule.id);
    expect(result.version).toBe(rule.version);
    expect(result.parsedRule).toBeDefined();
    expect(result.simulatedAt).toBe('2025-06-15T12:00:00.000Z');
  });

  it('simulate throws RuleNotFoundError for nonexistent rule', async () => {
    const { sandbox } = setup();

    await expect(
      sandbox.simulate({
        ruleId: 'nonexistent',
        version: 1,
        input: {},
        meta: { tenantId: 'tenant-1', effectiveDate: '2025-06-01' },
      }),
    ).rejects.toThrow(/not found/);
  });

  it('simulate returns validation_error for invalid payload', async () => {
    const { store, sandbox } = setup();

    // Save a rule with invalid payload directly via store
    const rule = await store.saveRule(validInput({ payload: 'not-json-at-all{{{' }));

    const result = await sandbox.simulate({
      ruleId: rule.id,
      version: rule.version,
      input: {},
      meta: { tenantId: 'tenant-1', effectiveDate: '2025-06-01' },
    });

    expect(result.status).toBe('validation_error');
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('simulate handles rule with optional fields (country, region, description)', async () => {
    const { manager, sandbox } = setup();
    const rule = await manager.createRule(
      validInput({
        country: 'TG',
        description: 'Test rule with extra fields',
      }),
      'alice',
    );

    const result = await sandbox.simulate({
      ruleId: rule.id,
      version: rule.version,
      input: { amount: 500 },
      meta: { tenantId: 'tenant-1', effectiveDate: '2025-06-01', country: 'TG' },
    });

    expect(result.status).toBe('success');
  });

  it('simulate returns validation_error for invalid period', async () => {
    const { store, sandbox } = setup();

    // Save a rule with effectiveFrom after effectiveUntil
    const input = validInput();
    const m = input as unknown as Record<string, unknown>;
    m['effectiveFrom'] = '2025-12-01';
    m['effectiveUntil'] = '2025-01-01';
    const rule = await store.saveRule(input);

    const result = await sandbox.simulate({
      ruleId: rule.id,
      version: rule.version,
      input: {},
      meta: { tenantId: 'tenant-1', effectiveDate: '2025-06-01' },
    });

    // Period validation should catch effectiveFrom > effectiveUntil
    expect(result.status).toBe('validation_error');
  });

  it('simulate re-throws non-RuleValidationError errors', async () => {
    const { store, manager } = setup();
    const rule = await manager.createRule(validInput(), 'alice');

    // Create a sandbox with a broken validator to trigger a non-RuleValidationError
    const brokenValidator = {
      ...manager.config.validator,
      validatePayload: async () => {
        throw new Error('unexpected internal error');
      },
    };
    const brokenManager = new RuleManager({
      ...manager.config,
      validator: brokenValidator as unknown as RuleValidator,
    });
    const sandbox = new RuleSandbox(store, brokenManager);

    await expect(
      sandbox.simulate({
        ruleId: rule.id,
        version: rule.version,
        input: {},
        meta: { tenantId: 'tenant-1', effectiveDate: '2025-06-01' },
      }),
    ).rejects.toThrow('unexpected internal error');
  });
});
