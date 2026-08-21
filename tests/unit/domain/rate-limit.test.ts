import { describe, expect, it } from 'vitest';

import { FixedWindowRateLimiter } from '../../../src/domain/rate-limit.js';

describe('FixedWindowRateLimiter', () => {
  it('ограничивает ключ и открывает новое окно через минуту', () => {
    const limiter = new FixedWindowRateLimiter(2);
    const start = new Date('2026-08-21T10:00:00Z');

    expect(limiter.allow('user-1', start)).toBe(true);
    expect(limiter.allow('user-1', start)).toBe(true);
    expect(limiter.allow('user-1', start)).toBe(false);
    expect(limiter.allow('user-2', start)).toBe(true);
    expect(limiter.allow('user-1', new Date(start.getTime() + 60_000))).toBe(true);
  });
});
