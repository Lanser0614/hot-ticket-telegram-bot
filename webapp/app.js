import {
  escapeHtml, formatDate, formatPrice, minutesToTime, timeToMinutes, todayInTashkent
} from './lib/format.js';
import { demoDeals, demoHistory, demoProfile, demoSubscriptions } from './lib/demo-data.js';

const telegram = globalThis.Telegram?.WebApp;
const content = document.querySelector('#content');
const bottomNav = document.querySelector('#bottom-nav');
const sheet = document.querySelector('#app-sheet');
const backdrop = document.querySelector('#sheet-backdrop');
const toast = document.querySelector('#toast');
const watchDot = document.querySelector('#watch-dot');
const demoMode = globalThis.location.protocol === 'file:'
  || ['127.0.0.1', 'localhost'].includes(globalThis.location.hostname);

const state = {
  view: 'home', screen: 'tabs', profile: null, deals: [], destinations: [], subscriptions: [],
  selectedTicket: null, history: [], historyRange: 30, sheetForm: null, toastTimer: null
};
const icon = (name) => `<span class="icon icon-${name}" aria-hidden="true"></span>`;
const originNames = { TAS: 'Ташкент', SKD: 'Самарканд', BHK: 'Бухара', FEG: 'Фергана', NMA: 'Наманган', UGC: 'Ургенч' };
const className = (value) => value === 'business' ? 'Бизнес' : 'Эконом';

function applyTelegramChrome() {
  telegram?.setHeaderColor?.('#101922');
  telegram?.setBackgroundColor?.('#101922');
  telegram?.setBottomBarColor?.('#151f2b');
  telegram?.disableVerticalSwipes?.();
}
function haptic(style = 'light') { telegram?.HapticFeedback?.impactOccurred?.(style); }

async function api(path, options = {}) {
  if (demoMode) return demoApi(path, options);
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `tma ${telegram?.initData ?? ''}`, ...(options.headers ?? {}) }
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? 'Не удалось выполнить запрос');
  }
  return response.status === 204 ? null : response.json();
}

function demoApi(path, options) {
  const method = options.method ?? 'GET';
  if (path === '/api/v1/me' && method === 'GET') return globalThis.structuredClone(demoProfile);
  if (path === '/api/v1/me' && method === 'PATCH') { Object.assign(demoProfile, JSON.parse(options.body)); return globalThis.structuredClone(demoProfile); }
  if (path.startsWith('/api/v1/deals')) return { items: globalThis.structuredClone(demoDeals), nextCursor: null };
  if (path === '/api/v1/destinations') return { items: demoDeals.map(({ destinationCode: code, destinationName: name }) => ({ code, name })) };
  if (path === '/api/v1/subscriptions' && method === 'GET') return { items: globalThis.structuredClone(demoSubscriptions) };
  if (path === '/api/v1/subscriptions' && method === 'POST') {
    const item = { id: Date.now(), userId: 1, originCode: demoProfile.defaultOriginCode, currencyCode: 'UZS', isActive: true, ...JSON.parse(options.body) };
    demoSubscriptions.unshift(item); return globalThis.structuredClone(item);
  }
  if (path.startsWith('/api/v1/subscriptions/') && method === 'PATCH') {
    const item = demoSubscriptions.find((subscription) => subscription.id === Number(path.split('/').at(-1)));
    Object.assign(item, JSON.parse(options.body)); return globalThis.structuredClone(item);
  }
  if (path.startsWith('/api/v1/subscriptions/') && method === 'DELETE') {
    const item = demoSubscriptions.find((subscription) => subscription.id === Number(path.split('/').at(-1)));
    if (item) item.isActive = false; return null;
  }
  if (path.startsWith('/api/v1/tickets/')) return globalThis.structuredClone(demoDeals.find((item) => item.id === Number(path.split('/').at(-1))));
  if (path.includes('/history')) return { items: globalThis.structuredClone(demoHistory.slice(-state.historyRange)) };
  throw new Error(`Demo API: ${method} ${path}`);
}

