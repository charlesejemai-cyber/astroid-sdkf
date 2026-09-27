import { describe, it, expect } from 'vitest';
import {
  formatAmount,
  formatAsset,
  truncateMiddle,
  formatPercent,
  isNativeAsset,
  isValidAssetCode,
  assetIdentifier,
  parseAssetIdentifier,
  isStellarAddress,
  isEmail,
  isPositiveAmount,
  isUuid,
  validateTransfer,
  normalizePagination,
  buildPaginationMeta,
  nextPage,
  isExpired,
  addSeconds,
  relativeTime,
} from './index.js';

const VALID_ADDRESS = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

describe('formatting', () => {
  it('formats amounts and assets', () => {
    expect(formatAmount('1234.5')).toBe('1,234.50');
    expect(formatAsset('150', 'USDC')).toBe('150.00 USDC');
    expect(formatPercent(0.75)).toBe('75%');
  });

  it('truncates the middle of long identifiers', () => {
    expect(truncateMiddle('GABCDEFGHIJKLMNOP', 4, 4)).toBe('GABC…MNOP');
    expect(truncateMiddle('short')).toBe('short');
  });
});

describe('assets', () => {
  it('recognises native XLM', () => {
    expect(isNativeAsset('XLM')).toBe(true);
    expect(isNativeAsset('native')).toBe(true);
    expect(isNativeAsset('USDC')).toBe(false);
  });

  it('validates asset codes', () => {
    expect(isValidAssetCode('USDC')).toBe(true);
    expect(isValidAssetCode('TOOLONGASSETCODE')).toBe(false);
    expect(isValidAssetCode('BAD CODE')).toBe(false);
  });

  it('builds and parses canonical identifiers', () => {
    expect(assetIdentifier('USDC', 'GAISSUER')).toBe('USDC:GAISSUER');
    expect(assetIdentifier('XLM')).toBe('XLM');
    expect(parseAssetIdentifier('USDC:GAISSUER')).toEqual({ code: 'USDC', issuer: 'GAISSUER' });
    expect(parseAssetIdentifier('XLM')).toEqual({ code: 'XLM' });
  });
});

describe('validation', () => {
  it('recognises Stellar addresses, emails, amounts and uuids', () => {
    expect(isStellarAddress(VALID_ADDRESS)).toBe(true);
    expect(isStellarAddress('not-an-address')).toBe(false);
    expect(isEmail('dev@astroid.dev')).toBe(true);
    expect(isEmail('nope')).toBe(false);
    expect(isPositiveAmount('10.5')).toBe(true);
    expect(isPositiveAmount('-1')).toBe(false);
    expect(isUuid('018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b')).toBe(true);
  });

  it('collects transfer validation issues', () => {
    expect(validateTransfer({ recipientAddress: VALID_ADDRESS, asset: 'USDC', amount: 5 })).toEqual(
      [],
    );
    const issues = validateTransfer({ recipientAddress: 'bad', asset: 'BAD CODE', amount: -1 });
    expect(issues.map((i) => i.field)).toEqual(['recipientAddress', 'asset', 'amount']);
  });
});

describe('pagination', () => {
  it('normalises and clamps params', () => {
    expect(normalizePagination({ page: 0, limit: 999 })).toMatchObject({ page: 1, limit: 100 });
    expect(normalizePagination()).toMatchObject({ page: 1, limit: 25 });
  });

  it('builds metadata and computes next page', () => {
    const meta = buildPaginationMeta(120, 2, 25);
    expect(meta).toMatchObject({ totalPages: 5, hasNextPage: true, hasPreviousPage: true });
    expect(nextPage(meta)).toBe(3);
    expect(nextPage({ page: 5, totalPages: 5 })).toBeNull();
  });
});

describe('dates', () => {
  it('detects expiry and adds seconds', () => {
    expect(isExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isExpired(new Date(Date.now() + 10_000))).toBe(false);
    const later = addSeconds(new Date('2026-01-01T00:00:00.000Z'), 60);
    expect(later).toBe('2026-01-01T00:01:00.000Z');
  });

  it('produces relative time strings', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    expect(relativeTime(new Date('2026-01-01T00:05:00.000Z'), from)).toBe('in 5m');
    expect(relativeTime(new Date('2025-12-31T23:55:00.000Z'), from)).toBe('5m ago');
  });
});
