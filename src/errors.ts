import type { RuleConflict } from '@run-iq/context-engine';

// ─── Local types ─────────────────────────────────────────────────────────────

export interface ValidationErrorItem {
  readonly field: string;
  readonly message: string;
  readonly code: string;
}

export interface ValidationWarning {
  readonly field: string;
  readonly message: string;
  readonly code: string;
}

export interface RuleValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationErrorItem[];
  readonly warnings?: readonly ValidationWarning[];
}

// ─── Error hierarchy ─────────────────────────────────────────────────────────

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class RuleValidationError extends RegistryError {
  constructor(
    message: string,
    public readonly errors: readonly ValidationErrorItem[],
  ) {
    super(message);
    this.name = 'RuleValidationError';
  }
}

export class RuleConflictBlockerError extends RegistryError {
  constructor(
    message: string,
    public readonly conflicts: readonly RuleConflict[],
  ) {
    super(message);
    this.name = 'RuleConflictBlockerError';
  }
}

export class PermissionDeniedError extends RegistryError {
  constructor(
    public readonly actor: string,
    public readonly tenantId: string,
    public readonly action: string,
  ) {
    super(
      `Permission denied: actor "${actor}" cannot perform "${action}" on tenant "${tenantId}". ` +
        `Check PermissionChecker configuration.`,
    );
    this.name = 'PermissionDeniedError';
  }
}

export class RulePermissionError extends RegistryError {
  constructor(message: string) {
    super(message);
    this.name = 'RulePermissionError';
  }
}

export class RulePayloadError extends RegistryError {
  constructor(message: string) {
    super(message);
    this.name = 'RulePayloadError';
  }
}

export class RuleSandboxError extends RegistryError {
  constructor(message: string) {
    super(message);
    this.name = 'RuleSandboxError';
  }
}

export class RegionNotFoundError extends RegistryError {
  constructor(message: string) {
    super(message);
    this.name = 'RegionNotFoundError';
  }
}

export class RuleStaleError extends RegistryError {
  constructor(
    public readonly ruleId: string,
    public readonly version: number,
  ) {
    super(
      `Rule "${ruleId}" v${version} was modified by another operation since it was read. ` +
        `Re-read the rule and retry. This is an optimistic lock failure.`,
    );
    this.name = 'RuleStaleError';
  }
}
