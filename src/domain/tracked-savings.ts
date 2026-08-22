import { calculateDealScore } from './deal-score.js';
import type { RouteDailyPoint } from './route-price.js';

export interface TrackedSavingsSnapshot {
  readonly benchmarkPrice: number | null;
  readonly estimatedSavings: number | null;
}

export function calculateTrackedSavingsSnapshot(
  ticketPrice: number,
  currencyCode: string,
  history: readonly RouteDailyPoint[]
): TrackedSavingsSnapshot {
  if (currencyCode !== 'UZS') return { benchmarkPrice: null, estimatedSavings: null };
  const score = calculateDealScore(ticketPrice, history);
  if (score.sampleDays < 7 || score.medianPrice === null) {
    return { benchmarkPrice: null, estimatedSavings: null };
  }
  return {
    benchmarkPrice: score.medianPrice,
    estimatedSavings: Math.max(0, score.medianPrice - ticketPrice)
  };
}
