import type {
  AdminClickPoint,
  AdminClickRouteRecord,
  AdminPricePoint,
  AdminRepository,
  AdminRoutePriceRecord,
  AdminStatsRecord,
  AdminSyncRun,
  AdminTicketRecord,
  AdminUserRecord
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

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return asNumber(value);
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

function asStringArray(value: unknown): readonly string[] {
  if (typeof value !== 'string') throw new TypeError('База вернула некорректный JSON');
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new TypeError('База вернула некорректный список городов');
  }
  return parsed;
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

function mapUser(row: Row): AdminUserRecord {
  return {
    id: asNumber(row.id),
    telegramUserId: asNumber(row.telegram_user_id),
    username: asNullableString(row.username),
    firstName: asNullableString(row.first_name),
    lastName: asNullableString(row.last_name),
    isActive: asNumber(row.is_active) === 1,
    activeSubscriptions: asNumber(row.active_subscriptions),
    clicks30Days: asNumber(row.clicks_30d),
    referralCount: asNumber(row.referral_count),
    createdAt: new Date(asNumber(row.created_at) * 1_000)
  };
}

function mapPricePoint(row: Row): AdminPricePoint {
  return {
    day: asString(row.day),
    minPrice: asNumber(row.min_price),
    averageMinPrice: asNumber(row.average_min_price),
    maxPrice: asNumber(row.max_price),
    sampleCount: asNumber(row.sample_count)
  };
}

function mapRoutePrice(row: Row): AdminRoutePriceRecord {
  return {
    originCode: asString(row.origin_code),
    destinationCode: asString(row.destination_code),
    tripClass: asTripClass(row.trip_class),
    minPrice: asNumber(row.min_price),
    averagePrice: asNumber(row.average_price),
    maxPrice: asNumber(row.max_price),
    sampleCount: asNumber(row.sample_count),
    observedDays: asNumber(row.observed_days)
  };
}

function mapClickPoint(row: Row): AdminClickPoint {
  return {
    day: asString(row.day),
    clicks: asNumber(row.clicks),
    uniqueUsers: asNumber(row.unique_users)
  };
}

function mapClickRoute(row: Row): AdminClickRouteRecord {
  return {
    originCode: asString(row.origin_code),
    destinationCode: asString(row.destination_code),
    clicks: asNumber(row.clicks),
    uniqueUsers: asNumber(row.unique_users),
    averagePrice: asNumber(row.average_price)
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

  public async listCachedDestinations(): Promise<readonly string[]> {
    const rows = await this.db.all('SELECT destination_codes FROM destination_cache');
    const codes = new Set<string>();
    for (const row of rows) {
      for (const code of asStringArray(row.destination_codes)) codes.add(code);
    }
    return [...codes].sort();
  }

  public async getStats(): Promise<AdminStatsRecord> {
    const [
      totals,
      users,
      subscriptions,
      recentUsers,
      prices,
      priceTrend,
      routePrices,
      lastSync,
      clicks,
      clickSources,
      clickDaily,
      clickRoutes
    ] = await Promise.all([
      this.db.get('SELECT count(*) AS count FROM tickets'),
      this.db.get(`
        SELECT
          count(*) AS total,
          COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) AS active,
          COALESCE(SUM(CASE WHEN created_at >= unixepoch('now', '-7 days') THEN 1 ELSE 0 END), 0) AS new_7d,
          COALESCE(SUM(CASE WHEN created_at >= unixepoch('now', '-30 days') THEN 1 ELSE 0 END), 0) AS new_30d,
          COALESCE(SUM(CASE WHEN EXISTS (
            SELECT 1 FROM subscriptions s WHERE s.user_id = users.id AND s.is_active = 1
          ) THEN 1 ELSE 0 END), 0) AS with_subscriptions,
          (SELECT count(*) FROM referrals) AS referrals_total,
          (SELECT count(*) FROM referrals
            WHERE attributed_at >= unixepoch('now', '-30 days')) AS referrals_30d
        FROM users
      `),
      this.db.get('SELECT count(*) AS count FROM subscriptions WHERE is_active = 1'),
      this.db.all(`
        SELECT
          u.id,
          u.telegram_user_id,
          u.username,
          u.first_name,
          u.last_name,
          u.is_active,
          u.created_at,
          (SELECT count(*) FROM subscriptions s
            WHERE s.user_id = u.id AND s.is_active = 1) AS active_subscriptions,
          (SELECT count(*) FROM link_clicks c
            WHERE c.user_id = u.id
              AND c.user_agent_kind = 'human'
              AND c.clicked_at >= unixepoch('now', '-30 days')) AS clicks_30d,
          (SELECT count(*) FROM referrals r
            WHERE r.referrer_user_id = u.id) AS referral_count
        FROM users u
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT 12
      `),
      this.db.get(`
        SELECT
          min(price) AS min_price,
          round(avg(price)) AS average_price,
          max(price) AS max_price
        FROM tickets
        WHERE is_active = 1
      `),
      this.db.all(`
        SELECT
          day,
          min(min_price) AS min_price,
          round(avg(min_price)) AS average_min_price,
          max(max_price) AS max_price,
          sum(sample_count) AS sample_count
        FROM route_price_daily
        WHERE day >= date('now', '+5 hours', '-29 days')
        GROUP BY day
        ORDER BY day ASC
      `),
      this.db.all(`
        SELECT
          origin_code,
          destination_code,
          trip_class,
          min(min_price) AS min_price,
          round(avg(avg_price)) AS average_price,
          max(max_price) AS max_price,
          sum(sample_count) AS sample_count,
          count(*) AS observed_days
        FROM route_price_daily
        WHERE day >= date('now', '+5 hours', '-29 days')
        GROUP BY origin_code, destination_code, trip_class
        ORDER BY sample_count DESC, average_price ASC
        LIMIT 12
      `),
      this.db.get('SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1'),
      this.db.get(`
      SELECT
        COALESCE(SUM(CASE WHEN clicked_at >= unixepoch('now', '-1 day') THEN 1 ELSE 0 END), 0) AS clicks_24h,
        COALESCE(SUM(CASE WHEN clicked_at >= unixepoch('now', '-7 days') THEN 1 ELSE 0 END), 0) AS clicks_7d,
        COALESCE(SUM(CASE WHEN clicked_at >= unixepoch('now', '-30 days') THEN 1 ELSE 0 END), 0) AS clicks_30d,
        COUNT(DISTINCT CASE WHEN clicked_at >= unixepoch('now', '-30 days') THEN user_id END) AS users_30d
      FROM link_clicks
      WHERE user_agent_kind = 'human'
      `),
      this.db.all(`
        SELECT source, count(*) AS count
        FROM link_clicks
        WHERE user_agent_kind = 'human' AND clicked_at >= unixepoch('now', '-30 days')
        GROUP BY source
        ORDER BY count DESC, source ASC
      `),
      this.db.all(`
        WITH RECURSIVE days(day) AS (
          SELECT date('now', '-29 days')
          UNION ALL
          SELECT date(day, '+1 day') FROM days WHERE day < date('now')
        ), totals AS (
          SELECT
            date(clicked_at, 'unixepoch') AS day,
            count(*) AS clicks,
            count(DISTINCT user_id) AS unique_users
          FROM link_clicks
          WHERE user_agent_kind = 'human'
            AND clicked_at >= unixepoch('now', '-29 days', 'start of day')
          GROUP BY date(clicked_at, 'unixepoch')
        )
        SELECT
          days.day,
          COALESCE(totals.clicks, 0) AS clicks,
          COALESCE(totals.unique_users, 0) AS unique_users
        FROM days
        LEFT JOIN totals ON totals.day = days.day
        ORDER BY days.day ASC
      `),
      this.db.all(`
        SELECT
          origin_code,
          destination_code,
          count(*) AS clicks,
          count(DISTINCT user_id) AS unique_users,
          round(avg(price)) AS average_price
        FROM link_clicks
        WHERE user_agent_kind = 'human'
          AND clicked_at >= unixepoch('now', '-30 days')
        GROUP BY origin_code, destination_code
        ORDER BY clicks DESC, unique_users DESC, destination_code ASC
        LIMIT 10
      `)
    ]);
    return {
      totalTickets: totals === null ? 0 : asNumber(totals.count),
      users: users === null ? 0 : asNumber(users.total),
      activeSubscriptions: subscriptions === null ? 0 : asNumber(subscriptions.count),
      userStats: {
        active: users === null ? 0 : asNumber(users.active),
        new7Days: users === null ? 0 : asNumber(users.new_7d),
        new30Days: users === null ? 0 : asNumber(users.new_30d),
        withActiveSubscriptions: users === null ? 0 : asNumber(users.with_subscriptions),
        referralsTotal: users === null ? 0 : asNumber(users.referrals_total),
        referrals30Days: users === null ? 0 : asNumber(users.referrals_30d),
        recent: recentUsers.map(mapUser)
      },
      priceStats: {
        currentMinPrice: prices === null ? null : asNullableNumber(prices.min_price),
        currentAveragePrice: prices === null ? null : asNullableNumber(prices.average_price),
        currentMaxPrice: prices === null ? null : asNullableNumber(prices.max_price),
        trend30Days: priceTrend.map(mapPricePoint),
        routes30Days: routePrices.map(mapRoutePrice)
      },
      clickStats: {
        clicks24Hours: clicks === null ? 0 : asNumber(clicks.clicks_24h),
        clicks7Days: clicks === null ? 0 : asNumber(clicks.clicks_7d),
        clicks30Days: clicks === null ? 0 : asNumber(clicks.clicks_30d),
        uniqueUsers30Days: clicks === null ? 0 : asNumber(clicks.users_30d),
        bySource30Days: clickSources.map((row) => ({
          source: asString(row.source),
          count: asNumber(row.count)
        })),
        daily30Days: clickDaily.map(mapClickPoint),
        topRoutes30Days: clickRoutes.map(mapClickRoute)
      },
      lastSync: mapLastSync(lastSync)
    };
  }
}
