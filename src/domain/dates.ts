import { ValidationError } from './errors.js';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertIsoDate(value: string): string {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) {
    throw new ValidationError('Некорректная дата');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new ValidationError('Некорректная дата');
  }

  return value;
}

export function isDateInRange(value: string, from: string, to: string): boolean {
  const normalizedValue = assertIsoDate(value);
  const normalizedFrom = assertIsoDate(from);
  const normalizedTo = assertIsoDate(to);

  if (normalizedFrom > normalizedTo) {
    throw new ValidationError('Начальная дата позже конечной');
  }

  return normalizedValue >= normalizedFrom && normalizedValue <= normalizedTo;
}

