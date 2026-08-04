import { ValidationError } from './errors.js';

export interface HotOffersInput {
  originCode: string;
  currencyCode: string;
}

export function normalizeIataCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{3}$/.test(normalized)) {
    throw new ValidationError('Некорректный IATA-код');
  }
  return normalized;
}

export function normalizeCurrencyCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new ValidationError('Некорректный код валюты');
  }
  return normalized;
}

export function validateHotOffersInput(input: HotOffersInput): HotOffersInput {
  return {
    originCode: normalizeIataCode(input.originCode),
    currencyCode: normalizeCurrencyCode(input.currencyCode)
  };
}

