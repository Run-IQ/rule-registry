import type { RuleInput } from '@run-iq/context-engine';
import { InMemoryRuleStore } from '@run-iq/context-engine';
import { EffectiveDateManager } from '../../src/EffectiveDateManager.js';

const clock = () => '2025-06-15T00:00:00.000Z';

async function publishRule(store: InMemoryRuleStore, input: RuleInput) {
  const draft = await store.saveRule(input);
  await store.updateRuleStatus(draft.id, draft.version, 'review', 'sys');
  const { published } = await store.publishRule(draft.id, draft.version, 'sys');
  return published;
}

function makeInput(overrides?: Partial<RuleInput>): RuleInput {
  const base: RuleInput = {
    model: 'TAX',
    tenantId: 'tenant-1',
    scope: 'tenant-specific',
    effectiveFrom: '2025-01-01',
    payload: JSON.stringify({ model: 'TAX' }),
    createdBy: 'alice',
  };
  if (!overrides) return base;
  return { ...base, ...overrides };
}

describe('EffectiveDateManager', () => {
  let store: InMemoryRuleStore;
  let manager: EffectiveDateManager;

  beforeEach(() => {
    store = new InMemoryRuleStore();
    manager = new EffectiveDateManager(store, clock);
  });

  it('resolveAtDate() returns published rules active at date', async () => {
    await publishRule(store, makeInput());
    const rules = await manager.resolveAtDate('tenant-1', '2025-03-15', 'TAX');
    expect(rules.length).toBeGreaterThan(0);
  });

  it('resolveAtDate() returns [] for date with no rules', async () => {
    const rules = await manager.resolveAtDate('tenant-1', '2025-03-15');
    expect(rules).toEqual([]);
  });

  it('findGaps() returns gaps between coverage periods', async () => {
    const i1 = makeInput({ effectiveFrom: '2025-01-01' });
    (i1 as unknown as Record<string, unknown>)['effectiveUntil'] = '2025-03-01';
    await publishRule(store, i1);

    const i2 = makeInput({
      effectiveFrom: '2025-06-01',
      payload: JSON.stringify({ model: 'TAX', v: 2 }),
    });
    (i2 as unknown as Record<string, unknown>)['effectiveUntil'] = '2025-12-31';
    await publishRule(store, i2);

    const gaps = await manager.findGaps('tenant-1', 'TAX', '2025-01-01', '2025-12-31');
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.some((g) => g.from === '2025-03-01' && g.to === '2025-06-01')).toBe(true);
  });

  it('findGaps() returns [] when continuous coverage', async () => {
    const i1 = makeInput({ effectiveFrom: '2025-01-01' });
    (i1 as unknown as Record<string, unknown>)['effectiveUntil'] = '2025-12-31';
    await publishRule(store, i1);

    const gaps = await manager.findGaps('tenant-1', 'TAX', '2025-01-01', '2025-12-31');
    expect(gaps).toEqual([]);
  });

  it('findGaps() detects gap at start', async () => {
    const i1 = makeInput({ effectiveFrom: '2025-06-01' });
    (i1 as unknown as Record<string, unknown>)['effectiveUntil'] = '2025-12-31';
    await publishRule(store, i1);

    const gaps = await manager.findGaps('tenant-1', 'TAX', '2025-01-01', '2025-12-31');
    expect(gaps.some((g) => g.from === '2025-01-01')).toBe(true);
  });

  it('findGaps() detects gap at end', async () => {
    const i1 = makeInput({ effectiveFrom: '2025-01-01' });
    (i1 as unknown as Record<string, unknown>)['effectiveUntil'] = '2025-06-01';
    await publishRule(store, i1);

    const gaps = await manager.findGaps('tenant-1', 'TAX', '2025-01-01', '2025-12-31');
    expect(gaps.some((g) => g.to === '2025-12-31')).toBe(true);
  });

  it('nextChange() returns nearest future date', async () => {
    const i1 = makeInput({ effectiveFrom: '2025-09-01' });
    await publishRule(store, i1);

    const next = await manager.nextChange('tenant-1', 'TAX');
    expect(next).toBe('2025-09-01');
  });

  it('nextChange() returns null when no future changes', async () => {
    const i1 = makeInput({ effectiveFrom: '2024-01-01' });
    await publishRule(store, i1);

    const next = await manager.nextChange('tenant-1', 'TAX');
    expect(next).toBeNull();
  });
});
