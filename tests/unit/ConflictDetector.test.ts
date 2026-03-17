import type { RuleInput } from '@run-iq/context-engine';
import { InMemoryRuleStore } from '@run-iq/context-engine';
import { ConflictDetector } from '../../src/ConflictDetector.js';

async function publishRule(store: InMemoryRuleStore, input: RuleInput) {
  const draft = await store.saveRule(input);
  await store.updateRuleStatus(draft.id, draft.version, 'review', 'sys');
  const { published } = await store.publishRule(draft.id, draft.version, 'sys');
  return published;
}

function makeInput(overrides?: Partial<RuleInput>): RuleInput {
  const base: RuleInput = {
    model: 'FLAT_RATE',
    tenantId: 'tenant-1',
    scope: 'tenant-specific',
    effectiveFrom: '2025-01-01',
    payload: JSON.stringify({ model: 'FLAT_RATE', rate: 0.18 }),
    createdBy: 'alice',
  };
  if (!overrides) return base;
  return { ...base, ...overrides };
}

describe('ConflictDetector', () => {
  let store: InMemoryRuleStore;
  let detector: ConflictDetector;

  beforeEach(() => {
    store = new InMemoryRuleStore();
    detector = new ConflictDetector(store);
  });

  it('detect() returns [] when no conflicts', async () => {
    const conflicts = await detector.detect(makeInput());
    expect(conflicts).toEqual([]);
  });

  it('detect() returns critical for duplicate_checksum', async () => {
    const input = makeInput();
    await publishRule(store, input);
    const conflicts = await detector.detect(input);
    expect(conflicts.some((c) => c.conflictType === 'duplicate_checksum')).toBe(true);
    expect(conflicts.find((c) => c.conflictType === 'duplicate_checksum')?.severity).toBe(
      'critical',
    );
  });

  it('detect() returns warning for period_overlap', async () => {
    await publishRule(store, makeInput({ payload: JSON.stringify({ x: 1 }), priority: 10 }));
    const conflicts = await detector.detect(
      makeInput({ payload: JSON.stringify({ x: 2 }), priority: 5 }),
    );
    expect(conflicts.some((c) => c.conflictType === 'period_overlap')).toBe(true);
  });

  it('detect() returns warning for same_priority', async () => {
    await publishRule(store, makeInput({ payload: JSON.stringify({ x: 1 }), priority: 5 }));
    const conflicts = await detector.detect(
      makeInput({ payload: JSON.stringify({ x: 2 }), priority: 5 }),
    );
    expect(conflicts.some((c) => c.conflictType === 'same_priority')).toBe(true);
  });

  it('isBlocker() returns true for critical severity', () => {
    expect(
      detector.isBlocker({
        existingRuleId: 'r1',
        existingVersion: 1,
        existingStatus: 'published',
        overlapFrom: '2025-01-01',
        conflictType: 'duplicate_checksum',
        severity: 'critical',
        description: 'dup',
      }),
    ).toBe(true);
    expect(
      detector.isBlocker({
        existingRuleId: 'r1',
        existingVersion: 1,
        existingStatus: 'published',
        overlapFrom: '2025-01-01',
        conflictType: 'period_overlap',
        severity: 'warning',
        description: 'overlap',
      }),
    ).toBe(false);
  });

  it('explain() returns human-readable descriptions', () => {
    const base = {
      existingRuleId: 'r1',
      existingVersion: 1,
      existingStatus: 'published' as const,
      overlapFrom: '2025-01-01',
    };
    expect(
      detector.explain({
        ...base,
        conflictType: 'duplicate_checksum',
        severity: 'critical',
        description: '',
      }),
    ).toContain('exact duplicate');
    expect(
      detector.explain({
        ...base,
        conflictType: 'period_overlap',
        severity: 'warning',
        description: '',
      }),
    ).toContain('Period overlap');
    expect(
      detector.explain({
        ...base,
        conflictType: 'same_priority',
        severity: 'warning',
        description: '',
      }),
    ).toContain('Same priority');
    expect(
      detector.explain({
        ...base,
        conflictType: 'effective_date_gap',
        severity: 'warning',
        description: '',
      }),
    ).toContain('Coverage gap');
  });
});
