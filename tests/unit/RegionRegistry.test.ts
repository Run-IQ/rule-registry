import { RegionRegistry } from '../../src/RegionRegistry.js';
import { RegionNotFoundError, RuleValidationError } from '../../src/errors.js';

describe('RegionRegistry', () => {
  const ALPHA = { code: 'ALPHA', name: 'Alpha Region', countries: ['AA', 'BB', 'CC'] };
  const BETA = { code: 'BETA', name: 'Beta Region', countries: ['BB', 'DD'] };

  it('register() accepts valid RegionConfig', () => {
    const reg = new RegionRegistry();
    reg.register(ALPHA);
    expect(reg.get('ALPHA')).toEqual(ALPHA);
  });

  it('register() throws if code empty', () => {
    const reg = new RegionRegistry();
    expect(() => reg.register({ code: '', name: 'x', countries: ['AA'] })).toThrow(
      'must be a non-empty string',
    );
  });

  it('register() throws if countries empty', () => {
    const reg = new RegionRegistry();
    expect(() => reg.register({ code: 'X', name: 'x', countries: [] })).toThrow(
      'must have at least one country',
    );
  });

  it('register() throws if country code not 2 uppercase letters', () => {
    const reg = new RegionRegistry();
    expect(() => reg.register({ code: 'X', name: 'x', countries: ['aa'] })).toThrow(
      'ISO 3166-1 alpha-2',
    );
    expect(() => reg.register({ code: 'X', name: 'x', countries: ['TOG'] })).toThrow(
      'ISO 3166-1 alpha-2',
    );
  });

  it('get() returns undefined if not registered', () => {
    const reg = new RegionRegistry();
    expect(reg.get('NOPE')).toBeUndefined();
  });

  it('getOrThrow() throws RegionNotFoundError', () => {
    const reg = new RegionRegistry();
    expect(() => reg.getOrThrow('NOPE')).toThrow(RegionNotFoundError);
  });

  it('getByCountry() returns all regions containing country', () => {
    const reg = new RegionRegistry([ALPHA, BETA]);
    const regions = reg.getByCountry('BB');
    expect(regions).toHaveLength(2);
    expect(regions.map((r) => r.code).sort()).toEqual(['ALPHA', 'BETA']);
  });

  it('getByCountry() returns [] if country in no region', () => {
    const reg = new RegionRegistry([ALPHA]);
    expect(reg.getByCountry('ZZ')).toEqual([]);
  });

  it('isCountryInRegion() returns true if member', () => {
    const reg = new RegionRegistry([ALPHA]);
    expect(reg.isCountryInRegion('AA', 'ALPHA')).toBe(true);
  });

  it('isCountryInRegion() returns false if region not configured', () => {
    const reg = new RegionRegistry();
    expect(reg.isCountryInRegion('AA', 'NOPE')).toBe(false);
  });

  it('list() returns all registered regions', () => {
    const reg = new RegionRegistry([ALPHA, BETA]);
    expect(reg.list()).toHaveLength(2);
  });

  it('validateCountryInRegion() throws if not member', () => {
    const reg = new RegionRegistry([ALPHA]);
    expect(() => reg.validateCountryInRegion('ZZ', 'ALPHA')).toThrow(RuleValidationError);
  });
});
