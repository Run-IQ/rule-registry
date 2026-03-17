import type { Rule } from '@run-iq/core';
import { RuleNotFoundError } from '@run-iq/context-engine';
import { RuleValidationError, type ValidationErrorItem, type ValidationWarning } from './errors.js';
import type { RuleManager } from './RuleManager.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SandboxSimulateInput {
  readonly ruleId: string;
  readonly version: number;
  readonly input: Record<string, unknown>;
  readonly meta: {
    readonly tenantId: string;
    readonly effectiveDate: string;
    readonly country?: string;
  };
}

export interface SandboxResult {
  readonly ruleId: string;
  readonly version: number;
  readonly status: 'success' | 'validation_error' | 'schema_error';
  readonly parsedRule?: Rule;
  readonly errors?: readonly ValidationErrorItem[];
  readonly warnings?: readonly ValidationWarning[];
  readonly simulatedAt: string;
}

// ─── RuleSandbox ─────────────────────────────────────────────────────────────

export class RuleSandbox {
  constructor(
    private readonly store: {
      getRule: typeof import('@run-iq/context-engine').InMemoryRuleStore.prototype.getRule;
    },
    private readonly manager: RuleManager,
  ) {}

  async simulate(params: SandboxSimulateInput): Promise<SandboxResult> {
    const rule = await this.store.getRule(params.ruleId, params.version);
    if (!rule) {
      throw new RuleNotFoundError(`Rule "${params.ruleId}" v${params.version} not found`);
    }

    const now = this.manager.clock();

    try {
      const ruleInput = this.toRuleInput(rule);
      await this.manager.config.validator.validatePayload(ruleInput);
      await this.manager.config.validator.validatePeriod(ruleInput);

      return {
        ruleId: params.ruleId,
        version: params.version,
        status: 'success',
        parsedRule: JSON.parse(rule.payload) as Rule,
        simulatedAt: now,
      };
    } catch (err) {
      if (err instanceof RuleValidationError) {
        return {
          ruleId: params.ruleId,
          version: params.version,
          status: 'validation_error',
          errors: err.errors,
          simulatedAt: now,
        };
      }
      throw err;
    }
  }

  private toRuleInput(
    rule: Awaited<ReturnType<typeof this.store.getRule>> & object,
  ): import('@run-iq/context-engine').RuleInput {
    const serialized = rule as import('@run-iq/context-engine').SerializedRule;
    const input: import('@run-iq/context-engine').RuleInput = {
      id: serialized.id,
      model: serialized.model,
      tenantId: serialized.tenantId,
      scope: serialized.scope,
      effectiveFrom: serialized.effectiveFrom,
      priority: serialized.priority,
      tags: serialized.tags,
      payload: serialized.payload,
      createdBy: serialized.createdBy,
    };
    const m = input as unknown as Record<string, unknown>;
    if (serialized.country !== undefined) m['country'] = serialized.country;
    if (serialized.region !== undefined) m['region'] = serialized.region;
    if (serialized.effectiveUntil !== null) m['effectiveUntil'] = serialized.effectiveUntil;
    if (serialized.description !== undefined) m['description'] = serialized.description;
    if (serialized.source !== undefined) m['source'] = serialized.source;
    if (serialized.metadata !== undefined) m['metadata'] = serialized.metadata;
    return input;
  }
}
