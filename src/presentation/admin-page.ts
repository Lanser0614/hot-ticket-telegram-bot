import type {
  AdminDashboard,
  AdminScope,
  AdminSort,
  AdminTicketView,
  AdminTripFilter
} from '../application/admin-service.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatDateTime(value: Date | null): string {
  if (value === null) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tashkent'
  }).format(value);
}

function queryString(params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) search.set(key, String(value));
  return `?${search.toString()}`;
}

function baseParams(dashboard: AdminDashboard): Record<string, string | number> {
  const { query } = dashboard;
  return {
    scope: query.scope,
    trip: query.trip,
    date: query.date,
    rdate: query.returnDate,
    sort: query.sort,
    dir: query.direction,
    q: query.search,
    page: 1
  };
}

function sortLink(dashboard: AdminDashboard, sort: AdminSort, label: string): string {
  const { query } = dashboard;
  const active = query.sort === sort;
  const direction = active && query.direction === 'asc' ? 'desc' : 'asc';
  const arrow = active ? (query.direction === 'asc' ? ' ▲' : ' ▼') : '';
  const href = queryString({ ...baseParams(dashboard), sort, dir: direction });
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}${arrow}</a>`;
}

function scopeTab(dashboard: AdminDashboard, scope: AdminScope, label: string, count: number): string {
  const href = queryString({ ...baseParams(dashboard), scope });
  const cls = dashboard.query.scope === scope ? 'tab active' : 'tab';
  return `<a class="${cls}" href="${escapeHtml(href)}">${escapeHtml(label)} (${formatNumber(count)})</a>`;
}

function tripTab(dashboard: AdminDashboard, trip: AdminTripFilter, label: string, count: number): string {
  const href = queryString({ ...baseParams(dashboard), trip });
  const cls = dashboard.query.trip === trip ? 'tab active' : 'tab';
  return `<a class="${cls}" href="${escapeHtml(href)}">${escapeHtml(label)} (${formatNumber(count)})</a>`;
}

function dateSelect(
  name: string,
  placeholder: string,
  dates: readonly string[],
  selected: string
): string {
  const options = [`<option value="">${escapeHtml(placeholder)}</option>`];
  for (const date of dates) {
    const isSelected = date === selected ? ' selected' : '';
    options.push(`<option value="${escapeHtml(date)}"${isSelected}>${escapeHtml(date)}</option>`);
  }
  return `<select name="${escapeHtml(name)}">${options.join('')}</select>`;
}

function row(view: AdminTicketView): string {
  const cells = [
    `${escapeHtml(view.destinationName)} <span class="muted">${escapeHtml(view.destinationCode)}</span>`,
    view.scope === 'domestic' ? '🇺🇿 локальный' : '🌍 международный',
    `${formatNumber(view.price)} ${escapeHtml(view.currencyCode)}`,
    escapeHtml(view.departureDate),
    view.roundTrip ? escapeHtml(view.returnDate ?? '') : '<span class="muted">в одну сторону</span>',
    view.tripClass === 'business' ? 'Бизнес' : 'Эконом',
    view.isDirect ? 'прямой' : 'с пересадкой',
    view.hasBaggage ? 'да' : 'нет',
    `<a href="${escapeHtml(view.ticketLink)}" target="_blank" rel="noopener noreferrer">открыть</a>`
  ];
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
}

function pagination(dashboard: AdminDashboard): string {
  if (dashboard.pageCount <= 1) return '';
  const link = (page: number, label: string): string => {
    const href = queryString({ ...baseParams(dashboard), page });
    return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  };
  const parts: string[] = [];
  if (dashboard.page > 1) parts.push(link(dashboard.page - 1, '← Назад'));
  parts.push(`<span class="muted">Стр. ${dashboard.page} из ${dashboard.pageCount}</span>`);
  if (dashboard.page < dashboard.pageCount) parts.push(link(dashboard.page + 1, 'Вперёд →'));
  return `<div class="pagination">${parts.join(' ')}</div>`;
}

function statsCards(dashboard: AdminDashboard): string {
  const { stats, counts } = dashboard;
  const sync = stats.lastSync;
  const syncText = sync === null
    ? 'ещё не было'
    : `${escapeHtml(sync.status)} · ${formatDateTime(sync.finishedAt)}`;
  const cards: Array<[string, string]> = [
    ['Активных билетов', formatNumber(counts.active)],
    ['Локальные / межд.', `${formatNumber(counts.domestic)} / ${formatNumber(counts.international)}`],
    ['Всего билетов в базе', formatNumber(stats.totalTickets)],
    ['Пользователей', formatNumber(stats.users)],
    ['Активных подписок', formatNumber(stats.activeSubscriptions)],
    ['Последняя синхронизация', syncText]
  ];
  return `<div class="cards">${cards
    .map(([label, value]) => `<div class="card"><div class="card-label">${escapeHtml(label)}</div><div class="card-value">${value}</div></div>`)
    .join('')}</div>`;
}

const STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 24px; background: #f5f6f8; color: #1a1a1a; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .card { background: #fff; border: 1px solid #e3e5e8; border-radius: 10px; padding: 12px 14px; }
  .card-label { font-size: 12px; color: #6b7280; }
  .card-value { font-size: 18px; font-weight: 600; margin-top: 4px; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 16px; }
  .tabs { display: flex; gap: 6px; }
  .tab { padding: 6px 12px; border-radius: 8px; background: #fff; border: 1px solid #e3e5e8; text-decoration: none; color: #1a1a1a; font-size: 14px; }
  .tab.active { background: #2563eb; color: #fff; border-color: #2563eb; }
  form.search { margin-left: auto; display: flex; gap: 6px; }
  input[type=search], input[type=date], select { padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; background: #fff; }
  button { padding: 6px 14px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; font-size: 14px; cursor: pointer; }
  button.secondary { background: #10b981; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; border: 1px solid #e3e5e8; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #eef0f2; font-size: 14px; }
  th { background: #fafbfc; font-weight: 600; }
  th a { color: #1a1a1a; text-decoration: none; }
  .muted { color: #9ca3af; font-size: 12px; }
  .pagination { display: flex; gap: 12px; align-items: center; margin-top: 16px; }
  .flash { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; }
  .empty { padding: 24px; text-align: center; color: #6b7280; }
`;

