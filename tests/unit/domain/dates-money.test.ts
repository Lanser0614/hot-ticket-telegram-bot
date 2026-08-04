import { describe, expect, it } from 'vitest';

import { assertIsoDate, isDateInRange } from '../../../src/domain/dates.js';
import { ValidationError } from '../../../src/domain/errors.js';
import { assertMoney } from '../../../src/domain/money.js';

describe('календарные даты', () => {
  it.each(['2026-08-15', '2024-02-29'])('принимает %s', (value) => {
    expect(assertIsoDate(value)).toBe(value);
  });

  it.each(['', '15.08.2026', '2026-2-01', '2026-02-30', '2025-02-29'])('отклоняет %j', (value) => {
    expect(() => assertIsoDate(value)).toThrow(ValidationError);
  });

  it('проверяет диапазон включительно', () => {
    expect(isDateInRange('2026-08-15', '2026-08-15', '2026-08-20')).toBe(true);
    expect(isDateInRange('2026-08-20', '2026-08-15', '2026-08-20')).toBe(true);
    expect(isDateInRange('2026-08-21', '2026-08-15', '2026-08-20')).toBe(false);
  });
});

describe('денежные значения', () => {
  it.each([0, 1, 2_395_739, Number.MAX_SAFE_INTEGER])('принимает %d', (value) => {
    expect(assertMoney(value)).toBe(value);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'отклоняет %s',
    (value) => {
      expect(() => assertMoney(value)).toThrow(ValidationError);
    }
  );
});

