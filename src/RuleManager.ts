import type {
  RuleStore,
  RuleInput,
  SerializedRule,
  RuleConflict,
  RuleAuditEvent,
} from '@run-iq/context-engine';
import { sha256 } from '@run-iq/context-engine';
import { RuleNotFoundError, RuleTransitionError } from '@run-iq/context-engine';
import { RuleConflictBlockerError, RulePermissionError } from './errors.js';
import type { RuleValidator } from './RuleValidator.js';
import type { ConflictDetector } from './ConflictDetector.js';
import type { AuditLogger } from './AuditLogger.js';
import type { PermissionChecker } from './PermissionChecker.js';
import { generateId } from './utils.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toRuleInput(rule: SerializedRule): RuleInput {
  const input: RuleInput = {
    id: rule.id,
    model: rule.model,
    tenantId: rule.tenantId,
    scope: rule.scope,
    effectiveFrom: rule.effectiveFrom,
    priority: rule.priority,
    tags: rule.tags,
    payload: rule.payload,
    createdBy: rule.createdBy,
  };

  const mutable = input as unknown as Record<string, unknown>;
  if (rule.country !== undefined) mutable['country'] = rule.country;
  if (rule.region !== undefined) mutable['region'] = rule.region;
  if (rule.effectiveUntil !== null) mutable['effectiveUntil'] = rule.effectiveUntil;
  if (rule.description !== undefined) mutable['description'] = rule.description;
  if (rule.source !== undefined) mutable['source'] = rule.source;
  if (rule.metadata !== undefined) mutable['metadata'] = rule.metadata;

  return input;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface RuleManagerConfig {
  readonly store: RuleStore;
  readonly validator: RuleValidator;
  readonly conflictDetector: ConflictDetector;
  readonly auditLogger: AuditLogger;
  readonly permissions: PermissionChecker;
  readonly clock?: () => string;
}

// ─── RuleManager ─────────────────────────────────────────────────────────────

export class RuleManager {
  readonly clock: () => string;

  constructor(readonly config: RuleManagerConfig) {
    this.clock = config.clock ?? (() => new Date().toISOString());
  }

  get store(): RuleStore {
    return this.config.store;
  }

  // ─── Creation ────────────────────────────────────────────────────────────

  async createRule(input: RuleInput, actor: string): Promise<SerializedRule> {
    await this.config.permissions.check(actor, input.tenantId, 'rule:create');
    await this.config.validator.validateStructure(input);
    await this.config.validator.validatePeriod(input);
    await this.config.validator.validatePayload(input);

    const rule = await this.config.store.saveRule({ ...input, createdBy: actor });

    await this.logAudit({
      ruleId: rule.id,
      version: rule.version,
      tenantId: rule.tenantId,
      type: 'rule.created',
      actor,
      after: rule,
    });

    return rule;
  }

  // ─── Update ──────────────────────────────────────────────────────────────

  async updateRule(
    ruleId: string,
    version: number,
    updates: Partial<RuleInput>,
    actor: string,
  ): Promise<SerializedRule> {
    const existing = await this.config.store.getRule(ruleId, version);
    if (!existing) throw new RuleNotFoundError(`Rule "${ruleId}" v${version} not found`);
    if (existing.status !== 'draft') {
      throw new RuleTransitionError(
        `Cannot update rule "${ruleId}" v${version}: ` +
          `status is "${existing.status}", only draft rules are editable. ` +
          `Create a new version instead.`,
      );
    }

    await this.config.permissions.check(actor, existing.tenantId, 'rule:update');

    const merged: RuleInput = {
      id: ruleId,
      model: updates.model ?? existing.model,
      tenantId: existing.tenantId,
      scope: updates.scope ?? existing.scope,
      effectiveFrom: updates.effectiveFrom ?? existing.effectiveFrom,
      priority: updates.priority ?? existing.priority,
      tags: updates.tags ?? existing.tags,
      payload: updates.payload ?? existing.payload,
      createdBy: actor,
    };

    const mMerged = merged as unknown as Record<string, unknown>;
    const country = updates.country ?? existing.country;
    if (country !== undefined) mMerged['country'] = country;
    const region = updates.region ?? existing.region;
    if (region !== undefined) mMerged['region'] = region;
    const effectiveUntil =
      updates.effectiveUntil !== undefined ? updates.effectiveUntil : existing.effectiveUntil;
    if (effectiveUntil !== null && effectiveUntil !== undefined) {
      mMerged['effectiveUntil'] = effectiveUntil;
    }
    const description = updates.description ?? existing.description;
    if (description !== undefined) mMerged['description'] = description;
    const source = updates.source ?? existing.source;
    if (source !== undefined) mMerged['source'] = source;
    const metadata = updates.metadata ?? existing.metadata;
    if (metadata !== undefined) mMerged['metadata'] = metadata;

    await this.config.validator.validateStructure(merged);
    if (updates.effectiveFrom || updates.effectiveUntil) {
      await this.config.validator.validatePeriod(merged);
    }
    if (updates.payload) {
      await this.config.validator.validatePayload(merged);
    }

    const updated = await this.config.store.saveRule(merged);

    await this.logAudit({
      ruleId: updated.id,
      version: updated.version,
      tenantId: updated.tenantId,
      type: 'rule.updated',
      actor,
      before: existing,
      after: updated,
    });

    return updated;
  }

