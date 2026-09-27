import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyWebhookSignature } from '../src/webhooks.js';

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_test_secret_12345';
  const payload = JSON.stringify({ id: 'evt_123', event: 'transaction.completed' });
  const fixedNow = 1700000300; // Fixed current time in seconds

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createHeader(timestamp: number, payloadStr: string, sec: string = secret, version = 'v1') {
    const signature = createHmac('sha256', sec)
      .update(`${timestamp}.${payloadStr}`)
      .digest('hex');
    return `t=${timestamp},${version}=${signature}`;
  }

  it('validates a signature with valid timestamp and signature', () => {
    const timestamp = fixedNow - 10;
    const header = createHeader(timestamp, payload);
    const result = verifyWebhookSignature(payload, header, secret);
    expect(result).toBe(true);
  });

  it('rejects tampered payload', () => {
    const timestamp = fixedNow - 10;
    const header = createHeader(timestamp, payload);
    const tamperedPayload = JSON.stringify({ id: 'evt_123', event: 'transaction.completed', tampered: true });
    const result = verifyWebhookSignature(tamperedPayload, header, secret);
    expect(result).toBe(false);
  });

  it('rejects stale timestamp beyond default 5-minute tolerance', () => {
    const staleTimestamp = fixedNow - 301; // 301 seconds old (> default 300)
    const header = createHeader(staleTimestamp, payload);
    const result = verifyWebhookSignature(payload, header, secret);
    expect(result).toBe(false);
  });

  it('accepts stale timestamp within custom toleranceSeconds', () => {
    const staleTimestamp = fixedNow - 500;
    const header = createHeader(staleTimestamp, payload);
    const result = verifyWebhookSignature(payload, header, secret, 600);
    expect(result).toBe(true);
  });

  it('rejects timestamp in the future', () => {
    const futureTimestamp = fixedNow + 10;
    const header = createHeader(futureTimestamp, payload);
    const result = verifyWebhookSignature(payload, header, secret);
    expect(result).toBe(false);
  });

  it('rejects invalid header formats', () => {
    expect(verifyWebhookSignature(payload, '', secret)).toBe(false);
    expect(verifyWebhookSignature(payload, 'invalid-header-format', secret)).toBe(false);
    expect(verifyWebhookSignature(payload, 't=1700000000', secret)).toBe(false);
    expect(verifyWebhookSignature(payload, 'v1=abcdef12345', secret)).toBe(false);
    expect(verifyWebhookSignature(payload, 't=notanumber,v1=abcdef', secret)).toBe(false);
  });

  it('rejects missing or empty parameters', () => {
    const header = createHeader(fixedNow, payload);
    expect(verifyWebhookSignature('', header, secret)).toBe(false);
    expect(verifyWebhookSignature(payload, header, '')).toBe(false);
    expect(verifyWebhookSignature(payload, header, secret, 300)).toBe(true);
  });

  it('rejects signature mismatched with secret', () => {
    const timestamp = fixedNow - 10;
    const header = createHeader(timestamp, payload, 'different_secret');
    const result = verifyWebhookSignature(payload, header, secret);
    expect(result).toBe(false);
  });
});
