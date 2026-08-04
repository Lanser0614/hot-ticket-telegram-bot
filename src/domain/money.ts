import { ValidationError } from './errors.js';

export function assertMoney(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError('Некорректная цена');
  }
  return value;
}

