import type { RuleInput, RuleAuditEvent, RuleAuditEventType } from '@run-iq/context-engine';
import { InMemoryRuleStore, sha256 } from '@run-iq/context-engine';
import { AuditLogger, AUDIT_EVENT_LABELS } from '../../src/AuditLogger.js';

const clock = () => '2025-06-15T12:00:00.000Z';

function makeEvent(
  ruleId: string,
  type: RuleAuditEventType,
  id: string,
  metadata?: Record<string, unknown>,
): RuleAuditEvent {
  const event: RuleAuditEvent = {
    id,
    ruleId,
    version: 1,
    tenantId: 'tenant-1',
    type,
    actor: 'alice',
    recordedAt: clock(),
  };
  if (metadata) {
    (event as unknown as Record<string, unknown>)['metadata'] = metadata;
  }
  return event;
}

describe('AuditLogger', () => {
  let store: InMemoryRuleStore;
  let logger: AuditLogger;

  beforeEach(() => {
    store = new InMemoryRuleStore();
    logger = new AuditLogger(store, clock);
  });

  it('log() records event in store', async () => {
    const event = makeEvent('r1', 'rule.created', 'e1');
    await logger.log(event);
    const trail = await store.getAuditTrail('r1');
    expect(trail).toHaveLength(1);
  });

  it('getTrail() returns events for ruleId', async () => {
    await logger.log(makeEvent('r1', 'rule.created', 'e1'));
    await logger.log(makeEvent('r1', 'rule.updated', 'e2'));
    const trail = await logger.getTrail('r1');
    expect(trail).toHaveLength(2);
  });

  it('getTrail() returns [] for unknown ruleId', async () => {
    const trail = await logger.getTrail('unknown');
    expect(trail).toEqual([]);
  });

  it('exportForAudit() returns formatted report', async () => {
    // Create a rule so history works
    const input: RuleInput = {
      model: 'TAX',
      tenantId: 'tenant-1',
      scope: 'tenant-specific',
      effectiveFrom: '2025-01-01',
      payload: '{}',
      createdBy: 'alice',
    };
    const rule = await store.saveRule(input);

    await logger.log(makeEvent(rule.id, 'rule.created', 'e1'));
    const report = await logger.exportForAudit(rule.id, 'tenant-1');
    expect(report.ruleId).toBe(rule.id);
    expect(report.tenantId).toBe('tenant-1');
    expect(report.summary.totalVersions).toBe(1);
    expect(report.timeline).toHaveLength(1);
    expect(report.timeline[0]!.action).toBe('Rule created');
  });

  it('exportForAudit() summary includes rollback/conflict flags', async () => {
    const input: RuleInput = {
      model: 'TAX',
      tenantId: 'tenant-1',
      scope: 'tenant-specific',
      effectiveFrom: '2025-01-01',
      payload: '{}',
      createdBy: 'alice',
    };
    const rule = await store.saveRule(input);

    await logger.log(makeEvent(rule.id, 'rule.created', 'e1'));
    await logger.log(makeEvent(rule.id, 'rule.emergency_rollback', 'e2'));
    await logger.log(makeEvent(rule.id, 'rule.conflict_detected', 'e3'));

    const report = await logger.exportForAudit(rule.id, 'tenant-1');
    expect(report.summary.hasRollback).toBe(true);
    expect(report.summary.hasConflicts).toBe(true);
  });

  it('verifyIntegrity() passes when prevChecksum chain is correct', async () => {
    const e1 = makeEvent('r1', 'rule.created', 'e1');
    await logger.log(e1);
    const e2 = makeEvent('r1', 'rule.updated', 'e2', {
      prevChecksum: sha256(JSON.stringify(e1)),
    });
    await logger.log(e2);

    const result = await logger.verifyIntegrity('r1');
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(2);
  });

  it('verifyIntegrity() fails when prevChecksum wrong', async () => {
    const e1 = makeEvent('r1', 'rule.created', 'e1');
    await logger.log(e1);
    const e2 = makeEvent('r1', 'rule.updated', 'e2', { prevChecksum: 'wrong-hash' });
    await logger.log(e2);

    const result = await logger.verifyIntegrity('r1');
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
  });

  it('AUDIT_EVENT_LABELS covers all 12 event types', () => {
    expect(Object.keys(AUDIT_EVENT_LABELS)).toHaveLength(12);
  });
});
