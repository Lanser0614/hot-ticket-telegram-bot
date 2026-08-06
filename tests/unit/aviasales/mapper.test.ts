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
      tripClass: 'economy',
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
              trip_class: 1,
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

  it('сохраняет business class и багаж', () => {
    const logger = new RecordingLogger();
    const response: unknown = {
      directions: [{
        destination_iata: 'DXB',
        ticket: { price: {
          value: 4_000_000,
          origin: 'TAS',
          currency: 'uzs',
          depart_date: '2026-09-16',
          depart_date_time: '2026-09-16 10:20',
          trip_class: 2,
          with_baggage: true,
          number_of_changes: 0,
          airline: 'HY',
          ticket_link: '/TAS1609DXB1?t=token'
        } }
      }]
    };

    expect(mapHotOffersResponse(response, logger)[0]).toMatchObject({
      tripClass: 'business',
      hasBaggage: true,
      returnDate: null
    });
    expect(logger.warnings).toHaveLength(0);
  });

  it('парсит дату возврата для round-trip offer', () => {
    const logger = new RecordingLogger();
    const response: unknown = {
      directions: [{
        destination_iata: 'DXB',
        ticket: { price: {
          value: 3_300_103,
          origin: 'TAS',
          currency: 'uzs',
          depart_date: '2026-08-09',
          return_date: '2026-08-13',
          depart_date_time: '2026-08-09 07:50',
          trip_class: 1,
          with_baggage: false,
          number_of_changes: 0,
          airline: 'C6',
          ticket_link: '/TAS0908DXB13081?t=token'
        } }
      }]
    };

    expect(mapHotOffersResponse(response, logger)[0]).toMatchObject({
      destinationCode: 'DXB',
      departureDate: '2026-08-09',
      returnDate: '2026-08-13'
    });
    expect(logger.warnings).toHaveLength(0);
  });

  it('пропускает неизвестный trip_class без raw payload в логе', () => {
    const logger = new RecordingLogger();
    const response: unknown = {
      directions: [{
        destination_iata: 'DXB',
        secret: 'raw-payload',
        ticket: { price: {
          value: 4_000_000,
          origin: 'TAS',
          currency: 'uzs',
          depart_date: '2026-09-16',
          trip_class: 3,
          with_baggage: true,
          number_of_changes: 0,
          ticket_link: '/TAS1609DXB1'
        } }
      }]
    };

    expect(mapHotOffersResponse(response, logger)).toEqual([]);
    expect(JSON.stringify(logger.warnings)).not.toContain('raw-payload');
    expect(logger.warnings[0]?.event).toBe('aviasales_offer_mapping_failed');
  });

  it.each([null, {}, { directions: null }])('отклоняет неверную структуру %j', (value) => {
    expect(() => mapHotOffersResponse(value, new RecordingLogger())).toThrow(AviasalesResponseError);
  });
});
