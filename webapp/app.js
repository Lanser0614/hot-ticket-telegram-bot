import {
  escapeHtml, formatDate, formatPrice, minutesToTime, setFormatLanguage, timeToMinutes, todayInTashkent
} from './lib/format.js';
import { demoDeals, demoHistory, demoProfile, demoSubscriptions } from './lib/demo-data.js';
import { appLanguage, translate } from './lib/i18n.js';

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
  dealsNextCursor: null, dealsLoadingMore: false, selectedTicket: null, history: [], historyRange: 30,
  homeSearch: '', homeSearchDestinationCode: null, homeSuggestions: [], homeSuggestionsQuery: '', homeSearchActiveIndex: -1,
  homeScopedDestinationCode: null, homeScopedDeals: null, homeScopedNextCursor: null, homeScopedLoadingMore: false,
  homeSort: 'best', homeFilters: { directOnly: false, maxPrice: null, baggageRequired: false },
  homeSearchTimer: null, sheetForm: null, toastTimer: null, sessionExpired: false
};
const icon = (name) => `<span class="icon icon-${name}" aria-hidden="true"></span>`;
const originNames = { TAS: 'Ташкент', SKD: 'Самарканд', BHK: 'Бухара', FEG: 'Фергана', NMA: 'Наманган', UGC: 'Ургенч' };
const originNamesUz = { TAS: 'Toshkent', SKD: 'Samarqand', BHK: 'Buxoro', FEG: 'Farg‘ona', NMA: 'Namangan', UGC: 'Urganch' };
const demoNamesUz = { TAS: 'Toshkent', IST: 'Istanbul', DXB: 'Dubay', ALA: 'Olmaota', BHK: 'Buxoro', SKD: 'Samarqand' };
const demoSearchAliases = { TAS: ['Tashkent'], IST: ['Istanbul'], DXB: ['Dubay', 'Dubai'], ALA: ['Olmaota', 'Almaty'], BHK: ['Bukhara', 'Buhara'], SKD: ['Samarkand'] };
const demoDestinationCatalog = [
  { code: 'IST', name: 'Стамбул' }, { code: 'DXB', name: 'Дубай' }, { code: 'ALA', name: 'Алматы' },
  { code: 'BHK', name: 'Бухара' }, { code: 'SKD', name: 'Самарканд' }
];
const language = () => appLanguage(state.profile?.languageCode);
const t = (key, params) => translate(language(), key, params);
const className = (value) => value === 'business' ? t('business') : t('economy');
const originName = (code) => (language() === 'uz' ? originNamesUz : originNames)[code] ?? code;

function applyDocumentLanguage() {
  document.documentElement.lang = language(); setFormatLanguage(language());
  const labels = { home: t('navDeals'), watchlist: t('navWatchlist'), profile: t('navProfile') };
  document.querySelectorAll('[data-view]').forEach((button) => { const label = button.querySelector(':scope > span:last-child'); if (label) label.textContent = labels[button.dataset.view]; });
}

function applyTelegramChrome() {
  telegram?.setHeaderColor?.('#101922');
  telegram?.setBackgroundColor?.('#101922');
  telegram?.setBottomBarColor?.('#151f2b');
  telegram?.disableVerticalSwipes?.();
}
function haptic(style = 'light') { telegram?.HapticFeedback?.impactOccurred?.(style); }

const API_TIMEOUT_MS = 15_000;
class ApiError extends Error {
  constructor(message, code = null) { super(message); this.code = code; }
}

async function api(path, options = {}) {
  if (demoMode) return demoApi(path, options);
  const controller = new globalThis.AbortController(); const timeout = globalThis.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      ...options, signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `tma ${telegram?.initData ?? ''}`, ...(options.headers ?? {}) }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null); const code = payload?.error?.code ?? null;
      if (code === 'unauthorized') { state.sessionExpired = true; renderSessionExpired(); }
      throw new ApiError(payload?.error?.message ?? 'Не удалось выполнить запрос', code);
    }
    return response.status === 204 ? null : response.json();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new ApiError(t('requestTimedOut'), 'timeout');
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function demoApi(path, options) {
  const method = options.method ?? 'GET';
  if (path === '/api/v1/me' && method === 'GET') return globalThis.structuredClone(demoProfile);
  if (path === '/api/v1/me' && method === 'PATCH') { Object.assign(demoProfile, JSON.parse(options.body)); return globalThis.structuredClone(demoProfile); }
  if (path.startsWith('/api/v1/deals')) return { items: globalThis.structuredClone(demoDeals).map(localizeDemoTicket), nextCursor: null };
  if (path.startsWith('/api/v1/destinations')) {
    const url = new globalThis.URL(path, globalThis.location.origin); const query = normalizeSearch(url.searchParams.get('q'));
    const activeCodes = new Set(demoDeals.map((ticket) => ticket.destinationCode));
    const items = demoDestinationCatalog.map(({ code, name }) => ({
      code, name: demoProfile.languageCode === 'uz' ? demoNamesUz[code] ?? name : name,
      searchNames: [code, name, demoNamesUz[code], ...(demoSearchAliases[code] ?? [])].filter(Boolean)
    })).filter((item) => query
      ? [item.code, item.name, ...item.searchNames].some((candidate) => normalizeSearch(candidate).startsWith(query))
      : activeCodes.has(item.code));
    return { items: items.slice(0, Math.max(1, Math.min(20, Number(url.searchParams.get('limit')) || 8))) };
  }
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
  if (path.startsWith('/api/v1/tickets/')) return localizeDemoTicket(globalThis.structuredClone(demoDeals.find((item) => item.id === Number(path.split('/').at(-1)))));
  if (path.includes('/history')) return { items: globalThis.structuredClone(demoHistory.slice(-state.historyRange)) };
  throw new Error(`Demo API: ${method} ${path}`);
}
function localizeDemoTicket(ticket) {
  if (!ticket || demoProfile.languageCode !== 'uz') return ticket;
  return { ...ticket, originName: demoNamesUz[ticket.originCode] ?? ticket.originName, destinationName: demoNamesUz[ticket.destinationCode] ?? ticket.destinationName };
}

