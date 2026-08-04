import { describe, expect, it } from 'vitest';

import { NetworkError, TimeoutError } from '../../../src/infrastructure/aviasales/client.js';
import { NativeTextHttpClient } from '../../../src/infrastructure/http/native-fetch.js';

describe('NativeTextHttpClient', () => {
  it('возвращает status и text', async () => {
    const client = new NativeTextHttpClient(() => Promise.resolve(new Response('body', { status: 200 })));
    await expect(client.get(new URL('https://example.com'), 100, { accept: 'text/plain' }))
      .resolves.toEqual({ status: 200, body: 'body' });
  });

  it('классифицирует network error', async () => {
    const client = new NativeTextHttpClient(() => Promise.reject(new Error('offline')));
    await expect(client.get(new URL('https://example.com'), 100, {}))
      .rejects.toBeInstanceOf(NetworkError);
  });

  it('классифицирует timeout', async () => {
    const client = new NativeTextHttpClient((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await expect(client.get(new URL('https://example.com'), 1, {}))
      .rejects.toBeInstanceOf(TimeoutError);
  });
});
