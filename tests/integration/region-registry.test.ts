import { RuleRegistry } from '../../src/RuleRegistry.js';
import { InMemoryRuleStore } from '@run-iq/context-engine';
import { RegionNotFoundError } from '../../src/errors.js';

const regions = [
  { code: 'EU', name: 'European Union', countries: ['FR', 'DE', 'IT', 'ES'] },
  { code: 'EEA', name: 'European Economic Area', countries: ['FR', 'DE', 'IT', 'ES', 'NO', 'IS'] },
];

describe('Integration: Region registry', () => {
  it('regions from config are available', () => {
    const registry = new RuleRegistry({ store: new InMemoryRuleStore(), regions });
    expect(registry.regions.list()).toHaveLength(2);
  });

  it('get by country returns matching regions', () => {
    const registry = new RuleRegistry({ store: new InMemoryRuleStore(), regions });
    const fr = registry.regions.getByCountry('FR');
    expect(fr).toHaveLength(2);
  });

  it('NO is in EEA but not EU', () => {
    const registry = new RuleRegistry({ store: new InMemoryRuleStore(), regions });
    expect(registry.regions.isCountryInRegion('NO', 'EEA')).toBe(true);
    expect(registry.regions.isCountryInRegion('NO', 'EU')).toBe(false);
  });

  it('dynamic registration works', () => {
    const registry = new RuleRegistry({ store: new InMemoryRuleStore(), regions });
    registry.regions.register({ code: 'ASEAN', name: 'ASEAN', countries: ['SG', 'MY'] });
    expect(registry.regions.get('ASEAN')).toBeDefined();
  });

  it('getOrThrow throws for unknown region', () => {
    const registry = new RuleRegistry({ store: new InMemoryRuleStore(), regions });
    expect(() => registry.regions.getOrThrow('UNKNOWN')).toThrow(RegionNotFoundError);
  });
});
