import type {
  AdminClickPoint,
  AdminDashboard,
  AdminDestinationOption,
  AdminPricePoint,
  AdminQuery,
  AdminScope,
  AdminSort,
  AdminTicketView,
  AdminTripFilter
} from '../application/admin-service.js';
import { getLocationName } from '../domain/locations.js';

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatPrice(value: number | null): string {
  return value === null ? '—' : `${formatNumber(value)} UZS`;
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value / 1_000_000)} млн`;
  if (value >= 1_000) return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value / 1_000)} тыс.`;
  return formatNumber(value);
}

function formatDateTime(value: Date | null): string {
  if (value === null) return 'Нет данных';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Tashkent'
  }).format(value);
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Tashkent'
  }).format(value);
}

function shortDay(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' })
    .format(new Date(`${value}T00:00:00Z`));
}

function queryString(basePath: string, params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) search.set(key, String(value));
  return `${basePath}/?${search.toString()}`;
}

function baseParams(dashboard: AdminDashboard): Record<string, string | number> {
  const { query } = dashboard;
  return { scope: query.scope, trip: query.trip, date: query.date, rdate: query.returnDate,
    sort: query.sort, dir: query.direction, q: query.search, page: 1 };
}

function sortLink(dashboard: AdminDashboard, sort: AdminSort, label: string, basePath: string): string {
  const { query } = dashboard;
  const active = query.sort === sort;
  const direction = active && query.direction === 'asc' ? 'desc' : 'asc';
  const arrow = active ? (query.direction === 'asc' ? ' ↑' : ' ↓') : '';
  const href = queryString(basePath, { ...baseParams(dashboard), sort, dir: direction });
  return `<a href="${escapeHtml(href)}#tickets">${escapeHtml(label)}${arrow}</a>`;
}

function scopeTab(dashboard: AdminDashboard, scope: AdminScope, label: string, count: number, basePath: string): string {
  const href = `${queryString(basePath, { ...baseParams(dashboard), scope })}#tickets`;
  const cls = dashboard.query.scope === scope ? 'filter-pill active' : 'filter-pill';
  return `<a class="${cls}" href="${escapeHtml(href)}">${escapeHtml(label)} <span>${formatNumber(count)}</span></a>`;
}

function tripTab(dashboard: AdminDashboard, trip: AdminTripFilter, label: string, count: number, basePath: string): string {
  const href = `${queryString(basePath, { ...baseParams(dashboard), trip })}#tickets`;
  const cls = dashboard.query.trip === trip ? 'filter-pill active' : 'filter-pill';
  return `<a class="${cls}" href="${escapeHtml(href)}">${escapeHtml(label)} <span>${formatNumber(count)}</span></a>`;
}

function dateInput(name: string, label: string, selected: string): string {
  const id = `filter-${name}`;
  return `<div class="filter-field"><label for="${id}">${escapeHtml(label)}</label><input id="${id}" type="date" name="${escapeHtml(name)}" value="${escapeHtml(selected)}" onchange="this.form.requestSubmit()"></div>`;
}

function cityCombobox(destinations: readonly AdminDestinationOption[], selected: string): string {
  const options = destinations.map((destination, index) =>
    `<button id="city-option-${index}" class="city-option" type="button" role="option" aria-selected="false" data-city-code="${escapeHtml(destination.code)}" data-city-search="${escapeHtml(`${destination.name} ${destination.code}`.toLocaleLowerCase('ru'))}">${escapeHtml(destination.name)} <span>${escapeHtml(destination.code)}</span></button>`);
  return `<div class="filter-field city-field"><label for="filter-city">Город</label><div class="city-combobox" data-city-combobox><input id="filter-city" type="search" name="q" role="combobox" aria-autocomplete="list" aria-controls="city-options" aria-expanded="false" placeholder="Город или IATA" autocomplete="off" value="${escapeHtml(selected)}"><div id="city-options" class="city-options" role="listbox" hidden>${options.join('')}</div></div></div>`;
}

function hasActiveFilters(query: AdminQuery): boolean {
  return query.scope !== 'all' || query.trip !== 'all' || query.date.length > 0
    || query.returnDate.length > 0 || query.search.length > 0;
}

function ticketRow(view: AdminTicketView): string {
  const routeType = view.scope === 'domestic' ? 'Локальный' : 'Международный';
  return `<tr>
    <td><div class="primary-cell">${escapeHtml(view.destinationName)}</div><div class="secondary-cell">${escapeHtml(view.originCode)} → ${escapeHtml(view.destinationCode)}</div></td>
    <td><span class="status-badge neutral">${routeType}</span></td>
    <td class="numeric strong">${formatNumber(view.price)} <span class="currency">${escapeHtml(view.currencyCode)}</span></td>
    <td>${escapeHtml(view.departureDate)}</td>
    <td>${view.roundTrip ? escapeHtml(view.returnDate ?? '') : '<span class="secondary-cell">В одну сторону</span>'}</td>
    <td>${view.tripClass === 'business' ? 'Бизнес' : 'Эконом'}</td>
    <td>${view.isDirect ? '<span class="status-badge success">Прямой</span>' : 'С пересадкой'}</td>
    <td>${view.hasBaggage ? 'Есть' : '<span class="secondary-cell">Нет</span>'}</td>
    <td><a class="table-link" href="${escapeHtml(view.ticketLink)}" target="_blank" rel="noopener noreferrer">Открыть</a></td>
  </tr>`;
}

