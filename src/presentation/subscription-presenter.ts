import type { Subscription } from '../domain/subscription.js';
import { formatLocationLabel } from '../domain/locations.js';

export function presentSubscription(subscription: Subscription): string {
  const destination = subscription.destinationCode === null
    ? 'любое направление'
    : formatLocationLabel(subscription.destinationCode);
  const price = subscription.maxPrice === null
    ? 'без ограничения'
    : `${new Intl.NumberFormat('ru-RU').format(subscription.maxPrice)} ${subscription.currencyCode}`;
  return [
    `🔔 ${formatLocationLabel(subscription.originCode)} → ${destination}`,
    `Период: ${subscription.departureDateFrom}–${subscription.departureDateTo}`,
    `Максимальная цена: ${price}`,
    `Рейс: ${subscription.directOnly ? 'только прямой' : 'любой'}`,
    `Статус: ${subscription.isActive ? 'активна' : 'отключена'}`
  ].join('\n');
}
