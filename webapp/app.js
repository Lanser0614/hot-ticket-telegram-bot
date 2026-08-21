const telegram = globalThis.Telegram?.WebApp;
const content = document.querySelector('#content');
const bottomNav = document.querySelector('#bottom-nav');
const filterSheet = document.querySelector('#filter-sheet');
const sheetBackdrop = document.querySelector('#sheet-backdrop');
const toast = document.querySelector('#toast');
const watchDot = document.querySelector('#watch-dot');
const demoMode = globalThis.location.protocol === 'file:'
  || ['127.0.0.1', 'localhost'].includes(globalThis.location.hostname);

const state = {
  view: 'deals',
  screen: 'tabs',
  destinations: [],
  deals: [],
  subscriptions: [],
  profile: null,
  selectedTicket: null,
  history: [],
  historyRange: 30,
  filters: { destination: '', maxPrice: '', direct: false, baggage: false, sort: 'best' },
  form: null,
  formError: '',
  toastTimer: null
};

const sortLabels = {
  best: 'Выгодные',
  cheapest: 'Дешёвые',
  recent: 'Недавние',
  departing_soon: 'Скоро вылет'
};

const demoHistory = [
  2_390_000, 2_210_000, 2_150_000, 2_080_000, 1_990_000, 2_040_000,
  1_970_000, 1_910_000, 1_860_000, 1_920_000, 1_980_000, 1_890_000,
  1_820_000, 1_790_000, 1_750_000, 1_700_000, 1_680_000, 1_650_000,
  1_600_000, 1_580_000, 1_550_000, 1_520_000, 1_500_000, 1_480_000
];

const demoDeals = [
  {
    id: 1,
    originCode: 'TAS', originName: 'Ташкент', destinationCode: 'IST', destinationName: 'Стамбул',
    departureDate: '2026-09-12', returnDate: '2026-09-16', price: 1_480_000, currencyCode: 'UZS',
    airlineName: 'Turkish Airlines', isDirect: true, tripClass: 'economy', hasBaggage: true,
    lastSeenAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    dealScore: { level: 'lowest', sampleDays: 24, percentile: 100, daysBelow: 0, minPrice: 1_450_000, medianPrice: 1_920_000, maxPrice: 2_390_000, trend: 'falling' },
    openUrl: 'https://www.aviasales.uz/search/TAS1209IST16091'
  },
  {
    id: 2,
    originCode: 'TAS', originName: 'Ташкент', destinationCode: 'DXB', destinationName: 'Дубай',
    departureDate: '2026-09-14', returnDate: null, price: 2_100_000, currencyCode: 'UZS',
    airlineName: 'flydubai', isDirect: false, tripClass: 'economy', hasBaggage: false,
    lastSeenAt: new Date(Date.now() - 22 * 60_000).toISOString(),
    dealScore: { level: 'good', sampleDays: 15, percentile: 82, daysBelow: 2, minPrice: 2_100_000, medianPrice: 2_380_000, maxPrice: 2_600_000, trend: 'falling' },
    openUrl: 'https://www.aviasales.uz/search/TAS1409DXB1'
  },
  {
    id: 3,
    originCode: 'TAS', originName: 'Ташкент', destinationCode: 'ALA', destinationName: 'Алматы',
    departureDate: '2026-09-18', returnDate: null, price: 1_320_000, currencyCode: 'UZS',
    airlineName: 'Air Astana', isDirect: true, tripClass: 'economy', hasBaggage: false,
    lastSeenAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    dealScore: { level: 'insufficient_data', sampleDays: 3, percentile: null, daysBelow: 0, minPrice: 1_300_000, medianPrice: 1_340_000, maxPrice: 1_390_000, trend: null },
    openUrl: 'https://www.aviasales.uz/search/TAS1809ALA1'
  }
];

