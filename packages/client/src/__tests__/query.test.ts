import { describe, it, expect } from 'vitest';
import { serializeQuery } from '../query.js';

describe('serializeQuery', () => {
  it('returns empty string for undefined or empty params', () => {
    expect(serializeQuery(undefined)).toBe('');
    expect(serializeQuery({})).toBe('');
  });

  it('serializes strings, numbers, and booleans', () => {
    const query = serializeQuery({
      search: 'agent-1',
      limit: 10,
      active: true,
      disabled: false,
    });
    expect(query).toBe('?search=agent-1&limit=10&active=true&disabled=false');
  });

  it('omits null, undefined, and empty string values', () => {
    const query = serializeQuery({
      name: 'test',
      missing: null,
      absent: undefined,
      emptyStr: '',
    });
    expect(query).toBe('?name=test');
  });

  it('serializes arrays with bracket notation', () => {
    const query = serializeQuery({
      status: ['active', 'pending'],
      tags: ['ai', null, 'stellar', ''],
    });
    expect(query).toBe(
      '?status%5B0%5D=active&status%5B1%5D=pending&tags%5B0%5D=ai&tags%5B2%5D=stellar',
    );
  });

  it('serializes nested objects recursively', () => {
    const query = serializeQuery({
      filter: {
        asset: 'USDC',
        minAmount: 100,
        nested: {
          deep: true,
        },
      },
    });
    expect(query).toBe(
      '?filter%5Basset%5D=USDC&filter%5BminAmount%5D=100&filter%5Bnested%5D%5Bdeep%5D=true',
    );
  });
});
