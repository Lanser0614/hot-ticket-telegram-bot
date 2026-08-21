const telegram = globalThis.Telegram?.WebApp;
const content = document.querySelector('#content');
const bottomNav = document.querySelector('#bottom-nav');
const filterSheet = document.querySelector('#filter-sheet');
const sheetBackdrop = document.querySelector('#sheet-backdrop');
const toast = document.querySelector('#toast');
const watchDot = document.querySelector('#watch-dot');
const demoMode = globalThis.location.protocol === 'file:'
  || ['127.0.0.1', 'localhost'].includes(globalThis.location.hostname);
const requestedLanguage = new globalThis.URLSearchParams(globalThis.location.search).get('lang');
const telegramLanguage = telegram?.initDataUnsafe?.user?.language_code;
const language = (requestedLanguage ?? telegramLanguage ?? '').toLocaleLowerCase().startsWith('uz')
  ? 'uz'
  : 'ru';
const locale = language === 'uz' ? 'uz-UZ' : 'ru-RU';
const pick = (russian, uzbek) => language === 'uz' ? uzbek : russian;

document.documentElement.lang = language;

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
  best: pick('Выгодные', 'Foydali'),
  cheapest: pick('Дешёвые', 'Arzon'),
  recent: pick('Недавние', 'Yangi'),
  departing_soon: pick('Скоро вылет', 'Tez orada uchish')
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
    originCode: 'TAS', originName: pick('Ташкент', 'Toshkent'), destinationCode: 'IST', destinationName: pick('Стамбул', 'Istanbul'),
    departureDate: '2026-09-12', returnDate: '2026-09-16', price: 1_480_000, currencyCode: 'UZS',
    airlineName: 'Turkish Airlines', isDirect: true, tripClass: 'economy', hasBaggage: true,
    lastSeenAt: new Date(Date.now() - 8 * 60_000).toISOString(),
    dealScore: { level: 'lowest', sampleDays: 24, percentile: 100, daysBelow: 0, minPrice: 1_450_000, medianPrice: 1_920_000, maxPrice: 2_390_000, trend: 'falling' },
    openUrl: 'https://www.aviasales.uz/search/TAS1209IST16091'
  },
  {
    id: 2,
    originCode: 'TAS', originName: pick('Ташкент', 'Toshkent'), destinationCode: 'DXB', destinationName: pick('Дубай', 'Dubay'),
    departureDate: '2026-09-14', returnDate: null, price: 2_100_000, currencyCode: 'UZS',
    airlineName: 'flydubai', isDirect: false, tripClass: 'economy', hasBaggage: false,
    lastSeenAt: new Date(Date.now() - 22 * 60_000).toISOString(),
    dealScore: { level: 'good', sampleDays: 15, percentile: 82, daysBelow: 2, minPrice: 2_100_000, medianPrice: 2_380_000, maxPrice: 2_600_000, trend: 'falling' },
    openUrl: 'https://www.aviasales.uz/search/TAS1409DXB1'
  },
  {
    id: 3,
    originCode: 'TAS', originName: pick('Ташкент', 'Toshkent'), destinationCode: 'ALA', destinationName: pick('Алматы', 'Olmaota'),
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
    firstName: pick('Алишер', 'Alisher'),
    username: 'alisher',
    languageCode: language,
    defaultOriginCode: 'TAS',
    onboardingCompleted: true,
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
  const number = new Intl.NumberFormat(locale).format(value);
  return currency ? `${number} ${currency}` : number;
}

function formatDate(value) {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
    .format(new Date(`${value}T00:00:00+05:00`));
}

function displayLocationName(name, code) {
  if (language !== 'uz') return name;
  const known = {
    TAS: 'Toshkent', IST: 'Istanbul', DXB: 'Dubay', ALA: 'Olmaota', SKD: 'Samarqand',
    BHK: 'Buxoro', FEG: 'Farg‘ona', NMA: 'Namangan', NCU: 'Nukus', UGC: 'Urganch',
    TMJ: 'Termiz', KSQ: 'Qarshi', AZN: 'Andijon', NVI: 'Navoiy'
  };
  if (known[code]) return known[code];
  const letters = {
    А: 'A', а: 'a', Б: 'B', б: 'b', В: 'V', в: 'v', Г: 'G', г: 'g', Д: 'D', д: 'd',
    Е: 'E', е: 'e', Ё: 'Yo', ё: 'yo', Ж: 'J', ж: 'j', З: 'Z', з: 'z', И: 'I', и: 'i',
    Й: 'Y', й: 'y', К: 'K', к: 'k', Л: 'L', л: 'l', М: 'M', м: 'm', Н: 'N', н: 'n',
    О: 'O', о: 'o', П: 'P', п: 'p', Р: 'R', р: 'r', С: 'S', с: 's', Т: 'T', т: 't',
    У: 'U', у: 'u', Ф: 'F', ф: 'f', Х: 'X', х: 'x', Ц: 'Ts', ц: 'ts', Ч: 'Ch', ч: 'ch',
    Ш: 'Sh', ш: 'sh', Щ: 'Shch', щ: 'shch', Ъ: '', ъ: '', Ы: 'I', ы: 'i', Ь: '', ь: '',
    Э: 'E', э: 'e', Ю: 'Yu', ю: 'yu', Я: 'Ya', я: 'ya'
  };
  return [...name].map((character) => letters[character] ?? character).join('');
}

