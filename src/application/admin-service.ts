import type { TripClass } from '../domain/travel-preferences.js';
import { getLocationCountryCode, getLocationName } from '../domain/locations.js';

const DOMESTIC_COUNTRY_CODE = 'UZ';
const DEFAULT_PAGE_SIZE = 50;

export type AdminScope = 'all' | 'domestic' | 'international';
export type AdminTripFilter = 'all' | 'round' | 'oneway';
export type AdminSort = 'city' | 'price' | 'date';
export type SortDirection = 'asc' | 'desc';
export type AdminPricePeriod = 30 | 90 | 180 | 365;

export interface AdminPriceAnalyticsQuery {
  readonly destinationCode: string | null;
  readonly originCode: string | null;
  readonly periodDays: AdminPricePeriod;
}

export interface AdminRoutePriceSeries {
  readonly originCode: string;
  readonly destinationCode: string;
  readonly tripClass: TripClass;
  readonly observationDays: number;
  readonly averagePrice: number;
  readonly points: readonly { readonly day: string; readonly price: number }[];
}

export interface AdminPriceAnalytics {
  readonly query: AdminPriceAnalyticsQuery;
  readonly origins: readonly string[];
  readonly series: readonly AdminRoutePriceSeries[];
}

export interface AdminTicketRecord {
  readonly id: number;
  readonly originCode: string;
  readonly destinationCode: string;
  readonly price: number;
  readonly currencyCode: string;
  readonly departureDate: string;
  readonly returnDate: string | null;
  readonly isDirect: boolean;
  readonly tripClass: TripClass;
  readonly hasBaggage: boolean;
  readonly ticketLink: string;
}

export interface AdminStatsRecord {
  readonly totalTickets: number;
  readonly users: number;
  readonly activeSubscriptions: number;
  readonly userStats: AdminUserStats;
  readonly priceStats: AdminPriceStats;
  readonly clickStats: AdminClickStats;
  readonly lastSync: AdminSyncRun | null;
}

export interface AdminUserStats {
  readonly active: number;
  readonly new7Days: number;
  readonly new30Days: number;
  readonly withActiveSubscriptions: number;
  readonly referralsTotal: number;
  readonly referrals30Days: number;
  readonly recent: readonly AdminUserRecord[];
}

export interface AdminUserRecord {
  readonly id: number;
  readonly telegramUserId: number;
  readonly username: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly isActive: boolean;
  readonly activeSubscriptions: number;
  readonly clicks30Days: number;
  readonly referralCount: number;
  readonly createdAt: Date;
}

export interface AdminPriceStats {
  readonly currentMinPrice: number | null;
  readonly currentAveragePrice: number | null;
  readonly currentMaxPrice: number | null;
  readonly trend30Days: readonly AdminPricePoint[];
  readonly routes30Days: readonly AdminRoutePriceRecord[];
}

export interface AdminPricePoint {
  readonly day: string;
  readonly minPrice: number;
  readonly averageMinPrice: number;
  readonly maxPrice: number;
  readonly sampleCount: number;
}

export interface AdminRoutePriceRecord {
  readonly originCode: string;
  readonly destinationCode: string;
  readonly tripClass: TripClass;
  readonly minPrice: number;
  readonly averagePrice: number;
  readonly maxPrice: number;
  readonly sampleCount: number;
  readonly observedDays: number;
}

export interface AdminClickStats {
  readonly clicks24Hours: number;
  readonly clicks7Days: number;
  readonly clicks30Days: number;
  readonly uniqueUsers30Days: number;
  readonly bySource30Days: readonly {
    readonly source: string;
    readonly count: number;
  }[];
  readonly daily30Days: readonly AdminClickPoint[];
  readonly topRoutes30Days: readonly AdminClickRouteRecord[];
}

export interface AdminClickPoint {
  readonly day: string;
  readonly clicks: number;
  readonly uniqueUsers: number;
}

export interface AdminClickRouteRecord {
  readonly originCode: string;
  readonly destinationCode: string;
  readonly clicks: number;
  readonly uniqueUsers: number;
  readonly averagePrice: number;
}

export interface AdminSyncRun {
  readonly status: string;
  readonly finishedAt: Date | null;
  readonly fetchedCount: number;
  readonly insertedCount: number;
  readonly updatedCount: number;
}

export interface AdminRepository {
  listActiveTickets(): Promise<readonly AdminTicketRecord[]>;
  listCachedDestinations(): Promise<readonly string[]>;
  getStats(): Promise<AdminStatsRecord>;
  getPriceAnalytics(query: AdminPriceAnalyticsQuery): Promise<AdminPriceAnalytics>;
}

export interface AdminDestinationOption {
  readonly code: string;
  readonly name: string;
}

export interface AdminTicketView {
  readonly id: number;
  readonly originCode: string;
  readonly destinationCode: string;
  readonly destinationName: string;
  readonly scope: 'domestic' | 'international';
  readonly price: number;
  readonly currencyCode: string;
  readonly departureDate: string;
  readonly returnDate: string | null;
  readonly roundTrip: boolean;
  readonly isDirect: boolean;
  readonly tripClass: TripClass;
  readonly hasBaggage: boolean;
  readonly ticketLink: string;
}