function showToast(message) {
  globalThis.clearTimeout(state.toastTimer); toast.textContent = message; toast.classList.remove('hidden');
  state.toastTimer = globalThis.setTimeout(() => toast.classList.add('hidden'), 2400);
}
function loading() { content.innerHTML = '<div class="screen-loader"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>'; }
function errorScreen(error, retry) {
  content.innerHTML = `<section class="screen error-state"><span class="state-icon">${icon('wifi-off')}</span><div class="state-title">Не удалось загрузить</div><div class="state-copy">${escapeHtml(error instanceof Error ? error.message : 'Попробуйте ещё раз')}</div><button id="retry" class="primary state-action" type="button">Повторить</button></section>`;
  document.querySelector('#retry')?.addEventListener('click', retry);
}
function showTabs(value) { bottomNav.classList.toggle('hidden', !value); telegram?.BackButton?.[value ? 'hide' : 'show']?.(); }
function setActiveNav() {
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  watchDot.classList.toggle('hidden', !state.subscriptions.some((item) => item.isActive));
}
function percentBelow(ticket) {
  const median = ticket.dealScore?.medianPrice;
  return median && median > ticket.price ? Math.round((1 - ticket.price / median) * 100) : null;
}
function ticketMatches(ticket, subscription, includePrice = true) {
  return subscription.isActive && ticket.originCode === subscription.originCode
    && (!subscription.destinationCode || ticket.destinationCode === subscription.destinationCode)
    && ticket.departureDate >= subscription.departureDateFrom && ticket.departureDate <= subscription.departureDateTo
    && (!includePrice || !subscription.maxPrice || ticket.price <= subscription.maxPrice)
    && (!subscription.directOnly || ticket.isDirect) && (!subscription.roundTripOnly || ticket.returnDate)
    && (!subscription.baggageRequired || ticket.hasBaggage) && ticket.tripClass === subscription.tripClass;
}
function dateRange(ticket) { return ticket.returnDate ? `${formatDate(ticket.departureDate)} — ${formatDate(ticket.returnDate)}` : formatDate(ticket.departureDate); }
function historyScale(ticket) {
  const score = ticket.dealScore ?? {}; const min = score.minPrice ?? ticket.price; const median = score.medianPrice ?? ticket.price; const max = score.maxPrice ?? ticket.price;
  const position = Math.max(3, Math.min(97, (ticket.price - min) / Math.max(1, max - min) * 100));
  return `<div class="price-scale"><span class="scale-marker" style="left:${position}%"></span></div><div class="scale-values"><span><small>Мин.</small>${formatPrice(min)}</span><span><small>Обычно</small>${formatPrice(median)}</span><span><small>Макс.</small>${formatPrice(max)}</span></div>`;
}

function renderHome() {
  state.screen = 'tabs'; showTabs(true); setActiveNav(); const hero = state.deals[0];
  if (!hero) { content.innerHTML = `<section class="screen"><div class="topbar"><div><div class="brand">Hot Ticket</div><h1>Лучшие билеты</h1></div></div><div class="empty-state"><span class="state-icon">${icon('ticket')}</span><div class="state-title">Сейчас подходящих билетов нет</div><div class="state-copy">Продолжаем следить за маршрутами и покажем новый HotTicket здесь.</div></div></section>`; return; }
  const discount = percentBelow(hero); const movers = [...state.deals.slice(1, 3), null];
  const sampleDays = hero.dealScore?.sampleDays ?? 30;
  const dayWord = sampleDays % 10 === 1 && sampleDays % 100 !== 11 ? 'день' : sampleDays % 10 >= 2 && sampleDays % 10 <= 4 && (sampleDays % 100 < 12 || sampleDays % 100 > 14) ? 'дня' : 'дней';
  content.innerHTML = `<section class="screen home-screen"><header class="home-toolbar"><button id="origin-pill" class="origin-pill" type="button">Из ${escapeHtml(originNames[state.profile.defaultOriginCode] ?? state.profile.defaultOriginCode)}</button><span><button id="refresh-deals" class="icon-button" type="button" aria-label="Обновить">${icon('refresh')}</button><button id="filter-deals" class="icon-button" type="button" aria-label="Фильтры">${icon('filter')}</button></span></header><article class="hero-card"><div class="hero-label"><span>Лучший билет сейчас</span>${discount ? `<b>−${discount}% к обычной</b>` : ''}</div><button class="hero-main compact-hero" type="button" data-ticket="${hero.id}"><span><b>${escapeHtml(hero.originName)} → ${escapeHtml(hero.destinationName)}</b><small>${dateRange(hero)}</small></span><strong>${formatPrice(hero.price)} <small>UZS</small></strong></button><p class="price-caption">Цены по направлению за ${sampleDays} ${dayWord}</p>${historyScale(hero)}<div class="hero-actions"><button class="ghost-button primary-ghost" type="button" data-ticket="${hero.id}">${icon('ticket')} Открыть билет</button><button class="bell-button" type="button" data-track="${hero.id}" aria-label="Следить за направлением">${icon('bell')}</button></div></article><div class="section-heading"><div><h2>Подешевело за 3 дня</h2></div><small>4 маршрута</small></div><div class="mover-list">${movers.map((ticket) => ticket ? moverRow(ticket) : unavailableRow()).join('')}</div><button id="notifications-cta" class="notification-cta" type="button"><span class="cta-icon">${icon('bell')}</span><span><b>Бот пришлёт сообщение, когда цена упадёт</b></span><strong>Включить</strong></button></section>`;
  bindTicketButtons(); document.querySelectorAll('[data-track]').forEach((button) => button.addEventListener('click', () => openTracking(Number(button.dataset.track))));
  document.querySelector('#notifications-cta')?.addEventListener('click', () => openTracking(hero.id));
  document.querySelector('#origin-pill')?.addEventListener('click', () => { state.view = 'profile'; void loadView(); });
  document.querySelector('#refresh-deals')?.addEventListener('click', refreshDeals);
  document.querySelector('#filter-deals')?.addEventListener('click', openRoutePicker);
}