function pagination(dashboard: AdminDashboard, basePath: string): string {
  if (dashboard.pageCount <= 1) return '';
  const link = (page: number, label: string): string => {
    const href = `${queryString(basePath, { ...baseParams(dashboard), page })}#tickets`;
    return `<a class="page-link" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  };
  const parts: string[] = [];
  if (dashboard.page > 1) parts.push(link(dashboard.page - 1, 'Назад'));
  parts.push(`<span>Страница ${dashboard.page} из ${dashboard.pageCount}</span>`);
  if (dashboard.page < dashboard.pageCount) parts.push(link(dashboard.page + 1, 'Вперёд'));
  return `<div class="pagination">${parts.join('')}</div>`;
}

function pointsPath(values: readonly number[], width: number, height: number, min: number, max: number): string {
  const range = Math.max(1, max - min);
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function chartGrid(min: number, max: number, width: number, height: number): string {
  return Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const y = height - ratio * height;
    const value = Math.round(min + ratio * (max - min));
    return `<g><line x1="0" y1="${y.toFixed(2)}" x2="${width}" y2="${y.toFixed(2)}" class="grid-line"/><text x="-12" y="${(y + 4).toFixed(2)}" text-anchor="end" class="axis-label">${escapeHtml(formatCompact(value))}</text></g>`;
  }).join('');
}

function priceChart(points: readonly AdminPricePoint[], idPrefix: string): string {
  if (points.length === 0) return '<div class="chart-empty"><strong>История цен ещё собирается</strong><span>График появится после первых дневных агрегатов.</span></div>';
  const width = 760;
  const height = 220;
  const all = points.flatMap((point) => [point.minPrice, point.averageMinPrice]);
  const rawMin = Math.min(...all);
  const rawMax = Math.max(...all);
  const padding = Math.max(1, Math.round((rawMax - rawMin) * 0.08));
  const min = Math.max(0, rawMin - padding);
  const max = rawMax + padding;
  const averagePath = pointsPath(points.map((point) => point.averageMinPrice), width, height, min, max);
  const minPath = pointsPath(points.map((point) => point.minPrice), width, height, min, max);
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const xLabels = labelIndexes.map((index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    return `<text x="${x.toFixed(2)}" y="248" text-anchor="middle" class="axis-label">${escapeHtml(shortDay(points[index]?.day ?? ''))}</text>`;
  }).join('');
  const dots = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y = height - ((point.averageMinPrice - min) / Math.max(1, max - min)) * height;
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3" class="chart-dot"><title>${escapeHtml(point.day)}: средний минимум ${formatPrice(point.averageMinPrice)}, наблюдений ${formatNumber(point.sampleCount)}</title></circle>`;
  }).join('');
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;
  return `<div class="chart-legend"><span><i class="legend-line primary"></i>Средняя минимальная цена</span><span><i class="legend-line comparison"></i>Самая низкая цена</span></div><div class="chart-scroll"><svg class="chart" viewBox="0 0 840 280" role="img" aria-labelledby="${escapeHtml(titleId)} ${escapeHtml(descriptionId)}"><title id="${escapeHtml(titleId)}">Динамика цен за 30 дней</title><desc id="${escapeHtml(descriptionId)}">Сравнение средней минимальной и самой низкой цены среди наблюдаемых маршрутов.</desc><g transform="translate(60 18)">${chartGrid(min, max, width, height)}<path d="${averagePath}" class="chart-line primary"/><path d="${minPath}" class="chart-line comparison"/>${dots}${xLabels}</g></svg></div>`;
}

function routePriceChart(series: NonNullable<AdminDashboard['priceAnalytics']>['series'], periodDays: number): string {
  if (series.length === 0) return '<div class="chart-empty"><strong>Недостаточно истории для выбранных маршрутов</strong><span>Выберите другой город, origin или более длинный период.</span></div>';
  const width = 760;
  const height = 220;
  const values = series.flatMap((route) => route.points.map((point) => point.price));
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max(1, Math.round((rawMax - rawMin) * 0.08));
  const min = Math.max(0, rawMin - padding);
  const max = rawMax + padding;
  const days = [...new Set(series.flatMap((route) => route.points.map((point) => point.day)))].sort();
  const routePath = (points: readonly { day: string; price: number }[]): string => points.map((point, index) => {
    const dayIndex = days.indexOf(point.day);
    const x = days.length === 1 ? width / 2 : dayIndex / (days.length - 1) * width;
    const y = height - (point.price - min) / Math.max(1, max - min) * height;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
  const colors = ['#2f80ed','#ef8d42','#1f9d70','#8e5ad8','#d65a7a','#1598a6','#a77b16','#e05d2f','#5575cc','#4b936e','#a65bca','#9e6b45'];
  const lines = series.map((route, index) => `<path d="${routePath(route.points)}" fill="none" stroke="${colors[index] ?? '#2f80ed'}" stroke-width="3" stroke-linecap="round"><title>${escapeHtml(`${route.originCode} → ${route.destinationCode}: ${formatNumber(route.observationDays)} дней наблюдений`)}</title></path>`).join('');
  const labelIndexes = [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])];
  const xLabels = labelIndexes.map((index) => { const x = days.length === 1 ? width / 2 : index / (days.length - 1) * width; return `<text x="${x.toFixed(2)}" y="248" text-anchor="middle" class="axis-label">${escapeHtml(shortDay(days[index] ?? ''))}</text>`; }).join('');
  const legend = series.map((route, index) => `<span><i class="legend-line" style="background:${colors[index] ?? '#2f80ed'}"></i>${escapeHtml(`${route.originCode} → ${route.destinationCode}${route.tripClass === 'business' ? ' · бизнес' : ''}`)}</span>`).join('');
  return `<div class="chart-legend">${legend}</div><div class="chart-scroll"><svg class="chart" viewBox="0 0 840 280" role="img"><title>Минимальные цены по маршрутам за ${periodDays} дней</title><g transform="translate(60 18)">${chartGrid(min, max, width, height)}${lines}${xLabels}</g></svg></div>`;
}