function showToast(message) {
  globalThis.clearTimeout(state.toastTimer); toast.textContent = message; toast.classList.remove('hidden');
  state.toastTimer = globalThis.setTimeout(() => toast.classList.add('hidden'), 2400);
}
function loading() { content.innerHTML = '<div class="screen-loader"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>'; }
function errorScreen(error, retry) {
  if (state.sessionExpired) { renderSessionExpired(); return; }
  content.innerHTML = `<section class="screen error-state"><span class="state-icon">${icon('wifi-off')}</span><div class="state-title">${t('loadFailed')}</div><div class="state-copy">${escapeHtml(error instanceof Error ? error.message : t('tryAgain'))}</div><button id="retry" class="primary state-action" type="button">${t('retry')}</button></section>`;
  document.querySelector('#retry')?.addEventListener('click', retry);
}
function renderSessionExpired() {
  showTabs(false); sheet.classList.add('hidden'); backdrop.classList.add('hidden');
  content.innerHTML = `<section class="screen locked-state"><span class="state-icon">${icon('ticket')}</span><div class="state-title">${t('sessionExpired')}</div><div class="state-copy">${t('sessionExpiredHelp')}</div><button id="close-expired-session" class="primary state-action" type="button">${t('reopenMiniApp')}</button></section>`;
  document.querySelector('#close-expired-session')?.addEventListener('click', () => {
    if (telegram?.close) telegram.close(); else globalThis.location.reload();
  });
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
  return `<div class="price-scale"><span class="scale-marker" style="left:${position}%"></span></div><div class="scale-values"><span><small>${t('min')}</small>${formatPrice(min)}</span><span><small>${t('normal')}</small>${formatPrice(median)}</span><span><small>${t('max')}</small>${formatPrice(max)}</span></div>`;
}
function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').replaceAll('ё', 'е').replaceAll('’', "'").trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru-RU');
}
function searchDestinationCodes(query) {
  if (!query) return new Set();
  if (state.homeSearchDestinationCode) return new Set([state.homeSearchDestinationCode]);
  const destinations = [...state.destinations, ...state.homeSuggestions];
  return new Set(destinations.filter((destination) => [destination.code, destination.name, ...(destination.searchNames ?? [])]
    .some((name) => normalizeSearch(name).startsWith(query))).map((destination) => destination.code));
}
function filteredDeals() {
  const query = normalizeSearch(state.homeSearch); const filters = state.homeFilters; const destinationCodes = searchDestinationCodes(query);
  const source = state.homeScopedDestinationCode && state.homeScopedDeals !== null ? state.homeScopedDeals : state.deals;
  const items = source.filter((ticket) => {
    const haystack = normalizeSearch(`${ticket.destinationName} ${ticket.destinationCode} ${ticket.originName} ${ticket.originCode}`);
    const matchesSearch = state.homeSearchDestinationCode
      ? ticket.destinationCode === state.homeSearchDestinationCode
      : !query || haystack.split(' ').some((part) => part.startsWith(query)) || destinationCodes.has(ticket.destinationCode);
    return matchesSearch && (!filters.directOnly || ticket.isDirect)
      && (!filters.maxPrice || ticket.price <= filters.maxPrice) && (!filters.baggageRequired || ticket.hasBaggage);
  });
  if (state.homeSort === 'cheapest') return [...items].sort((left, right) => left.price - right.price || left.id - right.id);
  return items;
}
async function loadDealsForSearch(query) {
  const normalizedQuery = normalizeSearch(query); if (!normalizedQuery) return;
  const codes = [...searchDestinationCodes(normalizedQuery)].slice(0, 4);
  if (!codes.length) return;
  if (codes.length === 1) {
    state.homeScopedDestinationCode = codes[0]; await loadScopedDestinationDeals(codes[0]); return;
  }
  state.homeScopedDestinationCode = null; state.homeScopedDeals = null; state.homeScopedNextCursor = null;
  const missingCodes = codes.filter((code) => !state.deals.some((ticket) => ticket.destinationCode === code));
  if (!missingCodes.length) return;
  const results = await Promise.all(missingCodes.map((code) => api(`/api/v1/deals?sort=best&limit=20&destination=${encodeURIComponent(code)}`)));
  const ids = new Set(state.deals.map((ticket) => ticket.id));
  for (const result of results) for (const ticket of result.items) if (!ids.has(ticket.id)) { ids.add(ticket.id); state.deals.push(ticket); }
}
async function loadScopedDestinationDeals(destinationCode) {
  const result = await api(`/api/v1/deals?sort=${encodeURIComponent(state.homeSort)}&limit=20&destination=${encodeURIComponent(destinationCode)}`);
  if (state.homeScopedDestinationCode !== destinationCode) return;
  state.homeScopedDeals = result.items; state.homeScopedNextCursor = result.nextCursor;
}
async function loadCitySuggestions(query) {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) { state.homeSuggestions = []; state.homeSuggestionsQuery = ''; return; }
  const result = await api(`/api/v1/destinations?q=${encodeURIComponent(query)}&limit=8`);
  if (query !== state.homeSearch || state.homeSearchDestinationCode) return;
  state.homeSuggestions = result.items.filter((destination) => [destination.code, destination.name, ...(destination.searchNames ?? [])]
    .some((candidate) => normalizeSearch(candidate).startsWith(normalizedQuery)));
  state.homeSuggestionsQuery = query; state.homeSearchActiveIndex = -1;
}
function activeHomeFilterCount() {
  return Number(state.homeFilters.directOnly) + Number(Boolean(state.homeFilters.maxPrice)) + Number(state.homeFilters.baggageRequired);
}
function heroHistoryScale(ticket) {
  const score = ticket.dealScore ?? {}; const min = score.minPrice ?? ticket.price; const median = score.medianPrice ?? ticket.price; const max = score.maxPrice ?? ticket.price;
  const range = Math.max(1, max - min); const pricePosition = Math.max(4, Math.min(96, (ticket.price - min) / range * 100)); const medianPosition = Math.max(4, Math.min(96, (median - min) / range * 100));
  return `<div class="hero-price-scale"><span style="width:${pricePosition}%"></span><i style="left:${medianPosition}%"></i></div><div class="hero-scale-values"><span>${t('min')} ${formatPrice(min)}</span><span>${t('median')} ${formatPrice(median)}</span><span>${formatPrice(max)}</span></div>`;
}
function compactTicketRow(ticket) {
  const discount = percentBelow(ticket); const conditions = [ticket.isDirect ? t('directFlight') : t('connectionFlight'), ticket.hasBaggage ? t('baggageIncluded') : t('noBaggage')].join(' · ');
  return `<article class="compact-ticket-row"><button class="compact-ticket-main" type="button" data-ticket="${ticket.id}"><span><b>${escapeHtml(ticket.originName)} → ${escapeHtml(ticket.destinationName)}</b><small>${formatDate(ticket.departureDate)} · ${conditions}</small></span><strong>${formatPrice(ticket.price)}<small>${discount ? t('belowUsual', { value: discount }) : t('fewHistory')}</small></strong></button><button class="compact-row-bell" type="button" data-track="${ticket.id}" aria-label="${t('trackRoute')} ${escapeHtml(ticket.destinationName)}">${icon('bell')}</button></article>`;
}
function homeSearchAndFilters() {
  const filters = state.homeFilters; const filterCount = activeHomeFilterCount();
  const showSuggestions = !state.homeSearchDestinationCode && state.homeSearch && state.homeSuggestionsQuery === state.homeSearch && state.homeSuggestions.length > 0;
  const suggestions = showSuggestions ? `<div id="city-suggestions" class="city-suggestions" role="listbox">${state.homeSuggestions.map((destination, index) => `<button id="city-option-${index}" class="city-suggestion ${index === state.homeSearchActiveIndex ? 'active' : ''}" type="button" role="option" aria-selected="${index === state.homeSearchActiveIndex}" data-search-city="${escapeHtml(destination.code)}" data-search-name="${escapeHtml(destination.name)}"><span><b>${escapeHtml(destination.name)}</b><small>${escapeHtml(destination.code)}</small></span>${icon('chevron-left')}</button>`).join('')}</div>` : '';
  return `<div class="home-search-row"><div class="home-search-wrap"><label class="home-search">${icon('search')}<input id="deal-search" type="search" value="${escapeHtml(state.homeSearch)}" placeholder="${t('searchPlaceholder')}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="city-suggestions" aria-expanded="${showSuggestions}"${state.homeSearchActiveIndex >= 0 ? ` aria-activedescendant="city-option-${state.homeSearchActiveIndex}"` : ''}></label>${suggestions}</div><button id="filter-deals" class="home-filter-button" type="button" aria-label="${t('filters')}">${icon('adjustments')}${filterCount ? `<b>${filterCount}</b>` : ''}</button></div><div class="quick-filter-row"><button id="origin-pill" class="filter-chip origin-filter" type="button">${t('from', { city: originName(state.profile.defaultOriginCode) })} ${icon('chevron-left')}</button><button class="filter-chip ${filters.directOnly ? 'active' : ''}" type="button" data-quick-filter="directOnly">${t('direct')}</button><button class="filter-chip ${filters.maxPrice ? 'active' : ''}" type="button" data-quick-filter="maxPrice">${t('upTo2m')}</button><button class="filter-chip ${filters.baggageRequired ? 'active' : ''}" type="button" data-quick-filter="baggageRequired">${t('withBaggage')}</button></div>`;
}

