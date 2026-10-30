# @run-iq/rule-registry

Manages the lifecycle of Run-IQ rules: drafts, review, publication, deprecation and rollback, with validation, conflict detection, role-based permissions and an audit trail for every change.

`RuleRegistry` wraps a `RuleStore` from [`@run-iq/context-engine`](https://github.com/Run-IQ/context-engine) and implements the same interface, so it can be used anywhere a store is expected, for example by [`@run-iq/dg`](https://github.com/Run-IQ/decision-graph) to load the rules of each node. Storage stays in the store you provide; the registry adds the workflow on top.

## Install

```bash
npm install @run-iq/rule-registry @run-iq/context-engine @run-iq/core
```

`@run-iq/context-engine` and `@run-iq/core` are peer dependencies. Requires Node.js 20 or later.

## Example

```ts
import { RuleRegistry, DefaultPermissionChecker } from '@run-iq/rule-registry';
import { InMemoryRuleStore } from '@run-iq/context-engine';

const permissions = new DefaultPermissionChecker();
permissions.grantRole('alice', 'acme', 'editor');
permissions.grantRole('bob', 'acme', 'reviewer');

const registry = new RuleRegistry({ store: new InMemoryRuleStore(), permissions });

// alice writes a draft and submits it
const draft = await registry.rules.createRule({
  id: 'shipping-fee',
  model: 'PERCENTAGE',
  tenantId: 'acme',
  scope: 'tenant-specific',
  effectiveFrom: '2025-01-01',
  payload: JSON.stringify({ params: { base: 'orderTotal', rate: 0.05 } }),
  createdBy: 'alice',
}, 'alice');
await registry.rules.submitForReview('shipping-fee', draft.version, 'alice');

// bob approves it, which publishes it
await registry.rules.approve('shipping-fee', draft.version, 'bob');

await registry.resolveRules({ tenantId: 'acme', effectiveDate: '2025-06-01' });
// [{ id: 'shipping-fee', version: 1, status: 'published', ... }]

await registry.getAuditTrail('shipping-fee');
// rule.created (alice), rule.submitted_for_review (alice), rule.published (bob)
```

## Lifecycle

```
draft -> review -> published -> deprecated -> archived
           |
           +-> draft (sent back)
```

| Method on `registry.rules` | |
|---|---|
| `createRule(input, actor)` | Validates and saves a new draft |
| `updateRule(id, version, changes, actor)` | Only for drafts. Saves the changes as a new draft version |
| `submitForReview(id, version, actor)` | Runs conflict detection. Critical conflicts block the submission |
| `sendBackToDraft(id, version, actor, comment)` | Reviewer returns the rule to its author |
| `approve(id, version, actor, notes?)` | Publishes the rule. The author cannot approve their own rule |
| `deprecate(id, version, actor, reason)` | Takes a published rule out of service |
| `archive(id, version, actor, reason)` | Archives a deprecated rule |
| `emergencyRollback(id, targetVersion, actor, reason)` | Restores an earlier version |

Every operation checks permissions, re-reads the rule to reject concurrent changes (`RuleStaleError`), and writes an audit event.

## Validation and conflicts

A rule needs a `model`, `tenantId`, `scope`, `effectiveFrom` and a JSON `payload`. Dates use `YYYY-MM-DD`, and `effectiveUntil` must be after `effectiveFrom`. Pass `ruleSchemaValidator` in the config to also validate the payload content; by default any JSON is accepted. Invalid input throws `RuleValidationError` with a list of errors.

Conflicts are checked against published rules of the same tenant, model and country whose periods overlap. An identical payload is critical and blocks submission. A same-priority or overlapping rule is a warning that the approver acknowledges in the audit trail.

## Permissions

`DefaultPermissionChecker` keeps roles in memory per actor and tenant, and denies everything until a role is granted. To use your own user system, pass any object with `check()` and `hasPermission()`.

| Role | Can |
|---|---|
| `viewer` | read |
| `editor` | create, update, submit |
| `reviewer` | editor + review, approve, audit |
| `admin` | reviewer + deprecate, archive |
| `super-admin` | admin + emergency rollback |

## Shared rules and regions

A rule is either `tenant-specific` or `shared`. Shared rules must name a `region`, and regions are declared in the config as `{ code, name, countries }` with ISO 3166-1 alpha-2 country codes. When `resolveRules` is called with a `region` or a `country`, the matching shared rules are added to the tenant's own rules. A tenant rule with the same model and period replaces the shared one.

## Other tools

| | |
|---|---|
| `registry.audit` | `getTrail`, `exportForAudit` (readable timeline), `verifyIntegrity` (each event stores the hash of the previous one) |
| `registry.dates` | `resolveAtDate`, `findGaps` (periods with no published rule), `nextChange` |
| `registry.importer` | `fromJSON(inputs, actor, options)` and `fromCSV(csv, tenantId, actor, options)`, with `dryRun`, `skipOnError` and `autoSubmit` |
| `registry.sandbox` | `simulate()` validates a stored rule and returns its parsed payload. It does not evaluate the rule |

## License

Business Source License 1.1. Production use is allowed, except offering the package as a hosted or embedded service that competes with the licensor. It converts to Apache 2.0 on 2030-01-01. See [LICENSE](LICENSE).
