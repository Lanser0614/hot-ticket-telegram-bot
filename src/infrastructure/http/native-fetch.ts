import {
  NetworkError,
  TimeoutError,
  type TextHttpClient,
  type TextHttpResponse
} from '../aviasales/client.js';

export type NativeFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class NativeTextHttpClient implements TextHttpClient {
  public constructor(private readonly fetch: NativeFetch = globalThis.fetch) {}

  public async get(
    url: URL,
    timeoutMs: number,
    headers: Readonly<Record<string, string>>
  ): Promise<TextHttpResponse> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await this.fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      return { status: response.status, body: await response.text() };
    } catch (error: unknown) {
      if (timedOut) throw new TimeoutError();
      throw new NetworkError(error instanceof Error ? error.message : 'Ошибка HTTP transport');
    } finally {
      clearTimeout(timer);
    }
  }
}