function renderHome() {
  if (state.sessionExpired) { renderSessionExpired(); return; }
  applyDocumentLanguage(); state.screen = 'tabs'; showTabs(true); setActiveNav(); const visibleDeals = filteredDeals(); const hero = visibleDeals[0];
  if (!hero) {
    content.innerHTML = `<section class="screen home-screen">${homeSearchAndFilters()}<div class="empty-state home-empty"><span class="state-icon">${icon('ticket')}</span><div class="state-title">${t('noSearchResults')}</div><div class="state-copy">${t('changeSearch')}</div><button id="reset-home-filters" class="secondary state-action" type="button">${t('resetFilters')}</button></div></section>`;
    bindHomeControls(); return;
  }
  const discount = percentBelow(hero); const movers = visibleDeals.slice(1, 2); const listDeals = visibleDeals.slice(1);
  const sampleDays = hero.dealScore?.sampleDays ?? 30;
  const scopedResult = state.homeScopedDestinationCode && state.homeScopedDeals !== null;
  const nextCursor = scopedResult ? state.homeScopedNextCursor : state.dealsNextCursor;
  const loadingMore = scopedResult ? state.homeScopedLoadingMore : state.dealsLoadingMore;
  const dayWord = sampleDays % 10 === 1 && sampleDays % 100 !== 11 ? 'день' : sampleDays % 10 >= 2 && sampleDays % 10 <= 4 && (sampleDays % 100 < 12 || sampleDays % 100 > 14) ? 'дня' : 'дней';
  const dayLabel = language() === 'uz' ? `${sampleDays} kun` : `${sampleDays} ${dayWord}`;
  content.innerHTML = `<section class="screen home-screen">${homeSearchAndFilters()}<article class="hero-card featured-hero"><div class="hero-label"><span>${t('bestNow')}</span>${discount ? `<b>${icon('flame')} ${t('belowUsual', { value: discount })}</b>` : ''}</div><button class="hero-main compact-hero" type="button" data-ticket="${hero.id}"><span><b>${escapeHtml(hero.originName)} → ${escapeHtml(hero.destinationName)}</b><small>${dateRange(hero)}</small></span><strong>${formatPrice(hero.price)} <small>${escapeHtml(hero.currencyCode)}</small></strong></button><p class="price-caption">${t('routePrices', { days: dayLabel })}</p>${heroHistoryScale(hero)}<div class="hero-actions"><button class="ghost-button primary-ghost" type="button" data-ticket="${hero.id}">${icon('ticket')} ${t('openTicket')}</button><button class="bell-button" type="button" data-track="${hero.id}" aria-label="${t('trackRoute')}">${icon('bell')}</button></div></article>${movers.length ? `<div class="section-heading mover-heading"><h2>${t('cheaper3days')}</h2><button id="more-movers" type="button">${t('more', { count: Math.max(0, visibleDeals.length - 1) })} ${icon('chevron-left')}</button></div><div class="mover-list compact-mover-list">${movers.map(moverRow).join('')}</div>` : ''}<div class="section-heading compact-ticket-heading"><h2>${t('allHotTickets')}</h2><button id="sort-deals" type="button">${state.homeSort === 'best' ? t('sortBest') : t('sortPrice')}</button></div>${listDeals.length ? `<div id="all-hot-tickets" class="compact-ticket-list">${listDeals.map(compactTicketRow).join('')}</div>` : `<div class="compact-list-empty">${t('noOtherTickets')}</div>`}${nextCursor ? `<button id="load-more-deals" class="secondary load-more-deals" type="button" ${loadingMore ? 'disabled' : ''}>${loadingMore ? t('loading') : t('showMore')}</button>` : ''}</section>`;
  bindTicketButtons(); document.querySelectorAll('[data-track]').forEach((button) => button.addEventListener('click', () => openTracking(Number(button.dataset.track))));
  document.querySelector('#more-movers')?.addEventListener('click', () => document.querySelector('#all-hot-tickets')?.scrollIntoView({ behavior: 'smooth' }));
  document.querySelector('#sort-deals')?.addEventListener('click', async () => {
    state.homeSort = state.homeSort === 'best' ? 'cheapest' : 'best';
    if (state.homeScopedDestinationCode) {
      try { await loadScopedDestinationDeals(state.homeScopedDestinationCode); }
      catch (error) { showToast(error instanceof Error ? error.message : t('failedLoad')); }
    }
    renderHome();
  });
  document.querySelector('#load-more-deals')?.addEventListener('click', loadMoreDeals); bindHomeControls();
}