const uzbekistanOrigins = [
  'TAS', 'SKD', 'BHK', 'FEG', 'NMA', 'NCU', 'UGC', 'TMJ', 'KSQ', 'AZN', 'NVI'
];

function originName(code = state.profile?.defaultOriginCode ?? 'TAS', targetLanguage = language) {
  const names = {
    ru: {
      TAS: 'Ташкент', SKD: 'Самарканд', BHK: 'Бухара', FEG: 'Фергана', NMA: 'Наманган',
      NCU: 'Нукус', UGC: 'Ургенч', TMJ: 'Термез', KSQ: 'Карши', AZN: 'Андижан', NVI: 'Навои'
    },
    uz: {
      TAS: 'Toshkent', SKD: 'Samarqand', BHK: 'Buxoro', FEG: 'Farg‘ona', NMA: 'Namangan',
      NCU: 'Nukus', UGC: 'Urganch', TMJ: 'Termiz', KSQ: 'Qarshi', AZN: 'Andijon', NVI: 'Navoiy'
    }
  };
  return names[targetLanguage]?.[code] ?? code;
}

function relativeTime(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return pick('только что', 'hozirgina');
  if (minutes < 60) return pick(`${minutes} мин. назад`, `${minutes} daqiqa oldin`);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return pick(`${hours} ч. назад`, `${hours} soat oldin`);
  return pick(`${Math.round(hours / 24)} дн. назад`, `${Math.round(hours / 24)} kun oldin`);
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
  if (url.pathname === '/api/v1/onboarding' && options.method === 'POST') {
    Object.assign(demoStore.profile, JSON.parse(options.body), { onboardingCompleted: true });
    return { ...demoStore.profile };
  }
  if (url.pathname === '/api/v1/me') return { ...demoStore.profile };
  throw new Error(pick('Демо-данные для запроса не найдены', 'So‘rov uchun demo ma’lumotlari topilmadi'));
}

function localizeServerError(message) {
  if (language !== 'uz') return message;
  const errors = {
    'Сначала выполните /start в боте': 'Avval botda /start buyrug‘ini yuboring',
    'Билет не найден': 'Chipta topilmadi',
    'Некорректная дата': 'Sana noto‘g‘ri',
    'Некорректная цена': 'Narx noto‘g‘ri',
    'Начальная дата позже конечной': 'Boshlanish sanasi tugash sanasidan keyin',
    'Достигнут лимит 20 активных подписок': '20 ta faol kuzatuv chegarasiga yetildi'
  };
  return errors[message] ?? message;
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
  if (!response.ok) throw new Error(localizeServerError(
    payload?.error?.message ?? pick('Не удалось загрузить данные', 'Ma’lumotlarni yuklab bo‘lmadi')
  ));
  return payload;
}

function haptic(type = 'light') {
  if (demoMode) return;
  telegram?.HapticFeedback?.impactOccurred(type);
}

