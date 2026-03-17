import type {
  RuleStore,
  RuleQuery,
  RuleListQuery,
  RuleInput,
  SerializedRule,
  RuleMetadata,
  RuleStatus,
  RuleAuditEvent,
  RuleConflict,
} from '@run-iq/context-engine';
import { RuleTransitionError } from '@run-iq/context-engine';
import { RegionRegistry, type RegionConfig } from './RegionRegistry.js';
import {
  RuleValidator,
  defaultRuleSchemaValidator,
  type RuleSchemaValidator,
} from './RuleValidator.js';
import { ConflictDetector } from './ConflictDetector.js';
import { AuditLogger } from './AuditLogger.js';
import { EffectiveDateManager } from './EffectiveDateManager.js';
import { ScopeManager } from './ScopeManager.js';
import { RuleManager } from './RuleManager.js';
import { RuleSandbox } from './RuleSandbox.js';
import { RuleImporter } from './RuleImporter.js';
import { DefaultPermissionChecker, type PermissionChecker } from './PermissionChecker.js';

// ─── Config ──────────────────────────────────────────────────────────────────

export interface RuleRegistryConfig {
  readonly store: RuleStore;
  readonly regions?: readonly RegionConfig[];
  readonly ruleSchemaValidator?: RuleSchemaValidator;
  readonly permissions?: PermissionChecker;
  readonly clock?: () => string;
}

// ─── RuleRegistry ────────────────────────────────────────────────────────────

export class RuleRegistry implements RuleStore {
  private readonly manager: RuleManager;
  private readonly conflictDetector: ConflictDetector;
  private readonly auditLogger: AuditLogger;
  private readonly scopeManager: ScopeManager;
  private readonly regionRegistry: RegionRegistry;
  private readonly validator: RuleValidator;

  constructor(config: RuleRegistryConfig) {
    this.regionRegistry = new RegionRegistry(config.regions ?? []);

    this.validator = new RuleValidator(config.ruleSchemaValidator ?? defaultRuleSchemaValidator);

    const permissions = config.permissions ?? new DefaultPermissionChecker();
    const clock = config.clock ?? (() => new Date().toISOString());

    this.auditLogger = new AuditLogger(config.store, clock);
    this.conflictDetector = new ConflictDetector(config.store);
    this.scopeManager = new ScopeManager(config.store, this.regionRegistry);
    this.manager = new RuleManager({
      store: config.store,
      validator: this.validator,
      conflictDetector: this.conflictDetector,
      auditLogger: this.auditLogger,
      permissions,
      clock,
    });
  }

  // ─── RuleStore — hot path ──────────────────────────────────────────────

  async resolveRules(query: RuleQuery): Promise<SerializedRule[]> {
    return this.scopeManager.resolveWithTenantRules(query);
  }

  fingerprint(query: RuleQuery): string {
    return this.manager.store.fingerprint(query);
  }

  // ─── RuleStore — read ──────────────────────────────────────────────────

  async getRule(ruleId: string, version?: number): Promise<SerializedRule | null> {
    return this.manager.store.getRule(ruleId, version);
  }

  async listRules(query: RuleListQuery): Promise<RuleMetadata[]> {
    return this.manager.store.listRules(query);
  }

  async getRuleHistory(ruleId: string): Promise<SerializedRule[]> {
    return this.manager.store.getRuleHistory(ruleId);
  }

  async getRulesAtDate(
    tenantId: string,
    atDate: string,
    model?: string,
  ): Promise<SerializedRule[]> {
    return this.manager.store.getRulesAtDate(tenantId, atDate, model);
  }

  // ─── RuleStore — write ─────────────────────────────────────────────────

  async saveRule(input: RuleInput): Promise<SerializedRule> {
    return this.manager.createRule(input, input.createdBy);
  }

  async updateRuleStatus(
    ruleId: string,
    version: number,
    status: RuleStatus,
    actor: string,
    reason?: string,
  ): Promise<SerializedRule> {
    switch (status) {
      case 'review':
        return (await this.manager.submitForReview(ruleId, version, actor)).rule;
      case 'draft':
        return this.manager.sendBackToDraft(ruleId, version, actor, reason ?? 'Sent back to draft');
      case 'published':
        return (await this.manager.approve(ruleId, version, actor, reason)).published;
      case 'deprecated':
        if (!reason) throw new RuleTransitionError('Reason is required for deprecation');
        return this.manager.deprecate(ruleId, version, actor, reason);
      case 'archived':
        if (!reason) throw new RuleTransitionError('Reason is required for archival');
        return this.manager.archive(ruleId, version, actor, reason);
    }
  }

  async publishRule(
    ruleId: string,
    version: number,
    actor: string,
  ): Promise<{ published: SerializedRule; deprecated: SerializedRule[] }> {
    return this.manager.approve(ruleId, version, actor);
  }

  async rollbackRule(
    ruleId: string,
    targetVersion: number,
    actor: string,
    reason: string,
  ): Promise<{ restored: SerializedRule; deprecated: SerializedRule }> {
    return this.manager.emergencyRollback(ruleId, targetVersion, actor, reason);
  }

  async recordAuditEvent(event: RuleAuditEvent): Promise<void> {
    return this.manager.store.recordAuditEvent(event);
  }

  async getAuditTrail(ruleId: string): Promise<RuleAuditEvent[]> {
    return this.manager.store.getAuditTrail(ruleId);
  }

  async detectConflicts(candidate: RuleInput): Promise<RuleConflict[]> {
    return this.manager.store.detectConflicts(candidate);
  }

  async listSharedRules(region: string, model?: string): Promise<SerializedRule[]> {
    return this.manager.store.listSharedRules(region, model);
  }

  // ─── Management API (beyond RuleStore) ─────────────────────────────────

  get rules(): RuleManager {
    return this.manager;
  }

  get regions(): RegionRegistry {
    return this.regionRegistry;
  }

  get sandbox(): RuleSandbox {
    return new RuleSandbox(this, this.manager);
  }

  get importer(): RuleImporter {
    return new RuleImporter(this.manager, this.validator);
  }

  get audit(): AuditLogger {
    return this.auditLogger;
  }

  get dates(): EffectiveDateManager {
    return new EffectiveDateManager(this.manager.store, this.manager.clock);
  }
}
