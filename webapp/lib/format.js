export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

let activeLocale = 'ru-RU';

export function setFormatLanguage(languageCode) {
  activeLocale = String(languageCode ?? '').toLowerCase().startsWith('uz') ? 'uz-UZ' : 'ru-RU';
}

export function formatPrice(value) {
  return new Intl.NumberFormat(activeLocale).format(value).replace(/[,\u00a0\u202f]/gu, ' ');
}

export function formatDate(value, options = { day: 'numeric', month: 'short' }) {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (activeLocale === 'uz-UZ' && options.day === 'numeric' && options.month === 'short') {
    const months = ['yan.', 'fev.', 'mar.', 'apr.', 'may', 'iyun', 'iyul', 'avg.', 'sen.', 'okt.', 'noy.', 'dek.'];
    return `${day} ${months[month - 1]}`;
  }
  return new Intl.DateTimeFormat(activeLocale, options).format(new Date(Date.UTC(year, month - 1, day)));
}

export function todayInTashkent(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function minutesToTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function timeToMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}
