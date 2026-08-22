const now = new Date(Date.now() - 8 * 60_000).toISOString();

export const demoProfile = {
  telegramUserId: 100, firstName: 'Азиз', username: 'aziz_travel', languageCode: 'ru',
  defaultOriginCode: 'TAS', onboardingCompleted: true, preferredTripClass: 'economy',
  baggageRequired: true, instantNotificationsEnabled: true, morningDigestEnabled: false,
  quietHoursEnabled: true, quietStartMinute: 1380, quietEndMinute: 480,
  potentialSavings: 440_000
};

export const demoDeals = [
  {
    id: 1, originCode: 'TAS', originName: 'Ташкент', destinationCode: 'IST', destinationName: 'Стамбул',
    departureDate: '2026-09-12', returnDate: '2026-09-16', price: 1_480_000, currencyCode: 'UZS',
    airlineName: 'Turkish Airlines', isDirect: true, tripClass: 'economy', hasBaggage: true,
    lastSeenAt: now, dealScore: { level: 'very_good', percentile: 77, sampleDays: 24, minPrice: 1_450_000, medianPrice: 1_920_000, maxPrice: 2_390_000, trend: 'falling' },
    openUrl: 'https://www.aviasales.uz/'
  },
  {
    id: 2, originCode: 'TAS', originName: 'Ташкент', destinationCode: 'DXB', destinationName: 'Дубай',
    departureDate: '2026-10-03', returnDate: '2026-10-09', price: 2_160_000, currencyCode: 'UZS',
    airlineName: 'flydubai', isDirect: true, tripClass: 'economy', hasBaggage: true,
    lastSeenAt: now, dealScore: { level: 'good', percentile: 68, sampleDays: 24, minPrice: 2_080_000, medianPrice: 2_550_000, maxPrice: 3_040_000, trend: 'falling' }, openUrl: 'https://www.aviasales.uz/'
  },
  {
    id: 3, originCode: 'TAS', originName: 'Ташкент', destinationCode: 'ALA', destinationName: 'Алматы',
    departureDate: '2026-09-21', returnDate: null, price: 1_120_000, currencyCode: 'UZS',
    airlineName: 'Uzbekistan Airways', isDirect: true, tripClass: 'economy', hasBaggage: false,
    lastSeenAt: now, dealScore: { level: 'good', percentile: 64, sampleDays: 24, minPrice: 1_070_000, medianPrice: 1_340_000, maxPrice: 1_690_000, trend: 'falling' }, openUrl: 'https://www.aviasales.uz/'
  }
];

export const demoSubscriptions = [
  { id: 1, userId: 1, originCode: 'TAS', destinationCode: 'IST', currencyCode: 'UZS', departureDateFrom: '2026-08-22', departureDateTo: '2026-11-20', maxPrice: 1_330_000, directOnly: true, roundTripOnly: true, baggageRequired: true, tripClass: 'economy', isActive: true },
  { id: 2, userId: 1, originCode: 'TAS', destinationCode: 'DXB', currencyCode: 'UZS', departureDateFrom: '2026-09-01', departureDateTo: '2026-11-30', maxPrice: 2_100_000, directOnly: true, roundTripOnly: false, baggageRequired: true, tripClass: 'economy', isActive: true }
];

export const demoHistory = [2390000, 2210000, 2150000, 2080000, 1990000, 2040000, 1970000, 1910000, 1860000, 1920000, 1890000, 1820000, 1790000, 1750000, 1680000, 1600000, 1550000, 1500000, 1480000].map((price, index) => ({
  day: new Date(Date.UTC(2026, 7, 1 + index)).toISOString().slice(0, 10), minPrice: price,
  averagePrice: price + 50_000, medianPrice: price + 30_000, maxPrice: price + 180_000, sampleCount: 3
}));
