import type { StoredTicket } from '../application/models.js';
import { formatLocationLabel } from '../domain/locations.js';
import { presentTripClass } from '../domain/travel-preferences.js';

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Tashkent'
  }).format(new Date(`${isoDate}T00:00:00+05:00`));
}

export function presentTicket(ticket: StoredTicket): string {
  const price = new Intl.NumberFormat('ru-RU').format(ticket.price);
  const roundTrip = ticket.returnDate !== null;
  const lines = [
    `✈️ <b>${escapeHtml(formatLocationLabel(ticket.originCode))} → ${escapeHtml(formatLocationLabel(ticket.destinationCode))}</b>`,
    '',
    `🔁 Тип: ${roundTrip ? 'туда-обратно' : 'в одну сторону'}`,
    `📅 Вылет: ${formatDate(ticket.departureDate)}`
  ];
  if (ticket.returnDate !== null) {
    lines.push(`📅 Обратно: ${formatDate(ticket.returnDate)}`);
  }
  lines.push(
    `💰 Цена: ${price} ${escapeHtml(ticket.currencyCode)}`,
    `🛫 Рейс: ${ticket.isDirect ? 'прямой' : 'с пересадкой'}`,
    `💺 Класс: ${presentTripClass(ticket.tripClass)}`,
    `🧳 Багаж: ${ticket.hasBaggage ? 'включён' : 'не включён'}`,
    '',
    'Предложение может измениться после перехода на сайт.'
  );
  return lines.join('\n');
}
