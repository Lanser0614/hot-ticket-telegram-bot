import { describe, expect, it } from 'vitest';

import type { Logger } from '../../../src/application/ports.js';
import type { AppConfig } from '../../../src/config.js';
import {
  AviasalesClient,
  AviasalesHotTicketsProvider,
  AviasalesHttpError,
  NetworkError,
  TimeoutError,
  type Sleeper,
  type TextHttpClient,
  type TextHttpResponse
} from '../../../src/infrastructure/aviasales/client.js';
import { AviasalesResponseError } from '../../../src/infrastructure/aviasales/mapper.js';

class SequenceHttpClient implements TextHttpClient {
  public calls = 0;

  public constructor(private readonly sequence: Array<TextHttpResponse | Error>) {}

  public get(): Promise<TextHttpResponse> {
    const item = this.sequence[this.calls];
    this.calls += 1;
    if (item === undefined) return Promise.reject(new Error('Тестовая последовательность закончилась'));
    if (item instanceof Error) return Promise.reject(item);
    return Promise.resolve(item);
  }
}

class RecordingSleeper implements Sleeper {
  public readonly delays: number[] = [];

  public sleep(milliseconds: number): Promise<void> {
    this.delays.push(milliseconds);
    return Promise.resolve();
  }
}

const config: AppConfig = {
  aviasalesExploreBaseUrl: 'https://explore-api.aviasales.com',
  aviasalesMarket: 'uz',
  aviasalesLanguage: 'ru',
  aviasalesPassportCountry: 'UZ'
};

const logger: Logger = {
  info() {},
  warn() {},
  error() {}
};

describe('AviasalesClient', () => {
  it('повторяет 503 и возвращает второй успешный ответ', async () => {
    const http = new SequenceHttpClient([
      { status: 503, body: 'busy' },
      { status: 200, body: '{"directions":[]}' }
    ]);
    const sleeper = new RecordingSleeper();
    const client = new AviasalesClient(http, sleeper, config);

    await expect(client.getHotOffers({ originCode: 'TAS', currencyCode: 'UZS' }))
      .resolves.toEqual({ directions: [] });
    expect(http.calls).toBe(2);
    expect(sleeper.delays).toEqual([250]);
  });

  it('не повторяет HTTP 400', async () => {
    const http = new SequenceHttpClient([{ status: 400, body: 'bad request' }]);
    const client = new AviasalesClient(http, new RecordingSleeper(), config);

    await expect(client.getHotOffers({ originCode: 'TAS', currencyCode: 'UZS' }))
      .rejects.toBeInstanceOf(AviasalesHttpError);
    expect(http.calls).toBe(1);
  });

  it('не повторяет некорректный JSON', async () => {
    const http = new SequenceHttpClient([{ status: 200, body: '{broken' }]);
    const client = new AviasalesClient(http, new RecordingSleeper(), config);

    await expect(client.getHotOffers({ originCode: 'TAS', currencyCode: 'UZS' }))
      .rejects.toBeInstanceOf(AviasalesResponseError);
    expect(http.calls).toBe(1);
  });

  it.each([new TimeoutError(), new NetworkError('offline')])('делает три попытки для %s', async (error) => {
    const http = new SequenceHttpClient([error, error, error]);
    const sleeper = new RecordingSleeper();
    const client = new AviasalesClient(http, sleeper, config);

    await expect(client.getHotOffers({ originCode: 'TAS', currencyCode: 'UZS' })).rejects.toBe(error);
    expect(http.calls).toBe(3);
    expect(sleeper.delays).toEqual([250, 500]);
  });

  it('provider не повторяет неверную структуру ответа', async () => {
    const http = new SequenceHttpClient([{ status: 200, body: '{}' }]);
    const client = new AviasalesClient(http, new RecordingSleeper(), config);
    const provider = new AviasalesHotTicketsProvider(client, logger);

    await expect(provider.getHotTickets({ originCode: 'TAS', currencyCode: 'UZS' }))
      .rejects.toBeInstanceOf(AviasalesResponseError);
    expect(http.calls).toBe(1);
  });
});