export function renderAdminPage(dashboard: AdminDashboard, flash?: string): string {
  const { query } = dashboard;
  const headers = [
    `<th>${sortLink(dashboard, 'city', 'Город')}</th>`,
    '<th>Тип</th>',
    `<th>${sortLink(dashboard, 'price', 'Цена')}</th>`,
    `<th>${sortLink(dashboard, 'date', 'Вылет')}</th>`,
    '<th>Обратно</th>',
    '<th>Класс</th>',
    '<th>Рейс</th>',
    '<th>Багаж</th>',
    '<th>Ссылка</th>'
  ].join('');
  const body = dashboard.rows.length === 0
    ? `<tr><td colspan="9"><div class="empty">Билеты не найдены</div></td></tr>`
    : dashboard.rows.map(row).join('');
  const flashHtml = flash === undefined ? '' : `<div class="flash">${escapeHtml(flash)}</div>`;

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HotTicket — админ-панель</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>✈️ HotTicket — админ-панель</h1>
  ${flashHtml}
  ${statsCards(dashboard)}
  <div class="toolbar">
    <div class="tabs">
      ${scopeTab(dashboard, 'all', 'Все', dashboard.counts.active)}
      ${scopeTab(dashboard, 'domestic', 'Локальные', dashboard.counts.domestic)}
      ${scopeTab(dashboard, 'international', 'Международные', dashboard.counts.international)}
    </div>
    <div class="tabs">
      ${tripTab(dashboard, 'all', 'Любой', dashboard.counts.active)}
      ${tripTab(dashboard, 'round', '🔁 Туда-обратно', dashboard.counts.roundTrip)}
      ${tripTab(dashboard, 'oneway', '➡️ В одну сторону', dashboard.counts.oneWay)}
    </div>
    <form method="post" action="/sync">
      <button class="secondary" type="submit">↻ Синхронизировать сейчас</button>
    </form>
    <form class="search" method="get" action="/">
      <input type="hidden" name="scope" value="${escapeHtml(query.scope)}">
      <input type="hidden" name="trip" value="${escapeHtml(query.trip)}">
      <input type="hidden" name="sort" value="${escapeHtml(query.sort)}">
      <input type="hidden" name="dir" value="${escapeHtml(query.direction)}">
      ${dateSelect('date', 'Дата вылета: все', dashboard.departureDates, query.date)}
      ${dateSelect('rdate', 'Дата возврата: все', dashboard.returnDates, query.returnDate)}
      <input type="search" name="q" placeholder="Поиск по городу или IATA" value="${escapeHtml(query.search)}">
      <button type="submit">Найти</button>
    </form>
  </div>
  <table>
    <thead><tr>${headers}</tr></thead>
    <tbody>${body}</tbody>
  </table>
  ${pagination(dashboard)}
</body>
</html>`;
}