function applyTelegramChrome() {
  if (!telegram) return;
  if (telegram.isVersionAtLeast?.('6.1')) telegram.setBackgroundColor?.('#101922');
  if (telegram.isVersionAtLeast?.('6.9')) telegram.setHeaderColor?.('#101922');
  if (telegram.isVersionAtLeast?.('7.10')) telegram.setBottomBarColor?.('#151f2b');
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
    <div class="state-title">${pick('Не удалось загрузить данные', 'Ma’lumotlarni yuklab bo‘lmadi')}</div>
    <div class="state-copy">${escapeHtml(error instanceof Error ? error.message : pick('Проверьте соединение и попробуйте снова.', 'Internet aloqasini tekshirib, qayta urinib ko‘ring.'))}</div>
    <button id="retry" class="primary state-action" type="button">${pick('Повторить', 'Qayta urinish')}</button>
  </section>`;
  document.querySelector('#retry')?.addEventListener('click', () => void retry());
}

function scoreBadge(score) {
  if (score.level === 'lowest') {
    return `<span class="deal-badge hot">${icon('flame')}${pick(`Самая низкая цена за ${score.sampleDays} дн.`, `${score.sampleDays} kundagi eng past narx`)}</span>`;
  }
  if (score.level === 'great') {
    return `<span class="deal-badge hot">${icon('flame')}${pick(`Дешевле, чем ${score.percentile}% наблюдений`, `Kuzatuvlarning ${score.percentile}% idan arzon`)}</span>`;
  }
  if (score.level === 'good') {
    return `<span class="deal-badge good">${icon('check')}${pick(`Дешевле, чем ${score.percentile}% наблюдений`, `Kuzatuvlarning ${score.percentile}% idan arzon`)}</span>`;
  }
  return '';
}

function dealCard(ticket) {
  const score = ticket.dealScore;
  const dates = ticket.returnDate
    ? `${formatDate(ticket.departureDate)} → ${formatDate(ticket.returnDate)}`
    : formatDate(ticket.departureDate);
  const history = score.sampleDays >= 7
    ? pick(
      `За ${score.sampleDays} дней наблюдали цены от ${formatPrice(score.minPrice)} до ${formatPrice(score.maxPrice)} UZS`,
      `${score.sampleDays} kun ichida narxlar ${formatPrice(score.minPrice)} dan ${formatPrice(score.maxPrice)} UZS gacha bo‘ldi`
    )
    : pick('Собираем историю цены — оценка появится через несколько дней', 'Narx tarixini yig‘moqdamiz — baho bir necha kundan keyin chiqadi');
  return `<button class="deal-card" type="button" data-ticket-id="${ticket.id}">
    ${scoreBadge(score)}
    <div class="route-code">${escapeHtml(ticket.originCode)} → ${escapeHtml(ticket.destinationCode)}</div>
    <div class="route-name">${escapeHtml(displayLocationName(ticket.originName, ticket.originCode))} → ${escapeHtml(displayLocationName(ticket.destinationName, ticket.destinationCode))}</div>
    <div class="deal-price">${escapeHtml(formatPrice(ticket.price))} <span class="currency">${escapeHtml(ticket.currencyCode)}</span></div>
    <div class="trip-date">${escapeHtml(dates)}</div>
    <div class="trip-meta">
      <span class="meta-item">${icon('plane')}${ticket.isDirect ? pick('Прямой', 'To‘g‘ridan-to‘g‘ri') : pick('С пересадкой', 'Almashib')}</span>
      <span class="meta-item">${icon('luggage')}${ticket.hasBaggage ? pick('С багажом', 'Bagaj bilan') : pick('Без багажа', 'Bagajsiz')}</span>
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
      <div><div class="eyebrow">HOT TICKET</div><h1>${pick('Горящие билеты', 'Qaynoq chiptalar')}</h1><div class="subtitle">${pick('Город вылета', 'Uchish shahri')}: ${escapeHtml(originName())}</div></div>
      <button id="refresh-deals" class="icon-button" type="button" aria-label="${pick('Обновить', 'Yangilash')}">${icon('refresh')}</button>
    </header>
    <div class="chip-strip">
      <button id="open-filters" class="chip ${filterCount ? 'active' : ''}" type="button">${icon('filter')}${pick('Фильтры', 'Filtrlar')}${filterCount ? ` (${filterCount})` : ''}</button>
      <button class="chip ${state.filters.direct ? 'active' : ''}" data-quick-filter="direct" type="button">${pick('Прямые', 'To‘g‘ridan-to‘g‘ri')}</button>
      <button class="chip ${state.filters.baggage ? 'active' : ''}" data-quick-filter="baggage" type="button">${pick('С багажом', 'Bagaj bilan')}</button>
      <button id="cycle-sort" class="chip" type="button">${escapeHtml(sortLabels[state.filters.sort])} ▾</button>
    </div>
    <div class="deal-list">${state.deals.length
      ? state.deals.map(dealCard).join('')
      : `<div class="empty-state"><span class="state-icon">${icon('search')}</span><div class="state-title">${pick('Нет результатов по фильтрам', 'Filtrlarga mos natija yo‘q')}</div><div class="state-copy">${pick('Попробуйте изменить условия поиска', 'Qidiruv shartlarini o‘zgartirib ko‘ring')}</div><button id="reset-filters" class="secondary state-action" type="button">${pick('Сбросить фильтры', 'Filtrlarni tozalash')}</button></div>`}
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
    state.destinations = destinations.items.map((item) => ({
      ...item,
      name: displayLocationName(item.name, item.code)
    }));
    renderDeals();
  } catch (error) {
    errorScreen(error, loadDeals);
  }
}

