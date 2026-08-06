import type { TripClass } from '../domain/travel-preferences.js';
import { getLocationCountryCode, getLocationName } from '../domain/locations.js';

const DOMESTIC_COUNTRY_CODE = 'UZ';
const DEFAULT_PAGE_SIZE = 50;

export type AdminScope = 'all' | 'domestic' | 'international';
export type AdminTripFilter = 'all' | 'round' | 'oneway';
export type AdminSort = 'city' | 'price' | 'date';
export type SortDirection = 'asc' | 'desc';

export interface AdminTicketRecord {
  readonly id: number;
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
  readonly lastSync: AdminSyncRun | null;
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
  getStats(): Promise<AdminStatsRecord>;
}

export interface AdminTicketView {
  readonly id: number;
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
  readonly departureDates: readonly string[];
  readonly returnDates: readonly string[];
  readonly stats: AdminStatsRecord;
}

function toView(record: AdminTicketRecord): AdminTicketView {
  const domestic = getLocationCountryCode(record.destinationCode) === DOMESTIC_COUNTRY_CODE;
  return {
    id: record.id,
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
    const [records, stats] = await Promise.all([
      this.repository.listActiveTickets(),
      this.repository.getStats()
    ]);
    const views = records.map(toView);
    const domestic = views.filter((view) => view.scope === 'domestic').length;
    const roundTrip = views.filter((view) => view.roundTrip).length;

    const departureDates = [...new Set(views.map((view) => view.departureDate))].sort();
    const returnDates = [...new Set(
      views.map((view) => view.returnDate).filter((value): value is string => value !== null)
    )].sort();

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
      return view.destinationName.toLocaleLowerCase('ru-RU').includes(search)
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
      departureDates,
      returnDates,
      stats
    };
  }
}