  // ─── Workflow ────────────────────────────────────────────────────────────

  async submitForReview(
    ruleId: string,
    version: number,
    actor: string,
  ): Promise<{ rule: SerializedRule; conflicts: RuleConflict[] }> {
    const rule = await this.config.store.getRule(ruleId, version);
    if (!rule) throw new RuleNotFoundError(`Rule "${ruleId}" v${version} not found`);
    if (rule.status !== 'draft') {
      throw new RuleTransitionError(
        `Cannot submit rule "${ruleId}": status is "${rule.status}", expected "draft"`,
      );
    }

    await this.config.permissions.check(actor, rule.tenantId, 'rule:submit');
    const ruleInput = toRuleInput(rule);
    await this.config.validator.validateStructure(ruleInput);
    await this.config.validator.validatePeriod(ruleInput);
    await this.config.validator.validatePayload(ruleInput);

    const conflicts = await this.config.conflictDetector.detect(ruleInput);
    const criticals = conflicts.filter((c) => c.severity === 'critical');

    if (criticals.length > 0) {
      await this.logAudit({
        ruleId,
        version,
        tenantId: rule.tenantId,
        type: 'rule.conflict_detected',
        actor,
        metadata: { conflicts: criticals, blocked: true },
      });
      throw new RuleConflictBlockerError(
        `Cannot submit rule "${ruleId}" v${version}: ` +
          `${criticals.length} critical conflict(s) must be resolved first.`,
        criticals,
      );
    }

    const updated = await this.config.store.updateRuleStatus(ruleId, version, 'review', actor);

    await this.logAudit({
      ruleId,
      version,
      tenantId: rule.tenantId,
      type: 'rule.submitted_for_review',
      actor,
      after: updated,
    });

    if (conflicts.length > 0) {
      await this.logAudit({
        ruleId,
        version,
        tenantId: rule.tenantId,
        type: 'rule.conflict_detected',
        actor,
        reason: 'Non-blocking conflicts — reviewer must acknowledge before publishing',
        metadata: { conflicts, blocked: false },
      });
    }

    return { rule: updated, conflicts };
  }

  async sendBackToDraft(
    ruleId: string,
    version: number,
    actor: string,
    comment: string,
  ): Promise<SerializedRule> {
    const rule = await this.config.store.getRule(ruleId, version);
    if (!rule) throw new RuleNotFoundError(`Rule "${ruleId}" v${version} not found`);
    if (rule.status !== 'review') {
      throw new RuleTransitionError(
        `Cannot send back rule "${ruleId}": status is "${rule.status}", expected "review"`,
      );
    }

    await this.config.permissions.check(actor, rule.tenantId, 'rule:review');
    this.enforceReviewerDifference(rule, actor);

    const updated = await this.config.store.updateRuleStatus(
      ruleId,
      version,
      'draft',
      actor,
      comment,
    );

    await this.logAudit({
      ruleId,
      version,
      tenantId: rule.tenantId,
      type: 'rule.sent_back_to_draft',
      actor,
      reason: comment,
      after: updated,
    });

    return updated;
  }

  async approve(
    ruleId: string,
    version: number,
    actor: string,
    notes?: string,
  ): Promise<{ published: SerializedRule; deprecated: SerializedRule[] }> {
    const rule = await this.config.store.getRule(ruleId, version);
    if (!rule) throw new RuleNotFoundError(`Rule "${ruleId}" v${version} not found`);
    if (rule.status !== 'review') {
      throw new RuleTransitionError(
        `Cannot approve rule "${ruleId}": status is "${rule.status}", expected "review"`,
      );
    }

    await this.config.permissions.check(actor, rule.tenantId, 'rule:approve');
    this.enforceReviewerDifference(rule, actor);

    // Acknowledge warnings if any
    const conflicts = await this.config.conflictDetector.detect(toRuleInput(rule));
    const warnings = conflicts.filter((c) => c.severity === 'warning');
    if (warnings.length > 0) {
      await this.logAudit({
        ruleId,
        version,
        tenantId: rule.tenantId,
        type: 'rule.conflict_acknowledged',
        actor,
        reason: notes ?? 'Reviewer acknowledged overlapping rules',
        metadata: { conflicts: warnings },
      });
    }

    const result = await this.config.store.publishRule(ruleId, version, actor);

    await this.logAudit({
      ruleId,
      version,
      tenantId: rule.tenantId,
      type: 'rule.published',
      actor,
      after: result.published,
    });

    return result;
  }