async function refreshDeals() {
  try { state.deals = (await api('/api/v1/deals?sort=best&limit=50')).items; haptic(); renderHome(); showToast('Цены обновлены'); }
  catch (error) { showToast(error instanceof Error ? error.message : 'Не удалось обновить'); }
}
function moverRow(ticket) {
  const delta = Math.max(4, Math.round((ticket.dealScore?.percentile ?? 60) / 8));
  return `<article class="mover-row"><button class="mover-main" type="button" data-ticket="${ticket.id}"><span class="mover-route"><b>${escapeHtml(ticket.destinationName)}</b><small>${ticket.originCode} → ${ticket.destinationCode} · ${formatDate(ticket.departureDate)}</small></span><span class="mover-price"><b>${formatPrice(ticket.price)}</b><small>−${delta}% по маршруту</small></span></button><button class="row-bell" type="button" data-track="${ticket.id}" aria-label="Следить">${icon('bell')}</button></article>`;
}
function unavailableRow() { return `<article class="mover-row unavailable"><div class="mover-main"><span class="mover-route"><b>Москва</b><small>TAS → MOW</small></span><span class="mover-price"><b>Нет билетов</b><small>Продолжаем отслеживать</small></span></div><button class="row-bell" type="button" data-track-custom="MOW" aria-label="Следить">${icon('bell')}</button></article>`; }
function bindTicketButtons() {
  document.querySelectorAll('[data-ticket]').forEach((button) => button.addEventListener('click', () => void openTicket(Number(button.dataset.ticket))));
  document.querySelectorAll('[data-track-custom]').forEach((button) => button.addEventListener('click', () => openTracking(null, button.dataset.trackCustom)));
}

async function openTicket(ticketId, subscriptionId = null) {
  state.screen = 'detail'; showTabs(false); loading();
  try { state.selectedTicket = await api(`/api/v1/tickets/${ticketId}${subscriptionId ? `?subscription_id=${subscriptionId}` : ''}`); await loadHistory(30); }
  catch (error) { errorScreen(error, () => openTicket(ticketId, subscriptionId)); }
}
async function loadHistory(days) {
  state.historyRange = days; const ticket = state.selectedTicket;
  try { state.history = (await api(`/api/v1/routes/${ticket.originCode}/${ticket.destinationCode}/history?days=${days}`)).items; }
  catch { state.history = []; }
  renderDetail();
}
function renderDetail() {
  const ticket = state.selectedTicket; const discount = percentBelow(ticket);
  content.innerHTML = `<section class="screen detail-screen"><header class="detail-top"><button id="back-detail" class="back-button" type="button" aria-label="Назад">${icon('chevron-left')}</button><button id="share-ticket" class="text-button" type="button">${icon('arrow-up-right')} Отправить в чат</button></header><div class="detail-route">${ticket.originCode} → ${ticket.destinationCode}</div><h1>${escapeHtml(ticket.originName)} → ${escapeHtml(ticket.destinationName)}</h1><div class="detail-price">${formatPrice(ticket.price)} <small>UZS</small></div>${discount ? `<div class="deal-pill">На ${discount}% ниже обычной</div>` : ''}<div class="updated">Обновлено недавно</div><article class="panel chart-panel"><div class="panel-title-row"><div><h2>Цены маршрута</h2><p>${ticket.originCode} → ${ticket.destinationCode}</p></div><div class="range-tabs">${[7, 30, 90].map((days) => `<button class="range-button ${state.historyRange === days ? 'active' : ''}" type="button" data-range="${days}">${days}д</button>`).join('')}</div></div><canvas id="price-chart" class="chart-canvas" width="650" height="230"></canvas>${historyScale(ticket)}<div class="percentile-copy">Одна из самых низких цен на этом маршруте за ${state.historyRange} дней.</div></article><article class="panel"><h2 class="panel-heading">Этот билет</h2><div class="info-row"><span>Даты</span><b>${dateRange(ticket)}</b></div><div class="info-row"><span>Рейс</span><b>${ticket.isDirect ? 'Прямой' : 'С пересадкой'}</b></div><div class="info-row"><span>Багаж</span><b>${ticket.hasBaggage ? 'Включён' : 'Без багажа'}</b></div><div class="info-row"><span>Класс</span><b>${className(ticket.tripClass)}</b></div><div class="info-row"><span>Авиакомпания</span><b>${escapeHtml(ticket.airlineName ?? 'Не указана')}</b></div></article><button id="track-detail" class="secondary" type="button">${icon('bell')} Следить за маршрутом</button></section><div class="purchase-bar"><a class="primary" href="${escapeHtml(ticket.openUrl)}" target="_blank" rel="noopener">Купить за ${formatPrice(ticket.price)} UZS</a></div>`;
  document.querySelector('#back-detail')?.addEventListener('click', backToTabs); document.querySelector('#track-detail')?.addEventListener('click', () => openTracking(ticket.id));
  document.querySelector('#share-ticket')?.addEventListener('click', () => shareText(`Hot Ticket: ${ticket.originCode} → ${ticket.destinationCode} за ${formatPrice(ticket.price)} UZS`, ticket.shareUrl ?? ticket.openUrl));
  document.querySelectorAll('[data-range]').forEach((button) => button.addEventListener('click', () => void loadHistory(Number(button.dataset.range)))); globalThis.requestAnimationFrame(drawChart);
}
function drawChart() {
  const canvas = document.querySelector('#price-chart'); if (!canvas) return; const context = canvas.getContext('2d');
  const values = state.history.map((item) => item.minPrice).filter(Number.isFinite); if (values.length < 2) { canvas.classList.add('empty-chart'); return; }
  const min = Math.min(...values); const max = Math.max(...values); const points = values.map((value, index) => ({ x: 14 + index / (values.length - 1) * (canvas.width - 28), y: 18 + (max - value) / Math.max(1, max - min) * (canvas.height - 42) }));
  context.clearRect(0, 0, canvas.width, canvas.height); context.strokeStyle = 'rgba(255,255,255,.08)'; context.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach((ratio) => { context.beginPath(); context.moveTo(0, canvas.height * ratio); context.lineTo(canvas.width, canvas.height * ratio); context.stroke(); });
  context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.strokeStyle = '#4faaf1'; context.lineWidth = 5; context.lineJoin = 'round'; context.stroke();
  const last = points.at(-1); context.beginPath(); context.arc(last.x, last.y, 8, 0, Math.PI * 2); context.fillStyle = '#4faaf1'; context.fill();
}
function backToTabs() { state.screen = 'tabs'; void loadView(); }

