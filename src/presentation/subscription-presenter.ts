import type { Subscription } from '../domain/subscription.js';
import { formatLocalizedLocationLabel } from '../domain/locations.js';
import type { AppLanguage } from './language.js';
import { localeForLanguage } from './language.js';

export function presentSubscription(
  subscription: Subscription,
  language: AppLanguage = 'ru'
): string {
  const uz = language === 'uz';
  const destination = subscription.destinationCode === null
    ? (uz ? 'istalgan yo‘nalish' : 'любое направление')
    : formatLocalizedLocationLabel(subscription.destinationCode, language);
  const price = subscription.maxPrice === null
    ? (uz ? 'cheklovsiz' : 'без ограничения')
    : `${new Intl.NumberFormat(localeForLanguage(language)).format(subscription.maxPrice)} ${subscription.currencyCode}`;
  return [
    `🔔 ${formatLocalizedLocationLabel(subscription.originCode, language)} → ${destination}`,
    `${uz ? 'Davr' : 'Период'}: ${subscription.departureDateFrom}–${subscription.departureDateTo}`,
    `${uz ? 'Eng yuqori narx' : 'Максимальная цена'}: ${price}`,
    `${uz ? 'Reys' : 'Рейс'}: ${subscription.directOnly ? (uz ? 'faqat to‘g‘ridan-to‘g‘ri' : 'только прямой') : (uz ? 'istalgan' : 'любой')}`,
    `${uz ? 'Chipta' : 'Билет'}: ${subscription.roundTripOnly ? (uz ? 'faqat borib-kelish' : 'только туда-обратно') : (uz ? 'istalgan' : 'любой')}`,
    `${uz ? 'Holat' : 'Статус'}: ${subscription.isActive ? (uz ? 'faol' : 'активна') : (uz ? 'o‘chirilgan' : 'отключена')}`
  ].join('\n');
}
