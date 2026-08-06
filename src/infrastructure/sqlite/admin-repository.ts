import type {
  AdminRepository,
  AdminStatsRecord,
  AdminSyncRun,
  AdminTicketRecord
} from '../../application/admin-service.js';
import type { TripClass } from '../../domain/travel-preferences.js';
import type { RawDatabase } from './repositories.js';

type Row = Readonly<Record<string, unknown>>;

function asNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError('База вернула некорректное число');
  }
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('База вернула некорректную строку');
  return value;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return asString(value);
}

function asTripClass(value: unknown): TripClass {
  const raw = asString(value);
  if (raw === 'economy' || raw === 'business') return raw;
  throw new TypeError('База вернула некорректный класс');
}

function mapRecord(row: Row): AdminTicketRecord {
  return {
    id: asNumber(row.id),
    destinationCode: asString(row.destination_code),
    price: asNumber(row.price),
    currencyCode: asString(row.currency_code),
    departureDate: asString(row.departure_date),
    returnDate: asNullableString(row.return_date),
    isDirect: asNumber(row.is_direct) === 1,
    tripClass: asTripClass(row.trip_class),
    hasBaggage: asNumber(row.has_baggage) === 1,
    ticketLink: asString(row.ticket_link)
  };
}

function mapLastSync(row: Row | null): AdminSyncRun | null {
  if (row === null) return null;
  const finishedAt = row.finished_at;
  return {
    status: asString(row.status),
    finishedAt: finishedAt === null || finishedAt === undefined
      ? null
      : new Date(asNumber(finishedAt) * 1_000),
    fetchedCount: asNumber(row.fetched_count),
    insertedCount: asNumber(row.inserted_count),
    updatedCount: asNumber(row.updated_count)
  };
}

export class SqliteAdminRepository implements AdminRepository {
  public constructor(private readonly db: RawDatabase) {}

  public async listActiveTickets(): Promise<readonly AdminTicketRecord[]> {
    const rows = await this.db.all(`
      SELECT id, destination_code, price, currency_code, departure_date, return_date,
             is_direct, trip_class, has_baggage, ticket_link
      FROM tickets WHERE is_active = 1
    `);
    return rows.map(mapRecord);
  }

  public async getStats(): Promise<AdminStatsRecord> {
    const totals = await this.db.get('SELECT count(*) AS count FROM tickets');
    const users = await this.db.get('SELECT count(*) AS count FROM users');
    const subscriptions = await this.db.get(
      'SELECT count(*) AS count FROM subscriptions WHERE is_active = 1'
    );
    const lastSync = await this.db.get(
      'SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1'
    );
    return {
      totalTickets: totals === null ? 0 : asNumber(totals.count),
      users: users === null ? 0 : asNumber(users.count),
      activeSubscriptions: subscriptions === null ? 0 : asNumber(subscriptions.count),
      lastSync: mapLastSync(lastSync)
    };
  }
}