function bindHomeControls() {
  document.querySelector('#origin-pill')?.addEventListener('click', () => { state.view = 'profile'; void loadView(); });
  document.querySelector('#filter-deals')?.addEventListener('click', openDealsFilters);
  const searchInput = document.querySelector('#deal-search');
  searchInput?.addEventListener('input', (event) => {
    state.homeSearch = event.target.value; state.homeSearchDestinationCode = null; state.homeScopedDestinationCode = null;
    state.homeScopedDeals = null; state.homeScopedNextCursor = null;
    state.homeSearchActiveIndex = -1; globalThis.clearTimeout(state.homeSearchTimer);
    if (!normalizeSearch(state.homeSearch)) { state.homeSuggestions = []; state.homeSuggestionsQuery = ''; renderHome(); document.querySelector('#deal-search')?.focus(); return; }
    state.homeSearchTimer = globalThis.setTimeout(async () => {
      const query = state.homeSearch;
      try { await loadCitySuggestions(query); await loadDealsForSearch(query); } catch { /* Local filtering still works. */ }
      if (query !== state.homeSearch) return; renderHome(); const input = document.querySelector('#deal-search'); input?.focus(); input?.setSelectionRange(state.homeSearch.length, state.homeSearch.length);
    }, 180);
  });
  searchInput?.addEventListener('keydown', (event) => {
    const options = [...document.querySelectorAll('[data-search-city]')]; if (!options.length) return;
    if (event.key === 'Escape') { event.preventDefault(); state.homeSuggestions = []; state.homeSuggestionsQuery = ''; state.homeSearchActiveIndex = -1; renderHome(); document.querySelector('#deal-search')?.focus(); return; }
    if (event.key === 'Enter') { const option = options[Math.max(0, state.homeSearchActiveIndex)]; if (option) { event.preventDefault(); option.click(); } return; }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault(); const direction = event.key === 'ArrowDown' ? 1 : -1;
    state.homeSearchActiveIndex = (state.homeSearchActiveIndex + direction + options.length) % options.length;
    options.forEach((option, index) => { option.classList.toggle('active', index === state.homeSearchActiveIndex); option.setAttribute('aria-selected', String(index === state.homeSearchActiveIndex)); });
    searchInput.setAttribute('aria-activedescendant', `city-option-${state.homeSearchActiveIndex}`);
  });
  document.querySelectorAll('[data-search-city]').forEach((button) => button.addEventListener('click', async () => {
    state.homeSearch = button.dataset.searchName; state.homeSearchDestinationCode = button.dataset.searchCity;
    state.homeScopedDestinationCode = button.dataset.searchCity; state.homeScopedDeals = null; state.homeScopedNextCursor = null;
    state.homeSuggestions = []; state.homeSuggestionsQuery = ''; state.homeSearchActiveIndex = -1; haptic();
    try { await loadScopedDestinationDeals(button.dataset.searchCity); }
    catch (error) { showToast(error instanceof Error ? error.message : t('failedLoad')); }
    renderHome();
  }));
  document.querySelectorAll('[data-quick-filter]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.quickFilter; state.homeFilters[key] = key === 'maxPrice' ? (state.homeFilters.maxPrice ? null : 2_000_000) : !state.homeFilters[key]; haptic(); renderHome();
  }));
  document.querySelector('#reset-home-filters')?.addEventListener('click', () => { state.homeSearch = ''; state.homeSearchDestinationCode = null; state.homeScopedDestinationCode = null; state.homeScopedDeals = null; state.homeScopedNextCursor = null; state.homeSuggestions = []; state.homeSuggestionsQuery = ''; state.homeFilters = { directOnly: false, maxPrice: null, baggageRequired: false }; renderHome(); });
}

