import { describe, expect, it } from 'vitest';

import type { AdminDashboard } from '../../../src/application/admin-service.js';
import { renderAdminPage } from '../../../src/presentation/admin-page.js';

const NBSP = String.fromCharCode(160);

function normalizeSpaces(value: string): string {
  return value.split(NBSP).join(' ');
}

function dashboard(overrides: Partial<AdminDashboard> = {}): AdminDashboard {
  return {
    query: { scope: 'all', sort: 'city', direction: 'asc', search: '', page: 1 },
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
    counts: { active: 1, domestic: 0, international: 1 },
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
    expect(html).toContain('Активных билетов');
    expect(html).toContain('action="/sync"');
  });

  it('строит ссылки сортировки с переключением направления', () => {
    const html = renderAdminPage(dashboard());

    expect(html).toContain('sort=city&amp;dir=desc');
    expect(html).toContain('sort=price&amp;dir=asc');
  });

  it('экранирует поисковый ввод', () => {
    const html = renderAdminPage(dashboard({
      query: { scope: 'all', sort: 'city', direction: 'asc', search: '<script>', page: 1 }
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