function defaultTrackingForm(ticket = null, destinationCode = '') {
  return { id: null, destinationCode: ticket?.destinationCode ?? destinationCode, departureDateFrom: ticket?.departureDate ?? todayInTashkent(), departureDateTo: ticket?.returnDate ?? todayInTashkent(90), maxPrice: ticket ? Math.max(10_000, Math.round(ticket.price * 0.9 / 10_000) * 10_000) : null, directOnly: ticket?.isDirect ?? false, baggageRequired: ticket?.hasBaggage ?? state.profile.baggageRequired, roundTripOnly: Boolean(ticket?.returnDate), tripClass: ticket?.tripClass ?? state.profile.preferredTripClass, preset: '90', expanded: false, sourcePrice: ticket?.price ?? null };
}
function openTracking(ticketId = null, destinationCode = '', subscription = null) {
  const ticket = ticketId ? state.deals.find((item) => item.id === ticketId) ?? state.selectedTicket : null;
  state.sheetForm = subscription ? { ...subscription, preset: 'custom', expanded: true, sourcePrice: subscription.currentTicket?.price ?? null } : defaultTrackingForm(ticket, destinationCode);
  renderTrackingSheet(); sheet.classList.remove('hidden'); backdrop.classList.remove('hidden');
}
function closeSheet() { sheet.classList.add('hidden'); backdrop.classList.add('hidden'); state.sheetForm = null; }
function renderTrackingSheet() {
  const form = state.sheetForm; const destination = state.destinations.find((item) => item.code === form.destinationCode); const name = destination?.name ?? form.destinationCode ?? 'направлением';
  const maxRange = Math.max(form.sourcePrice ?? form.maxPrice ?? 3_000_000, form.maxPrice ?? 0);
  const minRange = Math.max(10_000, Math.round(maxRange * .5 / 10_000) * 10_000);
  sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-title-row"><div><h2>${form.id ? 'Настроить' : 'Следить за'} ${escapeHtml(name)}</h2><p>Бот напишет, когда появится подходящий билет дешевле выбранной цены.</p></div><button id="close-sheet" class="icon-button sheet-close" type="button" aria-label="Закрыть">${icon('x')}</button></div><div class="form-label">Когда летим</div><div class="preset-row"><button class="choice ${form.preset === '90' ? 'active' : ''}" type="button" data-preset="90">Ближайшие 90 дней</button><button class="choice ${form.preset === 'september' ? 'active' : ''}" type="button" data-preset="september">Сентябрь</button><button class="choice ${form.preset === 'custom' ? 'active' : ''}" type="button" data-preset="custom">Свои даты</button></div>${form.preset === 'custom' ? `<div class="form-grid"><label><span class="form-label">С</span><input id="track-from" type="date" value="${form.departureDateFrom}"></label><label><span class="form-label">По</span><input id="track-to" type="date" value="${form.departureDateTo}"></label></div>` : ''}<div class="price-row"><span>Цена до</span><b id="track-price-label">${formatPrice(form.maxPrice ?? maxRange)} UZS</b></div><input id="track-price" class="price-range" type="range" min="${minRange}" max="${maxRange}" step="10000" value="${form.maxPrice ?? maxRange}">${form.sourcePrice ? `<p class="field-help">На 10% ниже текущей ${formatPrice(form.sourcePrice)} UZS</p>` : ''}<div class="toggle-card"><div class="toggle-row"><span><b>Только прямые рейсы</b><small>Без пересадок</small></span><button class="switch ${form.directOnly ? 'active' : ''}" type="button" data-form-toggle="directOnly"></button></div><div class="toggle-row"><span><b>Нужен багаж</b><small>Багаж включён в билет</small></span><button class="switch ${form.baggageRequired ? 'active' : ''}" type="button" data-form-toggle="baggageRequired"></button></div></div><button id="advanced-toggle" class="advanced-toggle" type="button">Дополнительные условия <span>${form.expanded ? '−' : '+'}</span></button>${form.expanded ? `<div class="advanced-panel"><div class="segments"><button class="segment ${form.tripClass === 'economy' ? 'active' : ''}" type="button" data-form-class="economy">Эконом</button><button class="segment ${form.tripClass === 'business' ? 'active' : ''}" type="button" data-form-class="business">Бизнес</button></div><div class="toggle-row"><span><b>Туда-обратно</b></span><button class="switch ${form.roundTripOnly ? 'active' : ''}" type="button" data-form-toggle="roundTripOnly"></button></div></div>` : '<p class="advanced-summary">Эконом · туда-обратно по выбору</p>'}<button id="save-tracking" class="primary sheet-primary" type="button">${form.id ? 'Сохранить изменения' : `${icon('bell')} Следить за ценой`}</button>${form.id ? '<button id="disable-tracking" class="danger-link" type="button">Отключить отслеживание</button>' : ''}`;
  bindTrackingSheet();
}
function bindTrackingSheet() {
  const form = state.sheetForm; document.querySelector('#close-sheet')?.addEventListener('click', closeSheet);
  sheet.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => { form.preset = button.dataset.preset; if (form.preset === '90') { form.departureDateFrom = todayInTashkent(); form.departureDateTo = todayInTashkent(90); } if (form.preset === 'september') { form.departureDateFrom = '2026-09-01'; form.departureDateTo = '2026-09-30'; } renderTrackingSheet(); }));
  sheet.querySelectorAll('[data-form-toggle]').forEach((button) => button.addEventListener('click', () => { form[button.dataset.formToggle] = !form[button.dataset.formToggle]; haptic(); renderTrackingSheet(); }));
  sheet.querySelectorAll('[data-form-class]').forEach((button) => button.addEventListener('click', () => { form.tripClass = button.dataset.formClass; renderTrackingSheet(); }));
  document.querySelector('#advanced-toggle')?.addEventListener('click', () => { form.expanded = !form.expanded; renderTrackingSheet(); });
  document.querySelector('#track-from')?.addEventListener('change', (event) => { form.departureDateFrom = event.target.value; form.preset = 'custom'; });
  document.querySelector('#track-to')?.addEventListener('change', (event) => { form.departureDateTo = event.target.value; form.preset = 'custom'; });
  document.querySelector('#track-price')?.addEventListener('input', (event) => { form.maxPrice = Number(event.target.value); document.querySelector('#track-price-label').textContent = `${formatPrice(form.maxPrice)} UZS`; });
  document.querySelector('#save-tracking')?.addEventListener('click', saveTracking); document.querySelector('#disable-tracking')?.addEventListener('click', disableTracking);
}
async function saveTracking() {
  const form = state.sheetForm; if (!form.destinationCode || !form.departureDateFrom || !form.departureDateTo || form.departureDateTo < form.departureDateFrom) { showToast('Проверьте направление и даты'); return; }
  const body = { destinationCode: form.destinationCode, departureDateFrom: form.departureDateFrom, departureDateTo: form.departureDateTo, maxPrice: form.maxPrice, directOnly: form.directOnly, roundTripOnly: form.roundTripOnly, baggageRequired: form.baggageRequired, tripClass: form.tripClass };
  try { await api(form.id ? `/api/v1/subscriptions/${form.id}` : '/api/v1/subscriptions', { method: form.id ? 'PATCH' : 'POST', body: JSON.stringify(body) }); state.subscriptions = (await api('/api/v1/subscriptions')).items.filter((item) => item.isActive); closeSheet(); haptic('medium'); showToast(form.id ? 'Изменения сохранены' : 'Отслеживание включено'); if (state.view === 'watchlist') renderWatchlist(); else setActiveNav(); }
  catch (error) { showToast(error instanceof Error ? error.message : 'Не удалось сохранить'); }
}
async function disableTracking() {
  try { const id = state.sheetForm.id; await api(`/api/v1/subscriptions/${id}`, { method: 'DELETE' }); state.subscriptions = state.subscriptions.filter((item) => item.id !== id); closeSheet(); showToast('Отслеживание отключено'); renderWatchlist(); }
  catch (error) { showToast(error.message); }
}