async function refreshDeals() {
  try {
    if (state.homeScopedDestinationCode) await loadScopedDestinationDeals(state.homeScopedDestinationCode);
    else { const result = await api('/api/v1/deals?sort=best&limit=20'); state.deals = result.items; state.dealsNextCursor = result.nextCursor; }
    haptic(); renderHome(); showToast(t('pricesUpdated'));
  }
  catch (error) { showToast(error instanceof Error ? error.message : t('failedRefresh')); }
}
async function loadMoreDeals() {
  const scopedResult = state.homeScopedDestinationCode && state.homeScopedDeals !== null;
  const nextCursor = scopedResult ? state.homeScopedNextCursor : state.dealsNextCursor;
  if ((scopedResult ? state.homeScopedLoadingMore : state.dealsLoadingMore) || !nextCursor) return;
  const scrollTop = globalThis.scrollY;
  if (scopedResult) state.homeScopedLoadingMore = true; else state.dealsLoadingMore = true;
  renderHome();
  try {
    const destination = scopedResult ? `&destination=${encodeURIComponent(state.homeScopedDestinationCode)}` : '';
    const result = await api(`/api/v1/deals?sort=${encodeURIComponent(scopedResult ? state.homeSort : 'best')}&limit=20&cursor=${encodeURIComponent(nextCursor)}${destination}`);
    const target = scopedResult ? state.homeScopedDeals : state.deals; const ids = new Set(target.map((ticket) => ticket.id));
    target.push(...result.items.filter((ticket) => !ids.has(ticket.id)));
    if (scopedResult) state.homeScopedNextCursor = result.nextCursor; else state.dealsNextCursor = result.nextCursor;
  } catch (error) { showToast(error instanceof Error ? error.message : t('failedLoad')); }
  finally {
    if (scopedResult) state.homeScopedLoadingMore = false; else state.dealsLoadingMore = false;
    renderHome(); globalThis.requestAnimationFrame(() => globalThis.scrollTo({ top: scrollTop }));
  }
}
function moverRow(ticket) {
  const median = ticket.dealScore?.medianPrice ?? ticket.price; const advantage = Math.max(0, median - ticket.price);
  return `<article class="mover-row featured-mover"><button class="mover-main" type="button" data-ticket="${ticket.id}"><span class="mover-route"><b>${escapeHtml(ticket.destinationName)} <em>· ${ticket.destinationCode}</em></b><small>${advantage ? t('belowUsualAmount', { amount: formatPrice(advantage) }) : `${ticket.originCode} → ${ticket.destinationCode}`}</small></span><span class="mover-price"><small>${t('bestPrice')}</small><b>${formatPrice(ticket.price)}</b></span></button><button class="row-bell" type="button" data-track="${ticket.id}" aria-label="${t('trackRoute')}">${icon('bell')}</button></article>`;
}
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
  if (state.sessionExpired) { renderSessionExpired(); return; }
  applyDocumentLanguage(); const ticket = state.selectedTicket; const discount = percentBelow(ticket);
  content.innerHTML = `<section class="screen detail-screen"><header class="detail-top"><button id="back-detail" class="back-button" type="button" aria-label="Назад">${icon('chevron-left')}</button><button id="share-ticket" class="text-button" type="button">${icon('arrow-up-right')} ${t('sendToChat')}</button></header><div class="detail-route">${ticket.originCode} → ${ticket.destinationCode}</div><h1>${escapeHtml(ticket.originName)} → ${escapeHtml(ticket.destinationName)}</h1><div class="detail-price">${formatPrice(ticket.price)} <small>${escapeHtml(ticket.currencyCode)}</small></div>${discount ? `<div class="deal-pill">${t('belowUsual', { value: discount })}</div>` : ''}<div class="updated">${t('updatedRecently')}</div><article class="panel chart-panel"><div class="panel-title-row"><div><h2>${t('routePricesTitle')}</h2><p>${ticket.originCode} → ${ticket.destinationCode}</p></div><div class="range-tabs">${[7, 30, 90].map((days) => `<button class="range-button ${state.historyRange === days ? 'active' : ''}" type="button" data-range="${days}">${days}${language() === 'uz' ? 'k' : 'д'}</button>`).join('')}</div></div><canvas id="price-chart" class="chart-canvas" width="650" height="230"></canvas>${historyScale(ticket)}<div class="percentile-copy">${t('lowPriceCopy', { days: state.historyRange })}</div></article><article class="panel"><h2 class="panel-heading">${t('ticketDetails')}</h2><div class="info-row"><span>${t('dates')}</span><b>${dateRange(ticket)}</b></div><div class="info-row"><span>${t('flight')}</span><b>${ticket.isDirect ? t('direct') : t('withConnection')}</b></div><div class="info-row"><span>${t('baggage')}</span><b>${ticket.hasBaggage ? t('included') : t('notIncluded')}</b></div><div class="info-row"><span>${t('class')}</span><b>${className(ticket.tripClass)}</b></div><div class="info-row"><span>${t('airline')}</span><b>${escapeHtml(ticket.airlineName ?? '—')}</b></div></article><button id="track-detail" class="secondary" type="button">${icon('bell')} ${t('track')}</button></section><div class="purchase-bar"><a class="primary" href="${escapeHtml(ticket.openUrl)}" target="_blank" rel="noopener">${t('buyFor', { price: formatPrice(ticket.price), currency: ticket.currencyCode })}</a></div>`;
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
  const form = state.sheetForm; const destination = state.destinations.find((item) => item.code === form.destinationCode); const name = destination?.name ?? form.destinationCode ?? t('direction');
  const maxRange = Math.max(form.sourcePrice ?? form.maxPrice ?? 3_000_000, form.maxPrice ?? 0);
  const minRange = Math.max(10_000, Math.round(maxRange * .5 / 10_000) * 10_000);
  sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-title-row"><div><h2>${form.id ? t('editTracking', { name: escapeHtml(name) }) : t('followTracking', { name: escapeHtml(name) })}</h2><p>${t('trackingHelp')}</p></div><button id="close-sheet" class="icon-button sheet-close" type="button" aria-label="Закрыть">${icon('x')}</button></div><div class="form-label">${t('whenFly')}</div><div class="preset-row"><button class="choice ${form.preset === '90' ? 'active' : ''}" type="button" data-preset="90">${t('next90')}</button><button class="choice ${form.preset === 'september' ? 'active' : ''}" type="button" data-preset="september">${t('september')}</button><button class="choice ${form.preset === 'custom' ? 'active' : ''}" type="button" data-preset="custom">${t('customDates')}</button></div>${form.preset === 'custom' ? `<div class="form-grid"><label><span class="form-label">${t('fromDate')}</span><input id="track-from" type="date" value="${form.departureDateFrom}"></label><label><span class="form-label">${t('toDate')}</span><input id="track-to" type="date" value="${form.departureDateTo}"></label></div>` : ''}<div class="price-row"><span>${t('priceTo')}</span><b id="track-price-label">${formatPrice(form.maxPrice ?? maxRange)} UZS</b></div><input id="track-price" class="price-range" type="range" min="${minRange}" max="${maxRange}" step="10000" value="${form.maxPrice ?? maxRange}">${form.sourcePrice ? `<p class="field-help">${t('tenBelow', { price: formatPrice(form.sourcePrice) })}</p>` : ''}<div class="toggle-card"><div class="toggle-row"><span><b>${t('directOnlyFlights')}</b><small>${t('noConnections')}</small></span><button class="switch ${form.directOnly ? 'active' : ''}" type="button" data-form-toggle="directOnly"></button></div><div class="toggle-row"><span><b>${t('needBaggage')}</b><small>${t('baggageHelp')}</small></span><button class="switch ${form.baggageRequired ? 'active' : ''}" type="button" data-form-toggle="baggageRequired"></button></div></div><button id="advanced-toggle" class="advanced-toggle" type="button">${t('advanced')} <span>${form.expanded ? '−' : '+'}</span></button>${form.expanded ? `<div class="advanced-panel"><div class="segments"><button class="segment ${form.tripClass === 'economy' ? 'active' : ''}" type="button" data-form-class="economy">${t('economy')}</button><button class="segment ${form.tripClass === 'business' ? 'active' : ''}" type="button" data-form-class="business">${t('business')}</button></div><div class="toggle-row"><span><b>${t('roundTrip')}</b></span><button class="switch ${form.roundTripOnly ? 'active' : ''}" type="button" data-form-toggle="roundTripOnly"></button></div></div>` : `<p class="advanced-summary">${t('economySummary')}</p>`}<button id="save-tracking" class="primary sheet-primary" type="button">${form.id ? t('saveChanges') : `${icon('bell')} ${t('followPrice')}`}</button>${form.id ? `<button id="disable-tracking" class="danger-link" type="button">${t('disableTracking')}</button>` : ''}`;
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
  const form = state.sheetForm; if (!form.destinationCode || !form.departureDateFrom || !form.departureDateTo || form.departureDateTo < form.departureDateFrom) { showToast(t('invalidRouteDates')); return; }
  const body = { destinationCode: form.destinationCode, departureDateFrom: form.departureDateFrom, departureDateTo: form.departureDateTo, maxPrice: form.maxPrice, directOnly: form.directOnly, roundTripOnly: form.roundTripOnly, baggageRequired: form.baggageRequired, tripClass: form.tripClass };
  try { await api(form.id ? `/api/v1/subscriptions/${form.id}` : '/api/v1/subscriptions', { method: form.id ? 'PATCH' : 'POST', body: JSON.stringify(body) }); state.subscriptions = (await api('/api/v1/subscriptions')).items.filter((item) => item.isActive); closeSheet(); haptic('medium'); showToast(form.id ? t('changesSaved') : t('trackingEnabled')); if (state.view === 'watchlist') renderWatchlist(); else setActiveNav(); }
  catch (error) { showToast(error instanceof Error ? error.message : t('saveFailed')); }
}
async function disableTracking() {
  try { const id = state.sheetForm.id; await api(`/api/v1/subscriptions/${id}`, { method: 'DELETE' }); state.subscriptions = state.subscriptions.filter((item) => item.id !== id); closeSheet(); showToast(t('trackingDisabled')); renderWatchlist(); }
  catch (error) { showToast(error.message); }
}

