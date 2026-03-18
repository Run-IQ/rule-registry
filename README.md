# @run-iq/rule-registry

Rule lifecycle management for Run-IQ. Versioning, validation, audit, conflict detection, permissions, and sandbox simulation.

## What it does

Rule Registry manages the full lifecycle of parametric rules: creation, validation, approval workflows, versioning, conflict detection, and audit logging. It sits between the host application and the persistence layer (`RuleStore` from `@run-iq/context-engine`).

## Install

```bash
npm install @run-iq/rule-registry
```

Peer dependencies: `@run-iq/context-engine`

## Quick start

```typescript
import { RuleRegistry } from '@run-iq/rule-registry';
import { createInMemoryAdapter } from '@run-iq/context-engine';

const registry = new RuleRegistry({
  adapter: createInMemoryAdapter(),
  regions: [
    { code: 'TG', name: 'Togo', jurisdictions: ['NATIONAL', 'REGIONAL'] },
  ],
});

// Create a rule (starts as draft)
await registry.createRule({
  id: 'tg-irpp-2025',
  model: 'PROGRESSIVE_BRACKET',
  jurisdiction: 'NATIONAL',
  country: 'TG',
  params: { base: 'taxableIncome', brackets: [...] },
}, { actor: 'admin' });

// Approve and publish
await registry.approveRule('tg-irpp-2025', 1, { actor: 'reviewer' });
await registry.publishRule('tg-irpp-2025', 1, { actor: 'admin' });

// Query active rules
const rules = await registry.listActiveRules({ country: 'TG', model: 'PROGRESSIVE_BRACKET' });
```

## Core features

### Rule lifecycle

```
draft → active → archived
         ↑         |
         └─────────┘  (rollback)
```

- **draft**: created, editable, not used in calculations
- **active**: published, immutable, used in calculations
- **archived**: superseded by a newer version

### Versioning

Every rule has `id` + `version`. Versions are immutable once active. Updating a rule creates a new version.

### Conflict detection

```typescript
const conflicts = await registry.detectConflicts('tg-irpp-2025', 1);
// Detects: overlapping date ranges, same jurisdiction+priority, contradictory conditions
```

### Permission system

```typescript
import { ROLE_PERMISSIONS } from '@run-iq/rule-registry';

// Built-in roles: admin, editor, reviewer, viewer
// Permissions: rule:create, rule:update, rule:approve, rule:publish, rule:archive, rule:review
// Separation of powers: creator cannot approve their own rule
```

### Audit trail

Every operation is logged with actor, timestamp, and action.

```typescript
const audit = await registry.getAuditTrail('tg-irpp-2025');
// [{ actor: 'admin', action: 'create', timestamp: '...' }, ...]
```

### Sandbox simulation

Test a rule against sample data without publishing.

```typescript
import { RuleSandbox } from '@run-iq/rule-registry';

const sandbox = new RuleSandbox(registry);
const result = await sandbox.simulate({
  ruleId: 'tg-irpp-2025',
  version: 1,
  payload: { taxableIncome: 5_000_000 },
  effectiveDate: '2025-06-15',
});
```

### CSV import

Bulk import rules from CSV files.

```typescript
import { RuleImporter, parseCSV } from '@run-iq/rule-registry';

const importer = new RuleImporter(registry);
const rows = parseCSV(csvContent);
const result = await importer.importRules(rows, { actor: 'admin', dryRun: true });
// result.valid: 42, result.errors: 0
```

## API surface

| Export | Kind | Description |
|---|---|---|
| `RuleRegistry` | class | Main facade — all operations |
| `RuleManager` | class | Low-level rule CRUD |
| `RuleValidator` | class | Schema + business rule validation |
| `ConflictDetector` | class | Overlapping rule detection |
| `AuditLogger` | class | Operation audit trail |
| `EffectiveDateManager` | class | Date range gap detection |
| `ScopeManager` | class | Jurisdiction/scope resolution |
| `RegionRegistry` | class | Region configuration |
| `RuleSandbox` | class | Rule testing without publishing |
| `RuleImporter` | class | CSV bulk import |
| `DefaultPermissionChecker` | class | Role-based access control |
| `ROLE_PERMISSIONS` | const | Built-in role → permission mapping |

## License

All rights reserved. See LICENSE for details.

---

*Run-IQ implements the PPE specification.*
*github.com/Run-IQ*
