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
    destinations: [{ code: 'IST', name: 'Стамбул' }],
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
    expect(html).toContain('type="date" name="date" value="2026-09-15"');
    expect(html).toContain('type="date" name="rdate" value="2026-09-20"');
  });

  it('рендерит поля дат вылета и возврата с подписями', () => {
    const html = renderAdminPage(dashboard());

    expect(html).toContain('type="date" name="date"');
    expect(html).toContain('type="date" name="rdate"');
    expect(html).toContain('Дата вылета');
    expect(html).toContain('Дата возврата');
    expect(html).toContain('onchange="this.form.requestSubmit()"');
    expect(html).toContain('<label for="filter-date">');
    expect(html).toContain('<label for="filter-rdate">');
    expect(html).toContain('id="filter-date"');
    expect(html).toContain('id="filter-rdate"');
  });

  it('не дублирует нативный date picker собственной кнопкой календаря', () => {
    const html = renderAdminPage(dashboard());

    expect(html).not.toContain('data-date-target');
    expect(html).not.toContain('calendar-button');
    expect(html).not.toContain('input.showPicker()');
  });

  it('показывает сброс фильтров только когда фильтр активен', () => {
    const withoutFilters = renderAdminPage(dashboard());
    expect(withoutFilters).not.toContain('class="reset"');

    const withSearch = renderAdminPage(dashboard({
      query: {
        scope: 'all', trip: 'all', date: '', returnDate: '', sort: 'city',
        direction: 'asc', search: 'IST', page: 1
      }
    }));
    expect(withSearch).toContain('<a class="reset" href="/">Сбросить</a>');

    const withScope = renderAdminPage(dashboard({
      query: {
        scope: 'domestic', trip: 'all', date: '', returnDate: '', sort: 'city',
        direction: 'asc', search: '', page: 1
      }
    }));
    expect(withScope).toContain('class="reset"');
  });

  it('рендерит searchable список городов из кэша и сохраняет выбранный город', () => {
    const html = renderAdminPage(dashboard({
      query: {
        scope: 'all', trip: 'all', date: '', returnDate: '', sort: 'city',
        direction: 'asc', search: 'IST', page: 1
      }
    }));

    expect(html).toContain('data-city-combobox');
    expect(html).toContain('type="search" name="q" role="combobox"');
    expect(html).toContain('value="IST"');
    expect(html).toContain('class="city-options" role="listbox"');
    expect(html).toContain('data-city-code="IST"');
    expect(html).toContain('Стамбул <span>IST</span>');
    expect(html).toContain("input.value = option.dataset.cityCode ?? ''");
    expect(html).toContain('input.form?.requestSubmit()');
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

    expect(html).not.toContain('value="<script>"');
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