function renderWatchlist() {
  if (state.sessionExpired) { renderSessionExpired(); return; }
  applyDocumentLanguage(); state.screen = 'tabs'; showTabs(true); setActiveNav(); const active = state.subscriptions.filter((item) => item.isActive);
  content.innerHTML = `<section class="screen"><header class="watch-head"><div><div class="brand">${t('watchlist')}</div><h1>${t('myTracking')}</h1><p>${t('trackingCount', { count: active.length })}</p></div></header>${active.length ? `<div class="watch-list">${active.map(watchCard).join('')}</div>` : `<div class="empty-state"><span class="state-icon">${icon('bell')}</span><div class="state-title">${t('noRoutes')}</div><div class="state-copy">${t('noRoutesHelp')}</div></div>`}<div class="section-heading compact"><div><h2>${t('popularTracking')}</h2><p>${t('popularFrom')}</p></div></div><div class="suggestion-grid">${state.destinations.slice(0, 4).map((item) => `<button class="suggestion" type="button" data-add-destination="${item.code}"><b>${escapeHtml(item.name)}</b><small>${state.profile.defaultOriginCode} → ${item.code}</small>${icon('plus')}</button>`).join('')}</div><button id="custom-route" class="add-watch" type="button">${icon('plus')} ${t('customRoute')}</button></section>`;
  document.querySelectorAll('[data-edit-watch]').forEach((button) => button.addEventListener('click', () => openTracking(null, '', active.find((item) => item.id === Number(button.dataset.editWatch)))));
  document.querySelectorAll('[data-current-ticket]').forEach((button) => button.addEventListener('click', () => void openTicket(Number(button.dataset.currentTicket), Number(button.dataset.subscriptionId))));
  document.querySelectorAll('[data-add-destination]').forEach((button) => button.addEventListener('click', () => openTracking(null, button.dataset.addDestination)));
  document.querySelector('#custom-route')?.addEventListener('click', openRoutePicker);
}
function watchCard(subscription) {
  const destination = state.destinations.find((item) => item.code === subscription.destinationCode); const current = subscription.currentTicket ?? null; const reached = current && ticketMatches(current, subscription, true); const progress = current && subscription.maxPrice ? Math.max(0, Math.min(100, subscription.maxPrice / current.price * 100)) : 0;
  const conditions = [className(subscription.tripClass), subscription.directOnly ? t('directFlight') : t('transfersAllowed'), subscription.baggageRequired ? t('baggageIncluded') : t('baggageOptional'), subscription.roundTripOnly ? t('roundTrip') : null].filter(Boolean).join(' · ');
  return `<article class="watch-card"><div class="watch-top"><div><div class="route-code">${subscription.originCode} → ${subscription.destinationCode}</div><h2>${escapeHtml(originName(subscription.originCode))} → ${escapeHtml(destination?.name ?? subscription.destinationCode)}</h2></div><span class="status-pill">${t('activeStatus')}</span></div><p class="watch-dates">${formatDate(subscription.departureDateFrom)} — ${formatDate(subscription.departureDateTo)} · ${escapeHtml(conditions)}</p><div class="watch-prices"><span><small>${t('yourGoal')}</small><b>${subscription.maxPrice ? `${formatPrice(subscription.maxPrice)} UZS` : t('anyPrice')}</b></span><span><small>${t('currentFrom')}</small><b>${current ? `${formatPrice(current.price)} UZS` : t('noTickets')}</b></span></div>${current && subscription.maxPrice ? `<div class="goal-track"><span style="width:${progress}%"></span></div><p class="goal-copy ${reached ? 'reached' : ''}">${reached ? t('goalReached') : t('needMore', { amount: formatPrice(Math.max(0, current.price - subscription.maxPrice)) })}</p>` : `<p class="goal-copy">${t('keepSearching')}</p>`}<div class="watch-actions">${current ? `<button class="ghost-button" type="button" data-current-ticket="${current.id}" data-subscription-id="${subscription.id}">${t('openTicket')}</button>` : '<span></span>'}<button class="small-action" type="button" data-edit-watch="${subscription.id}">${t('settingsAction')}</button></div></article>`;
}
function openDealsFilters() {
  const filters = state.homeFilters;
  sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-title-row"><div><h2>${t('filterTitle')}</h2><p>${t('filterHelp')}</p></div><button id="close-sheet" class="icon-button sheet-close" type="button" aria-label="Закрыть">${icon('x')}</button></div><div class="toggle-card deal-filter-card"><div class="toggle-row"><span><b>${t('onlyDirect')}</b><small>${t('noConnections')}</small></span><button class="switch ${filters.directOnly ? 'active' : ''}" type="button" data-deal-filter="directOnly" aria-pressed="${filters.directOnly}"></button></div><div class="toggle-row"><span><b>${t('limit2m')}</b><small>${t('limitHelp')}</small></span><button class="switch ${filters.maxPrice ? 'active' : ''}" type="button" data-deal-filter="maxPrice" aria-pressed="${Boolean(filters.maxPrice)}"></button></div><div class="toggle-row"><span><b>${t('withBaggage')}</b><small>${t('baggageHelp')}</small></span><button class="switch ${filters.baggageRequired ? 'active' : ''}" type="button" data-deal-filter="baggageRequired" aria-pressed="${filters.baggageRequired}"></button></div></div><button id="apply-deal-filters" class="primary sheet-primary" type="button">${t('showTickets')}</button><button id="clear-deal-filters" class="danger-link" type="button">${t('resetFilters')}</button>`;
  sheet.classList.remove('hidden'); backdrop.classList.remove('hidden'); document.querySelector('#close-sheet')?.addEventListener('click', closeSheet);
  sheet.querySelectorAll('[data-deal-filter]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.dealFilter; filters[key] = key === 'maxPrice' ? (filters.maxPrice ? null : 2_000_000) : !filters[key]; openDealsFilters();
  }));
  document.querySelector('#apply-deal-filters')?.addEventListener('click', () => { closeSheet(); renderHome(); });
  document.querySelector('#clear-deal-filters')?.addEventListener('click', () => { state.homeFilters = { directOnly: false, maxPrice: null, baggageRequired: false }; closeSheet(); renderHome(); });
}
function openRoutePicker() {
  sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-title-row"><div><h2>${t('chooseDirection')}</h2><p>${t('originFrom', { city: originName(state.profile.defaultOriginCode) })}</p></div><button id="close-sheet" class="icon-button sheet-close" type="button">${icon('x')}</button></div><div class="route-picker">${state.destinations.map((item) => `<button type="button" data-pick-route="${item.code}"><span><b>${escapeHtml(item.name)}</b><small>${state.profile.defaultOriginCode} → ${item.code}</small></span>${icon('plus')}</button>`).join('')}</div>`;
  sheet.classList.remove('hidden'); backdrop.classList.remove('hidden'); document.querySelector('#close-sheet')?.addEventListener('click', closeSheet);
  sheet.querySelectorAll('[data-pick-route]').forEach((button) => button.addEventListener('click', () => openTracking(null, button.dataset.pickRoute)));
}

