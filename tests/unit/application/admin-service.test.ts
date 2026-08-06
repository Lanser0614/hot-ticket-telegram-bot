import { describe, expect, it } from 'vitest';

import {
  AdminService,
  type AdminQuery,
  type AdminRepository,
  type AdminStatsRecord,
  type AdminTicketRecord
} from '../../../src/application/admin-service.js';

function record(overrides: Partial<AdminTicketRecord>): AdminTicketRecord {
  return {
    id: 1,
    destinationCode: 'IST',
    price: 2_000_000,
    currencyCode: 'UZS',
    departureDate: '2026-09-15',
    returnDate: null,
    isDirect: true,
    tripClass: 'economy',
    hasBaggage: false,
    ticketLink: 'https://www.aviasales.uz/search/TAS1509IST1',
    ...overrides
  };
}

const stats: AdminStatsRecord = {
  totalTickets: 42,
  users: 7,
  activeSubscriptions: 3,
  lastSync: null
};

function fakeRepository(records: readonly AdminTicketRecord[]): AdminRepository {
  return {
    listActiveTickets: () => Promise.resolve(records),
    getStats: () => Promise.resolve(stats)
  };
}

function query(overrides: Partial<AdminQuery>): AdminQuery {
  return { scope: 'all', sort: 'city', direction: 'asc', search: '', page: 1, ...overrides };
}

const sample: readonly AdminTicketRecord[] = [
  record({ id: 1, destinationCode: 'IST', price: 2_000_000, departureDate: '2026-09-15' }),
  record({ id: 2, destinationCode: 'DXB', price: 3_300_103, departureDate: '2026-08-09', returnDate: '2026-08-13' }),
  record({ id: 3, destinationCode: 'SKD', price: 500_000, departureDate: '2026-10-01' })
];

describe('AdminService.getDashboard', () => {
  it('считает статистику и локальные/международные', async () => {
    const service = new AdminService(fakeRepository(sample));
    const dashboard = await service.getDashboard(query({}));

    expect(dashboard.counts).toEqual({ active: 3, domestic: 1, international: 2 });
    expect(dashboard.stats.totalTickets).toBe(42);
  });

  it('фильтрует по локальным рейсам', async () => {
    const service = new AdminService(fakeRepository(sample));
    const dashboard = await service.getDashboard(query({ scope: 'domestic' }));

    expect(dashboard.rows.map((row) => row.destinationCode)).toEqual(['SKD']);
    expect(dashboard.rows[0]?.scope).toBe('domestic');
  });

  it('сортирует по цене по возрастанию и убыванию', async () => {
    const service = new AdminService(fakeRepository(sample));
    const asc = await service.getDashboard(query({ sort: 'price', direction: 'asc' }));
    const desc = await service.getDashboard(query({ sort: 'price', direction: 'desc' }));

    expect(asc.rows.map((row) => row.price)).toEqual([500_000, 2_000_000, 3_300_103]);
    expect(desc.rows.map((row) => row.price)).toEqual([3_300_103, 2_000_000, 500_000]);
  });

  it('сортирует по дате вылета', async () => {
    const service = new AdminService(fakeRepository(sample));
    const dashboard = await service.getDashboard(query({ sort: 'date', direction: 'asc' }));

    expect(dashboard.rows.map((row) => row.departureDate))
      .toEqual(['2026-08-09', '2026-09-15', '2026-10-01']);
  });

  it('сортирует по названию города', async () => {
    const service = new AdminService(fakeRepository(sample));
    const dashboard = await service.getDashboard(query({ sort: 'city', direction: 'asc' }));

    // Бухара? нет — Дубай, Самарканд, Стамбул по алфавиту
    expect(dashboard.rows.map((row) => row.destinationName)).toEqual(['Дубай', 'Самарканд', 'Стамбул']);
  });

  it('ищет по коду и названию', async () => {
    const service = new AdminService(fakeRepository(sample));
    const byCode = await service.getDashboard(query({ search: 'dxb' }));
    const byName = await service.getDashboard(query({ search: 'самар' }));

    expect(byCode.rows.map((row) => row.destinationCode)).toEqual(['DXB']);
    expect(byName.rows.map((row) => row.destinationCode)).toEqual(['SKD']);
  });

  it('пагинирует и зажимает номер страницы', async () => {
    const many = Array.from({ length: 5 }, (_, index) => record({
      id: index + 1,
      destinationCode: 'IST',
      price: 1_000_000 + index
    }));
    const service = new AdminService(fakeRepository(many), 2);
    const dashboard = await service.getDashboard(query({ page: 99 }));

    expect(dashboard.pageCount).toBe(3);
    expect(dashboard.page).toBe(3);
    expect(dashboard.rows).toHaveLength(1);
  });

  it('помечает round-trip билеты', async () => {
    const service = new AdminService(fakeRepository(sample));
    const dashboard = await service.getDashboard(query({ search: 'dxb' }));

    expect(dashboard.rows[0]?.roundTrip).toBe(true);
    expect(dashboard.rows[0]?.returnDate).toBe('2026-08-13');
  });
});
