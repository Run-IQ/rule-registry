import type { RuleInput } from '@run-iq/context-engine';
import {
  RuleValidationError,
  type ValidationErrorItem,
  type ValidationWarning,
  type RuleValidationResult,
} from './errors.js';

// ─── Schema validator interface ──────────────────────────────────────────────

export interface RuleSchemaValidator {
  validate(value: unknown): {
    valid: boolean;
    errors: Array<{ path: string; message: string; code: string }>;
  };
}

/**
 * Default no-op schema validator — always passes.
 * Host injects a real validator (can wrap hydrateRule from @run-iq/core).
 */
export const defaultRuleSchemaValidator: RuleSchemaValidator = {
  validate() {
    return { valid: true, errors: [] };
  },
};

// ─── RuleValidator ───────────────────────────────────────────────────────────

export class RuleValidator {
  constructor(private readonly schemaValidator: RuleSchemaValidator) {}

  /**
   * Layer 1 — Structural validation of RuleInput.
   * Required fields, types, scope/region coherence.
   */
  async validateStructure(input: RuleInput): Promise<RuleValidationResult> {
    const errors: ValidationErrorItem[] = [];

    if (!input.model?.trim()) {
      errors.push({ field: 'model', message: 'model is required', code: 'MISSING_MODEL' });
    }

    if (!input.tenantId?.trim()) {
      errors.push({ field: 'tenantId', message: 'tenantId is required', code: 'MISSING_TENANT' });
    }

    if (!input.effectiveFrom?.trim()) {
      errors.push({
        field: 'effectiveFrom',
        message: 'effectiveFrom is required',
        code: 'MISSING_EFFECTIVE_FROM',
      });
    }

    if (!input.payload?.trim()) {
      errors.push({ field: 'payload', message: 'payload is required', code: 'MISSING_PAYLOAD' });
    }

    if (!['tenant-specific', 'shared'].includes(input.scope)) {
      errors.push({
        field: 'scope',
        message: "scope must be 'tenant-specific' or 'shared'",
        code: 'INVALID_SCOPE',
      });
    }

    if (input.scope === 'shared' && !input.region?.trim()) {
      errors.push({
        field: 'region',
        message: 'region is required for shared rules',
        code: 'MISSING_REGION',
      });
    }

    if (errors.length > 0) {
      throw new RuleValidationError('Structural validation failed', errors);
    }
    return { valid: true, errors: [], warnings: [] };
  }

  /**
   * Layer 2 — Effective period validation.
   * YYYY-MM-DD format, from/until coherence, temporal warnings.
   */
  async validatePeriod(input: RuleInput): Promise<RuleValidationResult> {
    const errors: ValidationErrorItem[] = [];
    const warnings: ValidationWarning[] = [];
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!dateRegex.test(input.effectiveFrom)) {
      errors.push({
        field: 'effectiveFrom',
        message: 'effectiveFrom must be YYYY-MM-DD',
        code: 'INVALID_DATE_FORMAT',
      });
    }

    if (
      input.effectiveUntil != null &&
      input.effectiveUntil !== '' &&
      !dateRegex.test(input.effectiveUntil)
    ) {
      errors.push({
        field: 'effectiveUntil',
        message: 'effectiveUntil must be YYYY-MM-DD',
        code: 'INVALID_DATE_FORMAT',
      });
    }

    if (
      input.effectiveUntil != null &&
      input.effectiveUntil !== '' &&
      input.effectiveUntil <= input.effectiveFrom
    ) {
      errors.push({
        field: 'effectiveUntil',
        message: `effectiveUntil (${input.effectiveUntil}) must be strictly after effectiveFrom (${input.effectiveFrom})`,
        code: 'INVALID_PERIOD',
      });
    }

    // Warning: rule expiring soon
    if (input.effectiveUntil != null && input.effectiveUntil !== '') {
      const days = Math.floor((new Date(input.effectiveUntil).getTime() - Date.now()) / 86_400_000);
      if (days > 0 && days < 30) {
        warnings.push({
          field: 'effectiveUntil',
          message: `Rule expires in ${days} days — ensure a replacement is ready`,
          code: 'SHORT_LIVED_RULE',
        });
      }
    }

    if (errors.length > 0) {
      throw new RuleValidationError('Period validation failed', errors);
    }
    return { valid: true, errors: [], warnings };
  }

  /**
   * Layer 3 — Payload validation.
   * Step 1: Valid JSON
   * Step 2: Rule schema via injected validator
   * Step 3: Model consistency (payload.model == input.model)
   */
  async validatePayload(input: RuleInput): Promise<RuleValidationResult> {
    const errors: ValidationErrorItem[] = [];

    // Step 1 — Valid JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.payload);
    } catch {
      throw new RuleValidationError('payload is not valid JSON', [
        { field: 'payload', message: 'Invalid JSON syntax', code: 'INVALID_JSON' },
      ]);
    }

    // Step 2 — Schema validation via injected validator
    const schemaResult = this.schemaValidator.validate(parsed);
    if (!schemaResult.valid) {
      throw new RuleValidationError(
        `payload does not match Rule schema: ${schemaResult.errors.length} error(s)`,
        schemaResult.errors.map((e) => ({
          field: `payload.${e.path}`,
          message: e.message,
          code: e.code,
        })),
      );
    }

    // Step 3 — Model consistency
    const parsedRule = parsed as { model?: string };
    if (parsedRule.model && parsedRule.model !== input.model) {
      errors.push({
        field: 'payload.model',
        message: `payload.model "${parsedRule.model}" does not match rule.model "${input.model}"`,
        code: 'MODEL_MISMATCH',
      });
    }

    if (errors.length > 0) {
      throw new RuleValidationError('Payload validation failed', errors);
    }
    return { valid: true, errors: [], warnings: [] };
  }
}