function renderProfile() {
  if (state.sessionExpired) { renderSessionExpired(); return; }
  applyDocumentLanguage(); state.screen = 'tabs'; showTabs(true); setActiveNav(); const user = state.profile; const title = user.firstName ?? user.username ?? t('user'); const active = state.subscriptions.filter((item) => item.isActive).length;
  const savings = user.trackedSavings?.amount ?? 0;
  content.innerHTML = `<section class="screen profile-screen"><header><div class="brand">${t('profile')}</div><h1>${t('settings')}</h1></header><div class="profile-person"><div class="avatar">${escapeHtml(title.slice(0, 1).toUpperCase())}</div><div><div class="profile-name">${escapeHtml(title)}</div><div class="profile-source">${user.username ? `@${escapeHtml(user.username)}` : t('telegramAccount')}</div></div></div><div class="profile-stats"><span><b>${active}</b><small>${t('active')}</small></span><span><b>${formatPrice(savings)}</b><small>${t('potentialSavings')}</small></span></div><div class="section-label">${t('searchSettings')}</div><div class="settings-list"><button type="button" data-profile-sheet="origin"><span>${t('originCity')}</span><b>${escapeHtml(originName(user.defaultOriginCode))}</b></button><button type="button" data-profile-sheet="class"><span>${t('class')}</span><b>${className(user.preferredTripClass)}</b></button><div class="toggle-row"><span><b>${t('defaultBaggage')}</b><small>${t('newTracking')}</small></span><button class="switch ${user.baggageRequired ? 'active' : ''}" type="button" data-profile-toggle="baggageRequired"></button></div></div><div class="section-label">${t('notifications')}</div><div class="settings-list"><div class="toggle-row"><span><b>${t('instantDrop')}</b><small>${t('instantDropHelp')}</small></span><button class="switch ${user.instantNotificationsEnabled ? 'active' : ''}" type="button" data-profile-toggle="instantNotificationsEnabled"></button></div><div class="toggle-row"><span><b>${t('morningDigest')}</b><small>${t('digestHelp')}</small></span><button class="switch ${user.morningDigestEnabled ? 'active' : ''}" type="button" data-profile-toggle="morningDigestEnabled"></button></div><div class="toggle-row"><span><b>${t('quietHours')}</b><small>${minutesToTime(user.quietStartMinute)} — ${minutesToTime(user.quietEndMinute)}</small></span><button class="switch ${user.quietHoursEnabled ? 'active' : ''}" type="button" data-profile-toggle="quietHoursEnabled"></button></div><button type="button" data-profile-sheet="quiet"><span>${t('quietPeriod')}</span><b>${minutesToTime(user.quietStartMinute)} — ${minutesToTime(user.quietEndMinute)}</b></button></div><button id="share-app" class="share-card" type="button"><span class="cta-icon">${icon('arrow-up-right')}</span><span><b>${t('shareFriends')}</b><small>${t('invited', { count: user.referralCount ?? 0 })}</small></span></button><div class="section-label">${t('language')}</div><div class="segments"><button class="segment ${user.languageCode === 'ru' ? 'active' : ''}" type="button" data-profile-language="ru">Русский</button><button class="segment ${user.languageCode === 'uz' ? 'active' : ''}" type="button" data-profile-language="uz">O‘zbekcha</button></div><p class="autosave-copy">${t('autosave')}</p></section>`;
  document.querySelectorAll('[data-profile-toggle]').forEach((button) => button.addEventListener('click', () => void saveProfileField(button.dataset.profileToggle, !user[button.dataset.profileToggle])));
  document.querySelectorAll('[data-profile-language]').forEach((button) => button.addEventListener('click', () => void saveProfileField('languageCode', button.dataset.profileLanguage)));
  document.querySelectorAll('[data-profile-sheet]').forEach((button) => button.addEventListener('click', () => openProfileSheet(button.dataset.profileSheet)));
  document.querySelector('#share-app')?.addEventListener('click', () => shareText('Hot Ticket следит за маршрутами и находит выгодные авиабилеты.', user.referralShareUrl ?? `${globalThis.location.origin}/app/`));
}
async function saveProfileField(key, value) {
  const previous = state.profile[key]; state.profile[key] = value; renderProfile();
  try {
    state.profile = await api('/api/v1/me', { method: 'PATCH', body: JSON.stringify({ [key]: value }) });
    if (key === 'languageCode') {
      applyDocumentLanguage(); const [deals, destinations, subscriptions] = await Promise.all([api('/api/v1/deals?sort=best&limit=20'), api('/api/v1/destinations'), api('/api/v1/subscriptions')]);
      state.deals = deals.items; state.dealsNextCursor = deals.nextCursor; state.destinations = destinations.items; state.subscriptions = subscriptions.items.filter((item) => item.isActive);
      state.homeSearch = ''; state.homeSearchDestinationCode = null; state.homeScopedDestinationCode = null;
      state.homeScopedDeals = null; state.homeScopedNextCursor = null;
      state.homeSuggestions = []; state.homeSuggestionsQuery = ''; renderProfile();
    }
    haptic(); showToast(t('saved'));
  }
  catch (error) { state.profile[key] = previous; renderProfile(); showToast(error instanceof Error ? error.message : 'Не удалось сохранить'); }
}
function openProfileSheet(kind) {
  if (kind === 'origin') sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-title-row"><div><h2>${t('originCity')}</h2><p>${t('newTracking')}</p></div><button id="close-sheet" class="icon-button sheet-close" type="button">${icon('x')}</button></div><div class="route-picker">${Object.keys(originNames).map((code) => `<button type="button" data-profile-value="${code}"><span><b>${originName(code)}</b><small>${code}</small></span>${state.profile.defaultOriginCode === code ? icon('check') : ''}</button>`).join('')}</div>`;
  else if (kind === 'class') sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-title-row"><div><h2>${t('defaultClass')}</h2><p>${t('newTracking')}</p></div><button id="close-sheet" class="icon-button sheet-close" type="button">${icon('x')}</button></div><div class="route-picker"><button type="button" data-profile-value="economy"><span><b>${t('economy')}</b><small>${t('moreTickets')}</small></span></button><button type="button" data-profile-value="business"><span><b>${t('business')}</b><small>${t('comfort')}</small></span></button></div>`;
  else sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-title-row"><div><h2>${t('quietHours')}</h2><p>${t('quietHelp')}</p></div><button id="close-sheet" class="icon-button sheet-close" type="button">${icon('x')}</button></div><div class="form-grid"><label><span class="form-label">${t('fromTime')}</span><input id="quiet-start" type="time" value="${minutesToTime(state.profile.quietStartMinute)}"></label><label><span class="form-label">${t('toTime')}</span><input id="quiet-end" type="time" value="${minutesToTime(state.profile.quietEndMinute)}"></label></div><button id="save-quiet" class="primary" type="button">${t('savePeriod')}</button>`;
  sheet.classList.remove('hidden'); backdrop.classList.remove('hidden'); document.querySelector('#close-sheet')?.addEventListener('click', closeSheet);
  sheet.querySelectorAll('[data-profile-value]').forEach((button) => button.addEventListener('click', async () => { await saveProfileField(kind === 'origin' ? 'defaultOriginCode' : 'preferredTripClass', button.dataset.profileValue); closeSheet(); }));
  document.querySelector('#save-quiet')?.addEventListener('click', async () => { const start = timeToMinutes(document.querySelector('#quiet-start').value); const end = timeToMinutes(document.querySelector('#quiet-end').value); try { state.profile = await api('/api/v1/me', { method: 'PATCH', body: JSON.stringify({ quietStartMinute: start, quietEndMinute: end }) }); closeSheet(); renderProfile(); showToast(t('periodSaved')); } catch (error) { showToast(error.message); } });
}
function shareText(text, url) {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (telegram?.openTelegramLink) telegram.openTelegramLink(shareUrl); else globalThis.open(shareUrl, '_blank', 'noopener');
}