function clickChart(points: readonly AdminClickPoint[], idPrefix: string): string {
  const total = points.reduce((sum, point) => sum + point.clicks, 0);
  if (total === 0) return '<div class="chart-empty"><strong>Переходов пока нет</strong><span>Данные появятся после первых кликов по билетам.</span></div>';
  const width = 760;
  const height = 220;
  const max = Math.max(1, ...points.map((point) => point.clicks));
  const slot = width / points.length;
  const barWidth = Math.max(4, slot * 0.62);
  const bars = points.map((point, index) => {
    const barHeight = (point.clicks / max) * height;
    const x = index * slot + (slot - barWidth) / 2;
    const y = height - barHeight;
    return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="3" class="chart-bar"><title>${escapeHtml(point.day)}: ${formatNumber(point.clicks)} переходов, ${formatNumber(point.uniqueUsers)} пользователей</title></rect>`;
  }).join('');
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const labels = labelIndexes.map((index) => {
    const x = index * slot + slot / 2;
    return `<text x="${x.toFixed(2)}" y="248" text-anchor="middle" class="axis-label">${escapeHtml(shortDay(points[index]?.day ?? ''))}</text>`;
  }).join('');
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;
  return `<div class="chart-legend"><span><i class="legend-square"></i>Переходы по дням</span><span class="chart-total">Всего: ${formatNumber(total)}</span></div><div class="chart-scroll"><svg class="chart" viewBox="0 0 840 280" role="img" aria-labelledby="${escapeHtml(titleId)} ${escapeHtml(descriptionId)}"><title id="${escapeHtml(titleId)}">Переходы за 30 дней</title><desc id="${escapeHtml(descriptionId)}">Количество человеческих переходов по ссылкам на билеты за каждый день.</desc><g transform="translate(60 18)">${chartGrid(0, max, width, height)}${bars}${labels}</g></svg></div>`;
}

function kpiCards(dashboard: AdminDashboard): string {
  const { stats, counts } = dashboard;
  const price = stats.priceStats;
  const clicks = stats.clickStats;
  return `<div class="kpi-grid">
    <article class="kpi-card"><div class="kpi-label">Пользователи</div><div class="kpi-value">${formatNumber(stats.users)}</div><div class="kpi-meta"><strong>+${formatNumber(stats.userStats.new7Days)}</strong> за 7 дней · ${formatNumber(stats.userStats.active)} активных</div></article>
    <article class="kpi-card"><div class="kpi-label">Активные билеты</div><div class="kpi-value">${formatNumber(counts.active)}</div><div class="kpi-meta">${formatNumber(stats.totalTickets)} всего в базе</div></article>
    <article class="kpi-card"><div class="kpi-label">Средняя цена</div><div class="kpi-value price">${price.currentAveragePrice === null ? '—' : formatCompact(price.currentAveragePrice)}</div><div class="kpi-meta">от ${formatPrice(price.currentMinPrice)}</div></article>
    <article class="kpi-card"><div class="kpi-label">Переходы за 30 дней</div><div class="kpi-value">${formatNumber(clicks.clicks30Days)}</div><div class="kpi-meta">${formatNumber(clicks.uniqueUsers30Days)} уникальных пользователей</div></article>
  </div>`;
}

function usersSection(dashboard: AdminDashboard): string {
  const userStats = dashboard.stats.userStats;
  const rows = userStats.recent.length === 0 ? '<tr><td colspan="7"><div class="empty-table">Пользователей пока нет</div></td></tr>' : userStats.recent.map((user) => {
    const fullName = [user.firstName, user.lastName].filter((value) => value !== null && value.length > 0).join(' ') || 'Без имени';
    const username = user.username === null ? `ID ${user.telegramUserId}` : `@${user.username}`;
    return `<tr><td><div class="primary-cell">${escapeHtml(fullName)}</div><div class="secondary-cell">${escapeHtml(username)}</div></td><td><span class="status-badge ${user.isActive ? 'success' : 'neutral'}">${user.isActive ? 'Активен' : 'Отключён'}</span></td><td class="numeric">${formatNumber(user.activeSubscriptions)}</td><td class="numeric">${formatNumber(user.referralCount)}</td><td class="numeric">${formatNumber(user.clicks30Days)}</td><td>${formatDate(user.createdAt)}</td><td class="secondary-cell">${formatNumber(user.telegramUserId)}</td></tr>`;
  }).join('');
  return `<section id="users" class="dashboard-section"><div class="section-heading"><div><span class="eyebrow">Аудитория</span><h2>Пользователи</h2><p>Регистрации, активность и связь с подписками.</p></div></div><div class="mini-kpi-grid"><div class="mini-kpi"><span>Новые за 7 дней</span><strong>${formatNumber(userStats.new7Days)}</strong></div><div class="mini-kpi"><span>Новые за 30 дней</span><strong>${formatNumber(userStats.new30Days)}</strong></div><div class="mini-kpi"><span>Рефералы всего</span><strong>${formatNumber(userStats.referralsTotal)}</strong></div><div class="mini-kpi"><span>Рефералы за 30 дней</span><strong>${formatNumber(userStats.referrals30Days)}</strong></div></div><div class="panel table-panel"><div class="panel-heading"><div><h3>Последние пользователи</h3><p>12 последних регистраций</p></div></div><div class="table-wrap"><table><thead><tr><th>Пользователь</th><th>Статус</th><th>Подписки</th><th>Рефералы</th><th>Клики, 30 дн.</th><th>Регистрация</th><th>Telegram ID</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>`;
}

function pricesSection(dashboard: AdminDashboard): string {
  const stats = dashboard.stats.priceStats;
  const analytics = dashboard.priceAnalytics ?? { query: { destinationCode: null, originCode: null, periodDays: 30 as const }, origins: [], series: [], optimalDepartureDates: [] };
  const destinationOptions = dashboard.destinations.map((item) => `<option value="${escapeHtml(item.code)}"${item.code === analytics.query.destinationCode ? ' selected' : ''}>${escapeHtml(item.name)} (${escapeHtml(item.code)})</option>`).join('');
  const originOptions = analytics.origins.map((code) => `<option value="${escapeHtml(code)}"${code === analytics.query.originCode ? ' selected' : ''}>${escapeHtml(code)}</option>`).join('');
  const periods = [[30,'30 дней'],[90,'Квартал'],[180,'6 месяцев'],[365,'Год']] as const;
  const periodOptions = periods.map(([days, label]) => `<option value="${days}"${days === analytics.query.periodDays ? ' selected' : ''}>${label}</option>`).join('');
  const rows = analytics.series.length === 0 ? '<tr><td colspan="4"><div class="empty-table">Статистика маршрутов ещё собирается</div></td></tr>' : analytics.series.map((route) => `<tr><td><div class="primary-cell">${escapeHtml(route.originCode)} → ${escapeHtml(route.destinationCode)}</div></td><td>${route.tripClass === 'business' ? 'Бизнес' : 'Эконом'}</td><td class="numeric">${formatNumber(route.observationDays)}</td><td class="numeric">${formatNumber(route.averagePrice)} UZS</td></tr>`).join('');
  const optimalRows = analytics.optimalDepartureDates.length === 0 ? '<tr><td colspan="5"><div class="empty-table">Недостаточно наблюдений для рекомендаций по датам.</div></td></tr>' : analytics.optimalDepartureDates.map((item) => `<tr><td class="primary-cell">${escapeHtml(item.originCode)} → ${escapeHtml(item.destinationCode)}</td><td>${escapeHtml(item.departureDate)}</td><td class="numeric strong">${formatNumber(item.minPrice)} UZS</td><td>${formatDateTime(item.observedAt)}</td><td><span class="status-badge success">−${formatNumber(item.savingPercent)}% к медиане</span></td></tr>`).join('');
  return `<section id="prices" class="dashboard-section"><div class="section-heading"><div><span class="eyebrow">Маршруты</span><h2>Цены билетов</h2><p>Сравнение минимальных цен по origin → destination. Не более 12 линий.</p></div><div class="metric-range"><span>Текущий диапазон</span><strong>${formatPrice(stats.currentMinPrice)} — ${formatPrice(stats.currentMaxPrice)}</strong></div></div><form class="panel filters-panel price-filter" method="get" action="/admin/#prices"><div class="filter-field city-field"><label for="price-destination">Город назначения</label><select id="price-destination" name="priceDestination"><option value="">Все города</option>${destinationOptions}</select></div><div class="filter-field"><label for="price-origin">Origin</label><select id="price-origin" name="priceOrigin"><option value="">Все origin</option>${originOptions}</select></div><div class="filter-field"><label for="price-period">Период</label><select id="price-period" name="pricePeriod">${periodOptions}</select></div><div class="filter-actions"><button type="submit">Показать</button></div></form><div class="panel chart-panel"><div class="panel-heading"><div><h3>Минимальные цены по маршрутам</h3><p>Каждая линия — отдельный origin → destination.</p></div><span class="period-chip">${analytics.query.periodDays} дней</span></div>${routePriceChart(analytics.series, analytics.query.periodDays)}</div><div class="panel table-panel"><div class="panel-heading"><div><h3>Лучшие даты вылета</h3><p>Минимум за выбранный период и разница с медианой маршрута.</p></div></div><div class="table-wrap"><table><thead><tr><th>Маршрут</th><th>Дата вылета</th><th>Лучшая цена</th><th>Зафиксирована</th><th>Выгода</th></tr></thead><tbody>${optimalRows}</tbody></table></div></div><div class="panel table-panel"><div class="panel-heading"><div><h3>Линии на графике</h3><p>Отобраны по покрытию истории, затем по средней цене.</p></div></div><div class="table-wrap"><table><thead><tr><th>Маршрут</th><th>Класс</th><th>Дней истории</th><th>Средняя минимальная цена</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>`;
}

const SOURCE_LABELS: Readonly<Record<string, string>> = { bot_search: 'Поиск в боте', bot_notification: 'Уведомления бота', bot_share: 'Shared-билет', miniapp_deals: 'Hot Deals', miniapp_card: 'Карточка Mini App', miniapp_watchlist: 'Watchlist' };

function clicksSection(dashboard: AdminDashboard): string {
  const clicks = dashboard.stats.clickStats;
  const maxSource = Math.max(1, ...clicks.bySource30Days.map((item) => item.count));
  const sources = clicks.bySource30Days.length === 0 ? '<div class="chart-empty compact"><strong>Источников пока нет</strong><span>Переходы появятся после первых кликов.</span></div>' : clicks.bySource30Days.map((item) => `<div class="source-row"><div class="source-label"><span>${escapeHtml(SOURCE_LABELS[item.source] ?? item.source)}</span><strong>${formatNumber(item.count)}</strong></div><div class="source-track"><span style="width:${Math.max(3, Math.round(item.count / maxSource * 100))}%"></span></div></div>`).join('');
  const routes = clicks.topRoutes30Days.length === 0 ? '<tr><td colspan="5"><div class="empty-table">Переходов по маршрутам пока нет</div></td></tr>' : clicks.topRoutes30Days.map((route) => `<tr><td><div class="primary-cell">${escapeHtml(getLocationName(route.destinationCode) ?? route.destinationCode)}</div><div class="secondary-cell">${escapeHtml(route.originCode)} → ${escapeHtml(route.destinationCode)}</div></td><td class="numeric strong">${formatNumber(route.clicks)}</td><td class="numeric">${formatNumber(route.uniqueUsers)}</td><td class="numeric">${formatNumber(route.averagePrice)} UZS</td><td><span class="status-badge neutral">${route.clicks === 0 ? '0%' : `${formatNumber(Math.round(route.uniqueUsers / route.clicks * 100))}%`}</span></td></tr>`).join('');
  return `<section id="clicks" class="dashboard-section"><div class="section-heading"><div><span class="eyebrow">Конверсия</span><h2>Переходы по билетам</h2><p>Только реальные пользовательские клики; preview и bot-трафик исключены.</p></div></div><div class="mini-kpi-grid"><div class="mini-kpi"><span>За 24 часа</span><strong>${formatNumber(clicks.clicks24Hours)}</strong></div><div class="mini-kpi"><span>За 7 дней</span><strong>${formatNumber(clicks.clicks7Days)}</strong></div><div class="mini-kpi"><span>За 30 дней</span><strong>${formatNumber(clicks.clicks30Days)}</strong></div><div class="mini-kpi"><span>Уникальные пользователи</span><strong>${formatNumber(clicks.uniqueUsers30Days)}</strong></div></div><div class="two-column"><div class="panel chart-panel"><div class="panel-heading"><div><h3>Динамика переходов</h3><p>Последние 30 календарных дней</p></div></div>${clickChart(clicks.daily30Days, 'clicks-daily-chart')}</div><div class="panel source-panel"><div class="panel-heading"><div><h3>Источники</h3><p>Распределение кликов за 30 дней</p></div></div><div class="source-list">${sources}</div></div></div><div class="panel table-panel"><div class="panel-heading"><div><h3>Популярные маршруты</h3><p>По количеству переходов за 30 дней</p></div></div><div class="table-wrap"><table><thead><tr><th>Маршрут</th><th>Клики</th><th>Пользователи</th><th>Средняя цена клика</th><th>Доля уникальных</th></tr></thead><tbody>${routes}</tbody></table></div></div></section>`;
}

function ticketsSection(dashboard: AdminDashboard, basePath: string): string {
  const { query } = dashboard;
  const headers = [`<th>${sortLink(dashboard, 'city', 'Город', basePath)}</th>`, '<th>Тип</th>', `<th>${sortLink(dashboard, 'price', 'Цена', basePath)}</th>`, `<th>${sortLink(dashboard, 'date', 'Вылет', basePath)}</th>`, '<th>Обратно</th>', '<th>Класс</th>', '<th>Рейс</th>', '<th>Багаж</th>', '<th>Ссылка</th>'].join('');
  const body = dashboard.rows.length === 0 ? '<tr><td colspan="9"><div class="empty-table">Билеты не найдены</div></td></tr>' : dashboard.rows.map(ticketRow).join('');
  return `<section id="tickets" class="dashboard-section"><div class="section-heading"><div><span class="eyebrow">Каталог</span><h2>Билеты</h2><p>${formatNumber(dashboard.total)} результатов после фильтрации.</p></div></div><div class="panel filters-panel"><div class="filter-groups"><div class="filter-group"><span class="group-label">Направление</span><div class="filter-pills">${scopeTab(dashboard, 'all', 'Все', dashboard.counts.active, basePath)}${scopeTab(dashboard, 'domestic', 'Локальные', dashboard.counts.domestic, basePath)}${scopeTab(dashboard, 'international', 'Международные', dashboard.counts.international, basePath)}</div></div><div class="filter-group"><span class="group-label">Тип поездки</span><div class="filter-pills">${tripTab(dashboard, 'all', 'Любой', dashboard.counts.active, basePath)}${tripTab(dashboard, 'round', 'Туда-обратно', dashboard.counts.roundTrip, basePath)}${tripTab(dashboard, 'oneway', 'В одну сторону', dashboard.counts.oneWay, basePath)}</div></div></div><form class="search-form" method="get" action="${escapeHtml(basePath)}/#tickets"><input type="hidden" name="scope" value="${escapeHtml(query.scope)}"><input type="hidden" name="trip" value="${escapeHtml(query.trip)}"><input type="hidden" name="sort" value="${escapeHtml(query.sort)}"><input type="hidden" name="dir" value="${escapeHtml(query.direction)}">${dateInput('date', 'Дата вылета', query.date)}${dateInput('rdate', 'Дата возврата', query.returnDate)}${cityCombobox(dashboard.destinations, query.search)}<div class="filter-actions"><button type="submit">Применить</button>${hasActiveFilters(query) ? `<a class="button ghost" href="${escapeHtml(basePath)}/#tickets">Сбросить</a>` : ''}</div></form></div><div class="panel table-panel"><div class="table-wrap"><table class="tickets-table"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div></div>${pagination(dashboard, basePath)}</section>`;
}

const STYLES = `
  :root{color-scheme:light;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--navy:#101923;--navy-2:#192532;--canvas:#f3f6fa;--panel:#fff;--text:#17202b;--muted:#6b7785;--line:#e4e9ef;--blue:#2f80ed;--blue-soft:#eaf3ff;--orange:#ef8d42;--green:#1f9d70;--green-soft:#e8f7f1}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--canvas);color:var(--text);-webkit-font-smoothing:antialiased}a{color:inherit}button,input,select{font:inherit}.admin-shell{min-height:100vh;display:grid;grid-template-columns:248px minmax(0,1fr)}.sidebar{position:sticky;top:0;height:100vh;padding:24px 18px;background:var(--navy);color:#dbe4ed;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:12px;padding:0 8px 28px}.brand-mark{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:var(--blue);color:#fff;font-size:13px;font-weight:850;letter-spacing:.04em}.brand-name{font-size:16px;font-weight:760}.brand-subtitle{margin-top:2px;color:#8292a2;font-size:11px}.sidebar-label{padding:0 10px 8px;color:#66788a;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.side-nav{display:grid;gap:5px}.side-link{display:flex;align-items:center;gap:11px;min-height:42px;padding:10px 12px;border-radius:10px;color:#9eacba;text-decoration:none;font-size:13px;font-weight:650}.side-link:hover,.side-link.active{background:var(--navy-2);color:#fff}.nav-dot{width:8px;height:8px;border:2px solid currentColor;border-radius:50%}.side-link.active .nav-dot{border-color:var(--blue);background:var(--blue)}.sidebar-status{margin-top:auto;padding:15px;border:1px solid #263545;border-radius:12px;background:#141f2a}.status-title{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700}.live-dot{width:7px;height:7px;border-radius:50%;background:#35ca8f;box-shadow:0 0 0 3px rgb(53 202 143 / 12%)}.status-copy{margin-top:7px;color:#7f90a1;font-size:11px;line-height:1.5}.main{min-width:0;padding:28px 32px 64px}.topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:28px}h1,h2,h3,p{margin:0}h1{font-size:27px;line-height:1.15;letter-spacing:-.03em}h2{font-size:22px;letter-spacing:-.02em}h3{font-size:15px}.topbar p,.section-heading p,.panel-heading p{margin-top:5px;color:var(--muted);font-size:12px;line-height:1.45}.topbar-actions{display:flex;align-items:center;gap:9px;flex:0 0 auto}.button,button{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:9px 14px;border:1px solid transparent;border-radius:9px;background:var(--blue);color:#fff;text-decoration:none;font-size:12px;font-weight:750;cursor:pointer}.button.ghost{border-color:var(--line);background:#fff;color:#465462}.button:hover,button:hover{filter:brightness(.97)}.sync-form{margin:0}.dashboard-section{scroll-margin-top:20px;margin-bottom:54px}.section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:17px}.eyebrow{display:block;margin-bottom:6px;color:var(--blue);font-size:10px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin-bottom:14px}.kpi-card,.mini-kpi,.panel,.sync-strip{border:1px solid var(--line);background:var(--panel);box-shadow:0 1px 2px rgb(16 25 35 / 3%)}.kpi-card{min-height:135px;padding:19px;border-radius:14px}.kpi-label{color:var(--muted);font-size:11px;font-weight:700}.kpi-value{margin-top:14px;font-size:29px;font-weight:790;letter-spacing:-.035em}.kpi-value.price{color:var(--orange)}.kpi-meta{margin-top:10px;color:var(--muted);font-size:11px;line-height:1.4}.kpi-meta strong{color:var(--green)}.sync-strip{display:grid;grid-template-columns:1fr repeat(3,auto);align-items:center;gap:28px;padding:13px 17px;border-radius:12px;margin-bottom:14px}.sync-main{display:flex;align-items:center;gap:10px;min-width:0}.sync-copy strong{display:block;font-size:12px}.sync-copy span,.sync-metric span{display:block;margin-top:2px;color:var(--muted);font-size:10px}.sync-metric{text-align:right}.sync-metric strong{font-size:13px}.two-column{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(280px,.85fr);gap:14px}.panel{min-width:0;border-radius:14px}.chart-panel,.source-panel{padding:18px}.panel-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:16px}.period-chip{padding:5px 9px;border-radius:999px;background:var(--blue-soft);color:var(--blue);font-size:10px;font-weight:750;white-space:nowrap}.chart-legend{min-height:24px;display:flex;align-items:center;flex-wrap:wrap;gap:14px;color:var(--muted);font-size:10px}.chart-legend span{display:inline-flex;align-items:center;gap:6px}.chart-total{margin-left:auto;font-weight:700}.legend-line{width:18px;height:3px;border-radius:2px;background:var(--blue)}.legend-line.comparison{background:var(--orange)}.legend-square{width:8px;height:8px;border-radius:2px;background:var(--blue)}.chart-scroll{width:100%;overflow:hidden}.chart{display:block;width:100%;min-width:520px;height:auto}.grid-line{stroke:#e9edf2;stroke-width:1}.axis-label{fill:#8995a1;font-size:10px}.chart-line{fill:none;stroke:var(--blue);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.chart-line.comparison{stroke:var(--orange);stroke-width:2}.chart-dot{fill:#fff;stroke:var(--blue);stroke-width:2}.chart-bar{fill:var(--blue)}.chart-empty{min-height:250px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;color:var(--muted);text-align:center}.chart-empty strong{color:var(--text);font-size:13px}.chart-empty span{max-width:280px;font-size:11px;line-height:1.45}.chart-empty.compact{min-height:180px}.mini-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}.mini-kpi{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:66px;padding:14px 16px;border-radius:12px}.mini-kpi span{color:var(--muted);font-size:11px}.mini-kpi strong{font-size:19px}.table-panel{overflow:hidden}.table-panel>.panel-heading{padding:17px 18px 0}.table-wrap{overflow-x:auto}table{width:100%;min-width:760px;border-collapse:collapse}th,td{padding:12px 14px;border-bottom:1px solid #edf0f4;text-align:left;font-size:11px;white-space:nowrap}th{background:#f8fafc;color:#71808e;font-size:9px;font-weight:800;letter-spacing:.055em;text-transform:uppercase}th a{text-decoration:none}tr:last-child td{border-bottom:0}tbody tr:hover{background:#fbfcfe}.primary-cell{color:var(--text);font-size:12px;font-weight:700}.secondary-cell{margin-top:3px;color:#8a96a2;font-size:10px}.numeric{text-align:right;font-variant-numeric:tabular-nums}.strong{font-weight:750}.currency{color:var(--muted);font-size:9px}.status-badge{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:9px;font-weight:750}.status-badge.success{background:var(--green-soft);color:var(--green)}.status-badge.neutral{background:#eef2f6;color:#627180}.table-link{color:var(--blue);font-weight:700;text-decoration:none}.empty-table{padding:28px;color:var(--muted);text-align:center}.metric-range{text-align:right}.metric-range span{display:block;color:var(--muted);font-size:10px}.metric-range strong{display:block;margin-top:5px;font-size:12px}.source-list{display:grid;gap:16px;padding-top:4px}.source-label{display:flex;justify-content:space-between;gap:12px;margin-bottom:7px;font-size:11px}.source-track{height:6px;overflow:hidden;border-radius:999px;background:#edf1f5}.source-track span{display:block;height:100%;border-radius:inherit;background:var(--blue)}.filters-panel{padding:16px;margin-bottom:14px}.filter-groups{display:flex;flex-wrap:wrap;gap:18px 28px;margin-bottom:15px}.filter-group{display:grid;gap:7px}.group-label,.filter-field label{color:#778490;font-size:9px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.filter-pills{display:flex;flex-wrap:wrap;gap:6px}.filter-pill{display:inline-flex;align-items:center;gap:6px;min-height:31px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:#fff;color:#53616f;font-size:10px;font-weight:700;text-decoration:none}.filter-pill span{color:#94a0ab}.filter-pill.active{border-color:var(--blue);background:var(--blue);color:#fff}.filter-pill.active span{color:#dcecff}.search-form{display:flex;align-items:flex-end;flex-wrap:wrap;gap:10px;padding-top:14px;border-top:1px solid var(--line)}.filter-field{display:grid;gap:6px}.city-field{min-width:230px;flex:1}input[type=search],input[type=date],select{min-height:36px;padding:8px 10px;border:1px solid #d8dfe6;border-radius:8px;outline:none;background:#fff;color:var(--text);font-size:11px}input[type=date]{min-width:150px}input:focus-visible,a:focus-visible,button:focus-visible,select:focus-visible{outline:2px solid var(--blue);outline-offset:2px}.city-combobox{position:relative}.city-combobox input{width:100%}.city-options{position:absolute;z-index:30;top:calc(100% + 5px);right:0;left:0;max-height:260px;overflow:auto;padding:5px;border:1px solid #d8dfe6;border-radius:9px;background:#fff;box-shadow:0 16px 36px rgb(16 25 35 / 16%)}.city-options[hidden],.city-option[hidden]{display:none}.city-option{display:block;width:100%;padding:8px 9px;border:0;border-radius:6px;background:transparent;color:var(--text);text-align:left}.city-option span{float:right;color:var(--muted)}.city-option:hover,.city-option.active{background:var(--blue-soft);color:#1d67c8}.filter-actions{display:flex;gap:7px}.pagination{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:13px;color:var(--muted);font-size:11px}.page-link{padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text);text-decoration:none}.flash{margin-bottom:18px;padding:11px 14px;border:1px solid #aee6ce;border-radius:10px;background:var(--green-soft);color:#176d50;font-size:12px}@media(max-width:1100px){.kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.two-column{grid-template-columns:1fr}}@media(max-width:900px){.admin-shell{display:block}.sidebar{position:sticky;z-index:50;top:0;width:100%;height:auto;padding:10px 14px;display:block}.brand{display:none}.sidebar-label,.sidebar-status{display:none}.side-nav{display:flex;gap:4px;overflow-x:auto}.side-link{flex:0 0 auto;min-height:36px;padding:8px 10px;font-size:11px}.nav-dot{display:none}.main{padding:22px 18px 50px}.dashboard-section{scroll-margin-top:64px}}@media(max-width:640px){.topbar{align-items:flex-start}.topbar-actions{flex-direction:column;align-items:stretch}h1{font-size:23px}.kpi-grid,.mini-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.kpi-card{min-height:118px;padding:16px}.kpi-value{font-size:24px}.sync-strip{grid-template-columns:1fr 1fr;gap:14px}.sync-main{grid-column:1/-1}.section-heading{align-items:flex-start;flex-direction:column}.metric-range{text-align:left}.chart-scroll{overflow-x:auto}.search-form,.filter-field,.city-field{width:100%;min-width:0}input[type=search],input[type=date]{width:100%}.filter-actions{width:100%}.filter-actions>*{flex:1}}
`;

const SCRIPT = `
  for (const combobox of document.querySelectorAll('[data-city-combobox]')) {
    const input = combobox.querySelector('input[role="combobox"]');
    const list = combobox.querySelector('[role="listbox"]');
    const options = Array.from(combobox.querySelectorAll('[data-city-code]'));
    if (!(input instanceof HTMLInputElement) || !(list instanceof HTMLElement)) continue;
    let activeOption = null;
    const visibleOptions = () => options.filter((option) => !option.hidden);
    const setActiveOption = (option) => { for (const item of options) { const active = item === option; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); } activeOption = option; if (option === null) input.removeAttribute('aria-activedescendant'); else { input.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block:'nearest' }); } };
    const closeOptions = () => { list.hidden = true; input.setAttribute('aria-expanded','false'); setActiveOption(null); };
    const showOptions = (search) => { const needle = search.trim().toLocaleLowerCase('ru'); for (const option of options) option.hidden = needle !== '' && !option.dataset.citySearch.includes(needle); list.hidden = visibleOptions().length === 0; input.setAttribute('aria-expanded', String(!list.hidden)); setActiveOption(null); };
    const selectOption = (option) => { input.value = option.dataset.cityCode ?? ''; closeOptions(); input.form?.requestSubmit(); };
    input.addEventListener('focus', () => showOptions('')); input.addEventListener('click', () => { if (list.hidden) showOptions(''); }); input.addEventListener('input', () => showOptions(input.value));
    input.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeOptions(); return; } if (!['ArrowDown','ArrowUp','Enter'].includes(event.key)) return; const visible = visibleOptions(); if (visible.length === 0) return; if (event.key === 'Enter') { if (list.hidden) return; event.preventDefault(); selectOption(activeOption ?? visible[0]); return; } event.preventDefault(); if (list.hidden) showOptions(input.value); const currentIndex = visible.indexOf(activeOption); const nextIndex = event.key === 'ArrowDown' ? (currentIndex + 1) % visible.length : (currentIndex <= 0 ? visible.length - 1 : currentIndex - 1); setActiveOption(visible[nextIndex]); });
    for (const option of options) { option.addEventListener('mousedown', (event) => event.preventDefault()); option.addEventListener('click', () => selectOption(option)); }
    document.addEventListener('click', (event) => { if (!combobox.contains(event.target)) closeOptions(); });
  }
  const links = Array.from(document.querySelectorAll('.side-link'));
  const sections = links.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  const observer = new IntersectionObserver((entries) => { const visible = entries.filter((entry) => entry.isIntersecting).sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0]; if (!visible) return; for (const link of links) link.classList.toggle('active', link.getAttribute('href') === '#' + visible.target.id); }, { rootMargin:'-20% 0px -65% 0px', threshold:[0,.2,.5] });
  for (const section of sections) observer.observe(section);
  window.setInterval(() => { const active = document.activeElement; if (document.visibilityState === 'visible' && !(active instanceof HTMLInputElement)) window.location.reload(); }, 60_000);
