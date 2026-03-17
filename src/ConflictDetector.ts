import type { RuleStore, RuleInput, RuleConflict } from '@run-iq/context-engine';

export class ConflictDetector {
  constructor(private readonly store: RuleStore) {}

  async detect(candidate: RuleInput): Promise<RuleConflict[]> {
    return this.store.detectConflicts(candidate);
  }

  isBlocker(conflict: RuleConflict): boolean {
    return conflict.severity === 'critical';
  }

  explain(conflict: RuleConflict): string {
    switch (conflict.conflictType) {
      case 'duplicate_checksum':
        return (
          `This rule appears to be an exact duplicate of rule ` +
          `"${conflict.existingRuleId}" v${conflict.existingVersion}. ` +
          `Both rules have identical payloads.`
        );

      case 'period_overlap':
        return (
          `Period overlap with rule "${conflict.existingRuleId}" v${conflict.existingVersion} ` +
          `from ${conflict.overlapFrom}` +
          `${conflict.overlapUntil ? ` to ${conflict.overlapUntil}` : ' (open-ended)'}. ` +
          `The higher-priority rule will take precedence at execution time.`
        );

      case 'same_priority':
        return (
          `Same priority as rule "${conflict.existingRuleId}" v${conflict.existingVersion} ` +
          `on an overlapping period. ` +
          `The Core dominance resolver may produce non-deterministic results. ` +
          `Adjust the priority to clarify precedence.`
        );

      case 'effective_date_gap':
        return (
          `Coverage gap between the end of rule "${conflict.existingRuleId}" ` +
          `and the start of this rule. No rule will apply during this period.`
        );
    }
  }
}
