import type { Subscription } from '../domain/subscription.js';

export function presentSubscription(subscription: Subscription): string {
  const destination = subscription.destinationCode ?? 'любое направление';
  const price = subscription.maxPrice === null
    ? 'без ограничения'
    : `${new Intl.NumberFormat('ru-RU').format(subscription.maxPrice)} ${subscription.currencyCode}`;
  return [
    `🔔 ${subscription.originCode} → ${destination}`,
    `Период: ${subscription.departureDateFrom}–${subscription.departureDateTo}`,
    `Максимальная цена: ${price}`,
    `Рейс: ${subscription.directOnly ? 'только прямой' : 'любой'}`,
    `Статус: ${subscription.isActive ? 'активна' : 'отключена'}`
  ].join('\n');
}

