import { InMemoryRuleStore } from '@run-iq/context-engine';
import { RuleRegistry } from '../../src/RuleRegistry.js';
import { DefaultPermissionChecker } from '../../src/PermissionChecker.js';

function setup() {
  const store = new InMemoryRuleStore();
  const permissions = new DefaultPermissionChecker();
  permissions.grantRole('importer', 'tenant-1', 'editor');
  return {
    registry: new RuleRegistry({ store, permissions, clock: () => '2025-06-15T12:00:00.000Z' }),
    store,
  };
}

describe('Integration: Rule importer', () => {
  it('fromJSON creates multiple rules', async () => {
    const { registry } = setup();
    const result = await registry.importer.fromJSON(
      [
        {
          model: 'TAX',
          tenantId: 'tenant-1',
          scope: 'tenant-specific',
          effectiveFrom: '2025-01-01',
          payload: JSON.stringify({ model: 'TAX', v: 1 }),
          createdBy: 'importer',
        },
        {
          model: 'TAX',
          tenantId: 'tenant-1',
          scope: 'tenant-specific',
          effectiveFrom: '2025-06-01',
          payload: JSON.stringify({ model: 'TAX', v: 2 }),
          createdBy: 'importer',
        },
      ],
      'importer',
    );
    expect(result.created).toHaveLength(2);
  });

  it('dryRun validates without persisting', async () => {
    const { registry, store } = setup();
    const result = await registry.importer.fromJSON(
      [
        {
          model: 'TAX',
          tenantId: 'tenant-1',
          scope: 'tenant-specific',
          effectiveFrom: '2025-01-01',
          payload: JSON.stringify({ model: 'TAX' }),
          createdBy: 'importer',
        },
      ],
      'importer',
      { dryRun: true },
    );
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    const rules = await store.listRules({ tenantId: 'tenant-1' });
    expect(rules).toHaveLength(0);
  });

  it('skipOnError continues past failures', async () => {
    const { registry } = setup();
    const result = await registry.importer.fromJSON(
      [
        {
          model: '',
          tenantId: 'tenant-1',
          scope: 'tenant-specific',
          effectiveFrom: '2025-01-01',
          payload: '{}',
          createdBy: 'importer',
        },
        {
          model: 'TAX',
          tenantId: 'tenant-1',
          scope: 'tenant-specific',
          effectiveFrom: '2025-01-01',
          payload: JSON.stringify({ model: 'TAX' }),
          createdBy: 'importer',
        },
      ],
      'importer',
      { skipOnError: true },
    );
    expect(result.failed).toHaveLength(1);
    expect(result.created).toHaveLength(1);
  });

  it('fromCSV parses and creates rules', async () => {
    const { registry } = setup();
    const csv = [
      'model,effectiveFrom,scope,payload,createdBy',
      'TAX,2025-01-01,tenant-specific,"{""model"":""TAX""}",importer',
    ].join('\n');
    const result = await registry.importer.fromCSV(csv, 'tenant-1', 'importer');
    expect(result.created).toHaveLength(1);
  });
});
