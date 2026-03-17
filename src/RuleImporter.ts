import type { RuleInput, SerializedRule } from '@run-iq/context-engine';
import type { RuleManager } from './RuleManager.js';
import type { RuleValidator } from './RuleValidator.js';
import { parseCSV, csvRowToRuleInput } from './utils.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImportOptions {
  readonly skipOnError?: boolean;
  readonly autoSubmit?: boolean;
  readonly dryRun?: boolean;
}

export interface ImportResult {
  readonly created: SerializedRule[];
  readonly failed: Array<{ input: RuleInput; error: string }>;
  readonly skipped: Array<{ input: RuleInput; reason: string }>;
}

// ─── RuleImporter ────────────────────────────────────────────────────────────

export class RuleImporter {
  constructor(
    private readonly manager: RuleManager,
    private readonly validator: RuleValidator,
  ) {}

  async fromJSON(
    rules: RuleInput[],
    actor: string,
    options?: ImportOptions,
  ): Promise<ImportResult> {
    const result: {
      created: SerializedRule[];
      failed: Array<{ input: RuleInput; error: string }>;
      skipped: Array<{ input: RuleInput; reason: string }>;
    } = { created: [], failed: [], skipped: [] };

    if (options?.dryRun) {
      for (const input of rules) {
        try {
          await this.validator.validateStructure(input);
          await this.validator.validatePeriod(input);
          await this.validator.validatePayload(input);
          result.skipped.push({ input, reason: 'dry-run — validation passed' });
        } catch (err) {
          result.failed.push({ input, error: (err as Error).message });
        }
      }
      return result;
    }

    for (const input of rules) {
      try {
        const rule = await this.manager.createRule(input, actor);
        result.created.push(rule);

        if (options?.autoSubmit) {
          await this.manager.submitForReview(rule.id, rule.version, actor);
        }
      } catch (err) {
        if (options?.skipOnError) {
          result.failed.push({ input, error: (err as Error).message });
        } else {
          throw err;
        }
      }
    }

    return result;
  }

  async fromCSV(
    csvContent: string,
    tenantId: string,
    actor: string,
    options?: ImportOptions,
  ): Promise<ImportResult> {
    const rows = parseCSV(csvContent);
    if (rows.length < 2) {
      return { created: [], failed: [], skipped: [] };
    }

    const headers = rows[0]!;
    const dataRows = rows.slice(1);
    const inputs = dataRows.map((row) => csvRowToRuleInput(row, headers, tenantId));

    return this.fromJSON(inputs, actor, options);
  }

  // v2 — LLM import
  async fromLLMOutput(_output: unknown, _actor: string): Promise<SerializedRule> {
    throw new Error(
      'fromLLMOutput is not implemented in v1. ' +
        'Use fromJSON() with the output of @run-iq/mcp-server.',
    );
  }
}
