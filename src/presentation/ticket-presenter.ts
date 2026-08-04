import type { StoredTicket } from '../application/models.js';

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function presentTicket(ticket: StoredTicket): string {
  const departure = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Tashkent'
  }).format(new Date(`${ticket.departureDate}T00:00:00+05:00`));
  const price = new Intl.NumberFormat('ru-RU').format(ticket.price);
  return [
    `✈️ <b>${escapeHtml(ticket.originCode)} → ${escapeHtml(ticket.destinationCode)}</b>`,
    '',
    `📅 Вылет: ${departure}`,
    `💰 Цена: ${price} ${escapeHtml(ticket.currencyCode)}`,
    `🛫 Рейс: ${ticket.isDirect ? 'прямой' : 'с пересадкой'}`,
    `🧳 Багаж: ${ticket.hasBaggage ? 'включён' : 'не включён'}`,
    '',
    'Предложение может измениться после перехода на сайт.'
  ].join('\n');
}

