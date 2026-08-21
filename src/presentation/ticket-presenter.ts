import type { StoredTicket } from '../application/models.js';
import { formatLocalizedLocationLabel } from '../domain/locations.js';
import { presentTripClass } from '../domain/travel-preferences.js';
import type { AppLanguage } from './language.js';
import { localeForLanguage } from './language.js';

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function formatDate(isoDate: string, language: AppLanguage): string {
  return new Intl.DateTimeFormat(localeForLanguage(language), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Tashkent'
  }).format(new Date(`${isoDate}T00:00:00+05:00`));
}

export function presentTicket(ticket: StoredTicket, language: AppLanguage = 'ru'): string {
  const price = new Intl.NumberFormat(localeForLanguage(language)).format(ticket.price);
  const roundTrip = ticket.returnDate !== null;
  const uz = language === 'uz';
  const lines = [
    `✈️ <b>${escapeHtml(formatLocalizedLocationLabel(ticket.originCode, language))} → ${escapeHtml(formatLocalizedLocationLabel(ticket.destinationCode, language))}</b>`,
    '',
    `🔁 ${uz ? 'Turi' : 'Тип'}: ${roundTrip ? (uz ? 'borib-kelish' : 'туда-обратно') : (uz ? 'bir tomonga' : 'в одну сторону')}`,
    `📅 ${uz ? 'Uchish' : 'Вылет'}: ${formatDate(ticket.departureDate, language)}`
  ];
  if (ticket.returnDate !== null) {
    lines.push(`📅 ${uz ? 'Qaytish' : 'Обратно'}: ${formatDate(ticket.returnDate, language)}`);
  }
  lines.push(
    `💰 ${uz ? 'Narx' : 'Цена'}: ${price} ${escapeHtml(ticket.currencyCode)}`,
    `🛫 ${uz ? 'Reys' : 'Рейс'}: ${ticket.isDirect ? (uz ? 'to‘g‘ridan-to‘g‘ri' : 'прямой') : (uz ? 'almashib' : 'с пересадкой')}`,
    `💺 ${uz ? 'Klass' : 'Класс'}: ${uz ? (ticket.tripClass === 'economy' ? 'Ekonom' : 'Biznes') : presentTripClass(ticket.tripClass)}`,
    `🧳 ${uz ? 'Bagaj' : 'Багаж'}: ${ticket.hasBaggage ? (uz ? 'kiritilgan' : 'включён') : (uz ? 'kiritilmagan' : 'не включён')}`,
    '',
    uz
      ? 'Saytga o‘tgandan keyin taklif o‘zgarishi mumkin.'
      : 'Предложение может измениться после перехода на сайт.'
  );
  return lines.join('\n');
}
