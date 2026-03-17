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

describe('RuleValidator.validatePeriod', () => {
  const validator = new RuleValidator(defaultRuleSchemaValidator);

  it('passes with valid YYYY-MM-DD dates', async () => {
    const input = validInput();
    (input as unknown as Record<string, unknown>)['effectiveUntil'] = '2025-12-31';
    const result = await validator.validatePeriod(input);
    expect(result.valid).toBe(true);
  });

  it('throws INVALID_DATE_FORMAT if effectiveFrom bad format', async () => {
    await expect(
      validator.validatePeriod(validInput({ effectiveFrom: '01-01-2025' })),
    ).rejects.toThrow(RuleValidationError);
  });

  it('throws INVALID_DATE_FORMAT if effectiveUntil bad format', async () => {
    const input = validInput();
    (input as unknown as Record<string, unknown>)['effectiveUntil'] = '31/12/2025';
    await expect(validator.validatePeriod(input)).rejects.toThrow(RuleValidationError);
  });

  it('throws INVALID_PERIOD if effectiveUntil <= effectiveFrom', async () => {
    const input = validInput({ effectiveFrom: '2025-06-01' });
    (input as unknown as Record<string, unknown>)['effectiveUntil'] = '2025-01-01';
    await expect(validator.validatePeriod(input)).rejects.toThrow(RuleValidationError);
  });

  it('returns SHORT_LIVED_RULE warning if expires within 30 days', async () => {
    const soon = new Date(Date.now() + 15 * 86_400_000).toISOString().split('T')[0]!;
    const input = validInput({ effectiveFrom: '2020-01-01' });
    (input as unknown as Record<string, unknown>)['effectiveUntil'] = soon;
    const result = await validator.validatePeriod(input);
    expect(result.warnings?.some((w) => w.code === 'SHORT_LIVED_RULE')).toBe(true);
  });
});
