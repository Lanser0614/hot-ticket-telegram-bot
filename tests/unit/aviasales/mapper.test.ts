import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { Logger } from '../../../src/application/ports.js';
import { AviasalesResponseError, mapHotOffersResponse } from '../../../src/infrastructure/aviasales/mapper.js';

class RecordingLogger implements Logger {
  public readonly warnings: Array<{ event: string; context?: Readonly<Record<string, unknown>> }> = [];

  public info(): void {}

  public warn(event: string, context?: Readonly<Record<string, unknown>>): void {
    this.warnings.push(context === undefined ? { event } : { event, context });
  }

  public error(): void {}
}

async function readFixture(): Promise<unknown> {
  const content = await readFile(new URL('../../fixtures/aviasales-hot-offers.json', import.meta.url), 'utf8');
  return JSON.parse(content) as unknown;
}

describe('mapHotOffersResponse', () => {
  it('преобразует реальный Explore API fixture', async () => {
    const logger = new RecordingLogger();
    const tickets = mapHotOffersResponse(await readFixture(), logger);

    expect(tickets).not.toHaveLength(0);
    expect(tickets[0]).toMatchObject({
      originCode: 'TAS',
      destinationCode: 'IST',
      departureDate: '2026-08-09',
      departureAt: '2026-08-09T07:40:00',
      price: 2_401_660,
      currencyCode: 'UZS',
      airlineCode: 'HY',
      airlineName: null,
      isDirect: true,
      hasBaggage: false,
      ticketLink: 'https://www.aviasales.uz/search/TAS0908IST1'
    });
    expect(logger.warnings.length).toBeLessThanOrEqual(67);
  });

  it('пропускает отдельный некорректный offer и логирует его', () => {
    const logger = new RecordingLogger();
    const response: unknown = {
      directions: [
        {
          destination_iata: 'IST',
          ticket: {
            price: {
              value: 1_850_000,
              origin: 'TAS',
              currency: 'uzs',
              depart_date: '2026-09-15',
              depart_date_time: '2026-09-15 16:50',
              with_baggage: false,
              number_of_changes: 1,
              airline: 'HY',
              ticket_link: '/TAS1509IST1?t=token'
            }
          }
        },
        { destination_iata: 'DXB', ticket: null }
      ]
    };

    expect(mapHotOffersResponse(response, logger)).toHaveLength(1);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.event).toBe('aviasales_offer_mapping_failed');
  });

  it.each([null, {}, { directions: null }])('отклоняет неверную структуру %j', (value) => {
    expect(() => mapHotOffersResponse(value, new RecordingLogger())).toThrow(AviasalesResponseError);
  });
});

