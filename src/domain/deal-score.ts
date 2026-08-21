import type { RouteDailyPoint } from './route-price.js';

export type PriceTrend = 'falling' | 'rising' | 'flat';
export type DealLevel = 'insufficient_data' | 'stable' | 'regular' | 'good' | 'great' | 'lowest';

export interface DealScore {
  readonly level: DealLevel;
  readonly sampleDays: number;
  readonly percentile: number | null;
  readonly daysBelow: number;
  readonly minPrice: number | null;
  readonly medianPrice: number | null;
  readonly maxPrice: number | null;
  readonly trend: PriceTrend | null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const right = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return right;
  const left = sorted[middle - 1] ?? right;
  return Math.round((left + right) / 2);
}

function trend(points: readonly RouteDailyPoint[]): PriceTrend | null {
  const recent = points.slice(-3);
  if (recent.length < 2) return null;
  const first = recent[0]?.minPrice ?? 0;
  const last = recent.at(-1)?.minPrice ?? 0;
  if (last < first) return 'falling';
  if (last > first) return 'rising';
  return 'flat';
}

export function calculateDealScore(
  price: number,
  points: readonly RouteDailyPoint[],
  minimumSampleDays = 7
): DealScore {
  const prices = points.map((point) => point.minPrice);
  if (prices.length === 0) {
    return {
      level: 'insufficient_data',
      sampleDays: 0,
      percentile: null,
      daysBelow: 0,
      minPrice: null,
      medianPrice: null,
      maxPrice: null,
      trend: null
    };
  }

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const medianPrice = median(prices);
  const daysBelow = prices.filter((value) => value < price).length;
  const percentile = Math.floor(
    (prices.filter((value) => value > price).length / prices.length) * 100
  );
  const common = {
    sampleDays: prices.length,
    daysBelow,
    minPrice,
    medianPrice,
    maxPrice,
    trend: trend(points)
  };

  if (prices.length < minimumSampleDays) {
    return { ...common, level: 'insufficient_data', percentile: null };
  }
  if ((maxPrice - minPrice) / medianPrice < 0.05) {
    return { ...common, level: 'stable', percentile };
  }
  if (daysBelow === 0) return { ...common, level: 'lowest', percentile };
  if (percentile >= 90) return { ...common, level: 'great', percentile };
  if (percentile >= 75) return { ...common, level: 'good', percentile };
  return { ...common, level: 'regular', percentile };
}
