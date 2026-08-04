import type { HotTicketsProvider, Logger } from '../../application/ports.js';
import type { AppConfig } from '../../config.js';
import type { HotOffersInput } from '../../domain/codes.js';
import type { Ticket } from '../../domain/ticket.js';
import { mapHotOffersResponse, AviasalesResponseError } from './mapper.js';
import { createHotOffersUrl } from './url.js';

export interface TextHttpResponse {
  status: number;
  body: string;
}

export interface TextHttpClient {
  get(
    url: URL,
    timeoutMs: number,
    headers: Readonly<Record<string, string>>
  ): Promise<TextHttpResponse>;
}

export interface Sleeper {
  sleep(milliseconds: number): Promise<void>;
}

export class TimeoutError extends Error {
  public override readonly name = 'TimeoutError';

  public constructor() {
    super('Превышен тайм-аут Aviasales');
  }
}

export class NetworkError extends Error {
  public override readonly name = 'NetworkError';
}

export class AviasalesHttpError extends Error {
  public override readonly name = 'AviasalesHttpError';

  public constructor(
    public readonly status: number,
    public readonly responseBody: string
  ) {
    super(`Aviasales вернул HTTP ${status}`);
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS = [250, 500] as const;

export class AviasalesClient {
  public constructor(
    private readonly http: TextHttpClient,
    private readonly sleeper: Sleeper,
    private readonly config: AppConfig
  ) {}

  public async getHotOffers(input: HotOffersInput): Promise<unknown> {
    const url = createHotOffersUrl(input, this.config);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.http.get(url, 10_000, { Accept: 'application/json' });
        if (response.status < 200 || response.status >= 300) {
          const error = new AviasalesHttpError(response.status, response.body.slice(0, 1_000));
          if (RETRYABLE_STATUSES.has(response.status) && attempt < 2) {
            await this.sleeper.sleep(RETRY_DELAYS[attempt] ?? 500);
            continue;
          }
          throw error;
        }

        try {
          return JSON.parse(response.body) as unknown;
        } catch {
          throw new AviasalesResponseError('Aviasales вернул некорректный JSON');
        }
      } catch (error: unknown) {
        const retryable = error instanceof TimeoutError || error instanceof NetworkError;
        if (retryable && attempt < 2) {
          await this.sleeper.sleep(RETRY_DELAYS[attempt] ?? 500);
          continue;
        }
        throw error;
      }
    }

    throw new Error('Недостижимое состояние retry Aviasales');
  }
}

export class AviasalesHotTicketsProvider implements HotTicketsProvider {
  public constructor(
    private readonly client: AviasalesClient,
    private readonly logger: Logger
  ) {}

  public async getHotTickets(input: HotOffersInput): Promise<Ticket[]> {
    return mapHotOffersResponse(await this.client.getHotOffers(input), this.logger);
  }
}
