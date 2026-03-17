import { RegionNotFoundError, RuleValidationError } from './errors.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RegionConfig {
  readonly code: string;
  readonly name: string;
  readonly countries: readonly string[];
  readonly description?: string;
  readonly metadata?: Record<string, unknown>;
}

// ─── RegionRegistry ──────────────────────────────────────────────────────────

export class RegionRegistry {
  private readonly regions: Map<string, RegionConfig> = new Map();

  constructor(initialRegions: readonly RegionConfig[] = []) {
    for (const region of initialRegions) {
      this.register(region);
    }
  }

  register(region: RegionConfig): void {
    if (!region.code?.trim()) {
      throw new Error('RegionConfig.code must be a non-empty string');
    }
    if (!region.countries?.length) {
      throw new Error(`RegionConfig "${region.code}" must have at least one country`);
    }

    for (const country of region.countries) {
      if (!/^[A-Z]{2}$/.test(country)) {
        throw new Error(
          `Invalid country code "${country}" in region "${region.code}". ` +
            `Must be ISO 3166-1 alpha-2 (2 uppercase letters).`,
        );
      }
    }

    this.regions.set(region.code, region);
  }

  get(code: string): RegionConfig | undefined {
    return this.regions.get(code);
  }

  getOrThrow(code: string): RegionConfig {
    const region = this.regions.get(code);
    if (!region) {
      throw new RegionNotFoundError(
        `Region "${code}" is not configured. ` +
          `Register it via RegionRegistry.register() or RuleRegistryConfig.regions.`,
      );
    }
    return region;
  }

  getByCountry(countryCode: string): RegionConfig[] {
    return [...this.regions.values()].filter((r) => r.countries.includes(countryCode));
  }

  list(): RegionConfig[] {
    return [...this.regions.values()];
  }

  isCountryInRegion(countryCode: string, regionCode: string): boolean {
    const region = this.regions.get(regionCode);
    return region?.countries.includes(countryCode) ?? false;
  }

  validateCountryInRegion(countryCode: string, regionCode: string): void {
    if (!this.isCountryInRegion(countryCode, regionCode)) {
      throw new RuleValidationError(
        `Country "${countryCode}" is not a member of region "${regionCode}"`,
        [
          {
            field: 'country',
            message: `"${countryCode}" is not in region "${regionCode}"`,
            code: 'COUNTRY_NOT_IN_REGION',
          },
        ],
      );
    }
  }
}