function destinationChoices(selected, attribute) {
  const options = [{ code: '', name: pick('Куда угодно', 'Istalgan joyga') }, ...state.destinations];
  return options.map((item) => `<button class="choice ${selected === item.code ? 'active' : ''}" type="button" ${attribute}="${escapeHtml(item.code)}">${escapeHtml(item.name)}</button>`).join('');
}

function openFilterSheet(pending = { ...state.filters }) {
  filterSheet.innerHTML = `<div class="sheet-handle"></div>
    <div class="sheet-title-row"><h2 id="filter-title">${pick('Фильтры', 'Filtrlar')}</h2><button id="close-sheet" class="icon-button sheet-close" type="button" aria-label="${pick('Закрыть', 'Yopish')}">${icon('x')}</button></div>
    <div class="form-label">${pick('Направление', 'Yo‘nalish')}</div>
    <div id="sheet-destinations" class="choice-list">${destinationChoices(pending.destination, 'data-sheet-destination')}</div>
    <label class="form-label" for="sheet-price">${pick('Цена до, UZS', 'Narxgacha, UZS')}</label>
    <input id="sheet-price" class="full-input" type="number" min="1" step="10000" inputmode="numeric" value="${escapeHtml(pending.maxPrice)}" placeholder="${pick('Без ограничения', 'Cheklovsiz')}">
    <div class="form-label">${pick('Сортировка', 'Saralash')}</div>
    <div class="sort-list">${Object.entries(sortLabels).map(([key, label]) => `<button class="sort-option ${pending.sort === key ? 'active' : ''}" type="button" data-sheet-sort="${key}"><span>${escapeHtml(label)}</span>${pending.sort === key ? icon('check') : ''}</button>`).join('')}</div>
    <button id="apply-filters" class="primary" type="button">${pick('Применить', 'Qo‘llash')}</button>`;
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
    ? pick(
      `Самая низкая цена за ${ticket.dealScore.sampleDays} дней наблюдений`,
      `${ticket.dealScore.sampleDays} kunlik kuzatuvdagi eng past narx`
    )
    : ticket.dealScore.percentile === null
      ? ''
      : pick(
        `Текущая цена ниже ${ticket.dealScore.percentile}% наблюдений`,
        `Joriy narx kuzatuvlarning ${ticket.dealScore.percentile}% idan past`
      );
  showTabs(false);
  content.innerHTML = `<section class="screen without-tabs">
    <div class="back-row"><button id="back-to-deals" class="back-button" type="button" aria-label="${pick('Назад', 'Orqaga')}">${icon('chevron-left')}</button><span class="back-label">${pick('Назад к предложениям', 'Takliflarga qaytish')}</span></div>
    <div class="detail-route">${escapeHtml(displayLocationName(ticket.originName, ticket.originCode))} → ${escapeHtml(displayLocationName(ticket.destinationName, ticket.destinationCode))}</div>
    <div class="detail-price">${escapeHtml(formatPrice(ticket.price))} <span class="currency">${escapeHtml(ticket.currencyCode)}</span></div>
    ${detailBadge(ticket.dealScore)}
    <div class="updated">${pick('Обновлено', 'Yangilangan')}: ${escapeHtml(relativeTime(ticket.lastSeenAt))}</div>
    <div class="panel">
      <div class="info-row"><span class="info-label">${pick('Вылет', 'Uchish')}</span><span class="info-value">${escapeHtml(formatDate(ticket.departureDate))}</span></div>
      ${ticket.returnDate ? `<div class="info-row"><span class="info-label">${pick('Обратно', 'Qaytish')}</span><span class="info-value">${escapeHtml(formatDate(ticket.returnDate))}</span></div>` : ''}
      <div class="info-row"><span class="info-label">${pick('Рейс', 'Reys')}</span><span class="info-value">${ticket.isDirect ? pick('Прямой', 'To‘g‘ridan-to‘g‘ri') : pick('С пересадкой', 'Almashib')}</span></div>
      <div class="info-row"><span class="info-label">${pick('Багаж', 'Bagaj')}</span><span class="info-value">${ticket.hasBaggage ? pick('Есть', 'Bor') : pick('Нет', 'Yo‘q')}</span></div>
      <div class="info-row"><span class="info-label">${pick('Авиакомпания', 'Aviakompaniya')}</span><span class="info-value">${escapeHtml(ticket.airlineName ?? pick('Не указана', 'Ko‘rsatilmagan'))}</span></div>
      <div class="info-row"><span class="info-label">${pick('Класс', 'Klass')}</span><span class="info-value">${ticket.tripClass === 'business' ? pick('Бизнес', 'Biznes') : pick('Эконом', 'Ekonom')}</span></div>
    </div>
    ${enoughHistory ? `<div class="panel">
      <div class="panel-title-row"><h2>${pick('История цены', 'Narx tarixi')}</h2><div class="range-tabs">${[7, 30, 90].map((range) => `<button class="range-button ${state.historyRange === range ? 'active' : ''}" type="button" data-history-range="${range}">${range}${pick('д', 'k')}</button>`).join('')}</div></div>
      <div class="chart-wrap"><canvas id="price-chart" class="chart-canvas" aria-label="${pick('История минимальной цены', 'Eng past narx tarixi')}"></canvas></div>
      <div class="history-period">${pick(`За ${state.history.length} дней наблюдений`, `${state.history.length} kunlik kuzatuv`)}</div>
      <div class="stat-row"><span class="stat-label">${pick('Минимум', 'Minimum')}</span><span class="stat-value">${escapeHtml(formatPrice(stats.min))}</span></div>
      <div class="stat-row"><span class="stat-label">${pick('Медиана', 'Mediana')}</span><span class="stat-value">${escapeHtml(formatPrice(stats.median))}</span></div>
      <div class="stat-row"><span class="stat-label">${pick('Максимум', 'Maksimum')}</span><span class="stat-value">${escapeHtml(formatPrice(stats.max))}</span></div>
      ${percentile ? `<div class="percentile-copy">${escapeHtml(percentile)}</div>` : ''}
    </div>` : `<div class="panel empty-state"><span class="state-icon">${icon('chart')}</span><div class="state-title">${pick('Собираем историю этого маршрута', 'Bu yo‘nalish tarixini yig‘moqdamiz')}</div><div class="state-copy">${pick('Для достоверной оценки нужно ещё несколько дней наблюдений.', 'Ishonchli baho uchun yana bir necha kunlik kuzatuv kerak.')}</div></div>`}
    <button id="open-ticket" class="primary" type="button">${icon('ticket')}${pick('Открыть билет', 'Chiptani ochish')}</button>
    <button id="watch-ticket" class="secondary" type="button">${icon('bell')}${pick('Отслеживать направление', 'Yo‘nalishni kuzatish')}</button>
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
    showToast(error instanceof Error ? error.message : pick('Не удалось загрузить историю', 'Tarixni yuklab bo‘lmadi'));
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
  if (subscription.destinationCode === null) return { code: '', name: pick('Куда угодно', 'Istalgan joyga') };
  return state.destinations.find((item) => item.code === subscription.destinationCode)
    ?? { code: subscription.destinationCode, name: subscription.destinationCode };
}

function renderWatchlist() {
  state.screen = 'tabs';
  showTabs(true);
  setActiveNav();
  const active = state.subscriptions.filter((item) => item.isActive).length;
  content.innerHTML = `<section class="screen">
    <div class="watch-head"><h1>${pick('Мои отслеживания', 'Mening kuzatuvlarim')}</h1><div class="watch-count">${pick(`${active} из 20`, `${active} / 20`)}</div></div>
    <button id="new-watch" class="add-watch" type="button">${icon('plus')}${pick('Отслеживать направление', 'Yo‘nalishni kuzatish')}</button>
    ${state.subscriptions.length ? state.subscriptions.map((item) => {
      const destination = subscriptionDestination(item);
      const conditions = [
        item.maxPrice ? pick(`Цена до ${formatPrice(item.maxPrice)} UZS`, `${formatPrice(item.maxPrice)} UZS gacha`) : pick('Без ограничения цены', 'Narx cheklovisiz'),
        item.directOnly ? pick('Только прямые', 'Faqat to‘g‘ridan-to‘g‘ri') : null,
        item.baggageRequired ? pick('С багажом', 'Bagaj bilan') : null
      ].filter(Boolean).join(' · ');
      return `<article class="watch-card ${item.isActive ? '' : 'inactive'}">
        <div class="route-code">${escapeHtml(item.originCode)} → ${escapeHtml(destination.code || 'ANY')}</div>
        <div class="route-name">${escapeHtml(originName(item.originCode))} → ${escapeHtml(destination.name)}</div>
        <div class="trip-date">${escapeHtml(item.departureDateFrom)} – ${escapeHtml(item.departureDateTo)}</div>
        <div class="trip-meta">${escapeHtml(conditions)}</div>
        <div class="watch-card-footer"><span class="watch-status">${item.isActive ? pick('Активно', 'Faol') : pick('Отключено', 'O‘chirilgan')}</span>${item.isActive ? `<button class="small-action" type="button" data-disable-watch="${item.id}">${pick('Отключить', 'O‘chirish')}</button>` : ''}</div>
      </article>`;
    }).join('') : `<div class="empty-state"><span class="state-icon">${icon('bell')}</span><div class="state-title">${pick('Пока нет активных отслеживаний', 'Hozircha faol kuzatuvlar yo‘q')}</div><div class="state-copy">${pick('Создайте первое направление — бот сообщит, когда появится билет.', 'Birinchi yo‘nalishni yarating — chipta paydo bo‘lsa, bot xabar beradi.')}</div></div>`}
  </section>`;
  document.querySelector('#new-watch')?.addEventListener('click', () => openCreate(''));
  document.querySelectorAll('[data-disable-watch]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api(`/api/v1/subscriptions/${button.dataset.disableWatch}`, { method: 'DELETE' });
      haptic();
      showToast(pick('Отслеживание отключено', 'Kuzatuv o‘chirildi'));
      await loadWatchlist(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : pick('Не удалось отключить', 'O‘chirib bo‘lmadi'));
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
    <div class="back-row"><button id="close-create" class="back-button" type="button" aria-label="${pick('Назад', 'Orqaga')}">${icon('chevron-left')}</button><h2>${pick('Новое отслеживание', 'Yangi kuzatuv')}</h2></div>
    <div class="form-label">${pick('Направление', 'Yo‘nalish')}</div>
    <div class="choice-list">${destinationChoices(form.destinationCode, 'data-form-destination')}</div>
    <div class="form-grid">
      <label class="field"><span class="form-label">${pick('Вылет от', 'Uchish sanasi')}</span><input id="form-from" type="date" value="${escapeHtml(form.departureDateFrom)}" required></label>
      <label class="field"><span class="form-label">${pick('Вылет до', 'Oxirgi uchish sanasi')}</span><input id="form-to" type="date" value="${escapeHtml(form.departureDateTo)}" required></label>
    </div>
    <label class="form-label" for="form-price">${pick('Цена до, UZS', 'Narxgacha, UZS')}</label>
    <input id="form-price" class="full-input" type="number" min="1" step="10000" inputmode="numeric" value="${escapeHtml(form.maxPrice)}" placeholder="${pick('Например, 1 700 000', 'Masalan, 1 700 000')}">
    <div class="toggle-row"><span>${pick('Только прямые рейсы', 'Faqat to‘g‘ridan-to‘g‘ri reyslar')}</span><button class="switch ${form.directOnly ? 'active' : ''}" type="button" data-form-toggle="directOnly" aria-pressed="${form.directOnly}"></button></div>
    <div class="toggle-row"><span>${pick('Нужен багаж', 'Bagaj kerak')}</span><button class="switch ${form.baggageRequired ? 'active' : ''}" type="button" data-form-toggle="baggageRequired" aria-pressed="${form.baggageRequired}"></button></div>
    <div class="toggle-row last"><span>${pick('Туда-обратно', 'Borib-kelish')}</span><button class="switch ${form.roundTripOnly ? 'active' : ''}" type="button" data-form-toggle="roundTripOnly" aria-pressed="${form.roundTripOnly}"></button></div>
    ${state.formError ? `<div class="form-error">${escapeHtml(state.formError)}</div>` : ''}
    <button id="submit-watch" class="primary" type="button">${pick('Создать отслеживание', 'Kuzatuv yaratish')}</button>
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
  if (!form.departureDateFrom || !form.departureDateTo) state.formError = pick('Укажите диапазон дат', 'Sana oralig‘ini kiriting');
  else if (form.departureDateTo < form.departureDateFrom) state.formError = pick('Дата окончания раньше даты начала', 'Tugash sanasi boshlanish sanasidan oldin');
  else if (form.maxPrice && Number(form.maxPrice) <= 0) state.formError = pick('Неверная цена', 'Narx noto‘g‘ri');
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
    showToast(pick('Отслеживание создано', 'Kuzatuv yaratildi'));
    state.view = 'watchlist';
    await loadWatchlist();
  } catch (error) {
    state.formError = error instanceof Error ? error.message : pick('Не удалось создать отслеживание', 'Kuzatuvni yaratib bo‘lmadi');
    renderCreate();
  }
}

function renderProfile() {
  state.screen = 'tabs';
  showTabs(true);
  setActiveNav();
  const user = state.profile;
  const title = user.firstName ?? user.username ?? pick('Пользователь', 'Foydalanuvchi');
  content.innerHTML = `<section class="screen">
    <h1 style="margin-bottom:20px">${pick('Профиль', 'Profil')}</h1>
    <div class="profile-person"><div class="avatar">${escapeHtml(title.slice(0, 1).toUpperCase())}</div><div><div class="profile-name">${escapeHtml(title)}</div><div class="profile-source">${pick('Telegram-аккаунт', 'Telegram hisobi')}</div></div></div>
    <div class="panel settings-card"><div class="info-row"><span class="info-label">${pick('Город вылета', 'Uchish shahri')}</span><span class="info-value">${escapeHtml(originName(user.defaultOriginCode))}</span></div><div class="info-row"><span class="info-label">${pick('Валюта', 'Valyuta')}</span><span class="info-value">UZS</span></div></div>
    <div class="section-label">${pick('Язык', 'Til')}</div>
    <div class="segments"><button class="segment ${user.languageCode === 'uz' ? 'active' : ''}" type="button" data-profile-language="uz">🇺🇿 O‘zbekcha</button><button class="segment ${user.languageCode === 'ru' ? 'active' : ''}" type="button" data-profile-language="ru">🇷🇺 Русский</button></div>
    <div class="section-label">${pick('Город вылета', 'Uchish shahri')}</div>
    <div class="choice-list">${uzbekistanOrigins.map((code) => `<button class="choice ${user.defaultOriginCode === code ? 'active' : ''}" type="button" data-profile-origin="${code}">${escapeHtml(originName(code))}</button>`).join('')}</div>
    <div class="section-label">${pick('Класс перелёта', 'Parvoz klassi')}</div>
    <div class="segments"><button class="segment ${user.preferredTripClass === 'economy' ? 'active' : ''}" type="button" data-profile-class="economy">${pick('Эконом', 'Ekonom')}</button><button class="segment ${user.preferredTripClass === 'business' ? 'active' : ''}" type="button" data-profile-class="business">${pick('Бизнес', 'Biznes')}</button></div>
    <div class="section-label">${pick('Багаж', 'Bagaj')}</div>
    <div class="segments"><button class="segment ${!user.baggageRequired ? 'active' : ''}" type="button" data-profile-baggage="0">${pick('Не важно', 'Muhim emas')}</button><button class="segment ${user.baggageRequired ? 'active' : ''}" type="button" data-profile-baggage="1">${pick('Только с багажом', 'Faqat bagaj bilan')}</button></div>
    <button id="save-profile" class="primary profile-save" type="button">${pick('Сохранить', 'Saqlash')}</button>
  </section>`;
  document.querySelectorAll('[data-profile-class]').forEach((button) => button.addEventListener('click', () => {
    user.preferredTripClass = button.dataset.profileClass;
    renderProfile();
  }));
  document.querySelectorAll('[data-profile-origin]').forEach((button) => button.addEventListener('click', () => {
    user.defaultOriginCode = button.dataset.profileOrigin;
    renderProfile();
  }));
  document.querySelectorAll('[data-profile-language]').forEach((button) => button.addEventListener('click', () => {
    user.languageCode = button.dataset.profileLanguage;
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
        body: JSON.stringify({
          preferredTripClass: user.preferredTripClass,
          baggageRequired: user.baggageRequired,
          defaultOriginCode: user.defaultOriginCode,
          languageCode: user.languageCode
        })
      });
      haptic('medium');
      if (state.profile.languageCode !== language) {
        const nextUrl = new globalThis.URL(globalThis.location.href);
        nextUrl.searchParams.set('lang', state.profile.languageCode);
        globalThis.location.replace(nextUrl.toString());
        return;
      }
      showToast(pick('Настройки сохранены', 'Sozlamalar saqlandi'));
      renderProfile();
    } catch (error) {
      showToast(error instanceof Error ? error.message : pick('Не удалось сохранить', 'Saqlab bo‘lmadi'));
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

function renderOnboarding(selectedLanguage = null) {
  showTabs(false);
  state.screen = 'onboarding';
  if (selectedLanguage === null) {
    content.innerHTML = `<section class="screen without-tabs">
      <div class="eyebrow">HOT TICKET</div>
      <h1>Tilni tanlang</h1>
      <div class="subtitle" style="margin-bottom:24px">Выберите язык</div>
      <div class="choice-list">
        <button class="choice" type="button" data-onboarding-language="uz">🇺🇿 O‘zbekcha</button>
        <button class="choice" type="button" data-onboarding-language="ru">🇷🇺 Русский</button>
      </div>
    </section>`;
    document.querySelectorAll('[data-onboarding-language]').forEach((button) => {
      button.addEventListener('click', () => renderOnboarding(button.dataset.onboardingLanguage));
    });
    return;
  }

  const uz = selectedLanguage === 'uz';
  content.innerHTML = `<section class="screen without-tabs">
    <div class="back-row"><button id="onboarding-back" class="back-button" type="button" aria-label="${uz ? 'Orqaga' : 'Назад'}">${icon('chevron-left')}</button></div>
    <div class="eyebrow">HOT TICKET</div>
    <h1>${uz ? 'Uchish shahrini tanlang' : 'Выберите город вылета'}</h1>
    <div class="subtitle" style="margin-bottom:20px">${uz ? 'Faqat O‘zbekiston shaharlari' : 'Только города Узбекистана'}</div>
    <div class="choice-list">${uzbekistanOrigins.map((code) => (
      `<button class="choice" type="button" data-onboarding-origin="${code}">${escapeHtml(originName(code, selectedLanguage))} (${code})</button>`
    )).join('')}</div>
  </section>`;
  document.querySelector('#onboarding-back')?.addEventListener('click', () => renderOnboarding());
  document.querySelectorAll('[data-onboarding-origin]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        state.profile = await api('/api/v1/onboarding', {
          method: 'POST',
          body: JSON.stringify({
            languageCode: selectedLanguage,
            defaultOriginCode: button.dataset.onboardingOrigin
          })
        });
        haptic('medium');
        const nextUrl = new globalThis.URL(globalThis.location.href);
        nextUrl.searchParams.set('lang', selectedLanguage);
        globalThis.location.replace(nextUrl.toString());
      } catch (error) {
        showToast(error instanceof Error ? error.message : (uz ? 'Tanlovni saqlab bo‘lmadi' : 'Не удалось сохранить выбор'));
      }
    });
  });
}

async function bootstrap() {
  loadingScreen();
  try {
    state.profile = await api('/api/v1/me');
    if (!state.profile.onboardingCompleted) {
      renderOnboarding();
      return;
    }
    if (
      requestedLanguage === null
      && ['ru', 'uz'].includes(state.profile.languageCode)
      && state.profile.languageCode !== language
    ) {
      const nextUrl = new globalThis.URL(globalThis.location.href);
      nextUrl.searchParams.set('lang', state.profile.languageCode);
      globalThis.location.replace(nextUrl.toString());
      return;
    }
    await loadCurrentView();
  } catch (error) {
    errorScreen(error, bootstrap);
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

const navLabels = {
  deals: pick('Deals', 'Chiptalar'),
  watchlist: pick('Watchlist', 'Kuzatuvlar'),
  profile: pick('Профиль', 'Profil')
};
document.querySelectorAll('[data-view]').forEach((button) => {
  const label = button.querySelector('span:last-child');
  if (label) label.textContent = navLabels[button.dataset.view] ?? label.textContent;
});
bottomNav?.setAttribute('aria-label', pick('Основная навигация', 'Asosiy navigatsiya'));
content?.querySelector('.screen-loader')?.setAttribute('aria-label', pick('Загрузка', 'Yuklanmoqda'));

if (!demoMode && !telegram?.initData) {
  showTabs(false);
  content.innerHTML = `<section class="screen locked-state"><span class="state-icon">${icon('ticket')}</span><div class="state-title">${pick('Откройте Hot Ticket из Telegram', 'Hot Ticket’ni Telegram orqali oching')}</div><div class="state-copy">${pick('Mini App использует Telegram для безопасного входа и доступа к вашим отслеживаниям.', 'Mini App xavfsiz kirish va kuzatuvlaringizga ruxsat olish uchun Telegram’dan foydalanadi.')}</div></section>`;
} else {
  applyTelegramChrome();
  telegram?.ready();
  telegram?.expand();
  void bootstrap();
}
