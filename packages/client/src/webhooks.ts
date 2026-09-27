import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validates an incoming Astroid webhook signature header and guards against replay attacks.
 *
 * @param payload - The raw string body of the incoming webhook HTTP request.
 * @param signatureHeader - The full signature header string (e.g., `t=1700000000,v1=abcdef...`).
 * @param secret - The webhook endpoint signing secret.
 * @param toleranceSeconds - Maximum allowed age of the payload timestamp in seconds (default: 300).
 * @returns `true` if signature and timestamp are valid, `false` otherwise.
 */
export function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds: number = 300,
): boolean {
  if (!payload || typeof payload !== 'string' || !signatureHeader || !secret) {
    return false;
  }

  // Parse header parameters: e.g. "t=1700000000,v1=abcdef..."
  const elements = signatureHeader.split(',');
  let timestampStr: string | undefined;
  let signature: string | undefined;

  for (const element of elements) {
    const [key, ...valueParts] = element.split('=');
    if (!key || valueParts.length === 0) continue;
    const value = valueParts.join('=');
    if (key.trim() === 't') {
      timestampStr = value.trim();
    } else if (key.trim() === 'v1') {
      signature = value.trim();
    }
  }

  if (!timestampStr || !signature) {
    return false;
  }

  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  // Reject payloads where timestamp is in the future or older than toleranceSeconds
  if (timestamp > now || now - timestamp > toleranceSeconds) {
    return false;
  }

  // HMAC-SHA256 of timestamp + '.' + payload
  const expectedSignature = createHmac('sha256', secret)
    .update(`${timestampStr}.${payload}`)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const actualBuffer = Buffer.from(signature, 'utf8');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