async function bootstrap() {
  loading();
  try {
    const [profile, deals, destinations, subscriptions] = await Promise.all([api('/api/v1/me'), api('/api/v1/deals?sort=best&limit=20'), api('/api/v1/destinations'), api('/api/v1/subscriptions')]);
    state.profile = profile; state.deals = deals.items; state.dealsNextCursor = deals.nextCursor; state.destinations = destinations.items; state.subscriptions = subscriptions.items.filter((item) => item.isActive); renderHome();
  } catch (error) { errorScreen(error, bootstrap); }
}
async function loadView() { setActiveNav(); if (state.view === 'watchlist') renderWatchlist(); else if (state.view === 'profile') renderProfile(); else renderHome(); }

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { state.view = button.dataset.view; state.screen = 'tabs'; haptic(); void loadView(); }));
let pullStartY = null;
content.addEventListener('touchstart', (event) => { if (globalThis.scrollY <= 0 && state.view === 'home' && state.screen === 'tabs') pullStartY = event.touches[0]?.clientY ?? null; }, { passive: true });
content.addEventListener('touchend', (event) => { const endY = event.changedTouches[0]?.clientY ?? null; if (pullStartY !== null && endY !== null && endY - pullStartY > 70) void refreshDeals(); pullStartY = null; }, { passive: true });
backdrop.addEventListener('click', closeSheet); telegram?.BackButton?.onClick?.(() => { if (!sheet.classList.contains('hidden')) closeSheet(); else backToTabs(); });
if (!demoMode && !telegram?.initData) { showTabs(false); content.innerHTML = `<section class="screen locked-state"><span class="state-icon">${icon('ticket')}</span><div class="state-title">Откройте Hot Ticket из Telegram</div><div class="state-copy">Mini App использует Telegram для безопасного входа.</div></section>`; }
else { applyTelegramChrome(); telegram?.ready(); telegram?.expand(); void bootstrap(); }