function renderWatchlist() {
  state.screen = 'tabs'; showTabs(true); setActiveNav(); const active = state.subscriptions.filter((item) => item.isActive);
  content.innerHTML = `<section class="screen"><header class="watch-head"><div><div class="brand">Watchlist</div><h1>Мои отслеживания</h1><p>${active.length} из 20 · бот следит постоянно</p></div></header>${active.length ? `<div class="watch-list">${active.map(watchCard).join('')}</div>` : `<div class="empty-state"><span class="state-icon">${icon('bell')}</span><div class="state-title">Нет активных маршрутов</div><div class="state-copy">Включите отслеживание, и бот напишет при подходящей цене.</div></div>`}<div class="section-heading compact"><div><h2>Часто отслеживают</h2><p>Популярные направления из Ташкента</p></div></div><div class="suggestion-grid">${state.destinations.slice(0, 4).map((item) => `<button class="suggestion" type="button" data-add-destination="${item.code}"><b>${escapeHtml(item.name)}</b><small>TAS → ${item.code}</small>${icon('plus')}</button>`).join('')}</div><button id="custom-route" class="add-watch" type="button">${icon('plus')} Своё направление</button></section>`;
  document.querySelectorAll('[data-edit-watch]').forEach((button) => button.addEventListener('click', () => openTracking(null, '', active.find((item) => item.id === Number(button.dataset.editWatch)))));
  document.querySelectorAll('[data-current-ticket]').forEach((button) => button.addEventListener('click', () => void openTicket(Number(button.dataset.currentTicket), Number(button.dataset.subscriptionId))));
  document.querySelectorAll('[data-add-destination]').forEach((button) => button.addEventListener('click', () => openTracking(null, button.dataset.addDestination)));
  document.querySelector('#custom-route')?.addEventListener('click', openRoutePicker);
}
function watchCard(subscription) {
  const destination = state.destinations.find((item) => item.code === subscription.destinationCode); const current = subscription.currentTicket ?? null; const reached = current && ticketMatches(current, subscription, true); const progress = current && subscription.maxPrice ? Math.max(0, Math.min(100, subscription.maxPrice / current.price * 100)) : 0;
  const conditions = [className(subscription.tripClass), subscription.directOnly ? 'прямой' : 'пересадки допустимы', subscription.baggageRequired ? 'с багажом' : 'багаж не важен', subscription.roundTripOnly ? 'туда-обратно' : null].filter(Boolean).join(' · ');
  return `<article class="watch-card"><div class="watch-top"><div><div class="route-code">${subscription.originCode} → ${subscription.destinationCode}</div><h2>${escapeHtml(originNames[subscription.originCode] ?? subscription.originCode)} → ${escapeHtml(destination?.name ?? subscription.destinationCode)}</h2></div><span class="status-pill">Активно</span></div><p class="watch-dates">${formatDate(subscription.departureDateFrom)} — ${formatDate(subscription.departureDateTo)} · ${escapeHtml(conditions)}</p><div class="watch-prices"><span><small>Ваша цель</small><b>${subscription.maxPrice ? `${formatPrice(subscription.maxPrice)} UZS` : 'Любая цена'}</b></span><span><small>Сейчас от</small><b>${current ? `${formatPrice(current.price)} UZS` : 'Нет билетов'}</b></span></div>${current && subscription.maxPrice ? `<div class="goal-track"><span style="width:${progress}%"></span></div><p class="goal-copy ${reached ? 'reached' : ''}">${reached ? 'Цена достигла вашей цели' : `Нужно ещё −${formatPrice(Math.max(0, current.price - subscription.maxPrice))} UZS`}</p>` : '<p class="goal-copy">Продолжаем искать подходящий HotTicket</p>'}<div class="watch-actions">${current ? `<button class="ghost-button" type="button" data-current-ticket="${current.id}" data-subscription-id="${subscription.id}">Открыть билет</button>` : '<span></span>'}<button class="small-action" type="button" data-edit-watch="${subscription.id}">Настроить</button></div></article>`;
}
function openRoutePicker() {
  sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-title-row"><div><h2>Выберите направление</h2><p>Откуда: ${escapeHtml(originNames[state.profile.defaultOriginCode] ?? state.profile.defaultOriginCode)}</p></div><button id="close-sheet" class="icon-button sheet-close" type="button">${icon('x')}</button></div><div class="route-picker">${state.destinations.map((item) => `<button type="button" data-pick-route="${item.code}"><span><b>${escapeHtml(item.name)}</b><small>${state.profile.defaultOriginCode} → ${item.code}</small></span>${icon('plus')}</button>`).join('')}</div>`;
  sheet.classList.remove('hidden'); backdrop.classList.remove('hidden'); document.querySelector('#close-sheet')?.addEventListener('click', closeSheet);
  sheet.querySelectorAll('[data-pick-route]').forEach((button) => button.addEventListener('click', () => openTracking(null, button.dataset.pickRoute)));
}

