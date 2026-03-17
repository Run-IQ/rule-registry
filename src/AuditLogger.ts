import type {
  RuleStore,
  RuleAuditEvent,
  RuleAuditEventType,
  RuleStatus,
} from '@run-iq/context-engine';
import { sha256 } from '@run-iq/context-engine';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuditReport {
  readonly ruleId: string;
  readonly tenantId: string;
  readonly exportedAt: string;
  readonly summary: {
    readonly totalVersions: number;
    readonly currentStatus: RuleStatus;
    readonly firstCreatedAt: string;
    readonly lastModifiedAt: string;
    readonly hasRollback: boolean;
    readonly hasConflicts: boolean;
  };
  readonly timeline: ReadonlyArray<{
    readonly date: string;
    readonly action: string;
    readonly actor: string;
    readonly reason?: string;
    readonly version: number;
  }>;
}

export interface IntegrityResult {
  readonly valid: boolean;
  readonly issues: readonly string[];
  readonly eventCount: number;
  readonly checkedAt: string;
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export const AUDIT_EVENT_LABELS: Record<RuleAuditEventType, string> = {
  'rule.created': 'Rule created',
  'rule.updated': 'Rule updated',
  'rule.submitted_for_review': 'Submitted for review',
  'rule.sent_back_to_draft': 'Sent back to draft',
  'rule.approved': 'Approved',
  'rule.published': 'Published',
  'rule.deprecated': 'Deprecated',
  'rule.archived': 'Archived',
  'rule.rollback': 'Rollback',
  'rule.emergency_rollback': 'Emergency rollback',
  'rule.conflict_detected': 'Conflict detected',
  'rule.conflict_acknowledged': 'Conflict acknowledged by reviewer',
};

// ─── AuditLogger ─────────────────────────────────────────────────────────────

export class AuditLogger {
  constructor(
    private readonly store: RuleStore,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async log(event: RuleAuditEvent): Promise<void> {
    await this.store.recordAuditEvent(event);
  }

  async getTrail(ruleId: string): Promise<RuleAuditEvent[]> {
    return this.store.getAuditTrail(ruleId);
  }

  async exportForAudit(ruleId: string, tenantId: string): Promise<AuditReport> {
    const events = await this.getTrail(ruleId);
    const history = await this.store.getRuleHistory(ruleId);

    const lastRule = history.at(-1);
    const currentStatus: RuleStatus = lastRule?.status ?? ('unknown' as RuleStatus);

    return {
      ruleId,
      tenantId,
      exportedAt: this.clock(),
      summary: {
        totalVersions: history.length,
        currentStatus,
        firstCreatedAt: events[0]?.recordedAt ?? '',
        lastModifiedAt: events.at(-1)?.recordedAt ?? '',
        hasRollback: events.some((e) => e.type === 'rule.emergency_rollback'),
        hasConflicts: events.some((e) => e.type === 'rule.conflict_detected'),
      },
      timeline: events.map((e) => {
        const entry: {
          date: string;
          action: string;
          actor: string;
          reason?: string;
          version: number;
        } = {
          date: e.recordedAt,
          action: AUDIT_EVENT_LABELS[e.type] ?? e.type,
          actor: e.actor,
          version: e.version,
        };
        if (e.reason !== undefined) {
          (entry as unknown as Record<string, unknown>)['reason'] = e.reason;
        }
        return entry;
      }),
    };
  }

  async verifyIntegrity(ruleId: string): Promise<IntegrityResult> {
    const events = await this.getTrail(ruleId);
    const issues: string[] = [];

    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1]!;
      const curr = events[i]!;
      const expected = sha256(JSON.stringify(prev));

      if ((curr.metadata as Record<string, unknown> | undefined)?.['prevChecksum'] !== expected) {
        issues.push(
          `Integrity broken between event ${i - 1} (${prev.type} at ${prev.recordedAt}) ` +
            `and event ${i} (${curr.type} at ${curr.recordedAt})`,
        );
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      eventCount: events.length,
      checkedAt: this.clock(),
    };
  }
}
