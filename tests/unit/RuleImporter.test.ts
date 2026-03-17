import { InMemoryRuleStore } from '@run-iq/context-engine';
import type { RuleInput } from '@run-iq/context-engine';
import { RuleImporter } from '../../src/RuleImporter.js';
import { RuleManager } from '../../src/RuleManager.js';
import { RuleValidator, defaultRuleSchemaValidator } from '../../src/RuleValidator.js';
import { ConflictDetector } from '../../src/ConflictDetector.js';
import { AuditLogger } from '../../src/AuditLogger.js';
import { DefaultPermissionChecker } from '../../src/PermissionChecker.js';

const clock = () => '2025-06-15T12:00:00.000Z';

function validInput(overrides?: Partial<RuleInput>): RuleInput {
  const base: RuleInput = {
    model: 'FLAT_RATE',
    tenantId: 'tenant-1',
    scope: 'tenant-specific',
    effectiveFrom: '2025-01-01',
    payload: JSON.stringify({ model: 'FLAT_RATE', id: 'r1', version: 1, params: {} }),
    createdBy: 'importer',
  };
  if (!overrides) return base;
  return { ...base, ...overrides };
}

function setup() {
  const store = new InMemoryRuleStore();
  const validator = new RuleValidator(defaultRuleSchemaValidator);
  const conflictDetector = new ConflictDetector(store);
  const auditLogger = new AuditLogger(store, clock);
  const permissions = new DefaultPermissionChecker();
  permissions.grantRole('importer', 'tenant-1', 'editor');
  const manager = new RuleManager({
    store,
    validator,
    conflictDetector,
    auditLogger,
    permissions,
    clock,
  });
  const importer = new RuleImporter(manager, validator);
  return { store, importer, manager };
}

describe('RuleImporter', () => {
  it('fromJSON() creates rules in draft', async () => {
    const { importer } = setup();
    const result = await importer.fromJSON([validInput()], 'importer');
    expect(result.created).toHaveLength(1);
    expect(result.created[0]!.status).toBe('draft');
  });

  it('fromJSON() with autoSubmit moves to review', async () => {
    const { store, importer } = setup();
    const result = await importer.fromJSON([validInput()], 'importer', { autoSubmit: true });
    expect(result.created).toHaveLength(1);
    const rule = await store.getRule(result.created[0]!.id);
    expect(rule?.status).toBe('review');
  });

  it('fromJSON() with skipOnError continues on failure', async () => {
    const { importer } = setup();
    const bad = validInput({ model: '' });
    const good = validInput({ payload: JSON.stringify({ model: 'FLAT_RATE', v: 2 }) });
    const result = await importer.fromJSON([bad, good], 'importer', { skipOnError: true });
    expect(result.failed).toHaveLength(1);
    expect(result.created).toHaveLength(1);
  });

  it('fromJSON() without skipOnError throws on failure', async () => {
    const { importer } = setup();
    const bad = validInput({ model: '' });
    await expect(importer.fromJSON([bad], 'importer')).rejects.toThrow();
  });

  it('fromJSON() with dryRun validates without creating', async () => {
    const { store, importer } = setup();
    const result = await importer.fromJSON([validInput()], 'importer', { dryRun: true });
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    const rules = await store.listRules({ tenantId: 'tenant-1' });
    expect(rules).toHaveLength(0);
  });

  it('fromCSV() parses CSV and creates rules', async () => {
    const { importer } = setup();
    const csv = [
      'model,effectiveFrom,scope,payload,createdBy',
      'FLAT_RATE,2025-01-01,tenant-specific,"{""model"":""FLAT_RATE""}",importer',
    ].join('\n');
    const result = await importer.fromCSV(csv, 'tenant-1', 'importer');
    expect(result.created).toHaveLength(1);
  });

  it('fromCSV() handles empty CSV', async () => {
    const { importer } = setup();
    const result = await importer.fromCSV('', 'tenant-1', 'importer');
    expect(result.created).toHaveLength(0);
  });

  it('fromLLMOutput() throws not-implemented', async () => {
    const { importer } = setup();
    await expect(importer.fromLLMOutput({}, 'importer')).rejects.toThrow('not implemented');
  });
});
