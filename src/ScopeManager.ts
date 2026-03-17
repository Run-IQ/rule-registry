import type { RuleStore, RuleQuery, SerializedRule } from '@run-iq/context-engine';
import type { RegionRegistry } from './RegionRegistry.js';

export class ScopeManager {
  constructor(
    private readonly store: RuleStore,
    private readonly regionRegistry: RegionRegistry,
  ) {}

  async resolveWithTenantRules(query: RuleQuery): Promise<SerializedRule[]> {
    // Tenant-specific rules
    const tenantRules = await this.store.resolveRules({
      ...query,
      includeShared: false,
    });

    // Shared rules — via configured regions
    let sharedRules: SerializedRule[] = [];
    if (query.region) {
      sharedRules = await this.store.listSharedRules(query.region, query.model);
    } else if (query.country) {
      const regions = this.regionRegistry.getByCountry(query.country);
      const results = await Promise.all(
        regions.map((r) => this.store.listSharedRules(r.code, query.model)),
      );
      sharedRules = results.flat();
    }

    // Deduplicate shared rules (a country can be in multiple regions)
    const seen = new Set<string>();
    sharedRules = sharedRules.filter((r) => {
      const key = `${r.id}:${r.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Tenant-specific takes priority — exclude shared covered by tenant-specific
    const tenantCoverage = new Set(
      tenantRules.map((r) => `${r.model}:${r.effectiveFrom}:${r.effectiveUntil ?? 'open'}`),
    );

    const applicableShared = sharedRules.filter(
      (r) => !tenantCoverage.has(`${r.model}:${r.effectiveFrom}:${r.effectiveUntil ?? 'open'}`),
    );

    return [...tenantRules, ...applicableShared].sort(
      (a, b) => b.priority - a.priority || b.version - a.version,
    );
  }

  async listByRegion(regionCode: string, model?: string): Promise<SerializedRule[]> {
    this.regionRegistry.getOrThrow(regionCode);
    return this.store.listSharedRules(regionCode, model);
  }
}
