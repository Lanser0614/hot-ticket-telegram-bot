import type { SdkFetch } from 'sdk';

import {
  NetworkError,
  TimeoutError,
  type TextHttpClient,
  type TextHttpResponse
} from '../../infrastructure/aviasales/client.js';

export class SdkTextHttpClient implements TextHttpClient {
  public constructor(private readonly fetch: SdkFetch) {}

  public async get(
    url: URL,
    timeoutMs: number,
    headers: Readonly<Record<string, string>>
  ): Promise<TextHttpResponse> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new TimeoutError()), timeoutMs);
    });
    try {
      const response = await Promise.race([
        this.fetch(url.toString(), { method: 'GET', headers }),
        timeout
      ]);
      return { status: response.status, body: await response.text() };
    } catch (error: unknown) {
      if (error instanceof TimeoutError) throw error;
      throw new NetworkError(error instanceof Error ? error.message : 'Ошибка sdk/fetch');
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
}

