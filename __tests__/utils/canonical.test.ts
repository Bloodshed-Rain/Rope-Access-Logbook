import { canonicalize } from '../../src/utils/canonical';

describe('canonicalize', () => {
  it('sorts keys alphabetically', () => {
    const result = canonicalize({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('sorts nested object keys', () => {
    const result = canonicalize({ b: { d: 1, c: 2 }, a: 3 });
    expect(result).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it('preserves arrays in order', () => {
    const result = canonicalize({ items: [3, 1, 2] });
    expect(result).toBe('{"items":[3,1,2]}');
  });

  it('handles null values', () => {
    const result = canonicalize({ a: null, b: 1 });
    expect(result).toBe('{"a":null,"b":1}');
  });

  it('excludes created_at and updated_at', () => {
    const result = canonicalize({
      date: '2026-01-01',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });
    expect(result).toBe('{"date":"2026-01-01"}');
  });

  it('produces identical output for identical data regardless of key order', () => {
    const a = canonicalize({ x: 1, y: 2, z: 3 });
    const b = canonicalize({ z: 3, x: 1, y: 2 });
    expect(a).toBe(b);
  });

  it('normalizes whitespace in string values', () => {
    const result = canonicalize({ note: '  hello   world  ' });
    expect(result).toBe('{"note":"hello world"}');
  });
});