const demoStore = {
  subscriptions: [],
  profile: {
    telegramUserId: 100,
    firstName: 'Алишер',
    username: 'alisher',
    preferredTripClass: 'economy',
    baggageRequired: false
  }
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function icon(name, extraClass = '') {
  return `<span class="icon icon-${name} ${extraClass}" aria-hidden="true"></span>`;
}

function formatPrice(value, currency = '') {
  const number = new Intl.NumberFormat('ru-RU').format(value);
  return currency ? `${number} ${currency}` : number;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
    .format(new Date(`${value}T00:00:00+05:00`));
}

function relativeTime(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  return `${Math.round(hours / 24)} дн. назад`;
}

function delay(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

async function demoApi(path, options = {}) {
  await delay(120);
  const url = new globalThis.URL(path, 'https://demo.local');
  if (url.pathname === '/api/v1/deals') {
    let items = [...demoDeals];
    const destination = url.searchParams.get('destination');
    const maxPrice = Number(url.searchParams.get('max_price'));
    if (destination) items = items.filter((item) => item.destinationCode === destination);
    if (maxPrice > 0) items = items.filter((item) => item.price <= maxPrice);
    if (url.searchParams.get('direct') === '1') items = items.filter((item) => item.isDirect);
    if (url.searchParams.get('baggage') === '1') items = items.filter((item) => item.hasBaggage);
    const sort = url.searchParams.get('sort');
    if (sort === 'cheapest') items.sort((left, right) => left.price - right.price);
    if (sort === 'departing_soon') items.sort((left, right) => left.departureDate.localeCompare(right.departureDate));
    if (sort === 'recent') items.reverse();
    return { items, nextCursor: null };
  }
  if (url.pathname === '/api/v1/destinations') {
    return { items: demoDeals.map((item) => ({ code: item.destinationCode, name: item.destinationName })) };
  }
  if (/^\/api\/v1\/tickets\/\d+$/u.test(url.pathname)) {
    const id = Number(url.pathname.split('/').at(-1));
    return demoDeals.find((item) => item.id === id);
  }
  if (url.pathname.includes('/history')) {
    const days = Number(url.searchParams.get('days') ?? 30);
    const prices = demoHistory.slice(-days);
    return { items: prices.map((price, index) => ({
      day: `2026-08-${String(index + 1).padStart(2, '0')}`,
      minPrice: price,
      averagePrice: price + 60_000,
      medianPrice: price + 20_000,
      maxPrice: price + 120_000,
      sampleCount: 4
    })) };
  }
  if (url.pathname === '/api/v1/subscriptions' && options.method === 'POST') {
    const body = JSON.parse(options.body);
    const created = {
      id: demoStore.subscriptions.length + 1,
      userId: 1,
      originCode: 'TAS',
      destinationCode: body.destinationCode,
      currencyCode: 'UZS',
      departureDateFrom: body.departureDateFrom,
      departureDateTo: body.departureDateTo,
      maxPrice: body.maxPrice,
      directOnly: body.directOnly,
      roundTripOnly: body.roundTripOnly,
      baggageRequired: body.baggageRequired,
      isActive: true
    };
    demoStore.subscriptions.unshift(created);
    return created;
  }
  if (url.pathname === '/api/v1/subscriptions') return { items: demoStore.subscriptions };
  if (/^\/api\/v1\/subscriptions\/\d+$/u.test(url.pathname) && options.method === 'DELETE') {
    const id = Number(url.pathname.split('/').at(-1));
    const subscription = demoStore.subscriptions.find((item) => item.id === id);
    if (subscription) subscription.isActive = false;
    return null;
  }
  if (url.pathname === '/api/v1/me' && options.method === 'PATCH') {
    Object.assign(demoStore.profile, JSON.parse(options.body));
    return { ...demoStore.profile };
  }
  if (url.pathname === '/api/v1/me') return { ...demoStore.profile };
  throw new Error('Демо-данные для запроса не найдены');
}

async function api(path, options = {}) {
  if (demoMode) return demoApi(path, options);
  const response = await fetch(path, {
    ...options,
    headers: {
      authorization: `tma ${telegram?.initData ?? ''}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {})
    }
  });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message ?? 'Не удалось загрузить данные');
  return payload;
}

function haptic(type = 'light') {
  if (demoMode) return;
  telegram?.HapticFeedback?.impactOccurred(type);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  if (state.toastTimer) globalThis.clearTimeout(state.toastTimer);
  state.toastTimer = globalThis.setTimeout(() => toast.classList.add('hidden'), 2200);
}

function showTabs(show) {
  bottomNav.classList.toggle('hidden', !show);
  state.screen = show ? 'tabs' : state.screen;
}

function setActiveNav() {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.view);
  });
  watchDot.classList.toggle('hidden', !state.subscriptions.some((item) => item.isActive));
}

function loadingScreen() {
  content.innerHTML = `<div class="screen-loader"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>`;
}

function errorScreen(error, retry) {
  content.innerHTML = `<section class="screen error-state">
    <span class="state-icon">${icon('wifi-off')}</span>
    <div class="state-title">Не удалось загрузить данные</div>
    <div class="state-copy">${escapeHtml(error instanceof Error ? error.message : 'Проверьте соединение и попробуйте снова.')}</div>
    <button id="retry" class="primary state-action" type="button">Повторить</button>
  </section>`;
  document.querySelector('#retry')?.addEventListener('click', () => void retry());
}

function scoreBadge(score) {
  if (score.level === 'lowest') {
    return `<span class="deal-badge hot">${icon('flame')}Самая низкая цена за ${score.sampleDays} дн.</span>`;
  }
  if (score.level === 'great') {
    return `<span class="deal-badge hot">${icon('flame')}Дешевле, чем ${score.percentile}% наблюдений</span>`;
  }
  if (score.level === 'good') {
    return `<span class="deal-badge good">${icon('check')}Дешевле, чем ${score.percentile}% наблюдений</span>`;
  }
  return '';
}

function dealCard(ticket) {
  const score = ticket.dealScore;
  const dates = ticket.returnDate
    ? `${formatDate(ticket.departureDate)} → ${formatDate(ticket.returnDate)}`
    : formatDate(ticket.departureDate);
  const history = score.sampleDays >= 7
    ? `За ${score.sampleDays} дней наблюдали цены от ${formatPrice(score.minPrice)} до ${formatPrice(score.maxPrice)} UZS`
    : 'Собираем историю цены — оценка появится через несколько дней';
  return `<button class="deal-card" type="button" data-ticket-id="${ticket.id}">
    ${scoreBadge(score)}
    <div class="route-code">${escapeHtml(ticket.originCode)} → ${escapeHtml(ticket.destinationCode)}</div>
    <div class="route-name">${escapeHtml(ticket.originName)} → ${escapeHtml(ticket.destinationName)}</div>
    <div class="deal-price">${escapeHtml(formatPrice(ticket.price))} <span class="currency">${escapeHtml(ticket.currencyCode)}</span></div>
    <div class="trip-date">${escapeHtml(dates)}</div>
    <div class="trip-meta">
      <span class="meta-item">${icon('plane')}${ticket.isDirect ? 'Прямой' : 'С пересадкой'}</span>
      <span class="meta-item">${icon('luggage')}${ticket.hasBaggage ? 'С багажом' : 'Без багажа'}</span>
    </div>
    <div class="history-caption">${escapeHtml(history)}</div>
  </button>`;
}

function renderDeals() {
  state.screen = 'tabs';
  showTabs(true);
  setActiveNav();
  const filterCount = Number(Boolean(state.filters.destination)) + Number(Boolean(state.filters.maxPrice));
  content.innerHTML = `<section class="screen">
    <header class="screen-header">
      <div><div class="eyebrow">HOT TICKET</div><h1>Горящие билеты</h1><div class="subtitle">Вылет из Ташкента</div></div>
      <button id="refresh-deals" class="icon-button" type="button" aria-label="Обновить">${icon('refresh')}</button>
    </header>
    <div class="chip-strip">
      <button id="open-filters" class="chip ${filterCount ? 'active' : ''}" type="button">${icon('filter')}Фильтры${filterCount ? ` (${filterCount})` : ''}</button>
      <button class="chip ${state.filters.direct ? 'active' : ''}" data-quick-filter="direct" type="button">Прямые</button>
      <button class="chip ${state.filters.baggage ? 'active' : ''}" data-quick-filter="baggage" type="button">С багажом</button>
      <button id="cycle-sort" class="chip" type="button">${escapeHtml(sortLabels[state.filters.sort])} ▾</button>
    </div>
    <div class="deal-list">${state.deals.length
      ? state.deals.map(dealCard).join('')
      : `<div class="empty-state"><span class="state-icon">${icon('search')}</span><div class="state-title">Нет результатов по фильтрам</div><div class="state-copy">Попробуйте изменить условия поиска</div><button id="reset-filters" class="secondary state-action" type="button">Сбросить фильтры</button></div>`}
    </div>
  </section>`;
  document.querySelector('#refresh-deals')?.addEventListener('click', () => { haptic(); void loadDeals(); });
  document.querySelector('#open-filters')?.addEventListener('click', () => openFilterSheet());
  document.querySelectorAll('[data-quick-filter]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.quickFilter;
    state.filters[key] = !state.filters[key];
    haptic();
    void loadDeals(false);
  }));
  document.querySelector('#cycle-sort')?.addEventListener('click', () => {
    const keys = Object.keys(sortLabels);
    state.filters.sort = keys[(keys.indexOf(state.filters.sort) + 1) % keys.length];
    void loadDeals(false);
  });
  document.querySelectorAll('[data-ticket-id]').forEach((button) => button.addEventListener('click', () => {
    haptic();
    void openTicket(Number(button.dataset.ticketId));
  }));
  document.querySelector('#reset-filters')?.addEventListener('click', () => {
    state.filters = { destination: '', maxPrice: '', direct: false, baggage: false, sort: 'best' };
    void loadDeals();
  });
}

async function loadDeals(showLoader = true) {
  if (showLoader) loadingScreen();
  const query = new URLSearchParams({ sort: state.filters.sort, limit: '30' });
  if (state.filters.destination) query.set('destination', state.filters.destination);
  if (state.filters.maxPrice) query.set('max_price', state.filters.maxPrice);
  if (state.filters.direct) query.set('direct', '1');
  if (state.filters.baggage) query.set('baggage', '1');
  try {
    const [deals, destinations] = await Promise.all([
      api(`/api/v1/deals?${query.toString()}`),
      state.destinations.length ? Promise.resolve({ items: state.destinations }) : api('/api/v1/destinations')
    ]);
    state.deals = deals.items;
    state.destinations = destinations.items;
    renderDeals();
  } catch (error) {
    errorScreen(error, loadDeals);
  }
}

function destinationChoices(selected, attribute) {
  const options = [{ code: '', name: 'Куда угодно' }, ...state.destinations];
  return options.map((item) => `<button class="choice ${selected === item.code ? 'active' : ''}" type="button" ${attribute}="${escapeHtml(item.code)}">${escapeHtml(item.name)}</button>`).join('');
}

function openFilterSheet(pending = { ...state.filters }) {
  filterSheet.innerHTML = `<div class="sheet-handle"></div>
    <div class="sheet-title-row"><h2 id="filter-title">Фильтры</h2><button id="close-sheet" class="icon-button sheet-close" type="button" aria-label="Закрыть">${icon('x')}</button></div>
    <div class="form-label">Направление</div>
    <div id="sheet-destinations" class="choice-list">${destinationChoices(pending.destination, 'data-sheet-destination')}</div>
    <label class="form-label" for="sheet-price">Цена до, UZS</label>
    <input id="sheet-price" class="full-input" type="number" min="1" step="10000" inputmode="numeric" value="${escapeHtml(pending.maxPrice)}" placeholder="Без ограничения">
    <div class="form-label">Сортировка</div>
    <div class="sort-list">${Object.entries(sortLabels).map(([key, label]) => `<button class="sort-option ${pending.sort === key ? 'active' : ''}" type="button" data-sheet-sort="${key}"><span>${escapeHtml(label)}</span>${pending.sort === key ? icon('check') : ''}</button>`).join('')}</div>
    <button id="apply-filters" class="primary" type="button">Применить</button>`;
  filterSheet.classList.remove('hidden');
  sheetBackdrop.classList.remove('hidden');
  const rerender = () => {
    closeFilterSheet();
    openFilterSheet(pending);
  };
  document.querySelectorAll('[data-sheet-destination]').forEach((button) => button.addEventListener('click', () => {
    pending.destination = button.dataset.sheetDestination;
    rerender();
  }));
  document.querySelectorAll('[data-sheet-sort]').forEach((button) => button.addEventListener('click', () => {
    pending.sort = button.dataset.sheetSort;
    rerender();
  }));
  document.querySelector('#sheet-price')?.addEventListener('input', (event) => { pending.maxPrice = event.target.value; });
  document.querySelector('#close-sheet')?.addEventListener('click', closeFilterSheet);
  document.querySelector('#apply-filters')?.addEventListener('click', () => {
    state.filters = { ...state.filters, ...pending, maxPrice: document.querySelector('#sheet-price')?.value ?? '' };
    closeFilterSheet();
    void loadDeals();
  });
}

function closeFilterSheet() {
  filterSheet.classList.add('hidden');
  sheetBackdrop.classList.add('hidden');
}

function historyStats(points) {
  const values = points.map((point) => point.minPrice).sort((left, right) => left - right);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return {
    min: values[0],
    median: values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2),
    max: values.at(-1)
  };
}

function detailBadge(score) {
  return scoreBadge(score);
}

function renderDetail() {
  const ticket = state.selectedTicket;
  const enoughHistory = state.history.length >= 7;
  const stats = historyStats(state.history);
  const percentile = ticket.dealScore.level === 'lowest'
    ? `Самая низкая цена за ${ticket.dealScore.sampleDays} дней наблюдений`
    : ticket.dealScore.percentile === null
      ? ''
      : `Текущая цена ниже ${ticket.dealScore.percentile}% наблюдений`;
  showTabs(false);
  content.innerHTML = `<section class="screen without-tabs">
    <div class="back-row"><button id="back-to-deals" class="back-button" type="button" aria-label="Назад">${icon('chevron-left')}</button><span class="back-label">Назад к предложениям</span></div>
    <div class="detail-route">${escapeHtml(ticket.originName)} → ${escapeHtml(ticket.destinationName)}</div>
    <div class="detail-price">${escapeHtml(formatPrice(ticket.price))} <span class="currency">${escapeHtml(ticket.currencyCode)}</span></div>
    ${detailBadge(ticket.dealScore)}
    <div class="updated">Обновлено ${escapeHtml(relativeTime(ticket.lastSeenAt))}</div>
    <div class="panel">
      <div class="info-row"><span class="info-label">Вылет</span><span class="info-value">${escapeHtml(formatDate(ticket.departureDate))}</span></div>
      ${ticket.returnDate ? `<div class="info-row"><span class="info-label">Обратно</span><span class="info-value">${escapeHtml(formatDate(ticket.returnDate))}</span></div>` : ''}
      <div class="info-row"><span class="info-label">Рейс</span><span class="info-value">${ticket.isDirect ? 'Прямой' : 'С пересадкой'}</span></div>
      <div class="info-row"><span class="info-label">Багаж</span><span class="info-value">${ticket.hasBaggage ? 'Есть' : 'Нет'}</span></div>
      <div class="info-row"><span class="info-label">Авиакомпания</span><span class="info-value">${escapeHtml(ticket.airlineName ?? 'Не указана')}</span></div>
      <div class="info-row"><span class="info-label">Класс</span><span class="info-value">${ticket.tripClass === 'business' ? 'Бизнес' : 'Эконом'}</span></div>
    </div>
    ${enoughHistory ? `<div class="panel">
      <div class="panel-title-row"><h2>История цены</h2><div class="range-tabs">${[7, 30, 90].map((range) => `<button class="range-button ${state.historyRange === range ? 'active' : ''}" type="button" data-history-range="${range}">${range}д</button>`).join('')}</div></div>
      <div class="chart-wrap"><canvas id="price-chart" class="chart-canvas" aria-label="История минимальной цены"></canvas></div>
      <div class="history-period">За ${state.history.length} дней наблюдений</div>
      <div class="stat-row"><span class="stat-label">Минимум</span><span class="stat-value">${escapeHtml(formatPrice(stats.min))}</span></div>
      <div class="stat-row"><span class="stat-label">Медиана</span><span class="stat-value">${escapeHtml(formatPrice(stats.median))}</span></div>
      <div class="stat-row"><span class="stat-label">Максимум</span><span class="stat-value">${escapeHtml(formatPrice(stats.max))}</span></div>
      ${percentile ? `<div class="percentile-copy">${escapeHtml(percentile)}</div>` : ''}
    </div>` : `<div class="panel empty-state"><span class="state-icon">${icon('chart')}</span><div class="state-title">Собираем историю этого маршрута</div><div class="state-copy">Для достоверной оценки нужно ещё несколько дней наблюдений.</div></div>`}
    <button id="open-ticket" class="primary" type="button">${icon('ticket')}Открыть билет</button>
    <button id="watch-ticket" class="secondary" type="button">${icon('bell')}Отслеживать направление</button>
  </section>`;
  document.querySelector('#back-to-deals')?.addEventListener('click', renderDeals);
  document.querySelector('#open-ticket')?.addEventListener('click', () => {
    haptic('medium');
    if (telegram?.openLink) telegram.openLink(ticket.openUrl);
    else globalThis.open(ticket.openUrl, '_blank');
  });
  document.querySelector('#watch-ticket')?.addEventListener('click', () => openCreate(ticket.destinationCode, ticket));
  document.querySelectorAll('[data-history-range]').forEach((button) => button.addEventListener('click', () => {
    void loadHistory(Number(button.dataset.historyRange));
  }));
  if (enoughHistory) drawChart(state.history);
}

function drawChart(points) {
  const canvas = document.querySelector('#price-chart');
  const context = canvas?.getContext('2d');
  if (!canvas || !context || points.length < 2) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = globalThis.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.scale(ratio, ratio);
  const values = points.map((point) => point.minPrice);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const median = historyStats(points).median;
  const range = Math.max(1, max - min);
  const pad = 9;
  const coordinates = values.map((value, index) => ({
    x: pad + (index / (values.length - 1)) * (width - pad * 2),
    y: pad + ((max - value) / range) * (height - pad * 2)
  }));
  const medianY = pad + ((max - median) / range) * (height - pad * 2);
  context.setLineDash([4, 5]);
  context.strokeStyle = '#5c6b78';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, medianY);
  context.lineTo(width, medianY);
  context.stroke();
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(coordinates[0].x, height);
  for (const point of coordinates) context.lineTo(point.x, point.y);
  context.lineTo(coordinates.at(-1).x, height);
  context.closePath();
  context.fillStyle = 'rgba(79, 170, 241, 0.14)';
  context.fill();
  context.beginPath();
  coordinates.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
  context.strokeStyle = '#4faaf1';
  context.lineWidth = 2.5;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.stroke();
  const last = coordinates.at(-1);
  context.beginPath();
  context.arc(last.x, last.y, 8, 0, Math.PI * 2);
  context.fillStyle = 'rgba(79, 170, 241, 0.22)';
  context.fill();
  context.beginPath();
  context.arc(last.x, last.y, 4, 0, Math.PI * 2);
  context.fillStyle = '#4faaf1';
  context.fill();
}

async function loadHistory(range) {
  state.historyRange = range;
  try {
    const ticket = state.selectedTicket;
    const result = await api(`/api/v1/routes/${ticket.originCode}/${ticket.destinationCode}/history?days=${range}`);
    state.history = result.items;
    renderDetail();
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Не удалось загрузить историю');
  }
}

async function openTicket(ticketId) {
  state.screen = 'detail';
  showTabs(false);
  loadingScreen();
  try {
    state.selectedTicket = await api(`/api/v1/tickets/${ticketId}`);
    await loadHistory(30);
  } catch (error) {
    errorScreen(error, () => openTicket(ticketId));
  }
}

function subscriptionDestination(subscription) {
  if (subscription.destinationCode === null) return { code: '', name: 'Куда угодно' };
  return state.destinations.find((item) => item.code === subscription.destinationCode)
    ?? { code: subscription.destinationCode, name: subscription.destinationCode };
}

function renderWatchlist() {
  state.screen = 'tabs';
  showTabs(true);
  setActiveNav();
  const active = state.subscriptions.filter((item) => item.isActive).length;
  content.innerHTML = `<section class="screen">
    <div class="watch-head"><h1>Мои отслеживания</h1><div class="watch-count">${active} из 20</div></div>
    <button id="new-watch" class="add-watch" type="button">${icon('plus')}Отслеживать направление</button>
    ${state.subscriptions.length ? state.subscriptions.map((item) => {
      const destination = subscriptionDestination(item);
      const conditions = [
        item.maxPrice ? `Цена до ${formatPrice(item.maxPrice)} UZS` : 'Без ограничения цены',
        item.directOnly ? 'Только прямые' : null,
        item.baggageRequired ? 'С багажом' : null
      ].filter(Boolean).join(' · ');
      return `<article class="watch-card ${item.isActive ? '' : 'inactive'}">
        <div class="route-code">${escapeHtml(item.originCode)} → ${escapeHtml(destination.code || 'ANY')}</div>
        <div class="route-name">Ташкент → ${escapeHtml(destination.name)}</div>
        <div class="trip-date">${escapeHtml(item.departureDateFrom)} – ${escapeHtml(item.departureDateTo)}</div>
        <div class="trip-meta">${escapeHtml(conditions)}</div>
        <div class="watch-card-footer"><span class="watch-status">${item.isActive ? 'Активно' : 'Отключено'}</span>${item.isActive ? `<button class="small-action" type="button" data-disable-watch="${item.id}">Отключить</button>` : ''}</div>
      </article>`;
    }).join('') : `<div class="empty-state"><span class="state-icon">${icon('bell')}</span><div class="state-title">Пока нет активных отслеживаний</div><div class="state-copy">Создайте первое направление — бот сообщит, когда появится билет.</div></div>`}
  </section>`;
  document.querySelector('#new-watch')?.addEventListener('click', () => openCreate(''));
  document.querySelectorAll('[data-disable-watch]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api(`/api/v1/subscriptions/${button.dataset.disableWatch}`, { method: 'DELETE' });
      haptic();
      showToast('Отслеживание отключено');
      await loadWatchlist(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось отключить');
    }
  }));
}

async function loadWatchlist(showLoader = true) {
  if (showLoader) loadingScreen();
  try {
    const result = await api('/api/v1/subscriptions');
    state.subscriptions = result.items;
    renderWatchlist();
  } catch (error) {
    errorScreen(error, loadWatchlist);
  }
}

function todayInTashkent(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function renderCreate() {
  const form = state.form;
  showTabs(false);
  content.innerHTML = `<section class="screen without-tabs">
    <div class="back-row"><button id="close-create" class="back-button" type="button" aria-label="Назад">${icon('chevron-left')}</button><h2>Новое отслеживание</h2></div>
    <div class="form-label">Направление</div>
    <div class="choice-list">${destinationChoices(form.destinationCode, 'data-form-destination')}</div>
    <div class="form-grid">
      <label class="field"><span class="form-label">Вылет от</span><input id="form-from" type="date" value="${escapeHtml(form.departureDateFrom)}" required></label>
      <label class="field"><span class="form-label">Вылет до</span><input id="form-to" type="date" value="${escapeHtml(form.departureDateTo)}" required></label>
    </div>
    <label class="form-label" for="form-price">Цена до, UZS</label>
    <input id="form-price" class="full-input" type="number" min="1" step="10000" inputmode="numeric" value="${escapeHtml(form.maxPrice)}" placeholder="Например, 1 700 000">
    <div class="toggle-row"><span>Только прямые рейсы</span><button class="switch ${form.directOnly ? 'active' : ''}" type="button" data-form-toggle="directOnly" aria-pressed="${form.directOnly}"></button></div>
    <div class="toggle-row"><span>Нужен багаж</span><button class="switch ${form.baggageRequired ? 'active' : ''}" type="button" data-form-toggle="baggageRequired" aria-pressed="${form.baggageRequired}"></button></div>
    <div class="toggle-row last"><span>Туда-обратно</span><button class="switch ${form.roundTripOnly ? 'active' : ''}" type="button" data-form-toggle="roundTripOnly" aria-pressed="${form.roundTripOnly}"></button></div>
    ${state.formError ? `<div class="form-error">${escapeHtml(state.formError)}</div>` : ''}
    <button id="submit-watch" class="primary" type="button">Создать отслеживание</button>
  </section>`;
  document.querySelector('#close-create')?.addEventListener('click', () => {
    state.screen = 'tabs';
    if (state.view === 'watchlist') renderWatchlist();
    else renderDeals();
  });
  document.querySelectorAll('[data-form-destination]').forEach((button) => button.addEventListener('click', () => {
    form.destinationCode = button.dataset.formDestination;
    renderCreate();
  }));
  document.querySelectorAll('[data-form-toggle]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.formToggle;
    form[key] = !form[key];
    haptic();
    renderCreate();
  }));
  document.querySelector('#form-from')?.addEventListener('input', (event) => { form.departureDateFrom = event.target.value; });
  document.querySelector('#form-to')?.addEventListener('input', (event) => { form.departureDateTo = event.target.value; });
  document.querySelector('#form-price')?.addEventListener('input', (event) => { form.maxPrice = event.target.value; });
  document.querySelector('#submit-watch')?.addEventListener('click', submitWatch);
}

function openCreate(destinationCode, ticket = null) {
  state.screen = 'create';
  state.formError = '';
  state.form = {
    destinationCode,
    departureDateFrom: ticket?.departureDate ?? todayInTashkent(),
    departureDateTo: ticket?.returnDate ?? todayInTashkent(90),
    maxPrice: '',
    directOnly: ticket?.isDirect ?? false,
    baggageRequired: ticket?.hasBaggage ?? false,
    roundTripOnly: ticket?.returnDate !== null && ticket !== null
  };
  renderCreate();
}

async function submitWatch() {
  const form = state.form;
  state.formError = '';
  if (!form.departureDateFrom || !form.departureDateTo) state.formError = 'Укажите диапазон дат';
  else if (form.departureDateTo < form.departureDateFrom) state.formError = 'Дата окончания раньше даты начала';
  else if (form.maxPrice && Number(form.maxPrice) <= 0) state.formError = 'Неверная цена';
  if (state.formError) {
    renderCreate();
    return;
  }
  try {
    await api('/api/v1/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        destinationCode: form.destinationCode || null,
        departureDateFrom: form.departureDateFrom,
        departureDateTo: form.departureDateTo,
        maxPrice: form.maxPrice ? Number(form.maxPrice) : null,
        directOnly: form.directOnly,
        roundTripOnly: form.roundTripOnly,
        baggageRequired: form.baggageRequired
      })
    });
    haptic('medium');
    showToast('Отслеживание создано');
    state.view = 'watchlist';
    await loadWatchlist();
  } catch (error) {
    state.formError = error instanceof Error ? error.message : 'Не удалось создать отслеживание';
    renderCreate();
  }
}

function renderProfile() {
  state.screen = 'tabs';
  showTabs(true);
  setActiveNav();
  const user = state.profile;
  const title = user.firstName ?? user.username ?? 'Пользователь';
  content.innerHTML = `<section class="screen">
    <h1 style="margin-bottom:20px">Профиль</h1>
    <div class="profile-person"><div class="avatar">${escapeHtml(title.slice(0, 1).toUpperCase())}</div><div><div class="profile-name">${escapeHtml(title)}</div><div class="profile-source">Telegram-аккаунт</div></div></div>
    <div class="panel settings-card"><div class="info-row"><span class="info-label">Город вылета</span><span class="info-value">Ташкент</span></div><div class="info-row"><span class="info-label">Валюта</span><span class="info-value">UZS</span></div></div>
    <div class="section-label">Класс перелёта</div>
    <div class="segments"><button class="segment ${user.preferredTripClass === 'economy' ? 'active' : ''}" type="button" data-profile-class="economy">Эконом</button><button class="segment ${user.preferredTripClass === 'business' ? 'active' : ''}" type="button" data-profile-class="business">Бизнес</button></div>
    <div class="section-label">Багаж</div>
    <div class="segments"><button class="segment ${!user.baggageRequired ? 'active' : ''}" type="button" data-profile-baggage="0">Не важно</button><button class="segment ${user.baggageRequired ? 'active' : ''}" type="button" data-profile-baggage="1">Только с багажом</button></div>
    <button id="save-profile" class="primary profile-save" type="button">Сохранить</button>
  </section>`;
  document.querySelectorAll('[data-profile-class]').forEach((button) => button.addEventListener('click', () => {
    user.preferredTripClass = button.dataset.profileClass;
    renderProfile();
  }));
  document.querySelectorAll('[data-profile-baggage]').forEach((button) => button.addEventListener('click', () => {
    user.baggageRequired = button.dataset.profileBaggage === '1';
    renderProfile();
  }));
  document.querySelector('#save-profile')?.addEventListener('click', async () => {
    try {
      state.profile = await api('/api/v1/me', {
        method: 'PATCH',
        body: JSON.stringify({ preferredTripClass: user.preferredTripClass, baggageRequired: user.baggageRequired })
      });
      haptic('medium');
      showToast('Настройки сохранены');
      renderProfile();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось сохранить');
    }
  });
}

async function loadProfile() {
  loadingScreen();
  try {
    state.profile = await api('/api/v1/me');
    renderProfile();
  } catch (error) {
    errorScreen(error, loadProfile);
  }
}

async function loadCurrentView() {
  setActiveNav();
  if (state.view === 'watchlist') await loadWatchlist();
  else if (state.view === 'profile') await loadProfile();
  else await loadDeals();
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  state.screen = 'tabs';
  haptic();
  void loadCurrentView();
}));
sheetBackdrop?.addEventListener('click', closeFilterSheet);

if (!demoMode && !telegram?.initData) {
  showTabs(false);
  content.innerHTML = `<section class="screen locked-state"><span class="state-icon">${icon('ticket')}</span><div class="state-title">Откройте Hot Ticket из Telegram</div><div class="state-copy">Mini App использует Telegram для безопасного входа и доступа к вашим отслеживаниям.</div></section>`;
} else {
  telegram?.ready();
  telegram?.expand();
  void loadCurrentView();
}