function renderProfile() {
  state.screen = 'tabs'; showTabs(true); setActiveNav(); const user = state.profile; const title = user.firstName ?? user.username ?? 'Пользователь'; const active = state.subscriptions.filter((item) => item.isActive).length;
  const savings = user.trackedSavings?.amount ?? 0;
  content.innerHTML = `<section class="screen profile-screen"><header><div class="brand">Профиль</div><h1>Настройки</h1></header><div class="profile-person"><div class="avatar">${escapeHtml(title.slice(0, 1).toUpperCase())}</div><div><div class="profile-name">${escapeHtml(title)}</div><div class="profile-source">${user.username ? `@${escapeHtml(user.username)}` : 'Telegram-аккаунт'}</div></div></div><div class="profile-stats"><span><b>${active}</b><small>активных</small></span><span><b>${formatPrice(savings)}</b><small>потенциальная экономия за 90 дней</small></span></div><div class="section-label">Настройки поиска</div><div class="settings-list"><button type="button" data-profile-sheet="origin"><span>Город вылета</span><b>${escapeHtml(originNames[user.defaultOriginCode] ?? user.defaultOriginCode)}</b></button><button type="button" data-profile-sheet="class"><span>Класс</span><b>${className(user.preferredTripClass)}</b></button><div class="toggle-row"><span><b>Багаж по умолчанию</b><small>Для новых отслеживаний</small></span><button class="switch ${user.baggageRequired ? 'active' : ''}" type="button" data-profile-toggle="baggageRequired"></button></div></div><div class="section-label">Уведомления</div><div class="settings-list"><div class="toggle-row"><span><b>Сразу о снижении</b><small>До 3 важных сообщений в день</small></span><button class="switch ${user.instantNotificationsEnabled ? 'active' : ''}" type="button" data-profile-toggle="instantNotificationsEnabled"></button></div><div class="toggle-row"><span><b>Утренний дайджест</b><small>Лучшие изменения за ночь</small></span><button class="switch ${user.morningDigestEnabled ? 'active' : ''}" type="button" data-profile-toggle="morningDigestEnabled"></button></div><div class="toggle-row"><span><b>Тихие часы</b><small>${minutesToTime(user.quietStartMinute)} — ${minutesToTime(user.quietEndMinute)}</small></span><button class="switch ${user.quietHoursEnabled ? 'active' : ''}" type="button" data-profile-toggle="quietHoursEnabled"></button></div><button type="button" data-profile-sheet="quiet"><span>Период тишины</span><b>${minutesToTime(user.quietStartMinute)} — ${minutesToTime(user.quietEndMinute)}</b></button></div><button id="share-app" class="share-card" type="button"><span class="cta-icon">${icon('arrow-up-right')}</span><span><b>Поделиться с друзьями</b><small>${user.referralCount ?? 0} приглашено · отправить в Telegram</small></span></button><div class="section-label">Язык</div><div class="segments"><button class="segment ${user.languageCode === 'ru' ? 'active' : ''}" type="button" data-profile-language="ru">Русский</button><button class="segment ${user.languageCode === 'uz' ? 'active' : ''}" type="button" data-profile-language="uz">O‘zbekcha</button></div><p class="autosave-copy">Изменения сохраняются автоматически</p></section>`;
  document.querySelectorAll('[data-profile-toggle]').forEach((button) => button.addEventListener('click', () => void saveProfileField(button.dataset.profileToggle, !user[button.dataset.profileToggle])));
  document.querySelectorAll('[data-profile-language]').forEach((button) => button.addEventListener('click', () => void saveProfileField('languageCode', button.dataset.profileLanguage)));
  document.querySelectorAll('[data-profile-sheet]').forEach((button) => button.addEventListener('click', () => openProfileSheet(button.dataset.profileSheet)));
  document.querySelector('#share-app')?.addEventListener('click', () => shareText('Hot Ticket следит за маршрутами и находит выгодные авиабилеты.', user.referralShareUrl ?? `${globalThis.location.origin}/app/`));
}
async function saveProfileField(key, value) {
  const previous = state.profile[key]; state.profile[key] = value; renderProfile();
  try { state.profile = await api('/api/v1/me', { method: 'PATCH', body: JSON.stringify({ [key]: value }) }); haptic(); showToast('Сохранено'); }
  catch (error) { state.profile[key] = previous; renderProfile(); showToast(error instanceof Error ? error.message : 'Не удалось сохранить'); }
}
function openProfileSheet(kind) {
  if (kind === 'origin') sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-title-row"><div><h2>Город вылета</h2><p>Используется для новых маршрутов</p></div><button id="close-sheet" class="icon-button sheet-close" type="button">${icon('x')}</button></div><div class="route-picker">${Object.entries(originNames).map(([code, name]) => `<button type="button" data-profile-value="${code}"><span><b>${name}</b><small>${code}</small></span>${state.profile.defaultOriginCode === code ? icon('check') : ''}</button>`).join('')}</div>`;
  else if (kind === 'class') sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-title-row"><div><h2>Класс по умолчанию</h2><p>Для новых отслеживаний</p></div><button id="close-sheet" class="icon-button sheet-close" type="button">${icon('x')}</button></div><div class="route-picker"><button type="button" data-profile-value="economy"><span><b>Эконом</b><small>Больше доступных билетов</small></span></button><button type="button" data-profile-value="business"><span><b>Бизнес</b><small>Повышенный комфорт</small></span></button></div>`;
  else sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-title-row"><div><h2>Тихие часы</h2><p>Сообщения подождут до окончания периода</p></div><button id="close-sheet" class="icon-button sheet-close" type="button">${icon('x')}</button></div><div class="form-grid"><label><span class="form-label">С</span><input id="quiet-start" type="time" value="${minutesToTime(state.profile.quietStartMinute)}"></label><label><span class="form-label">До</span><input id="quiet-end" type="time" value="${minutesToTime(state.profile.quietEndMinute)}"></label></div><button id="save-quiet" class="primary" type="button">Сохранить период</button>`;
  sheet.classList.remove('hidden'); backdrop.classList.remove('hidden'); document.querySelector('#close-sheet')?.addEventListener('click', closeSheet);
  sheet.querySelectorAll('[data-profile-value]').forEach((button) => button.addEventListener('click', async () => { await saveProfileField(kind === 'origin' ? 'defaultOriginCode' : 'preferredTripClass', button.dataset.profileValue); closeSheet(); }));
  document.querySelector('#save-quiet')?.addEventListener('click', async () => { const start = timeToMinutes(document.querySelector('#quiet-start').value); const end = timeToMinutes(document.querySelector('#quiet-end').value); try { state.profile = await api('/api/v1/me', { method: 'PATCH', body: JSON.stringify({ quietStartMinute: start, quietEndMinute: end }) }); closeSheet(); renderProfile(); showToast('Период сохранён'); } catch (error) { showToast(error.message); } });
}
function shareText(text, url) {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (telegram?.openTelegramLink) telegram.openTelegramLink(shareUrl); else globalThis.open(shareUrl, '_blank', 'noopener');
}

