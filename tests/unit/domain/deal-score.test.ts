import { describe, expect, it } from 'vitest';

import { calculateDealScore } from '../../../src/domain/deal-score.js';
import type { RouteDailyPoint } from '../../../src/domain/route-price.js';

function points(prices: readonly number[]): readonly RouteDailyPoint[] {
  return prices.map((price, index) => ({
    day: `2026-08-${String(index + 1).padStart(2, '0')}`,
    minPrice: price,
    averagePrice: price,
    medianPrice: price,
    maxPrice: price,
    sampleCount: 1
  }));
}

describe('deal score', () => {
  it('не делает сильный вывод до семи дней истории', () => {
    expect(calculateDealScore(1_500_000, points([2_000_000, 1_900_000]))).toMatchObject({
      level: 'insufficient_data',
      sampleDays: 2,
      percentile: null
    });
  });

  it('помечает цену ниже всех дней как lowest', () => {
    expect(calculateDealScore(
      1_400_000,
      points([2_400_000, 2_300_000, 2_200_000, 2_100_000, 2_000_000, 1_900_000, 1_800_000])
    )).toMatchObject({
      level: 'lowest',
      percentile: 100,
      daysBelow: 0,
      trend: 'falling'
    });
  });

  it('не называет стабильный маршрут горячей сделкой', () => {
    expect(calculateDealScore(
      1_970_000,
      points([2_000_000, 2_010_000, 1_990_000, 2_020_000, 2_000_000, 1_980_000, 2_010_000])
    ).level).toBe('stable');
  });
});
