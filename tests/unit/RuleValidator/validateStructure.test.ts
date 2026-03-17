import type { RuleInput } from '@run-iq/context-engine';
import { RuleValidator, defaultRuleSchemaValidator } from '../../../src/RuleValidator.js';
import { RuleValidationError } from '../../../src/errors.js';

function validInput(overrides?: Partial<RuleInput>): RuleInput {
  const base: RuleInput = {
    model: 'FLAT_RATE',
    tenantId: 'tenant-1',
    scope: 'tenant-specific',
    effectiveFrom: '2025-01-01',
    payload: '{"model":"FLAT_RATE"}',
    createdBy: 'alice',
  };
  if (!overrides) return base;
  return { ...base, ...overrides };
}

describe('RuleValidator.validateStructure', () => {
  const validator = new RuleValidator(defaultRuleSchemaValidator);

  it('passes with valid complete input', async () => {
    const result = await validator.validateStructure(validInput());
    expect(result.valid).toBe(true);
  });

  it('throws MISSING_MODEL if model empty', async () => {
    await expect(validator.validateStructure(validInput({ model: '' }))).rejects.toThrow(
      RuleValidationError,
    );
  });

  it('throws MISSING_TENANT if tenantId empty', async () => {
    await expect(validator.validateStructure(validInput({ tenantId: '' }))).rejects.toThrow(
      RuleValidationError,
    );
  });

  it('throws MISSING_EFFECTIVE_FROM if effectiveFrom empty', async () => {
    await expect(validator.validateStructure(validInput({ effectiveFrom: '' }))).rejects.toThrow(
      RuleValidationError,
    );
  });

  it('throws MISSING_PAYLOAD if payload empty', async () => {
    await expect(validator.validateStructure(validInput({ payload: '' }))).rejects.toThrow(
      RuleValidationError,
    );
  });

  it('throws MISSING_REGION if scope=shared but no region', async () => {
    try {
      await validator.validateStructure(validInput({ scope: 'shared' }));
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RuleValidationError);
      const ve = err as RuleValidationError;
      expect(ve.errors.some((e) => e.code === 'MISSING_REGION')).toBe(true);
    }
  });
});