`;

export function renderAdminPage(dashboard: AdminDashboard, flash?: string, basePath = '/admin'): string {
  const { stats } = dashboard;
  const sync = stats.lastSync;
  const flashHtml = flash === undefined ? '' : `<div class="flash" role="status">${escapeHtml(flash)}</div>`;
  const syncState = sync === null ? 'Нет синхронизаций' : `Последняя синхронизация: ${formatDateTime(sync.finishedAt)}`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Hot Ticket — управление</title><style>${STYLES}</style></head><body><div class="admin-shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">HT</div><div><div class="brand-name">Hot Ticket</div><div class="brand-subtitle">Control center</div></div></div><div class="sidebar-label">Навигация</div><nav class="side-nav" aria-label="Разделы админ-панели"><a class="side-link active" href="#overview"><span class="nav-dot"></span>Обзор</a><a class="side-link" href="#users"><span class="nav-dot"></span>Пользователи</a><a class="side-link" href="#prices"><span class="nav-dot"></span>Цены</a><a class="side-link" href="#clicks"><span class="nav-dot"></span>Переходы</a><a class="side-link" href="#tickets"><span class="nav-dot"></span>Билеты</a></nav><div class="sidebar-status"><div class="status-title"><span class="live-dot"></span>Система работает</div><div class="status-copy">${escapeHtml(syncState)}</div></div></aside><main class="main"><header class="topbar"><div><h1>Панель управления</h1><p>Пользователи, цены, переходы и каталог билетов в одном месте.</p></div><div class="topbar-actions"><a class="button ghost" href="${escapeHtml(basePath)}/">Обновить данные</a><form class="sync-form" method="post" action="${escapeHtml(basePath)}/sync"><button type="submit">Запустить sync</button></form></div></header>${flashHtml}<section id="overview" class="dashboard-section"><div class="section-heading"><div><span class="eyebrow">Сводка</span><h2>Состояние продукта</h2><p>Первый экран показывает основные показатели без дополнительной фильтрации.</p></div><span class="period-chip">Последние 30 дней</span></div>${kpiCards(dashboard)}<div class="sync-strip"><div class="sync-main"><span class="live-dot"></span><div class="sync-copy"><strong>${escapeHtml(syncState)}</strong><span>${sync === null ? 'Запустите sync для первой загрузки' : `Статус: ${escapeHtml(sync.status)}`}</span></div></div><div class="sync-metric"><strong>${formatNumber(stats.activeSubscriptions)}</strong><span>активных подписок</span></div><div class="sync-metric"><strong>${sync === null ? '—' : formatNumber(sync.fetchedCount)}</strong><span>получено</span></div><div class="sync-metric"><strong>${sync === null ? '—' : formatNumber(sync.insertedCount + sync.updatedCount)}</strong><span>изменено</span></div></div><div class="two-column"><div class="panel chart-panel"><div class="panel-heading"><div><h3>Цены билетов</h3><p>Средняя минимальная цена по маршрутам</p></div><a class="table-link" href="#prices">Подробнее</a></div>${priceChart(stats.priceStats.trend30Days, 'overview-price-chart')}</div><div class="panel chart-panel"><div class="panel-heading"><div><h3>Переходы</h3><p>Человеческие клики по дням</p></div><a class="table-link" href="#clicks">Подробнее</a></div>${clickChart(stats.clickStats.daily30Days, 'overview-click-chart')}</div></div></section>${usersSection(dashboard)}${pricesSection(dashboard)}${clicksSection(dashboard)}${ticketsSection(dashboard, basePath)}</main></div><script>${SCRIPT}</script></body></html>`;
}
