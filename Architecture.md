# `@run-iq/rule-registry`
## Architecture Document v2.0

> **Statut** : Référence définitive pour l'implémentation  
> **Version du document** : 2.0.0 (remplace v1.0)  
> **Package** : `@run-iq/rule-registry`  
> **Dépendances Run-IQ** : `@run-iq/context-engine`, `@run-iq/core` (Catégorie B uniquement)  
> **Implémente** : `RuleStore` de `@run-iq/context-engine`  
> **Changements v2.0** :
> - `ScopeManager.REGIONS` hardcodé → `RegionConfig[]` injectable (agnosticisme géographique)
> - `RuleValidator.validatePayload()` intègre `validateRuleSchema()` du Core
> - Dépendance `@run-iq/core` ajoutée (Catégorie B uniquement — jamais PPEEngine)
> - `RegionRegistry` ajouté pour gérer les configurations de régions

---

## Table des matières

1. [Pourquoi ce module existe](#1-pourquoi-ce-module-existe)
2. [Ce que le Rule Registry n'est pas](#2-ce-que-le-rule-registry-nest-pas)
3. [Agnosticisme géographique et produit](#3-agnosticisme-géographique-et-produit)
4. [Position dans l'écosystème Run-IQ](#4-position-dans-lécosystème-run-iq)
5. [Vue d'ensemble des composants](#5-vue-densemble-des-composants)
6. [Cycle de vie d'une règle](#6-cycle-de-vie-dune-règle)
7. [RuleRegistry — classe principale](#7-ruleregistry--classe-principale)
8. [RuleManager — orchestrateur du workflow](#8-rulemanager--orchestrateur-du-workflow)
9. [Workflow Draft → Review → Published](#9-workflow-draft--review--published)
10. [RuleValidator — validation complète](#10-rulevalidator--validation-complète)
11. [ConflictDetector](#11-conflictdetector)
12. [EffectiveDateManager](#12-effectivedatemanager)
13. [ScopeManager & RegionRegistry — agnostique](#13-scopemanager--regionregistry--agnostique)
14. [AuditLogger](#14-auditlogger)
15. [RuleSandbox](#15-rulesandbox)
16. [RuleImporter](#16-ruleimporter)
17. [Rollback d'urgence](#17-rollback-durgence)
18. [Sécurité & isolation multi-tenant](#18-sécurité--isolation-multi-tenant)
19. [Intégration avec @run-iq/dg](#19-intégration-avec-run-iqdg)
20. [Intégration avec @run-iq/server](#20-intégration-avec-run-iqserver)
21. [Erreurs](#21-erreurs)
22. [Structure du package](#22-structure-du-package)
23. [Roadmap d'évolution](#23-roadmap-dévolution)
24. [Contrats de test](#24-contrats-de-test)

---

## 1. Pourquoi ce module existe

### Le problème

Le `RuleStore` dans `@run-iq/context-engine` définit le **contrat** de persistance des règles. Mais un contrat n'est pas une implémentation. Sans `@run-iq/rule-registry`, chaque host doit implémenter lui-même :

- Le versioning des règles
- Le workflow de publication avec séparation des pouvoirs
- La gestion des périodes effectives (lois de finances, règles temporaires)
- La détection des conflits entre règles
- L'audit trail réglementaire inattaquable
- Les rollbacks d'urgence tracés
- Les règles partagées entre tenants (régions économiques)

Ce sont des problèmes non-triviaux, répétitifs, et critiques dans les domaines régulés. Les implémenter mal crée des risques légaux directs.

### La solution

`@run-iq/rule-registry` est l'implémentation de référence complète du `RuleStore`. Agnostique à la zone géographique et au produit — il ne connaît ni l'UEMOA, ni la TVA, ni Taxe Facile. Il connaît uniquement les concepts universels : cycle de vie, workflow, conflits, audit.

### Positionnement

```
context-engine.RuleStore    → le contrat (ce que le DG attend)
rule-registry               → l'implémentation de référence (cycle de vie, audit, régions)
Application host            → configure rule-registry avec ses propres données
                              (régions, permissions, adapter DB)
```

---

## 2. Ce que le Rule Registry n'est pas

| Ce que le Rule Registry ne fait PAS | Qui le fait |
|---|---|
| Exécuter les règles | `@run-iq/core` — `PPEEngine` |
| Résoudre les conflits à l'exécution | `@run-iq/core` — `DominanceResolver` |
| Connaître les régions géographiques | L'host injecte `RegionConfig[]` |
| Connaître la logique fiscale | Les plugins |
| Orchestrer les calculs | `@run-iq/dg` |
| Persister en base de données | L'host via les adapters |
| Exposer une API HTTP | `@run-iq/server` |
| Générer des règles depuis du texte | `@run-iq/mcp-server` + LLM |
| Authentifier les utilisateurs | L'host |

**Le Rule Registry fait uniquement** :
1. Gérer le cycle de vie des règles (draft → review → published → deprecated → archived)
2. Enforcer le workflow d'approbation et la séparation des pouvoirs
3. Gérer les périodes effectives
4. Détecter et signaler les conflits
5. Gérer les scopes partagés via des `RegionConfig` injectées
6. Rollback d'urgence tracé
7. Audit trail inattaquable

---

## 3. Agnosticisme géographique et produit

### Le principe

Run-IQ ne sait pas ce qu'est l'UEMOA. Il ne sait pas ce qu'est la TVA. Il ne sait pas ce qu'est une déclaration fiscale. Ces connaissances appartiennent aux **données configurées par l'host**, jamais au code source de Run-IQ.

### Ce que ça veut dire concrètement

```
❌ Mauvais — Run-IQ hardcode des régions
──────────────────────────────────────────
class ScopeManager {
  readonly REGIONS = {
    'UEMOA': ['BF', 'BJ', 'CI', 'TG', ...],
    'OHADA': [...]
  }
}
→ Un déployeur européen ou brésilien doit modifier le code source


✅ Bon — l'host injecte ses propres régions
──────────────────────────────────────────
class ScopeManager {
  constructor(private regions: RegionConfig[]) {}
  // Run-IQ ne sait pas ce que 'UEMOA' signifie
  // Il sait juste qu'une région a un code et des pays membres
}

// Taxe Facile (host) injecte :
const regions: RegionConfig[] = [
  { code: 'UEMOA', name: 'Union Économique et Monétaire Ouest-Africaine',
    countries: ['BF', 'BJ', 'CI', 'GW', 'ML', 'NE', 'SN', 'TG'] },
  { code: 'OHADA', name: 'Organisation pour l\'Harmonisation en Afrique du Droit des Affaires',
    countries: ['BF', 'BJ', 'CI', 'CM', ...] }
]

// Un déployeur européen injecte :
const regions: RegionConfig[] = [
  { code: 'EU', name: 'European Union',
    countries: ['FR', 'DE', 'IT', 'ES', 'NL', ...27 pays] },
  { code: 'EEA', name: 'European Economic Area',
    countries: ['FR', 'DE', ..., 'NO', 'IS', 'LI'] }
]

// Un déployeur ASEAN injecte :
const regions: RegionConfig[] = [
  { code: 'ASEAN', name: 'Association of Southeast Asian Nations',
    countries: ['ID', 'MY', 'PH', 'SG', 'TH', 'VN', ...] }
]
```


---

## 4. Position dans l'écosystème Run-IQ

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Application Host                                 │
│                                                                           │
│   PostgresRuleRegistryAdapter   → persistence production                  │
│   RegionConfig[]                → UEMOA/OHADA ou EU/EEA ou ASEAN...      │
│   PermissionChecker impl        → intégré avec l'auth de l'host           │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │ configure via RuleRegistryConfig
┌────────────────────────────▼─────────────────────────────────────────────┐
│                      @run-iq/server                                       │
│   POST /rules   POST /rules/:id/submit   POST /rules/:id/approve  etc.   │
└──────────────┬──────────────────────────────────────────────────────────┘
               │ utilise
┌──────────────▼──────────────────────────────────────────────────────────┐
│                   @run-iq/rule-registry                                   │
│                                                                           │
│   RuleRegistry       → implémente RuleStore, orchestre tout              │
│   RuleManager        → cycle de vie + workflow + séparation des pouvoirs  │
│   RuleValidator      → structure + période + schéma Rule (via Core)      │
│   ConflictDetector   → chevauchements de période                          │
│   EffectiveDateManager → résolution temporelle                            │
│   ScopeManager       → régions injectées (agnostique)                    │
│   RegionRegistry     → CRUD des RegionConfig                             │
│   AuditLogger        → audit trail append-only + intégrité               │
│   RuleSandbox        → simulation sans impact prod                        │
│   RuleImporter       → JSON, CSV, LLM (v2)                               │
│   PermissionChecker  → interface + implémentation par rôles               │
└──────────────┬─────────────────────────────────────┬─────────────────────┘
               │ dépend de                           │ dépend de
┌──────────────▼──────────────┐       ┌──────────────▼─────────────────────┐
│   @run-iq/context-engine    │       │   @run-iq/core (Catégorie B)        │
│   RuleStore (interface)     │       │   Rule (type)                       │
│   SerializedRule, RuleQuery │       │   validateRuleSchema()              │
│   RuleStatus, RuleScope     │       │   RuleSchemaValidationResult        │
│   RuleAuditEvent, etc.      │       │   JAMAIS PPEEngine                  │
└─────────────────────────────┘       └────────────────────────────────────┘

Flux exécution DG (transparent pour le Registry) :
  DGOrchestrator → RuleStoreResolver → RuleRegistry.resolveRules()
  → SerializedRule[] → hydratePayload() → Rule[] → PPEEngine
```

---

## 5. Vue d'ensemble des composants

```
@run-iq/rule-registry
│
├── RuleRegistry                   — façade principale, implémente RuleStore
│   ├── Délègue à RuleManager      workflow + cycle de vie
│   ├── Délègue à ConflictDetector détection chevauchements
│   ├── Délègue à AuditLogger      audit trail
│   └── Délègue à ScopeManager     résolution avec règles partagées
│
├── RuleManager                    — orchestrateur du cycle de vie
│   ├── createRule()               → draft (validation complète avant)
│   ├── updateRule()               → nouvelle version draft
│   ├── submitForReview()          → draft → review
│   ├── sendBackToDraft()          → review → draft
│   ├── approve()                  → review → published
│   ├── deprecate()                → published → deprecated
│   ├── archive()                  → deprecated → archived
│   └── emergencyRollback()        → rollback tracé
│
├── RuleValidator                  — validation en 3 couches
│   ├── validateStructure()        → champs requis, types
│   ├── validatePeriod()           → dates, cohérence temporelle
│   └── validatePayload()          → JSON valide + validateRuleSchema() du Core
│
├── ConflictDetector               — analyse les chevauchements
│   ├── detect()                   → RuleConflict[]
│   ├── isBlocker()                → critical = bloque ?
│   └── explain()                  → description humaine
│
├── EffectiveDateManager           — gestion temporelle
│   ├── resolveAtDate()            → règles actives à une date
│   ├── findGaps()                 → périodes sans couverture
│   ├── findOverlaps()             → périodes multi-règles actives
│   └── nextChange()               → prochaine date de changement
│
├── ScopeManager                   — règles partagées (agnostique)
│   ├── resolveWithTenantRules()   → merge tenant-specific + shared
│   ├── listByRegion()             → règles d'une région configurée
│   └── validateCountryInRegion()  → pays ∈ région ? (via RegionRegistry)
│
├── RegionRegistry                 — CRUD des configurations de régions
│   ├── register()                 → enregistre une RegionConfig
│   ├── get()                      → récupère une région par code
│   ├── getByCountry()             → régions d'un pays
│   ├── list()                     → toutes les régions configurées
│   └── validate()                 → pays ISO 3166-1 alpha-2 valide ?
│
├── AuditLogger                    — audit trail append-only
│   ├── log()                      → enregistre un event
│   ├── getTrail()                 → historique complet
│   ├── exportForAudit()           → export formaté régulateurs
│   └── verifyIntegrity()          → chaîne de hachage
│
├── RuleSandbox                    — simulation isolée
│   └── simulate()                 → test sans impacter le store prod
│
├── RuleImporter                   — ingestion externe
│   ├── fromJSON()                 → import JSON structuré
│   ├── fromCSV()                  → import tableur
│   └── fromLLMOutput()            → import LLM (v2)
│
└── PermissionChecker
    ├── interface PermissionChecker → contrat
    └── DefaultPermissionChecker   → implémentation par rôles
```

---

## 6. Cycle de vie d'une règle

### 6.1 Diagramme d'état complet

```
                        ┌─────────────────┐
                        │      DRAFT       │
                        │                 │
                        │  - editable     │
                        │  - non-visible  │
                        │  - testable     │
                        └────────┬────────┘
                                 │ submitForReview(actor)
                                 │ [validation passe,
                                 │  pas de conflit critique]
                                 ▼
                        ┌─────────────────┐
                 ┌──────│     REVIEW       │──────┐
                 │      │                 │      │
    sendBackTo   │      │  - readonly     │      │ approve(actor)
    Draft        │      │  - non-visible  │      │ [actor ≠ createdBy]
    (reviewer)   │      │  - commentable  │      │
                 │      └─────────────────┘      │
                 ▼                               ▼
          ┌──────────┐              ┌─────────────────────┐
          │  DRAFT   │              │     PUBLISHED        │
          │ (retour) │              │                      │
          └──────────┘              │  - visible DG        │
                                    │  - si effectiveDate  │
                                    │    dans la période   │
                                    └──────────┬───────────┘
                                               │
                        ┌──────────────────────┤
                        │ deprecate(actor)      │ publishRule()
                        │ [manuelle]            │ automatique
                        │                       │ (déprécie chevauchant)
                        ▼                       │
               ┌─────────────────┐              │
               │   DEPRECATED    │◄─────────────┘
               │                 │
               │  - readonly     │
               │  - non-visible  │
               │  - dans history │
               └────────┬────────┘
                        │ archive(actor, reason)
                        ▼
               ┌─────────────────┐
               │    ARCHIVED     │
               │  - terminal     │
               │  - jamais       │
               │    supprimé     │
               └─────────────────┘

Transition spéciale (urgence) :
  PUBLISHED ──[emergencyRollback]──► DEPRECATED
  ancienne version restaurée ──────► PUBLISHED
```

### 6.2 Tableau des transitions

| De | Vers | Acteur | Condition | Raison obligatoire |
|---|---|---|---|---|
| `draft` | `review` | `editor` | Validation passe, pas de conflit critique | Non |
| `review` | `draft` | `reviewer` | — | Optionnelle |
| `review` | `published` | `reviewer` | `actor ≠ createdBy` | Non |
| `published` | `deprecated` | `admin` | — | Oui |
| `deprecated` | `archived` | `admin` | — | Oui |
| `draft` | `archived` | `editor` ou `admin` | — | Oui |
| N'importe quel statut | (émergence) | `super-admin` | rollback | Toujours |

---

## 7. RuleRegistry — classe principale

```ts
/**
 * Façade principale — implémente RuleStore de @run-iq/context-engine.
 *
 * RÔLE DE LA FAÇADE :
 *   - Méthodes de MUTATION (saveRule, publishRule, rollbackRule) → délèguent à RuleManager
 *     qui enforces permissions, validation, conflits, et audit.
 *   - Méthodes de LECTURE (getRule, listRules, getRuleHistory) → délèguent au store
 *     avec vérification de permissions (isolation tenant).
 *   - Méthodes de RÉSOLUTION (resolveRules, fingerprint) → hot path, pas de permissions
 *     (le tenantId dans la query assure l'isolation).
 *
 * POURQUOI UNE FAÇADE :
 *   Le caller ne devrait JAMAIS interagir directement avec RuleManager ou le store.
 *   RuleRegistry est le point d'entrée unique — elle garantit que chaque opération
 *   passe par les bons garde-fous. Accéder au store directement bypasse les permissions.
 */

interface RuleRegistryConfig {
  // Adapter de persistance — fourni par l'host
  // Peut être InMemoryRuleStore (dev) ou PostgresRuleRegistryAdapter (prod)
  store:            RuleStore

  // Régions configurées par l'host — agnostique géographiquement
  // Taxe Facile injecte UEMOA/OHADA
  // Un déployeur EU injecte EU/EEA
  // Peut être vide si pas de règles partagées
  regions?:         RegionConfig[]

  // Validation du schéma Rule — injectée depuis @run-iq/core
  // Permet de mocker en test sans dépendre du Core entier
  ruleSchemaValidator?: RuleSchemaValidator

  // Vérificateur de permissions — fourni par l'host
  // DefaultPermissionChecker si absent
  permissions?:     PermissionChecker

  /**
   * Injectable clock for deterministic timestamps.
   * Default: () => new Date().toISOString()
   *
   * Inject a fixed clock in tests for reproducible audit trails.
   * The Core eliminated all non-deterministic Date.now() — the Registry
   * follows the same standard.
   */
  clock?:               () => string
}

class RuleRegistry implements RuleStore {
  private readonly manager:         RuleManager
  private readonly conflictDetector: ConflictDetector
  private readonly auditLogger:     AuditLogger
  private readonly scopeManager:    ScopeManager
  private readonly regionRegistry:  RegionRegistry
  private readonly validator:       RuleValidator

  constructor(config: RuleRegistryConfig) {
    // RegionRegistry — agnostique, initialisé avec les régions de l'host
    this.regionRegistry = new RegionRegistry(config.regions ?? [])

    // Validator — injecte validateRuleSchema du Core si fourni
    this.validator = new RuleValidator(
      config.ruleSchemaValidator ?? defaultRuleSchemaValidator
    )

    // Permissions — DefaultPermissionChecker si non fourni
    const permissions = config.permissions ?? new DefaultPermissionChecker()

    // Clock — injectable pour le déterminisme (tests, audit)
    const clock = config.clock ?? (() => new Date().toISOString())

    // Composants — clock propagé à tous les sous-composants
    this.auditLogger      = new AuditLogger(config.store, clock)
    this.conflictDetector = new ConflictDetector(config.store)
    this.scopeManager     = new ScopeManager(config.store, this.regionRegistry)
    this.manager = new RuleManager({
      store:            config.store,
      validator:        this.validator,
      conflictDetector: this.conflictDetector,
      auditLogger:      this.auditLogger,
      permissions,
      clock:            config.clock
    })
  }

  // ─── Implémentation RuleStore — hot path ─────────────────────────────────

  async resolveRules(query: RuleQuery): Promise<SerializedRule[]> {
    return this.scopeManager.resolveWithTenantRules(query)
  }

  fingerprint(query: RuleQuery): string {
    return this.manager.store.fingerprint(query)
  }

  // ─── Implémentation RuleStore — lecture ──────────────────────────────────

  async getRule(ruleId: string, version?: number): Promise<SerializedRule | null> {
    // Lecture — pas de permission check (le ruleId ne contient pas de tenantId)
    // L'isolation tenant est assurée par le caller (server vérifie le tenant)
    return this.manager.store.getRule(ruleId, version)
  }

  async listRules(query: RuleListQuery): Promise<RuleMetadata[]> {
    // Lecture filtrée — tenantId dans la query assure l'isolation
    return this.manager.store.listRules(query)
  }

  async getRuleHistory(ruleId: string): Promise<SerializedRule[]> {
    return this.manager.store.getRuleHistory(ruleId)
  }

  async getRulesAtDate(tenantId: string, atDate: string, model?: string): Promise<SerializedRule[]> {
    return this.manager.store.getRulesAtDate(tenantId, atDate, model)
  }

  // ─── Implémentation RuleStore — écriture ─────────────────────────────────

  async saveRule(input: RuleInput): Promise<SerializedRule> {
    return this.manager.createRule(input, input.createdBy)
  }

  /**
   * Met à jour le statut d'une règle via RuleManager.
   *
   * IMPORTANT : cette méthode route vers les méthodes typées de RuleManager
   * (submitForReview, approve, deprecate, etc.) qui enforces permissions et audit.
   * Elle ne délègue JAMAIS directement au store — cela bypasserait les garde-fous.
   */
  async updateRuleStatus(
    ruleId: string, version: number, status: RuleStatus, actor: string, reason?: string
  ): Promise<SerializedRule> {
    switch (status) {
      case 'review':
        return (await this.manager.submitForReview(ruleId, version, actor)).rule
      case 'draft':
        return this.manager.sendBackToDraft(ruleId, version, actor, reason ?? 'Sent back to draft')
      case 'published':
        return (await this.manager.approve(ruleId, version, actor, reason)).published
      case 'deprecated':
        if (!reason) throw new RuleTransitionError('Reason is required for deprecation')
        return this.manager.deprecate(ruleId, version, actor, reason)
      case 'archived':
        if (!reason) throw new RuleTransitionError('Reason is required for archival')
        return this.manager.archive(ruleId, version, actor, reason)
    }
  }

  async publishRule(
    ruleId: string, version: number, actor: string
  ): Promise<{ published: SerializedRule; deprecated: SerializedRule[] }> {
    return this.manager.approve(ruleId, version, actor)
  }

  async rollbackRule(
    ruleId: string, targetVersion: number, actor: string, reason: string
  ): Promise<{ restored: SerializedRule; deprecated: SerializedRule }> {
    return this.manager.emergencyRollback(ruleId, targetVersion, actor, reason)
  }

  async recordAuditEvent(event: RuleAuditEvent): Promise<void> {
    return this.manager.store.recordAuditEvent(event)
  }

  async getAuditTrail(ruleId: string): Promise<RuleAuditEvent[]> {
    return this.manager.store.getAuditTrail(ruleId)
  }

  async detectConflicts(candidate: RuleInput): Promise<RuleConflict[]> {
    return this.manager.store.detectConflicts(candidate)
  }

  async listSharedRules(region: string, model?: string): Promise<SerializedRule[]> {
    return this.manager.store.listSharedRules(region, model)
  }

  // ─── API de management (au-delà de RuleStore) ────────────────────────────

  get rules():  RuleManager         { return this.manager }
  get regions(): RegionRegistry     { return this.regionRegistry }
  get sandbox(): RuleSandbox        { return new RuleSandbox(this, this.manager) }
  get importer(): RuleImporter      { return new RuleImporter(this.manager, this.validator) }
  get audit():   AuditLogger        { return this.auditLogger }
  get dates():   EffectiveDateManager { return new EffectiveDateManager(this.manager.store, this.manager.clock) }
}
```

---

## 8. RuleManager — orchestrateur du workflow

```ts
/**
 * Adapts a SerializedRule to RuleInput for re-validation.
 * Avoids unsafe double cast (as unknown as RuleInput).
 */
function toRuleInput(rule: SerializedRule): RuleInput {
  return {
    id:             rule.id,
    model:          rule.model,
    tenantId:       rule.tenantId,
    country:        rule.country,
    region:         rule.region,
    scope:          rule.scope,
    effectiveFrom:  rule.effectiveFrom,
    effectiveUntil: rule.effectiveUntil ?? undefined,
    priority:       rule.priority,
    tags:           rule.tags,
    description:    rule.description,
    source:         rule.source,
    payload:        rule.payload,
    createdBy:      rule.createdBy,
    metadata:       rule.metadata
  }
}

interface RuleManagerConfig {
  store:            RuleStore
  validator:        RuleValidator
  conflictDetector: ConflictDetector
  auditLogger:      AuditLogger
  permissions:      PermissionChecker
  clock?:           () => string
}

class RuleManager {
  private readonly clock: () => string

  constructor(readonly config: RuleManagerConfig) {
    this.clock = config.clock ?? (() => new Date().toISOString())
  }

  get store(): RuleStore { return this.config.store }

  // ─── Création ─────────────────────────────────────────────────────────────

  /**
   * Crée une règle en statut draft.
   * Validation complète avant création.
   * Versioning automatique : v1 pour un nouvel ID, vN+1 si existant.
   */
  async createRule(input: RuleInput, actor: string): Promise<SerializedRule> {
    await this.config.permissions.check(actor, input.tenantId, 'rule:create')
    await this.config.validator.validateStructure(input)
    await this.config.validator.validatePeriod(input)
    await this.config.validator.validatePayload(input)

    const rule = await this.config.store.saveRule({ ...input, createdBy: actor })

    await this.config.auditLogger.log({
      id: generateId(), ruleId: rule.id, version: rule.version,
      tenantId: rule.tenantId, type: 'rule.created', actor,
      after: rule, recordedAt: this.clock()
    })

    return rule
  }

  /**
   * Met à jour une règle draft en créant une nouvelle version.
   * Seules les règles draft sont modifiables.
   * review/published/deprecated/archived sont immuables.
   */
  async updateRule(
    ruleId:  string,
    version: number,
    updates: Partial<RuleInput>,
    actor:   string
  ): Promise<SerializedRule> {
    const existing = await this.config.store.getRule(ruleId, version)
    if (!existing) throw new RuleNotFoundError(`Rule "${ruleId}" v${version} not found`)
    if (existing.status !== 'draft') {
      throw new RuleTransitionError(
        `Cannot update rule "${ruleId}" v${version}: ` +
        `status is "${existing.status}", only draft rules are editable. ` +
        `Create a new version instead.`
      )
    }

    await this.config.permissions.check(actor, existing.tenantId, 'rule:update')

    const merged: RuleInput = {
      id:            ruleId,
      model:         updates.model          ?? existing.model,
      tenantId:      existing.tenantId,
      country:       updates.country        ?? existing.country,
      region:        updates.region         ?? existing.region,
      scope:         updates.scope          ?? existing.scope,
      effectiveFrom: updates.effectiveFrom  ?? existing.effectiveFrom,
      effectiveUntil: updates.effectiveUntil !== undefined
        ? updates.effectiveUntil
        : existing.effectiveUntil,
      priority:      updates.priority       ?? existing.priority,
      tags:          updates.tags           ?? existing.tags,
      description:   updates.description   ?? existing.description,
      source:        updates.source         ?? existing.source,
      payload:       updates.payload        ?? existing.payload,
      createdBy:     actor,
      metadata:      updates.metadata       ?? existing.metadata
    }

    await this.config.validator.validateStructure(merged)
    if (updates.effectiveFrom || updates.effectiveUntil) {
      await this.config.validator.validatePeriod(merged)
    }
    if (updates.payload) {
      await this.config.validator.validatePayload(merged)
    }

    const updated = await this.config.store.saveRule(merged)

    await this.config.auditLogger.log({
      id: generateId(), ruleId: updated.id, version: updated.version,
      tenantId: updated.tenantId, type: 'rule.updated', actor,
      before: existing, after: updated, recordedAt: this.clock()
    })

    return updated
  }

  // ─── Workflow ─────────────────────────────────────────────────────────────

  /**
   * Soumet une règle draft pour approbation.
   *
   * Les conflits critiques bloquent la soumission.
   * Les conflits warning sont notés dans l'audit et retournés au caller.
   */
  async submitForReview(
    ruleId:  string,
    version: number,
    actor:   string
  ): Promise<{ rule: SerializedRule; conflicts: RuleConflict[] }> {
    const rule = await this.config.store.getRule(ruleId, version)
    if (!rule) throw new RuleNotFoundError(`Rule "${ruleId}" v${version} not found`)
    if (rule.status !== 'draft') {
      throw new RuleTransitionError(
        `Cannot submit rule "${ruleId}": status is "${rule.status}", expected "draft"`
      )
    }

    await this.config.permissions.check(actor, rule.tenantId, 'rule:submit')
    await this.config.validator.validateStructure(toRuleInput(rule))
    await this.config.validator.validatePeriod(toRuleInput(rule))
    await this.config.validator.validatePayload(toRuleInput(rule))

    const conflicts = await this.config.conflictDetector.detect(toRuleInput(rule))
    const criticals = conflicts.filter(c => c.severity === 'critical')

    if (criticals.length > 0) {
      await this.config.auditLogger.log({
        id: generateId(), ruleId, version, tenantId: rule.tenantId,
        type: 'rule.conflict_detected', actor,
        metadata: { conflicts: criticals, blocked: true },
        recordedAt: this.clock()
      })
      throw new RuleConflictBlockerError(
        `Cannot submit rule "${ruleId}" v${version}: ` +
        `${criticals.length} critical conflict(s) must be resolved first.`,
        criticals
      )
    }

    const updated = await this.config.store.updateRuleStatus(ruleId, version, 'review', actor)

    if (conflicts.length > 0) {
      await this.config.auditLogger.log({
        id: generateId(), ruleId, version, tenantId: rule.tenantId,
        type: 'rule.conflict_detected', actor,
        metadata: { conflicts, blocked: false },
        reason: 'Non-blocking conflicts — reviewer must acknowledge before publishing',
        recordedAt: this.clock()
      })
    }

    return { rule: updated, conflicts }
  }

  /**
   * Renvoie une règle en draft avec un commentaire.
   * Séparation des pouvoirs : le reviewer ne peut pas être le créateur.
   */
  async sendBackToDraft(
    ruleId:  string,
    version: number,
    actor:   string,
    comment: string
  ): Promise<SerializedRule> {
    const rule = await this.config.store.getRule(ruleId, version)
    if (!rule) throw new RuleNotFoundError(`Rule "${ruleId}" v${version} not found`)
    if (rule.status !== 'review') {
      throw new RuleTransitionError(
        `Cannot send back rule "${ruleId}": status is "${rule.status}", expected "review"`
      )
    }

    await this.config.permissions.check(actor, rule.tenantId, 'rule:review')
    this.enforceReviewerDifference(rule, actor)

    return this.config.store.updateRuleStatus(ruleId, version, 'draft', actor, comment)
  }

  /**
   * Approuve et publie une règle.
   * Séparation des pouvoirs enforced — createdBy ≠ reviewer.
   * Déprécie automatiquement les règles chevauchantes.
   */
  async approve(
    ruleId:  string,
    version: number,
    actor:   string,
    notes?:  string
  ): Promise<{ published: SerializedRule; deprecated: SerializedRule[] }> {
    const rule = await this.config.store.getRule(ruleId, version)
    if (!rule) throw new RuleNotFoundError(`Rule "${ruleId}" v${version} not found`)
    if (rule.status !== 'review') {
      throw new RuleTransitionError(
        `Cannot approve rule "${ruleId}": status is "${rule.status}", expected "review"`
      )
    }

    await this.config.permissions.check(actor, rule.tenantId, 'rule:approve')
    this.enforceReviewerDifference(rule, actor)

    // Acknowledge les warnings s'il y en a
    const conflicts = await this.config.conflictDetector.detect(toRuleInput(rule))
    const warnings  = conflicts.filter(c => c.severity === 'warning')
    if (warnings.length > 0) {
      await this.config.auditLogger.log({
        id: generateId(), ruleId, version, tenantId: rule.tenantId,
        type: 'rule.conflict_acknowledged', actor,
        reason: notes ?? 'Reviewer acknowledged overlapping rules',
        metadata: { conflicts: warnings },
        recordedAt: this.clock()
      })
    }

    return this.config.store.publishRule(ruleId, version, actor)
  }

  /**
   * Déprécie manuellement une règle publiée.
   * Normalement automatique lors d'une publication — utilisé pour retrait manuel.
   */
  async deprecate(
    ruleId:  string,
    version: number,
    actor:   string,
    reason:  string
  ): Promise<SerializedRule> {
    const rule = await this.config.store.getRule(ruleId, version)
    if (!rule) throw new RuleNotFoundError(`Rule "${ruleId}" v${version} not found`)
    if (rule.status !== 'published') {
      throw new RuleTransitionError(
        `Cannot deprecate rule "${ruleId}": status is "${rule.status}", expected "published"`
      )
    }

    await this.config.permissions.check(actor, rule.tenantId, 'rule:deprecate')
    return this.config.store.updateRuleStatus(ruleId, version, 'deprecated', actor, reason)
  }

  /**
   * Archive définitivement une règle dépréciée.
   * Terminal — jamais supprimée, jamais restaurable.
   */
  async archive(
    ruleId:  string,
    version: number,
    actor:   string,
    reason:  string
  ): Promise<SerializedRule> {
    const rule = await this.config.store.getRule(ruleId, version)
    if (!rule) throw new RuleNotFoundError(`Rule "${ruleId}" v${version} not found`)
    if (rule.status !== 'deprecated') {
      throw new RuleTransitionError(
        `Cannot archive rule "${ruleId}": status is "${rule.status}", expected "deprecated"`
      )
    }

    await this.config.permissions.check(actor, rule.tenantId, 'rule:archive')
    return this.config.store.updateRuleStatus(ruleId, version, 'archived', actor, reason)
  }

  /**
   * Rollback d'urgence — voir section 17.
   */
  async emergencyRollback(
    ruleId:        string,
    targetVersion: number,
    actor:         string,
    reason:        string
  ): Promise<{ restored: SerializedRule; deprecated: SerializedRule }> {
    const target = await this.config.store.getRule(ruleId, targetVersion)
    if (!target) throw new RuleNotFoundError(`Rule "${ruleId}" v${targetVersion} not found`)

    await this.config.permissions.check(actor, target.tenantId, 'rule:emergency_rollback')

    if (!reason?.trim()) {
      throw new RuleTransitionError('reason is mandatory for emergency rollback')
    }

    return this.config.store.rollbackRule(ruleId, targetVersion, actor, reason)
  }

  // ─── Helper privé ─────────────────────────────────────────────────────────

  private enforceReviewerDifference(rule: SerializedRule, actor: string): void {
    if (rule.createdBy === actor) {
      throw new RulePermissionError(
        `Actor "${actor}" cannot review rule "${rule.id}" v${rule.version}: ` +
        `they are the rule's creator. ` +
        `Separation of powers requires a different person to review.`
      )
    }
  }
}
```

---

## 9. Workflow Draft → Review → Published

### 9.1 Séquence complète

```
Acteur A (editor)                         Acteur B (reviewer)
──────────────────────────────────────    ────────────────────────────────────

1. registry.rules.createRule(input, A)
   → rule v1, status: draft

2. [Test sandbox : registry.sandbox.simulate()]

3. registry.rules.updateRule(id, v1, changes, A)
   → rule v2, status: draft (nouvelle version)

4. registry.rules.submitForReview(id, v2, A)
   ├── validateStructure() → OK
   ├── validatePeriod()    → OK
   ├── validatePayload()   → validateRuleSchema() du Core → OK
   ├── detectConflicts()
   │   ├── critique → throw RuleConflictBlockerError
   │   └── warning  → noter dans audit, retourner
   └── status: review
                                          5. Reçoit { rule, conflicts }
                                             Examine la règle + les warnings

                                          6a. Insatisfait :
                                              registry.rules.sendBackToDraft(
                                                id, v2, B, "motif précis"
                                              )
                                              → status: draft
                                              ← retour étape 3

                                          6b. Satisfait :
                                              registry.rules.approve(id, v2, B)
                                              ├── enforceReviewerDifference(rule, B)
                                              │   B ≠ A → OK
                                              ├── acknowledge conflicts warning
                                              ├── publishRule(id, v2, B)
                                              │   └── déprécie règles chevauchantes
                                              └── status: published

7. Règle visible dans resolveRules()
   si effectiveDate dans la période
```

### 9.2 Sandbox testing

```ts
const testResult = await registry.sandbox.simulate({
  ruleId:  'irpp-2025',
  version: 1,   // draft — pas encore published
  input:   { income: 6_000_000 },
  meta: {
    tenantId:      'doztra',
    effectiveDate: '2025-01-01',
    country:       'TG'
  }
})
// Résultat comme si la règle était publiée — sans toucher au store prod
```

---

## 10. RuleValidator — validation complète

```ts
/**
 * Injecte un RuleSchemaValidator depuis @run-iq/core.
 * Découple rule-registry du Core entier tout en permettant
 * une validation complète du schéma Rule.
 */
interface RuleSchemaValidator {
  validate(value: unknown): { valid: boolean; errors: Array<{ path: string; message: string; code: string }> }
}

/**
 * Implémentation par défaut — utilise validateRuleSchema du Core.
 * Injectée dans RuleRegistryConfig si non fournie.
 */
const defaultRuleSchemaValidator: RuleSchemaValidator = {
  validate(value: unknown) {
    // Import dynamique pour éviter une dépendance circulaire potentielle
    const { validateRuleSchema } = require('@run-iq/core')
    const result = validateRuleSchema(value)
    return { valid: result.valid, errors: result.errors }
  }
}

class RuleValidator {
  constructor(private schemaValidator: RuleSchemaValidator) {}

  /**
   * Couche 1 — Validation structurelle de RuleInput.
   * Champs obligatoires, types, cohérence scope/region.
   */
  async validateStructure(input: RuleInput): Promise<RuleValidationResult> {
    const errors: ValidationError[] = []

    if (!input.model?.trim())
      errors.push({ field: 'model', message: 'model is required', code: 'MISSING_MODEL' })

    if (!input.tenantId?.trim())
      errors.push({ field: 'tenantId', message: 'tenantId is required', code: 'MISSING_TENANT' })

    if (!input.effectiveFrom?.trim())
      errors.push({ field: 'effectiveFrom', message: 'effectiveFrom is required', code: 'MISSING_EFFECTIVE_FROM' })

    if (!input.payload?.trim())
      errors.push({ field: 'payload', message: 'payload is required', code: 'MISSING_PAYLOAD' })

    if (!['tenant-specific', 'shared'].includes(input.scope))
      errors.push({ field: 'scope', message: `scope must be 'tenant-specific' or 'shared'`, code: 'INVALID_SCOPE' })

    if (input.scope === 'shared' && !input.region?.trim())
      errors.push({ field: 'region', message: 'region is required for shared rules', code: 'MISSING_REGION' })

    if (errors.length > 0) throw new RuleValidationError('Structural validation failed', errors)
    return { valid: true, errors: [], warnings: [] }
  }

  /**
   * Couche 2 — Validation de la période d'effectivité.
   * Format YYYY-MM-DD, cohérence from/until, warnings temporels.
   */
  async validatePeriod(input: RuleInput): Promise<RuleValidationResult> {
    const errors:   ValidationError[]   = []
    const warnings: ValidationWarning[] = []

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/

    if (!dateRegex.test(input.effectiveFrom))
      errors.push({ field: 'effectiveFrom', message: 'effectiveFrom must be YYYY-MM-DD', code: 'INVALID_DATE_FORMAT' })

    if (input.effectiveUntil && !dateRegex.test(input.effectiveUntil))
      errors.push({ field: 'effectiveUntil', message: 'effectiveUntil must be YYYY-MM-DD', code: 'INVALID_DATE_FORMAT' })

    if (input.effectiveUntil && input.effectiveUntil <= input.effectiveFrom)
      errors.push({
        field: 'effectiveUntil',
        message: `effectiveUntil (${input.effectiveUntil}) must be strictly after effectiveFrom (${input.effectiveFrom})`,
        code: 'INVALID_PERIOD'
      })

    // Warning : règle qui expire très prochainement
    if (input.effectiveUntil) {
      const days = Math.floor(
        (new Date(input.effectiveUntil).getTime() - Date.now()) / 86_400_000
      )
      if (days > 0 && days < 30) {
        warnings.push({
          field: 'effectiveUntil',
          message: `Rule expires in ${days} days — ensure a replacement is ready`,
          code: 'SHORT_LIVED_RULE'
        })
      }
    }

    if (errors.length > 0) throw new RuleValidationError('Period validation failed', errors)
    return { valid: true, errors: [], warnings }
  }

  /**
   * Couche 3 — Validation du payload.
   *
   * ÉTAPE 1 : JSON valide
   * ÉTAPE 2 : schéma Rule valide via validateRuleSchema() du Core
   * ÉTAPE 3 : cohérence model (payload.model == input.model)
   *
   * validateRuleSchema() est injecté — rule-registry ne connaît pas
   * la logique d'exécution du Core, seulement le schéma structurel.
   */
  async validatePayload(input: RuleInput): Promise<RuleValidationResult> {
    const errors: ValidationError[] = []

    // Étape 1 — JSON valide
    let parsed: unknown
    try {
      parsed = JSON.parse(input.payload)
    } catch {
      throw new RuleValidationError(
        'payload is not valid JSON',
        [{ field: 'payload', message: 'Invalid JSON syntax', code: 'INVALID_JSON' }]
      )
    }

    // Étape 2 — Schéma Rule valide (via @run-iq/core, injecté)
    const schemaResult = this.schemaValidator.validate(parsed)
    if (!schemaResult.valid) {
      throw new RuleValidationError(
        `payload does not match Rule schema: ${schemaResult.errors.length} error(s)`,
        schemaResult.errors.map(e => ({
          field:   `payload.${e.path}`,
          message: e.message,
          code:    e.code
        }))
      )
    }

    // Étape 3 — Cohérence model
    const parsedRule = parsed as { model?: string }
    if (parsedRule.model && parsedRule.model !== input.model) {
      errors.push({
        field:   'payload.model',
        message: `payload.model "${parsedRule.model}" does not match rule.model "${input.model}"`,
        code:    'MODEL_MISMATCH'
      })
    }

    if (errors.length > 0) throw new RuleValidationError('Payload validation failed', errors)
    return { valid: true, errors: [], warnings: [] }
  }
}
```

---

## 11. ConflictDetector

```ts
class ConflictDetector {
  constructor(private store: RuleStore) {}

  async detect(candidate: RuleInput): Promise<RuleConflict[]> {
    return this.store.detectConflicts(candidate)
  }

  isBlocker(conflict: RuleConflict): boolean {
    return conflict.severity === 'critical'
  }

  /**
   * Description humaine d'un conflit — agnostique au domaine.
   * Pas de mention de TVA, IRPP, ou règles fiscales.
   */
  explain(conflict: RuleConflict): string {
    switch (conflict.conflictType) {
      case 'duplicate_checksum':
        return `This rule appears to be an exact duplicate of rule ` +
               `"${conflict.existingRuleId}" v${conflict.existingVersion}. ` +
               `Both rules have identical payloads.`

      case 'period_overlap':
        return `Period overlap with rule "${conflict.existingRuleId}" v${conflict.existingVersion} ` +
               `from ${conflict.overlapFrom}` +
               `${conflict.overlapUntil ? ` to ${conflict.overlapUntil}` : ' (open-ended)'}. ` +
               `The higher-priority rule will take precedence at execution time.`

      case 'same_priority':
        return `Same priority as rule "${conflict.existingRuleId}" v${conflict.existingVersion} ` +
               `on an overlapping period. ` +
               `The Core dominance resolver may produce non-deterministic results. ` +
               `Adjust the priority to clarify precedence.`

      case 'effective_date_gap':
        return `Coverage gap between the end of rule "${conflict.existingRuleId}" ` +
               `and the start of this rule. No rule will apply during this period.`
    }
  }
}
```

### Politique des conflits

| Type | Sévérité | Bloque soumission | Reviewer peut override |
|---|---|---|---|
| `duplicate_checksum` | critical | Oui | Non |
| `period_overlap` | warning | Non | Oui |
| `same_priority` | warning | Non | Oui |
| `effective_date_gap` | warning | Non | Oui |

---

## 12. EffectiveDateManager

```ts
class EffectiveDateManager {
  constructor(
    private store: RuleStore,
    private clock: () => string = () => new Date().toISOString()
  ) {}

  /**
   * Règles actives à une date précise — pour l'audit réglementaire.
   * "Quelles règles s'appliquaient le 15 mars 2024 pour ce tenant ?"
   */
  async resolveAtDate(
    tenantId: string,
    atDate:   string,
    model?:   string
  ): Promise<SerializedRule[]> {
    return this.store.getRulesAtDate(tenantId, atDate, model)
  }

  /**
   * Trouve les trous de couverture pour un modèle sur une période.
   * "Y a-t-il des jours sans règle active entre 2024 et 2025 ?"
   */
  async findGaps(
    tenantId: string,
    model:    string,
    from:     string,
    to:       string
  ): Promise<DateGap[]> {
    const rules = await this.store.listRules({
      tenantId, model,
      status:        'published',
      effectiveFrom: from,
      effectiveTo:   to
    })

    const gaps: DateGap[] = []
    let cursor = from

    const sorted = rules.sort((a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom)
    )

    for (const rule of sorted) {
      if (rule.effectiveFrom > cursor) {
        gaps.push({ from: cursor, to: rule.effectiveFrom, model, tenantId })
      }
      if (rule.effectiveUntil && rule.effectiveUntil > cursor) {
        cursor = rule.effectiveUntil
      }
    }

    if (cursor < to) {
      gaps.push({ from: cursor, to, model, tenantId })
    }

    return gaps
  }

  /**
   * Prochaine date de changement de règle pour un tenant.
   * Utile pour les systèmes de cache — "invalide le cache à cette date".
   */
  async nextChange(tenantId: string, model?: string): Promise<string | null> {
    const today = this.clock().split('T')[0]
    const rules = await this.store.listRules({
      tenantId, model, status: 'published'
    })

    const futureDates = rules
      .flatMap(r => [r.effectiveFrom, r.effectiveUntil].filter(Boolean) as string[])
      .filter(d => d > today)
      .sort()

    return futureDates[0] ?? null
  }
}

interface DateGap {
  from:     string
  to:       string
  model:    string
  tenantId: string
}
```

---

## 13. ScopeManager & RegionRegistry — agnostique

### 13.1 RegionConfig — le type central

```ts
/**
 * Configuration d'une région économique ou géographique.
 * Fournie par l'host — Run-IQ ne définit aucune région par défaut.
 *
 * Exemples d'usage :
 *   Taxe Facile    → UEMOA, OHADA, CEMAC
 *   Déployeur EU   → EU, EEA, Eurozone
 *   Déployeur ASEAN → ASEAN, RCEP
 *   Déployeur US   → NAFTA/USMCA, États fédéraux
 *   Déployeur custom → n'importe quelle région personnalisée
 */
interface RegionConfig {
  code:         string     // identifiant unique — ex: 'UEMOA', 'EU', 'ASEAN'
  name:         string     // nom complet — ex: 'European Union'
  countries:    string[]   // codes ISO 3166-1 alpha-2
  description?: string
  metadata?:    Record<string, unknown>   // données libres
}
```

### 13.2 RegionRegistry

```ts
/**
 * Registre des configurations de régions — CRUD simple.
 * Initialisé avec les RegionConfig fournies par l'host.
 * Les régions peuvent être ajoutées dynamiquement (via API server).
 */
class RegionRegistry {
  private readonly regions: Map<string, RegionConfig> = new Map()

  constructor(initialRegions: RegionConfig[] = []) {
    for (const region of initialRegions) {
      this.register(region)
    }
  }

  register(region: RegionConfig): void {
    // Validation minimale — code non vide, au moins un pays
    if (!region.code?.trim())
      throw new Error('RegionConfig.code must be a non-empty string')
    if (!region.countries?.length)
      throw new Error(`RegionConfig "${region.code}" must have at least one country`)

    // Validation codes pays ISO 3166-1 alpha-2
    for (const country of region.countries) {
      if (!/^[A-Z]{2}$/.test(country)) {
        throw new Error(
          `Invalid country code "${country}" in region "${region.code}". ` +
          `Must be ISO 3166-1 alpha-2 (2 uppercase letters).`
        )
      }
    }

    this.regions.set(region.code, region)
  }

  get(code: string): RegionConfig | undefined {
    return this.regions.get(code)
  }

  getOrThrow(code: string): RegionConfig {
    const region = this.regions.get(code)
    if (!region) throw new RegionNotFoundError(`Region "${code}" is not configured. ` +
      `Register it via RegionRegistry.register() or RuleRegistryConfig.regions.`)
    return region
  }

  /**
   * Toutes les régions dont un pays est membre.
   * Ex: 'TG' → ['UEMOA', 'OHADA', 'ECOWAS'] si configurées
   */
  getByCountry(countryCode: string): RegionConfig[] {
    return [...this.regions.values()].filter(r =>
      r.countries.includes(countryCode)
    )
  }

  list(): RegionConfig[] {
    return [...this.regions.values()]
  }

  /**
   * Vérifie si un pays fait partie d'une région configurée.
   */
  isCountryInRegion(countryCode: string, regionCode: string): boolean {
    const region = this.regions.get(regionCode)
    return region?.countries.includes(countryCode) ?? false
  }

  /**
   * Vérifie qu'un pays appartient bien à la région déclarée dans une règle.
   * Appelé par RuleValidator si rule.scope === 'shared'.
   */
  validateCountryInRegion(countryCode: string, regionCode: string): void {
    if (!this.isCountryInRegion(countryCode, regionCode)) {
      throw new RuleValidationError(
        `Country "${countryCode}" is not a member of region "${regionCode}"`,
        [{
          field:   'country',
          message: `"${countryCode}" is not in region "${regionCode}"`,
          code:    'COUNTRY_NOT_IN_REGION'
        }]
      )
    }
  }
}
```

### 13.3 ScopeManager

```ts
class ScopeManager {
  constructor(
    private store:          RuleStore,
    private regionRegistry: RegionRegistry
  ) {}

  /**
   * Résout les règles pour un tenant en combinant :
   *   1. Les règles tenant-specific du tenant
   *   2. Les règles shared des régions configurées qui incluent le pays
   *
   * Priorité : tenant-specific > shared (pour même model + période).
   * Un tenant peut toujours surcharger une règle régionale partagée.
   */
  async resolveWithTenantRules(query: RuleQuery): Promise<SerializedRule[]> {
    // Règles spécifiques au tenant
    const tenantRules = await this.store.resolveRules({
      ...query,
      includeShared: false
    })

    // Règles partagées — via les régions configurées
    let sharedRules: SerializedRule[] = []
    if (query.region) {
      // Région explicitement spécifiée dans la query
      sharedRules = await this.store.listSharedRules(query.region, query.model)
    } else if (query.country) {
      // Auto-détection des régions du pays
      const regions = this.regionRegistry.getByCountry(query.country)
      const results = await Promise.all(
        regions.map(r => this.store.listSharedRules(r.code, query.model))
      )
      sharedRules = results.flat()
    }

    // Déduplication des règles partagées (un pays peut être dans plusieurs régions)
    const seen = new Set<string>()
    sharedRules = sharedRules.filter(r => {
      const key = `${r.id}:${r.version}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Les règles tenant-specific prennent la priorité
    // On exclut les règles shared qui sont couvertes par une règle tenant-specific
    const tenantCoverage = new Set(tenantRules.map(r =>
      `${r.model}:${r.effectiveFrom}:${r.effectiveUntil ?? 'open'}`
    ))

    const applicableShared = sharedRules.filter(r =>
      !tenantCoverage.has(`${r.model}:${r.effectiveFrom}:${r.effectiveUntil ?? 'open'}`)
    )

    return [...tenantRules, ...applicableShared]
      .sort((a, b) => b.priority - a.priority || b.version - a.version)
  }

  async listByRegion(regionCode: string, model?: string): Promise<SerializedRule[]> {
    // Vérifie que la région est configurée
    this.regionRegistry.getOrThrow(regionCode)
    return this.store.listSharedRules(regionCode, model)
  }
}
```

### 13.4 Exemple — configuration Taxe Facile

```ts
// Dans @run-iq/server ou l'application host Taxe Facile
import { RuleRegistry }  from '@run-iq/rule-registry'
import { validateRuleSchema } from '@run-iq/core'

const registry = new RuleRegistry({
  store: new PostgresRuleRegistryAdapter(pgClient),

  // Régions configurées par Taxe Facile — pas dans le code de Run-IQ
  regions: [
    {
      code:      'UEMOA',
      name:      'Union Économique et Monétaire Ouest-Africaine',
      countries: ['BF', 'BJ', 'CI', 'GW', 'ML', 'NE', 'SN', 'TG'],
      description: 'Zone monétaire CFA Ouest-Africaine'
    },
    {
      code:      'OHADA',
      name:      'Organisation pour l\'Harmonisation en Afrique du Droit des Affaires',
      countries: ['BF', 'BJ', 'CI', 'CM', 'CF', 'KM', 'CG', 'CD',
                  'GQ', 'GA', 'GW', 'GN', 'ML', 'MR', 'NE', 'SN', 'TD', 'TG'],
    },
    {
      code:      'CEMAC',
      name:      'Communauté Économique et Monétaire de l\'Afrique Centrale',
      countries: ['CM', 'CF', 'TD', 'CG', 'GA', 'GQ']
    }
  ],

  // Validation du schéma Rule via le Core
  ruleSchemaValidator: {
    validate: (value) => {
      const result = validateRuleSchema(value)
      return { valid: result.valid, errors: result.errors }
    }
  }
})
```

### 13.5 Exemple — configuration déployeur européen

```ts
const registry = new RuleRegistry({
  store: new PostgresRuleRegistryAdapter(pgClient),

  // Aucune trace d'UEMOA ou d'Afrique dans ce déploiement
  regions: [
    {
      code:      'EU',
      name:      'European Union',
      countries: ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE',
                  'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT',
                  'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO',
                  'SE', 'SI', 'SK']
    },
    {
      code:      'EEA',
      name:      'European Economic Area',
      countries: ['AT', 'BE', ..., 'NO', 'IS', 'LI']
    }
  ],
  ruleSchemaValidator: { validate: (v) => validateRuleSchema(v) }
})
```

---

## 14. AuditLogger

```ts
class AuditLogger {
  constructor(
    private store: RuleStore,
    private clock: () => string = () => new Date().toISOString()
  ) {}

  async log(event: RuleAuditEvent): Promise<void> {
    await this.store.recordAuditEvent(event)
  }

  async getTrail(ruleId: string): Promise<RuleAuditEvent[]> {
    return this.store.getAuditTrail(ruleId)
  }

  /**
   * Export formaté pour un auditeur externe (régulateur, commissaire aux comptes).
   * Ne contient pas le payload complet des règles (données sensibles).
   */
  async exportForAudit(ruleId: string, tenantId: string): Promise<AuditReport> {
    const events  = await this.getTrail(ruleId)
    const history = await this.store.getRuleHistory(ruleId)

    return {
      ruleId,
      tenantId,
      exportedAt: this.clock(),
      summary: {
        totalVersions:  history.length,
        currentStatus:  history.at(-1)?.status ?? 'unknown' as RuleStatus,
        firstCreatedAt: events[0]?.recordedAt ?? '',
        lastModifiedAt: events.at(-1)?.recordedAt ?? '',
        hasRollback:    events.some(e => e.type === 'rule.emergency_rollback'),
        hasConflicts:   events.some(e => e.type === 'rule.conflict_detected')
      },
      timeline: events.map(e => ({
        date:    e.recordedAt,
        action:  AUDIT_EVENT_LABELS[e.type] ?? e.type,
        actor:   e.actor,
        reason:  e.reason,
        version: e.version
      }))
    }
  }

  /**
   * Vérifie l'intégrité de l'audit trail via chaîne de hachage.
   * Chaque event inclut le hash du précédent — toute modification casse la chaîne.
   * Prouve devant un régulateur que l'historique n'a pas été manipulé.
   */
  async verifyIntegrity(ruleId: string): Promise<IntegrityResult> {
    const events = await this.getTrail(ruleId)
    const issues: string[] = []

    for (let i = 1; i < events.length; i++) {
      const prev     = events[i - 1]
      const curr     = events[i]
      const expected = sha256(JSON.stringify(prev))

      if (curr.metadata?.prevChecksum !== expected) {
        issues.push(
          `Integrity broken between event ${i-1} (${prev.type} at ${prev.recordedAt}) ` +
          `and event ${i} (${curr.type} at ${curr.recordedAt})`
        )
      }
    }

    return {
      valid:      issues.length === 0,
      issues,
      eventCount: events.length,
      checkedAt:  this.clock()
    }
  }
}

const AUDIT_EVENT_LABELS: Record<RuleAuditEventType, string> = {
  'rule.created':              'Rule created',
  'rule.updated':              'Rule updated',
  'rule.submitted_for_review': 'Submitted for review',
  'rule.sent_back_to_draft':   'Sent back to draft',
  'rule.approved':             'Approved',
  'rule.published':            'Published',
  'rule.deprecated':           'Deprecated',
  'rule.archived':             'Archived',
  'rule.rollback':             'Rollback',
  'rule.emergency_rollback':   'Emergency rollback',
  'rule.conflict_detected':    'Conflict detected',
  'rule.conflict_acknowledged':'Conflict acknowledged by reviewer'
}

interface AuditReport {
  ruleId:     string
  tenantId:   string
  exportedAt: string
  summary: {
    totalVersions:  number
    currentStatus:  RuleStatus
    firstCreatedAt: string
    lastModifiedAt: string
    hasRollback:    boolean
    hasConflicts:   boolean
  }
  timeline: Array<{
    date:    string
    action:  string
    actor:   string
    reason?: string
    version: number
  }>
}

interface IntegrityResult {
  valid:      boolean
  issues:     string[]
  eventCount: number
  checkedAt:  string
}
```

---

## 15. RuleSandbox

```ts
interface SandboxSimulateInput {
  ruleId:   string
  version:  number
  input:    Record<string, unknown>
  meta: {
    tenantId:      string
    effectiveDate: string
    country?:      string
  }
}

interface SandboxResult {
  ruleId:     string
  version:    number
  status:     'success' | 'validation_error' | 'schema_error'
  parsedRule?: Rule                  // la règle parsée si valide
  errors?:     ValidationError[]
  warnings?:   ValidationWarning[]
  simulatedAt: string
}

class RuleSandbox {
  constructor(
    private registry: RuleRegistry,
    private manager:  RuleManager
  ) {}

  /**
   * Simule l'application d'une règle draft sur un input donné.
   * Sans impacter le store de production.
   * Sans passer par le workflow — utile pour tester avant soumission.
   *
   * Retourne le résultat de validation + la règle parsée.
   * Pour exécuter réellement (avec le Core), l'host doit le faire lui-même —
   * le Registry ne connaît pas le Core au-delà de validateRuleSchema.
   */
  async simulate(params: SandboxSimulateInput): Promise<SandboxResult> {
    const rule = await this.registry.getRule(params.ruleId, params.version)
    if (!rule) throw new RuleNotFoundError(
      `Rule "${params.ruleId}" v${params.version} not found`
    )

    const now = this.manager.clock()

    try {
      // Validation complète du payload
      await this.manager.config.validator.validatePayload(toRuleInput(rule))
      await this.manager.config.validator.validatePeriod(toRuleInput(rule))

      return {
        ruleId:     params.ruleId,
        version:    params.version,
        status:     'success',
        parsedRule: JSON.parse(rule.payload) as Rule,
        simulatedAt: now
      }
    } catch (err) {
      if (err instanceof RuleValidationError) {
        return {
          ruleId:      params.ruleId,
          version:     params.version,
          status:      'validation_error',
          errors:      err.errors,
          simulatedAt: now
        }
      }
      throw err
    }
  }
}
```

---

## 16. RuleImporter

```ts
class RuleImporter {
  constructor(
    private manager:   RuleManager,
    private validator: RuleValidator
  ) {}

  async fromJSON(
    rules:   RuleInput[],
    actor:   string,
    options?: ImportOptions
  ): Promise<ImportResult> {
    const results: ImportResult = { created: [], failed: [], skipped: [] }

    for (const input of rules) {
      try {
        const rule = await this.manager.createRule(input, actor)
        results.created.push(rule)

        if (options?.autoSubmit) {
          await this.manager.submitForReview(rule.id, rule.version, actor)
        }
      } catch (err) {
        if (options?.skipOnError) {
          results.failed.push({ input, error: (err as Error).message })
        } else {
          throw err
        }
      }
    }

    return results
  }

  async fromCSV(
    csvContent: string,
    tenantId:   string,
    actor:      string,
    options?:   ImportOptions
  ): Promise<ImportResult> {
    const rows   = parseCSV(csvContent)
    const inputs = rows.map(row => csvRowToRuleInput(row, tenantId))
    return this.fromJSON(inputs, actor, options)
  }

  // v2 — LLM import
  async fromLLMOutput(_output: unknown, _actor: string): Promise<SerializedRule> {
    throw new Error(
      'fromLLMOutput is not implemented in v1. ' +
      'Use fromJSON() with the output of @run-iq/mcp-server.'
    )
  }
}

interface ImportOptions {
  skipOnError?: boolean   // défaut: false
  autoSubmit?:  boolean   // défaut: false — reste en draft
  dryRun?:      boolean   // défaut: false — valide sans créer
}

interface ImportResult {
  created: SerializedRule[]
  failed:  Array<{ input: RuleInput; error: string }>
  skipped: Array<{ input: RuleInput; reason: string }>
}
```

---

## 17. Rollback d'urgence

### Scénario réel

```
2 janvier 2025 : règle IRPP 2025 publiée avec taux incorrect (+2%)
3 janvier 2025 : découverte après 500 exécutions avec le mauvais taux
Action requise : restaurer immédiatement la règle 2024
```

### Séquence

```ts
// 1. Identifier la version stable
const history = await registry.getRuleHistory('irpp-2025')
// → [v1 (2023, archived), v2 (2024, deprecated), v3 (2025-erronée, published)]

// 2. Rollback d'urgence
const result = await registry.rules.emergencyRollback(
  'irpp-2025',
  2,
  'admin',
  'IRPP 2025 incorrect — taux majoré de 2% par erreur de saisie. ' +
  'Retour v2024 en attendant correction. Incident #2025-001.'
)
// result.restored   → { version: 2, status: 'published', ... }
// result.deprecated → { version: 3, status: 'deprecated', ... }

// 3. Le cache est invalidé automatiquement (fingerprint change)
// 4. Créer la version corrigée normalement
await registry.rules.createRule({ id: 'irpp-2025', /* payload corrigé */ }, 'fiscaliste')
// → v4, status: draft → workflow normal
```

### Garanties

- **Atomique** : les deux transitions (deprecated + published) réussissent ou aucune
- **Tracé** : `rule.emergency_rollback` dans l'audit trail avec acteur + raison obligatoire
- **Non-destructif** : la version erronée reste en deprecated, jamais supprimée
- **Rapide** : pas de redéploiement — les règles sont dans le store

---

## 18. Sécurité & isolation multi-tenant

### PermissionChecker

```ts
type Permission =
  | 'rule:create'
  | 'rule:update'
  | 'rule:submit'
  | 'rule:review'
  | 'rule:approve'
  | 'rule:deprecate'
  | 'rule:archive'
  | 'rule:emergency_rollback'
  | 'rule:read'
  | 'rule:audit'

interface PermissionChecker {
  /**
   * Checks if actor has permission for action on tenant.
   * Throws PermissionDeniedError if not authorized — never a generic Error.
   */
  check(actor: string, tenantId: string, permission: Permission): Promise<void>
  hasPermission(actor: string, tenantId: string, permission: Permission): Promise<boolean>
}

/**
 * Implémentation simple par rôles — pour dev et déploiements sans auth complexe.
 * L'host fournit sa propre implémentation en production.
 */
class DefaultPermissionChecker implements PermissionChecker {
  private roles: Map<string, Set<Permission>> = new Map()

  grantRole(actor: string, tenantId: string, role: UserRole): void {
    const key = `${actor}:${tenantId}`
    const perms = ROLE_PERMISSIONS[role]
    this.roles.set(key, new Set(perms))
  }

  async check(actor: string, tenantId: string, permission: Permission): Promise<void> {
    const has = await this.hasPermission(actor, tenantId, permission)
    if (!has) throw new PermissionDeniedError(actor, tenantId, permission)
  }

  async hasPermission(actor: string, tenantId: string, permission: Permission): Promise<boolean> {
    return this.roles.get(`${actor}:${tenantId}`)?.has(permission) ?? false
  }
}

type UserRole = 'viewer' | 'editor' | 'reviewer' | 'admin' | 'super-admin'

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  'viewer':      ['rule:read'],
  'editor':      ['rule:read', 'rule:create', 'rule:update', 'rule:submit'],
  'reviewer':    ['rule:read', 'rule:create', 'rule:update', 'rule:submit', 'rule:review', 'rule:approve', 'rule:audit'],
  'admin':       ['rule:read', 'rule:create', 'rule:update', 'rule:submit', 'rule:review', 'rule:approve', 'rule:deprecate', 'rule:archive', 'rule:audit'],
  'super-admin': ['rule:read', 'rule:create', 'rule:update', 'rule:submit', 'rule:review', 'rule:approve', 'rule:deprecate', 'rule:archive', 'rule:audit', 'rule:emergency_rollback']
}
```

### Isolation multi-tenant

Toutes les méthodes du `RuleStore` reçoivent un `tenantId`. La couche store est responsable de l'isolation — aucune requête ne peut retourner des données d'un autre tenant.

**Exception unique** : les règles `scope: 'shared'` sont visibles par tous les tenants d'une région — en lecture uniquement. Un tenant ne peut jamais modifier une règle partagée.

---

## 19. Intégration avec @run-iq/dg

Le Rule Registry est invisible pour le DG. Le DG consomme `RuleStore` via `RuleStoreResolver`.

```ts
import { RuleRegistry }       from '@run-iq/rule-registry'
import { validateRuleSchema }  from '@run-iq/core'
import { RuleStoreResolver,
         CachedRuleResolver,
         TimeoutRuleResolver,
         RetryRuleResolver }   from '@run-iq/dg'

const registry = new RuleRegistry({
  store:   new PostgresRuleRegistryAdapter(pgClient),
  regions: hostRegions,
  ruleSchemaValidator: { validate: (v) => validateRuleSchema(v) }
})

// Bridge RuleRegistry (implémente RuleStore) → DG
const resolver = new CachedRuleResolver(
  new TimeoutRuleResolver(
    new RetryRuleResolver(
      new RuleStoreResolver(registry),   // registry implémente RuleStore
      { attempts: 3, backoffMs: 100 }
    ),
    5_000
  ),
  { maxEntries: 1000, ttlMs: 300_000 }
)

const orchestrator = new DGOrchestrator(
  new CoreNodeExecutor(engine, resolver),
  engine.getDSLRegistry(),
  { adapter }
)
```

### Safe payload hydration

```ts
/**
 * Hydrates a SerializedRule payload into a Core Rule with runtime validation.
 *
 * NEVER use JSON.parse(r.payload) as Rule — the payload could be:
 *   - Corrupted (truncated JSON)
 *   - From an incompatible Core version (missing fields)
 *   - Tampered (modified after checksum computation)
 *
 * This function validates the parsed payload against the Core's Rule schema
 * before returning it. Throws RulePayloadError on any issue.
 */
function hydratePayload(rule: SerializedRule): Rule {
  // 1. Checksum verification
  const actualChecksum = sha256(rule.payload)
  if (actualChecksum !== rule.checksum) {
    throw new RulePayloadError(
      `Checksum mismatch for rule "${rule.id}" v${rule.version}. ` +
      `Expected: ${rule.checksum}, got: ${actualChecksum}. Payload may have been tampered.`
    )
  }

  // 2. JSON parse with error handling
  let parsed: unknown
  try {
    parsed = JSON.parse(rule.payload)
  } catch {
    throw new RulePayloadError(
      `Invalid JSON in payload for rule "${rule.id}" v${rule.version}.`
    )
  }

  // 3. Schema validation via Core's hydrateRule (if available)
  //    or manual field checks as fallback
  return hydrateRule(parsed)  // from @run-iq/core
}
```

---

## 20. Intégration avec @run-iq/server

```
POST   /rules                        → registry.rules.createRule()
PATCH  /rules/:id/:version           → registry.rules.updateRule()
POST   /rules/:id/:version/submit    → registry.rules.submitForReview()
POST   /rules/:id/:version/sendback  → registry.rules.sendBackToDraft()
POST   /rules/:id/:version/approve   → registry.rules.approve()
POST   /rules/:id/:version/deprecate → registry.rules.deprecate()
POST   /rules/:id/:version/archive   → registry.rules.archive()
POST   /rules/:id/rollback           → registry.rules.emergencyRollback()

GET    /rules                        → registry.listRules()
GET    /rules/:id                    → registry.getRule()
GET    /rules/:id/history            → registry.getRuleHistory()
GET    /rules/:id/conflicts          → registry.detectConflicts()
GET    /rules/:id/audit              → registry.audit.getTrail()
GET    /rules/:id/audit/export       → registry.audit.exportForAudit()
GET    /rules/:id/audit/verify       → registry.audit.verifyIntegrity()

POST   /rules/import/json            → registry.importer.fromJSON()
POST   /rules/import/csv             → registry.importer.fromCSV()
POST   /rules/sandbox/simulate       → registry.sandbox.simulate()

GET    /rules/shared/:region         → registry.scopeManager.listByRegion()
GET    /rules/at-date                → registry.dates.resolveAtDate()
GET    /rules/gaps                   → registry.dates.findGaps()
GET    /rules/next-change            → registry.dates.nextChange()

GET    /regions                      → registry.regions.list()
POST   /regions                      → registry.regions.register()
GET    /regions/:code                → registry.regions.get()
GET    /regions/country/:code        → registry.regions.getByCountry()
```

---

## 21. Erreurs

```ts
// Erreurs venant de @run-iq/context-engine (réexportées pour convenance)
export {
  RuleNotFoundError,
  RuleTransitionError,
  RulePublishError,
  RuleVersionConflictError
} from '@run-iq/context-engine'

// Classe de base pour les erreurs spécifiques à rule-registry
export class RegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RegistryError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// Erreurs spécifiques à rule-registry
export class RuleValidationError extends RegistryError {
  constructor(message: string, public readonly errors: ValidationError[]) {
    super(message)
    this.name = 'RuleValidationError'
  }
}

export class RuleConflictBlockerError extends RegistryError {
  constructor(message: string, public readonly conflicts: RuleConflict[]) {
    super(message)
    this.name = 'RuleConflictBlockerError'
  }
}

export class PermissionDeniedError extends RegistryError {
  constructor(
    public readonly actor:    string,
    public readonly tenantId: string,
    public readonly action:   string
  ) {
    super(
      `Permission denied: actor "${actor}" cannot perform "${action}" on tenant "${tenantId}". ` +
      `Check PermissionChecker configuration.`
    )
    this.name = 'PermissionDeniedError'
  }
}

export class RulePermissionError extends RegistryError {
  constructor(message: string) {
    super(message)
    this.name = 'RulePermissionError'
  }
}

export class RulePayloadError extends RegistryError {
  constructor(message: string) {
    super(message)
    this.name = 'RulePayloadError'
  }
}

export class RuleSandboxError extends RegistryError {
  constructor(message: string) {
    super(message)
    this.name = 'RuleSandboxError'
  }
}

export class RegionNotFoundError extends RegistryError {
  constructor(message: string) {
    super(message)
    this.name = 'RegionNotFoundError'
  }
}
```

---

## 22. Structure du package

```
packages/rule-registry/
├── src/
│   ├── RuleRegistry.ts             → façade principale, implémente RuleStore
│   │
│   ├── RuleManager.ts              → cycle de vie complet
│   │                                  createRule, updateRule, submitForReview,
│   │                                  sendBackToDraft, approve, deprecate,
│   │                                  archive, emergencyRollback
│   │
│   ├── RuleValidator.ts            → 3 couches de validation
│   │                                  structure, période, payload (+ schéma Core)
│   │                                  RuleSchemaValidator interface + default
│   │
│   ├── ConflictDetector.ts         → detect(), isBlocker(), explain()
│   │
│   ├── EffectiveDateManager.ts     → resolveAtDate, findGaps, nextChange
│   │
│   ├── ScopeManager.ts             → resolveWithTenantRules, listByRegion
│   │                                  agnostique — utilise RegionRegistry
│   │
│   ├── RegionRegistry.ts           → CRUD RegionConfig, agnostique
│   │                                  register, get, getByCountry, list,
│   │                                  isCountryInRegion, validateCountryInRegion
│   │
│   ├── AuditLogger.ts              → log, getTrail, exportForAudit, verifyIntegrity
│   │
│   ├── RuleSandbox.ts              → simulate() — isolation prod
│   │
│   ├── RuleImporter.ts             → fromJSON, fromCSV, fromLLMOutput (v2)
│   │
│   ├── PermissionChecker.ts        → interface + DefaultPermissionChecker
│   │                                  ROLE_PERMISSIONS map
│   │
│   ├── errors.ts                   → RegistryError (base), RuleValidationError,
│   │                                  RuleConflictBlockerError, PermissionDeniedError,
│   │                                  RulePermissionError, RulePayloadError,
│   │                                  RuleSandboxError, RegionNotFoundError
│   │
│   ├── utils.ts                    → generateId(), parseCSV(), csvRowToRuleInput()
│   │                                  sha256 importé de @run-iq/context-engine/utils
│   │
│   └── index.ts                    → exports publics
│
├── tests/
│   ├── unit/
│   │   ├── RuleManager/
│   │   │   ├── createRule.test.ts
│   │   │   ├── updateRule.test.ts
│   │   │   ├── submitForReview.test.ts
│   │   │   ├── sendBackToDraft.test.ts
│   │   │   ├── approve.test.ts
│   │   │   ├── deprecate.test.ts
│   │   │   ├── archive.test.ts
│   │   │   └── emergencyRollback.test.ts
│   │   ├── RuleValidator/
│   │   │   ├── validateStructure.test.ts
│   │   │   ├── validatePeriod.test.ts
│   │   │   └── validatePayload.test.ts    ← inclut mock de validateRuleSchema
│   │   ├── ConflictDetector.test.ts
│   │   ├── EffectiveDateManager.test.ts
│   │   ├── ScopeManager.test.ts           ← teste avec RegionConfig injectées
│   │   ├── RegionRegistry.test.ts
│   │   ├── AuditLogger.test.ts
│   │   └── RuleImporter.test.ts
│   │
│   └── integration/
│       ├── workflow-complete.test.ts
│       ├── workflow-sendback.test.ts
│       ├── conflict-blocking.test.ts
│       ├── conflict-warning.test.ts
│       ├── emergency-rollback.test.ts
│       ├── scope-shared-agnostic.test.ts  ← teste avec régions custom (pas UEMOA)
│       ├── effective-date.test.ts
│       ├── audit-integrity.test.ts
│       ├── separation-of-powers.test.ts
│       ├── multi-tenant-isolation.test.ts
│       ├── region-registry.test.ts        ← register, getByCountry, validation ISO
│       └── dg-integration.test.ts
│
├── package.json
│   {
│     "name": "@run-iq/rule-registry",
│     "version": "1.0.0",
│     "dependencies": {
│       "@run-iq/context-engine": "workspace:*",
│       "@run-iq/core":           "workspace:*"
│     }
│   }
│
└── tsconfig.json
```

---

## 23. Roadmap d'évolution

### v1 — Ce document

Périmètre exact — rien de plus :

- `RuleRegistry` : façade, implémente RuleStore
- `RuleManager` : cycle de vie complet + rollback
- `RuleValidator` : structure + période + payload (validateRuleSchema du Core)
- `ConflictDetector` : 4 types, politique critique/warning
- `EffectiveDateManager` : resolveAtDate, findGaps, nextChange
- `ScopeManager` : agnostique, utilise RegionRegistry
- `RegionRegistry` : CRUD RegionConfig, validation ISO 3166-1 alpha-2
- `AuditLogger` : log, getTrail, exportForAudit, verifyIntegrity (chaîne de hachage)
- `RuleSandbox` : simulate()
- `RuleImporter` : fromJSON, fromCSV
- `PermissionChecker` : interface + DefaultPermissionChecker par rôles
- Tests unitaires et intégration complets

### v2 — Sur besoin concret

```ts
// Notifications — alertes lors des transitions
interface RuleNotifier {
  onSubmitted(rule: SerializedRule, conflicts: RuleConflict[]): Promise<void>
  onApproved(rule: SerializedRule): Promise<void>
  onRollback(restored: SerializedRule, deprecated: SerializedRule): Promise<void>
}

// Scheduler d'expiration automatique
class RuleExpirationScheduler {
  async checkAndDeprecateExpired(): Promise<SerializedRule[]>
}

// Diff entre versions
class RuleDiffer {
  diff(v1: SerializedRule, v2: SerializedRule): RuleDiff
  explain(diff: RuleDiff): string
}

// Import LLM
async fromLLMOutput(llmOutput: LLMRuleOutput, actor: string): Promise<SerializedRule>
```

### v3 — Plateforme avancée

```
- Approval multi-niveaux (2 reviewers requis pour règles critiques)
- Publication planifiée (scheduled publish à une date)
- Versioning sémantique (majeur = breaking change)
- Webhooks sur changements de règles
- Templates de règles paramétrées
```

---

## 24. Contrats de test

### RuleManager

```ts
// createRule
✓ status = 'draft' à la création
✓ version = 1 pour un nouvel ID
✓ version = N+1 si ID existant
✓ audit event 'rule.created' enregistré
✓ throw RuleValidationError si model absent
✓ throw RuleValidationError si payload JSON invalide
✓ throw RuleValidationError si payload ne correspond pas au schéma Rule
✓ throw RulePermissionError si actor n'a pas rule:create

// updateRule
✓ crée une nouvelle version (jamais d'écrasement)
✓ throw RuleTransitionError si status != 'draft'
✓ audit event 'rule.updated' enregistré
✓ re-valide le payload si updates.payload présent

// submitForReview
✓ draft → review
✓ throw RuleConflictBlockerError si conflit critique
✓ retourne conflicts warning sans bloquer
✓ audit 'rule.submitted_for_review' enregistré
✓ audit 'rule.conflict_detected' si warnings présents
✓ throw RuleTransitionError si status != 'draft'

// sendBackToDraft
✓ review → draft
✓ throw RuleTransitionError si status != 'review'
✓ throw RulePermissionError si actor == createdBy
✓ audit 'rule.sent_back_to_draft' avec commentaire

// approve
✓ review → published
✓ throw RulePermissionError si actor == createdBy (séparation des pouvoirs)
✓ déprécie automatiquement les règles chevauchantes
✓ audit 'rule.published' enregistré
✓ audit 'rule.conflict_acknowledged' si warnings présents
✓ throw RuleTransitionError si status != 'review'

// emergencyRollback
✓ restaure la version cible en published
✓ déprécie la version courante
✓ audit 'rule.emergency_rollback' avec raison
✓ throw si reason vide
✓ throw RulePermissionError si manque rule:emergency_rollback
✓ throw RuleNotFoundError si version cible inexistante
```

### RuleValidator

```ts
// validatePayload — intégration validateRuleSchema
✓ throw si payload n'est pas du JSON valide
✓ throw si payload.id absent (via validateRuleSchema mocké)
✓ throw si payload.outputs vide (via validateRuleSchema mocké)
✓ throw si payload.model != input.model (MODEL_MISMATCH)
✓ pass si payload valide et model cohérent
✓ le mock de validateRuleSchema est utilisé — pas le Core réel en unit test
```

### RegionRegistry

```ts
✓ register() accepte RegionConfig valide
✓ register() throw si code vide
✓ register() throw si countries vide
✓ register() throw si country code != 2 lettres majuscules
✓ get() retourne la région configurée
✓ get() retourne undefined si absente
✓ getOrThrow() throw RegionNotFoundError si absente
✓ getByCountry() retourne toutes les régions d'un pays
✓ getByCountry() retourne [] si pays dans aucune région
✓ isCountryInRegion() retourne true si pays membre
✓ isCountryInRegion() retourne false si région non configurée
✓ list() retourne toutes les régions enregistrées
```

### ScopeManager — agnostique

```ts
// Tous ces tests utilisent des RegionConfig fictives, pas UEMOA/OHADA
✓ resolveWithTenantRules() combine règles tenant + shared de la région du pays
✓ règle tenant-specific surcharge règle shared sur même model + période
✓ si pays dans plusieurs régions → déduplique les règles shared
✓ si region absent dans query ET country absent → retourne seulement tenant-specific
✓ listByRegion() throw RegionNotFoundError si région non configurée
```

### Intégration

```ts
✓ workflow complet draft → review → published avec deux acteurs
✓ soumission bloquée par conflit critique
✓ approval avec conflit warning → acknowledged dans audit
✓ rollback d'urgence → audit trail complet → fingerprint invalidé
✓ multi-tenant isolation stricte
✓ règles shared visibles par tenants de la région, pas les autres
✓ verifyIntegrity() détecte une modification d'un event passé
✓ DG + RuleStoreResolver + RuleRegistry → résolution correcte à l'exécution
```

---

*Ce document est la source de vérité pour l'implémentation de `@run-iq/rule-registry`.*  
*Ce package dépend de `@run-iq/context-engine` et de `@run-iq/core` (Catégorie B uniquement).*  
*Les régions géographiques sont des données injectées par l'host — jamais dans le code source.*  
*Implémenter après `@run-iq/context-engine` et `@run-iq/core`.*