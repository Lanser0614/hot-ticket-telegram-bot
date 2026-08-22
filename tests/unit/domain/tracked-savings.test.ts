import { describe, expect, it } from 'vitest';

import { calculateTrackedSavingsSnapshot } from '../../../src/domain/tracked-savings.js';
import type { RouteDailyPoint } from '../../../src/domain/route-price.js';

function history(prices: readonly number[]): readonly RouteDailyPoint[] {
  return prices.map((price, index) => ({
    day: `2026-08-${String(index + 1).padStart(2, '0')}`,
    minPrice: price,
    averagePrice: price,
    medianPrice: price,
    maxPrice: price,
    sampleCount: 1
  }));
}

describe('tracked savings', () => {
  it('считает разницу с медианой при 7 и более днях данных', () => {
    expect(calculateTrackedSavingsSnapshot(
      1_500_000,
      'UZS',
      history([1_700_000, 1_800_000, 1_900_000, 2_000_000, 2_100_000, 2_200_000, 2_300_000])
    )).toEqual({ benchmarkPrice: 2_000_000, estimatedSavings: 500_000 });
  });

  it('не создаёт метрику при недостаточной выборке или другой валюте', () => {
    expect(calculateTrackedSavingsSnapshot(1_000_000, 'UZS', history([1_200_000])))
      .toEqual({ benchmarkPrice: null, estimatedSavings: null });
    expect(calculateTrackedSavingsSnapshot(100, 'USD', history(Array(7).fill(150))))
      .toEqual({ benchmarkPrice: null, estimatedSavings: null });
  });

  it('не показывает отрицательную экономию', () => {
    expect(calculateTrackedSavingsSnapshot(2_500_000, 'UZS', history(Array(7).fill(2_000_000))))
      .toEqual({ benchmarkPrice: 2_000_000, estimatedSavings: 0 });
  });
});
