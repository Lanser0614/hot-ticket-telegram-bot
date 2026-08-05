import { ValidationError } from './errors.js';

export const DEFAULT_ORIGIN_CODE = 'TAS';
export const DEFAULT_CURRENCY_CODE = 'UZS';
export const TICKET_PAGE_SIZE = 10;

export type TripClass = 'economy' | 'business';

export interface UserTicketPreferences {
  readonly preferredTripClass: TripClass;
  readonly baggageRequired: boolean;
}

export function assertTripClass(value: string): TripClass {
  const normalized = value.trim().toLowerCase();
  if (normalized !== 'economy' && normalized !== 'business') {
    throw new ValidationError('Некорректный класс перелёта');
  }
  return normalized;
}

export function matchesUserTicketPreferences(
  ticket: { readonly tripClass: TripClass; readonly hasBaggage: boolean },
  preferences: UserTicketPreferences
): boolean {
  return ticket.tripClass === preferences.preferredTripClass
    && (!preferences.baggageRequired || ticket.hasBaggage);
}

export function presentTripClass(value: TripClass): string {
  return value === 'economy' ? 'Эконом' : 'Бизнес';
}

export function presentBaggage(required: boolean): string {
  return required ? 'Только с багажом' : 'Не важно';
}