  async deprecate(
    ruleId: string,
    version: number,
    actor: string,
    reason: string,
  ): Promise<SerializedRule> {
    const rule = await this.config.store.getRule(ruleId, version);
    if (!rule) throw new RuleNotFoundError(`Rule "${ruleId}" v${version} not found`);
    if (rule.status !== 'published') {
      throw new RuleTransitionError(
        `Cannot deprecate rule "${ruleId}": status is "${rule.status}", expected "published"`,
      );
    }

    await this.config.permissions.check(actor, rule.tenantId, 'rule:deprecate');

    const updated = await this.config.store.updateRuleStatus(
      ruleId,
      version,
      'deprecated',
      actor,
      reason,
    );

    await this.logAudit({
      ruleId,
      version,
      tenantId: rule.tenantId,
      type: 'rule.deprecated',
      actor,
      reason,
      after: updated,
    });

    return updated;
  }

  async archive(
    ruleId: string,
    version: number,
    actor: string,
    reason: string,
  ): Promise<SerializedRule> {
    const rule = await this.config.store.getRule(ruleId, version);
    if (!rule) throw new RuleNotFoundError(`Rule "${ruleId}" v${version} not found`);
    if (rule.status !== 'deprecated') {
      throw new RuleTransitionError(
        `Cannot archive rule "${ruleId}": status is "${rule.status}", expected "deprecated"`,
      );
    }

    await this.config.permissions.check(actor, rule.tenantId, 'rule:archive');

    const updated = await this.config.store.updateRuleStatus(
      ruleId,
      version,
      'archived',
      actor,
      reason,
    );

    await this.logAudit({
      ruleId,
      version,
      tenantId: rule.tenantId,
      type: 'rule.archived',
      actor,
      reason,
      after: updated,
    });

    return updated;
  }

  async emergencyRollback(
    ruleId: string,
    targetVersion: number,
    actor: string,
    reason: string,
  ): Promise<{ restored: SerializedRule; deprecated: SerializedRule }> {
    const target = await this.config.store.getRule(ruleId, targetVersion);
    if (!target) throw new RuleNotFoundError(`Rule "${ruleId}" v${targetVersion} not found`);

    await this.config.permissions.check(actor, target.tenantId, 'rule:emergency_rollback');

    if (!reason?.trim()) {
      throw new RuleTransitionError('reason is mandatory for emergency rollback');
    }

    const result = await this.config.store.rollbackRule(ruleId, targetVersion, actor, reason);

    await this.logAudit({
      ruleId,
      version: targetVersion,
      tenantId: target.tenantId,
      type: 'rule.emergency_rollback',
      actor,
      reason,
      before: result.deprecated,
      after: result.restored,
    });

    return result;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private enforceReviewerDifference(rule: SerializedRule, actor: string): void {
    if (rule.createdBy === actor) {
      throw new RulePermissionError(
        `Actor "${actor}" cannot review rule "${rule.id}" v${rule.version}: ` +
          `they are the rule's creator. ` +
          `Separation of powers requires a different person to review.`,
      );
    }
  }

  private async logAudit(params: {
    ruleId: string;
    version: number;
    tenantId: string;
    type: RuleAuditEvent['type'];
    actor: string;
    reason?: string;
    before?: Partial<SerializedRule>;
    after?: Partial<SerializedRule>;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    // Build the audit chain — compute prevChecksum from the last event
    const trail = await this.config.auditLogger.getTrail(params.ruleId);
    const lastEvent = trail.at(-1);
    const prevChecksum = lastEvent ? sha256(JSON.stringify(lastEvent)) : undefined;

    const eventMetadata: Record<string, unknown> = { ...params.metadata };
    if (prevChecksum !== undefined) {
      eventMetadata['prevChecksum'] = prevChecksum;
    }

    const event: RuleAuditEvent = {
      id: generateId(),
      ruleId: params.ruleId,
      version: params.version,
      tenantId: params.tenantId,
      type: params.type,
      actor: params.actor,
      recordedAt: this.clock(),
    };

    const mutable = event as unknown as Record<string, unknown>;
    if (params.reason !== undefined) mutable['reason'] = params.reason;
    if (params.before !== undefined) mutable['before'] = params.before;
    if (params.after !== undefined) mutable['after'] = params.after;
    if (Object.keys(eventMetadata).length > 0) mutable['metadata'] = eventMetadata;

    await this.config.auditLogger.log(event);
  }
}
