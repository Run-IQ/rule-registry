import type { RuleInput } from '@run-iq/context-engine';
import { RuleValidator, defaultRuleSchemaValidator } from '../../../src/RuleValidator.js';
import { RuleValidationError } from '../../../src/errors.js';

function validInput(overrides?: Partial<RuleInput>): RuleInput {
  const base: RuleInput = {
    model: 'FLAT_RATE',
    tenantId: 'tenant-1',
    scope: 'tenant-specific',
    effectiveFrom: '2025-01-01',
    payload: JSON.stringify({ model: 'FLAT_RATE', id: 'r1', version: 1, priority: 1, params: {} }),
    createdBy: 'alice',
  };
  if (!overrides) return base;
  return { ...base, ...overrides };
}

describe('RuleValidator.validatePayload', () => {
  it('passes with valid JSON and matching model', async () => {
    const validator = new RuleValidator(defaultRuleSchemaValidator);
    const result = await validator.validatePayload(validInput());
    expect(result.valid).toBe(true);
  });

  it('throws INVALID_JSON if payload not valid JSON', async () => {
    const validator = new RuleValidator(defaultRuleSchemaValidator);
    await expect(validator.validatePayload(validInput({ payload: '{invalid' }))).rejects.toThrow(
      RuleValidationError,
    );
  });

  it('throws with schema errors when validator fails', async () => {
    const failingValidator = {
      validate: () => ({
        valid: false,
        errors: [{ path: 'id', message: 'id is required', code: 'REQUIRED' }],
      }),
    };
    const validator = new RuleValidator(failingValidator);
    try {
      await validator.validatePayload(validInput());
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RuleValidationError);
      const ve = err as RuleValidationError;
      expect(ve.errors[0]?.field).toBe('payload.id');
    }
  });

  it('throws MODEL_MISMATCH if payload.model != input.model', async () => {
    const validator = new RuleValidator(defaultRuleSchemaValidator);
    const input = validInput({
      model: 'FLAT_RATE',
      payload: JSON.stringify({ model: 'PROGRESSIVE', id: 'r1' }),
    });
    try {
      await validator.validatePayload(input);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RuleValidationError);
      expect((err as RuleValidationError).errors[0]?.code).toBe('MODEL_MISMATCH');
    }
  });

  it('passes when payload has no model field', async () => {
    const validator = new RuleValidator(defaultRuleSchemaValidator);
    const input = validInput({ payload: JSON.stringify({ id: 'r1', params: {} }) });
    const result = await validator.validatePayload(input);
    expect(result.valid).toBe(true);
  });

  it('uses injected schema validator', async () => {
    let called = false;
    const spy = {
      validate: () => {
        called = true;
        return { valid: true, errors: [] };
      },
    };
    const validator = new RuleValidator(spy);
    await validator.validatePayload(validInput());
    expect(called).toBe(true);
  });
});