export interface AdminQuery {
  readonly scope: AdminScope;
  readonly trip: AdminTripFilter;
  readonly date: string;
  readonly returnDate: string;
  readonly sort: AdminSort;
  readonly direction: SortDirection;
  readonly search: string;
  readonly page: number;
  readonly priceDestinationCode?: string | null;
  readonly priceOriginCode?: string | null;
  readonly pricePeriodDays?: AdminPricePeriod;
}

export interface AdminDashboard {
  readonly query: AdminQuery;
  readonly rows: readonly AdminTicketView[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly pageSize: number;
  readonly counts: {
    readonly active: number;
    readonly domestic: number;
    readonly international: number;
    readonly roundTrip: number;
    readonly oneWay: number;
  };
  readonly destinations: readonly AdminDestinationOption[];
  readonly stats: AdminStatsRecord;
  readonly priceAnalytics?: AdminPriceAnalytics;
}

function toView(record: AdminTicketRecord): AdminTicketView {
  const domestic = getLocationCountryCode(record.destinationCode) === DOMESTIC_COUNTRY_CODE;
  return {
    id: record.id,
    originCode: record.originCode,
    destinationCode: record.destinationCode,
    destinationName: getLocationName(record.destinationCode) ?? record.destinationCode,
    scope: domestic ? 'domestic' : 'international',
    price: record.price,
    currencyCode: record.currencyCode,
    departureDate: record.departureDate,
    returnDate: record.returnDate,
    roundTrip: record.returnDate !== null,
    isDirect: record.isDirect,
    tripClass: record.tripClass,
    hasBaggage: record.hasBaggage,
    ticketLink: record.ticketLink
  };
}

function compare(left: AdminTicketView, right: AdminTicketView, sort: AdminSort): number {
  if (sort === 'price') return left.price - right.price || left.id - right.id;
  if (sort === 'date') {
    return left.departureDate.localeCompare(right.departureDate)
      || left.price - right.price
      || left.id - right.id;
  }
  return left.destinationName.localeCompare(right.destinationName, 'ru')
    || left.price - right.price
    || left.id - right.id;
}

export class AdminService {
  public constructor(
    private readonly repository: AdminRepository,
    private readonly pageSize: number = DEFAULT_PAGE_SIZE
  ) {}

  public async getDashboard(query: AdminQuery): Promise<AdminDashboard> {
    const priceQuery: AdminPriceAnalyticsQuery = {
      destinationCode: query.priceDestinationCode ?? null,
      originCode: query.priceOriginCode ?? null,
      periodDays: query.pricePeriodDays ?? 30
    };
    const [records, cachedDestinationCodes, stats, priceAnalytics] = await Promise.all([
      this.repository.listActiveTickets(),
      this.repository.listCachedDestinations(),
      this.repository.getStats(),
      this.repository.getPriceAnalytics(priceQuery)
    ]);
    const views = records.map(toView);
    const domestic = views.filter((view) => view.scope === 'domestic').length;
    const roundTrip = views.filter((view) => view.roundTrip).length;

    const destinations = [...new Set(cachedDestinationCodes)].map((code) => ({
      code,
      name: getLocationName(code) ?? code
    })).sort((left, right) => left.name.localeCompare(right.name, 'ru')
      || left.code.localeCompare(right.code));

    const search = query.search.trim().toLocaleLowerCase('ru-RU');
    const date = query.date.trim();
    const returnDate = query.returnDate.trim();
    const filtered = views.filter((view) => {
      if (query.scope !== 'all' && view.scope !== query.scope) return false;
      if (query.trip === 'round' && !view.roundTrip) return false;
      if (query.trip === 'oneway' && view.roundTrip) return false;
      if (date.length > 0 && view.departureDate !== date) return false;
      if (returnDate.length > 0 && view.returnDate !== returnDate) return false;
      if (search.length === 0) return true;
      return view.originCode.toLocaleLowerCase('ru-RU').includes(search)
        || view.destinationName.toLocaleLowerCase('ru-RU').includes(search)
        || view.destinationCode.toLocaleLowerCase('ru-RU').includes(search);
    });

    filtered.sort((left, right) => {
      const ordered = compare(left, right, query.sort);
      return query.direction === 'desc' ? -ordered : ordered;
    });

    const total = filtered.length;
    const pageCount = Math.max(1, Math.ceil(total / this.pageSize));
    const page = Math.min(Math.max(1, query.page), pageCount);
    const offset = (page - 1) * this.pageSize;
    const rows = filtered.slice(offset, offset + this.pageSize);

    return {
      query: { ...query, page },
      rows,
      total,
      page,
      pageCount,
      pageSize: this.pageSize,
      counts: {
        active: views.length,
        domestic,
        international: views.length - domestic,
        roundTrip,
        oneWay: views.length - roundTrip
      },
      destinations,
      stats,
      priceAnalytics
    };
  }
}
