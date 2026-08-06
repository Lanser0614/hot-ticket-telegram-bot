import { describe, expect, it } from 'vitest';

import type { AdminDashboard } from '../../../src/application/admin-service.js';
import { renderAdminPage } from '../../../src/presentation/admin-page.js';

const NBSP = String.fromCharCode(160);

function normalizeSpaces(value: string): string {
  return value.split(NBSP).join(' ');
}

function dashboard(overrides: Partial<AdminDashboard> = {}): AdminDashboard {
  return {
    query: { scope: 'all', trip: 'all', date: '', returnDate: '', sort: 'city', direction: 'asc', search: '', page: 1 },
    rows: [{
      id: 1,
      destinationCode: 'IST',
      destinationName: 'Стамбул',
      scope: 'international',
      price: 2_000_000,
      currencyCode: 'UZS',
      departureDate: '2026-09-15',
      returnDate: '2026-09-20',
      roundTrip: true,
      isDirect: true,
      tripClass: 'economy',
      hasBaggage: false,
      ticketLink: 'https://www.aviasales.uz/search/TAS1509IST1'
    }],
    total: 1,
    page: 1,
    pageCount: 1,
    pageSize: 50,
    counts: { active: 1, domestic: 0, international: 1, roundTrip: 1, oneWay: 0 },
    departureDates: ['2026-09-15'],
    returnDates: ['2026-09-20'],
    stats: { totalTickets: 10, users: 4, activeSubscriptions: 2, lastSync: null },
    ...overrides
  };
}

describe('renderAdminPage', () => {
  it('рендерит таблицу, статистику и вкладки', () => {
    const html = renderAdminPage(dashboard());

    expect(html).toContain('Стамбул');
    expect(normalizeSpaces(html)).toContain('2 000 000 UZS');
    expect(html).toContain('Локальные (0)');
    expect(html).toContain('Международные (1)');
    expect(html).toContain('🔁 Туда-обратно (1)');
    expect(html).toContain('➡️ В одну сторону (0)');
    expect(html).toContain('name="date"');
    expect(html).toContain('Активных билетов');
    expect(html).toContain('action="/sync"');
  });

  it('переносит фильтры даты и типа в ссылки сортировки и вкладок', () => {
    const html = renderAdminPage(dashboard({
      query: {
        scope: 'all', trip: 'round', date: '2026-09-15', returnDate: '2026-09-20',
        sort: 'city', direction: 'asc', search: '', page: 1
      }
    }));

    expect(html).toContain('date=2026-09-15');
    expect(html).toContain('rdate=2026-09-20');
    expect(html).toContain('trip=round');
    expect(html).toContain('<option value="2026-09-15" selected>');
    expect(html).toContain('<option value="2026-09-20" selected>');
  });

  it('рендерит выпадающие списки дат вылета и возврата', () => {
    const html = renderAdminPage(dashboard());

    expect(html).toContain('name="date"');
    expect(html).toContain('name="rdate"');
    expect(html).toContain('Дата вылета: все');
    expect(html).toContain('Дата возврата: все');
  });

  it('строит ссылки сортировки с переключением направления', () => {
    const html = renderAdminPage(dashboard());

    expect(html).toContain('sort=city&amp;dir=desc');
    expect(html).toContain('sort=price&amp;dir=asc');
  });

  it('экранирует поисковый ввод', () => {
    const html = renderAdminPage(dashboard({
      query: { scope: 'all', trip: 'all', date: '', returnDate: '', sort: 'city', direction: 'asc', search: '<script>', page: 1 }
    }));

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('показывает flash-сообщение', () => {
    const html = renderAdminPage(dashboard(), 'Синхронизация запущена.');
    expect(html).toContain('Синхронизация запущена.');
  });

  it('показывает пустое состояние', () => {
    const html = renderAdminPage(dashboard({ rows: [], total: 0 }));
    expect(html).toContain('Билеты не найдены');
  });
});
