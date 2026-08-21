import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ClickSource } from './click-tracking.js';

export interface ClickPayload {
  readonly ticketId: number;
  readonly source: ClickSource;
  readonly userId: number | null;
  readonly subscriptionId: number | null;
}

export function serializeClickPayload(payload: ClickPayload): string {
  return [
    payload.ticketId,
    payload.source,
    payload.userId ?? '',
    payload.subscriptionId ?? ''
  ].join('|');
}

export function signClickPayload(payload: ClickPayload, secret: string): string {
  return createHmac('sha256', secret)
    .update(serializeClickPayload(payload))
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

export function verifyClickSignature(
  payload: ClickPayload,
  signature: string,
  secret: string
): boolean {
  const expected = Buffer.from(signClickPayload(payload, secret));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
