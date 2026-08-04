import { describe, expect, it } from 'vitest';

import { createSyncEndpoint } from '../../../src/http/sync-endpoint.js';

class FakeJob {
  public calls = 0;
  public failure: Error | null = null;

  public execute(): Promise<{ processedSources: number }> {
    this.calls += 1;
    if (this.failure !== null) return Promise.reject(this.failure);
    return Promise.resolve({ processedSources: 1 });
  }
}

describe('sync endpoint', () => {
  it('принимает только POST', async () => {
    const job = new FakeJob();
    const endpoint = createSyncEndpoint({ syncSecret: 'strong-secret', job });

    await expect(endpoint({ method: 'GET', authorization: 'Bearer strong-secret' }))
      .resolves.toEqual({ statusCode: 405, body: { status: 'error' } });
    expect(job.calls).toBe(0);
  });

  it.each([null, '', 'Bearer wrong', 'Basic strong-secret'])('отклоняет authorization %j', async (authorization) => {
    const job = new FakeJob();
    const endpoint = createSyncEndpoint({ syncSecret: 'strong-secret', job });

    await expect(endpoint({ method: 'POST', authorization }))
      .resolves.toEqual({ statusCode: 401, body: { status: 'error' } });
    expect(job.calls).toBe(0);
  });

  it('запускает все активные sources и возвращает только счётчик', async () => {
    const job = new FakeJob();
    const endpoint = createSyncEndpoint({ syncSecret: 'strong-secret', job });

    await expect(endpoint({ method: 'POST', authorization: 'Bearer strong-secret' }))
      .resolves.toEqual({
        statusCode: 200,
        body: { status: 'success', processed_sources: 1 }
      });
    expect(job.calls).toBe(1);
  });

  it('не раскрывает внутреннюю ошибку job', async () => {
    const job = new FakeJob();
    job.failure = new Error('full Aviasales response and stack');
    const endpoint = createSyncEndpoint({ syncSecret: 'strong-secret', job });

    const response = await endpoint({ method: 'POST', authorization: 'Bearer strong-secret' });
    expect(response).toEqual({ statusCode: 500, body: { status: 'error' } });
    expect(JSON.stringify(response)).not.toContain('Aviasales');
  });
});
