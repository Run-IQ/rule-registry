import type { RuleStore, RuleListQuery, SerializedRule } from '@run-iq/context-engine';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DateGap {
  readonly from: string;
  readonly to: string;
  readonly model: string;
  readonly tenantId: string;
}

// ─── EffectiveDateManager ────────────────────────────────────────────────────

export class EffectiveDateManager {
  constructor(
    private readonly store: RuleStore,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async resolveAtDate(tenantId: string, atDate: string, model?: string): Promise<SerializedRule[]> {
    return this.store.getRulesAtDate(tenantId, atDate, model);
  }

  async findGaps(tenantId: string, model: string, from: string, to: string): Promise<DateGap[]> {
    const rules = await this.store.listRules({
      tenantId,
      model,
      status: 'published',
      effectiveFrom: from,
      effectiveTo: to,
    });

    const gaps: DateGap[] = [];
    let cursor = from;

    const sorted = [...rules].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

    for (const rule of sorted) {
      if (rule.effectiveFrom > cursor) {
        gaps.push({ from: cursor, to: rule.effectiveFrom, model, tenantId });
      }
      if (rule.effectiveUntil && rule.effectiveUntil > cursor) {
        cursor = rule.effectiveUntil;
      }
    }

    if (cursor < to) {
      gaps.push({ from: cursor, to, model, tenantId });
    }

    return gaps;
  }

  async nextChange(tenantId: string, model?: string): Promise<string | null> {
    const todayStr = this.clock().split('T')[0]!;
    const query: RuleListQuery = { tenantId, status: 'published' };
    if (model !== undefined) {
      (query as unknown as Record<string, unknown>)['model'] = model;
    }
    const rules = await this.store.listRules(query);

    const futureDates = rules
      .flatMap((r) => [r.effectiveFrom, r.effectiveUntil].filter(Boolean) as string[])
      .filter((d) => d > todayStr)
      .sort();

    return futureDates[0] ?? null;
  }
}
