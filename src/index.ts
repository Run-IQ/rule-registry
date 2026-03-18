// ─── Facade ──────────────────────────────────────────────────────────────────
export { RuleRegistry, type RuleRegistryConfig } from './RuleRegistry.js';

// ─── Components ──────────────────────────────────────────────────────────────
export { RuleManager, type RuleManagerConfig } from './RuleManager.js';
export {
  RuleValidator,
  defaultRuleSchemaValidator,
  type RuleSchemaValidator,
} from './RuleValidator.js';
export { ConflictDetector } from './ConflictDetector.js';
export {
  AuditLogger,
  AUDIT_EVENT_LABELS,
  type AuditReport,
  type IntegrityResult,
} from './AuditLogger.js';
export { EffectiveDateManager, type DateGap } from './EffectiveDateManager.js';
export { ScopeManager } from './ScopeManager.js';
export { RegionRegistry, type RegionConfig } from './RegionRegistry.js';
export { RuleSandbox, type SandboxSimulateInput, type SandboxResult } from './RuleSandbox.js';
export { RuleImporter, type ImportOptions, type ImportResult } from './RuleImporter.js';
export {
  DefaultPermissionChecker,
  ROLE_PERMISSIONS,
  type PermissionChecker,
  type Permission,
  type UserRole,
} from './PermissionChecker.js';

// ─── Errors ──────────────────────────────────────────────────────────────────
export {
  RegistryError,
  RuleValidationError,
  RuleConflictBlockerError,
  PermissionDeniedError,
  RulePermissionError,
  RulePayloadError,
  RuleSandboxError,
  RegionNotFoundError,
  RuleStaleError,
  type ValidationErrorItem,
  type ValidationWarning,
  type RuleValidationResult,
} from './errors.js';

// ─── Re-exports from context-engine ──────────────────────────────────────────
export {
  RuleNotFoundError,
  RuleTransitionError,
  RulePublishError,
  RuleVersionConflictError,
} from '@run-iq/context-engine';

// ─── Utilities ───────────────────────────────────────────────────────────────
export { generateId, parseCSV, csvRowToRuleInput } from './utils.js';