async function bootstrap() {
  loading();
  try {
    const [profile, deals, destinations, subscriptions] = await Promise.all([api('/api/v1/me'), api('/api/v1/deals?sort=best&limit=50'), api('/api/v1/destinations'), api('/api/v1/subscriptions')]);
    state.profile = profile; state.deals = deals.items; state.destinations = destinations.items; state.subscriptions = subscriptions.items.filter((item) => item.isActive); renderHome();
  } catch (error) { errorScreen(error, bootstrap); }
}
async function loadView() { setActiveNav(); if (state.view === 'watchlist') renderWatchlist(); else if (state.view === 'profile') renderProfile(); else renderHome(); }

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { state.view = button.dataset.view; state.screen = 'tabs'; haptic(); void loadView(); }));
backdrop.addEventListener('click', closeSheet); telegram?.BackButton?.onClick?.(() => { if (!sheet.classList.contains('hidden')) closeSheet(); else backToTabs(); });
if (!demoMode && !telegram?.initData) { showTabs(false); content.innerHTML = `<section class="screen locked-state"><span class="state-icon">${icon('ticket')}</span><div class="state-title">Откройте Hot Ticket из Telegram</div><div class="state-copy">Mini App использует Telegram для безопасного входа.</div></section>`; }
else { applyTelegramChrome(); telegram?.ready(); telegram?.expand(); void bootstrap(); }
