import type {
  Clock,
  ClickRepository,
  LockRepository,
  NotificationHistoryRepository,
  PriceHistoryRepository,
  RoutePriceRepository,
  SessionRepository,
  SubscriptionRepository,
  SyncRunRepository,
  SyncSourceRepository,
  TicketRepository,
  UserRepository
} from '../../application/ports.js';
import type {
  DestinationQuery,
  StoredTicket,
  SyncResult,
  SyncSource,
  SyncSourceKey,
  TelegramProfileInput,
  TicketQuery,
  User,
  UserSession
} from '../../application/models.js';
import type { Subscription } from '../../domain/subscription.js';
import type { TicketEventType } from '../../domain/ticket-events.js';
import type { Ticket } from '../../domain/ticket.js';
import type { TripClass } from '../../domain/travel-preferences.js';
import type { RouteDailyPoint, RoutePriceObservation } from '../../domain/route-price.js';
import { dateInTimeZone } from '../../domain/dates.js';
import type { ClickSource, UserAgentKind } from '../../domain/click-tracking.js';

type Row = Readonly<Record<string, unknown>>;
type Parameters = Readonly<Record<string, unknown>>;

export interface RawDatabase {
  run(query: string, parameters?: Parameters): Promise<unknown>;
  all(query: string, parameters?: Parameters): Promise<readonly Row[]>;
  get(query: string, parameters?: Parameters): Promise<Row | null>;
}

function requiredNumber(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`База вернула некорректное число ${key}`);
  }
  return value;
}

function requiredString(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new TypeError(`База вернула некорректную строку ${key}`);
  return value;
}

function nullableString(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new TypeError(`База вернула некорректную строку ${key}`);
  return value;
}

function bool(row: Row, key: string): boolean {
  const value = requiredNumber(row, key);
  if (value !== 0 && value !== 1) throw new TypeError(`База вернула некорректный boolean ${key}`);
  return value === 1;
}

function timestamp(row: Row, key: string): Date {
  return new Date(requiredNumber(row, key) * 1_000);
}

function seconds(value: Date): number {
  return Math.floor(value.getTime() / 1_000);
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return JSON.parse(value) as unknown;
}

function stringArray(row: Row, key: string): readonly string[] {
  const value = jsonValue(row[key]);
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new TypeError(`База вернула некорректный массив ${key}`);
  }
  return value;
}

function tripClass(row: Row, key: string): TripClass {
  const value = requiredString(row, key);
  if (value !== 'economy' && value !== 'business') {
    throw new TypeError(`База вернула некорректный класс ${key}`);
  }
  return value;
}

function mapUser(row: Row): User {
  return {
    id: requiredNumber(row, 'id'),
    telegramUserId: requiredNumber(row, 'telegram_user_id'),
    telegramChatId: requiredNumber(row, 'telegram_chat_id'),
    username: nullableString(row, 'username'),
    firstName: nullableString(row, 'first_name'),
    lastName: nullableString(row, 'last_name'),
    phoneNumber: nullableString(row, 'phone_number'),
    languageCode: nullableString(row, 'language_code'),
    defaultOriginCode: requiredString(row, 'default_origin_code'),
    preferredCurrencyCode: requiredString(row, 'preferred_currency_code'),
    preferredTripClass: tripClass(row, 'preferred_trip_class'),
    baggageRequired: bool(row, 'baggage_required'),
    isActive: bool(row, 'is_active'),
    createdAt: timestamp(row, 'created_at'),
    updatedAt: timestamp(row, 'updated_at')
  };
}

function mapTicket(row: Row): StoredTicket {
  return {
    id: requiredNumber(row, 'id'),
    externalKey: requiredString(row, 'external_key'),
    originCode: requiredString(row, 'origin_code'),
    destinationCode: requiredString(row, 'destination_code'),
    departureDate: requiredString(row, 'departure_date'),
    departureAt: nullableString(row, 'departure_at'),
    returnDate: nullableString(row, 'return_date'),
    price: requiredNumber(row, 'price'),
    currencyCode: requiredString(row, 'currency_code'),
    airlineCode: nullableString(row, 'airline_code'),
    airlineName: nullableString(row, 'airline_name'),
    isDirect: bool(row, 'is_direct'),
    tripClass: tripClass(row, 'trip_class'),
    hasBaggage: bool(row, 'has_baggage'),
    ticketLink: requiredString(row, 'ticket_link'),
    rawTicketLink: nullableString(row, 'raw_ticket_link'),
    rawPayload: jsonValue(row.raw_payload),
    firstSeenAt: timestamp(row, 'first_seen_at'),
    lastSeenAt: timestamp(row, 'last_seen_at'),
    isActive: bool(row, 'is_active'),
    createdAt: timestamp(row, 'created_at'),
    updatedAt: timestamp(row, 'updated_at')
  };
}

function mapSubscription(row: Row): Subscription {
  const maxPrice = row.max_price;
  return {
    id: requiredNumber(row, 'id'),
    userId: requiredNumber(row, 'user_id'),
    originCode: requiredString(row, 'origin_code'),
    destinationCode: nullableString(row, 'destination_code'),
    currencyCode: requiredString(row, 'currency_code'),
    departureDateFrom: requiredString(row, 'departure_date_from'),
    departureDateTo: requiredString(row, 'departure_date_to'),
    maxPrice: maxPrice === null || maxPrice === undefined ? null : requiredNumber(row, 'max_price'),
    directOnly: bool(row, 'direct_only'),
    roundTripOnly: bool(row, 'round_trip_only'),
    baggageRequired: bool(row, 'baggage_required'),
    isActive: bool(row, 'is_active')
  };
}

function mapSession(row: Row): UserSession {
  const payload = jsonValue(row.payload);
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new TypeError('База вернула некорректный payload сессии');
  }
  return {
    userId: requiredNumber(row, 'user_id'),
    flow: requiredString(row, 'flow'),
    step: requiredString(row, 'step'),
    payload: payload as Readonly<Record<string, unknown>>,
    expiresAt: timestamp(row, 'expires_at'),
    createdAt: timestamp(row, 'created_at'),
    updatedAt: timestamp(row, 'updated_at')
  };
}

function mapSyncSource(row: Row): SyncSource {
  return {
    id: requiredNumber(row, 'id'),
    originCode: requiredString(row, 'origin_code'),
    currencyCode: requiredString(row, 'currency_code'),
    isEnabled: bool(row, 'is_enabled')
  };
}

export class ApplicationRepositories implements
  UserRepository,
  TicketRepository,
  ClickRepository,
  PriceHistoryRepository,
  RoutePriceRepository,
  SubscriptionRepository,
  SessionRepository,
  NotificationHistoryRepository,
  SyncSourceRepository,
  SyncRunRepository,
  LockRepository {
  private readonly lockOwners = new Map<string, string>();
  private ownerSequence = 0;

  public constructor(
    private readonly db: RawDatabase,
    private readonly clock: Clock
  ) {}

  public async upsertTelegramProfile(input: TelegramProfileInput, now: Date): Promise<User> {
    const row = await this.db.get(`
      INSERT INTO users (
        telegram_user_id, telegram_chat_id, username, first_name, last_name,
        language_code, created_at, updated_at
      ) VALUES (
        :telegramUserId, :telegramChatId, :username, :firstName, :lastName,
        :languageCode, :now, :now
      )
      ON CONFLICT(telegram_user_id) DO UPDATE SET
        telegram_chat_id = excluded.telegram_chat_id,
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        language_code = excluded.language_code,
        updated_at = excluded.updated_at
      RETURNING *
    `, {
      ':telegramUserId': input.telegramUserId,
      ':telegramChatId': input.telegramChatId,
      ':username': input.username,
      ':firstName': input.firstName,
      ':lastName': input.lastName,
      ':languageCode': input.languageCode,
      ':now': seconds(now)
    });
    if (row === null) throw new Error('Не удалось сохранить пользователя');
    return mapUser(row);
  }

  public async findById(userId: number): Promise<User | null> {
    const row = await this.db.get('SELECT * FROM users WHERE id = :id', { ':id': userId });
    return row === null ? null : mapUser(row);
  }

  public async findByTelegramUserId(telegramUserId: number): Promise<User | null> {
    const row = await this.db.get(
      'SELECT * FROM users WHERE telegram_user_id = :telegramUserId',
      { ':telegramUserId': telegramUserId }
    );
    return row === null ? null : mapUser(row);
  }

  public async updatePhone(userId: number, phoneNumber: string, now: Date): Promise<void> {
    await this.db.run(
      'UPDATE users SET phone_number = :phone, updated_at = :now WHERE id = :id',
      { ':phone': phoneNumber, ':now': seconds(now), ':id': userId }
    );
  }

  public async updateTicketPreferences(
    userId: number,
    preferredTripClass: TripClass,
    baggageRequired: boolean,
    now: Date
  ): Promise<void> {
    await this.db.run(`
      UPDATE users SET preferred_trip_class = :tripClass,
        baggage_required = :baggageRequired, updated_at = :now
      WHERE id = :id
    `, {
      ':tripClass': preferredTripClass,
      ':baggageRequired': baggageRequired ? 1 : 0,
      ':now': seconds(now),
      ':id': userId
    });
  }

  public async findByExternalKey(externalKey: string): Promise<StoredTicket | null> {
    const row = await this.db.get(
      'SELECT * FROM tickets WHERE external_key = :externalKey',
      { ':externalKey': externalKey }
    );
    return row === null ? null : mapTicket(row);
  }

  public async findTicketById(ticketId: number): Promise<StoredTicket | null> {
    const row = await this.db.get(
      'SELECT * FROM tickets WHERE id = :ticketId',
      { ':ticketId': ticketId }
    );
    return row === null ? null : mapTicket(row);
  }

  public async upsert(
    ticket: Ticket,
    observedAt: Date
  ): Promise<{ stored: StoredTicket; previous: StoredTicket | null }> {
    const previous = await this.findByExternalKey(ticket.externalKey);
    const parameters = {
      ':externalKey': ticket.externalKey,
      ':origin': ticket.originCode,
      ':destination': ticket.destinationCode,
      ':departureDate': ticket.departureDate,
      ':departureAt': ticket.departureAt,
      ':returnDate': ticket.returnDate,
      ':price': ticket.price,
      ':currency': ticket.currencyCode,
      ':airlineCode': ticket.airlineCode,
      ':airlineName': ticket.airlineName,
      ':isDirect': ticket.isDirect ? 1 : 0,
      ':tripClass': ticket.tripClass,
      ':hasBaggage': ticket.hasBaggage ? 1 : 0,
      ':ticketLink': ticket.ticketLink,
      ':rawTicketLink': ticket.rawTicketLink,
      ':rawPayload': JSON.stringify(ticket.rawPayload),
      ':now': seconds(observedAt)
    };
    await this.db.run(`
      INSERT INTO tickets (
        external_key, origin_code, destination_code, departure_date, departure_at, return_date,
        price, currency_code, airline_code, airline_name, is_direct, trip_class, has_baggage,
        ticket_link, raw_ticket_link, raw_payload, first_seen_at, last_seen_at,
        is_active, created_at, updated_at
      ) VALUES (
        :externalKey, :origin, :destination, :departureDate, :departureAt, :returnDate,
        :price, :currency, :airlineCode, :airlineName, :isDirect, :tripClass, :hasBaggage,
        :ticketLink, :rawTicketLink, :rawPayload, :now, :now, 1, :now, :now
      )
      ON CONFLICT(external_key) DO UPDATE SET
        departure_at = excluded.departure_at, return_date = excluded.return_date, price = excluded.price,
        airline_code = excluded.airline_code, airline_name = excluded.airline_name,
        is_direct = excluded.is_direct, trip_class = excluded.trip_class,
        has_baggage = excluded.has_baggage,
        ticket_link = excluded.ticket_link, raw_ticket_link = excluded.raw_ticket_link,
        raw_payload = excluded.raw_payload, last_seen_at = excluded.last_seen_at,
        is_active = 1, updated_at = excluded.updated_at
    `, parameters);
    const stored = await this.findByExternalKey(ticket.externalKey);
    if (stored === null) throw new Error('Не удалось прочитать сохранённый билет');
    return { stored, previous };
  }

  public async deactivateUnseen(
    source: SyncSourceKey,
    seenExternalKeys: readonly string[],
    now: Date
  ): Promise<number> {
    const parameters: Record<string, unknown> = {
      ':origin': source.originCode,
      ':currency': source.currencyCode,
      ':now': seconds(now)
    };
    const seenPlaceholders = seenExternalKeys.map((externalKey, index) => {
      const placeholder = `:seenExternalKey${String(index)}`;
      parameters[placeholder] = externalKey;
      return placeholder;
    });
    const unseenCondition = seenPlaceholders.length === 0
      ? ''
      : `AND external_key NOT IN (${seenPlaceholders.join(', ')})`;
    const rows = await this.db.all(`
      UPDATE tickets SET is_active = 0, updated_at = :now
      WHERE origin_code = :origin AND currency_code = :currency
        AND is_active = 1 ${unseenCondition}
      RETURNING id
    `, parameters);
    return rows.length;
  }

  public async listActive(query: TicketQuery): Promise<readonly StoredTicket[]> {
    const conditions = [
      'origin_code = :origin',
      'currency_code = :currency',
      'is_active = 1',
      'departure_date >= :dateFrom',
      'trip_class = :tripClass'
    ];
    const parameters: Record<string, unknown> = {
      ':origin': query.originCode,
      ':currency': query.currencyCode,
      ':dateFrom': query.departureDateFrom,
      ':tripClass': query.tripClass,
      ':limit': query.limit,
      ':offset': query.offset
    };
    if (query.departureDateTo !== null) {
      conditions.push('departure_date <= :dateTo');
      parameters[':dateTo'] = query.departureDateTo;
    }
    if (query.destinationCode !== null) {
      conditions.push('destination_code = :destination');
      parameters[':destination'] = query.destinationCode;
    }
    if (query.maxPrice !== null) {
      conditions.push('price <= :maxPrice');
      parameters[':maxPrice'] = query.maxPrice;
    }
    if (query.directOnly) conditions.push('is_direct = 1');
    if (query.baggageRequired) conditions.push('has_baggage = 1');
    const order = query.sort === 'departure_date_asc'
      ? 'departure_date ASC, price ASC, id ASC'
      : query.sort === 'recently_added'
        ? 'first_seen_at DESC, id ASC'
        : 'price ASC, departure_date ASC, id ASC';
    const rows = await this.db.all(`
      SELECT * FROM tickets WHERE ${conditions.join(' AND ')}
      ORDER BY ${order} LIMIT :limit OFFSET :offset
    `, parameters);
    return rows.map(mapTicket);
  }

  public async listActiveDestinations(query: DestinationQuery): Promise<readonly string[]> {
    const conditions = [
      'origin_code = :origin',
      'currency_code = :currency',
      'is_active = 1',
      'departure_date >= :dateFrom',
      'trip_class = :tripClass'
    ];
    const parameters: Record<string, unknown> = {
      ':origin': query.originCode,
      ':currency': query.currencyCode,
      ':dateFrom': query.departureDateFrom,
      ':tripClass': query.tripClass
    };
    if (query.baggageRequired) conditions.push('has_baggage = 1');
    const rows = await this.db.all(`
      SELECT DISTINCT destination_code FROM tickets WHERE ${conditions.join(' AND ')}
      ORDER BY destination_code ASC
    `, parameters);
    return rows.map((row) => requiredString(row, 'destination_code'));
  }

  public async getCachedActiveDestinations(
    query: DestinationQuery
  ): Promise<readonly string[] | null> {
    const row = await this.db.get(`
      SELECT destination_codes FROM destination_cache
      WHERE origin_code = :origin
        AND currency_code = :currency
        AND departure_date_from = :dateFrom
        AND trip_class = :tripClass
        AND baggage_required = :baggageRequired
    `, {
      ':origin': query.originCode,
      ':currency': query.currencyCode,
      ':dateFrom': query.departureDateFrom,
      ':tripClass': query.tripClass,
      ':baggageRequired': query.baggageRequired ? 1 : 0
    });
    return row === null ? null : stringArray(row, 'destination_codes');
  }

  public async saveActiveDestinationsCache(
    query: DestinationQuery,
    destinations: readonly string[],
    updatedAt: Date
  ): Promise<void> {
    await this.db.run(`
      INSERT INTO destination_cache (
        origin_code, currency_code, departure_date_from, trip_class,
        baggage_required, destination_codes, updated_at
      ) VALUES (
        :origin, :currency, :dateFrom, :tripClass,
        :baggageRequired, :destinations, :updatedAt
      )
      ON CONFLICT(
        origin_code, currency_code, departure_date_from, trip_class, baggage_required
      ) DO UPDATE SET
        destination_codes = excluded.destination_codes,
        updated_at = excluded.updated_at
    `, {
      ':origin': query.originCode,
      ':currency': query.currencyCode,
      ':dateFrom': query.departureDateFrom,
      ':tripClass': query.tripClass,
      ':baggageRequired': query.baggageRequired ? 1 : 0,
      ':destinations': JSON.stringify(destinations),
      ':updatedAt': seconds(updatedAt)
    });
  }

  public async pruneActiveDestinationsCache(
    source: SyncSourceKey,
    departureDateFrom: string
  ): Promise<void> {
    await this.db.run(`
      DELETE FROM destination_cache
      WHERE origin_code = :origin
        AND currency_code = :currency
        AND departure_date_from <> :dateFrom
    `, {
      ':origin': source.originCode,
      ':currency': source.currencyCode,
      ':dateFrom': departureDateFrom
    });
  }

  public async addPrice(ticketId: number, price: number, observedAt: Date): Promise<void> {
    await this.db.run(`
      INSERT INTO ticket_price_history (ticket_id, price, observed_at)
      VALUES (:ticketId, :price, :observedAt)
    `, { ':ticketId': ticketId, ':price': price, ':observedAt': seconds(observedAt) });
  }

  public async recordObservation(input: RoutePriceObservation): Promise<void> {
    const observedAt = seconds(input.observedAt);
    await this.db.run(`
      INSERT INTO route_price_observations (
        route_key, origin_code, destination_code, trip_class, is_direct,
        has_baggage, departure_date, days_ahead, price, currency_code,
        observed_at, observed_hour
      ) VALUES (
        :routeKey, :origin, :destination, :tripClass, :isDirect,
        :hasBaggage, :departureDate, :daysAhead, :price, :currency,
        :observedAt, :observedHour
      )
      ON CONFLICT(
        route_key, departure_date, is_direct, has_baggage, observed_hour
      ) DO UPDATE SET
        price = MIN(route_price_observations.price, excluded.price),
        observed_at = MAX(route_price_observations.observed_at, excluded.observed_at)
    `, {
      ':routeKey': input.routeKey,
      ':origin': input.originCode,
      ':destination': input.destinationCode,
      ':tripClass': input.tripClass,
      ':isDirect': input.isDirect ? 1 : 0,
      ':hasBaggage': input.hasBaggage ? 1 : 0,
      ':departureDate': input.departureDate,
      ':daysAhead': input.daysAhead,
      ':price': input.price,
      ':currency': input.currencyCode,
      ':observedAt': observedAt,
      ':observedHour': Math.floor(observedAt / 3_600)
    });
  }

  public async rebuildDailyAggregate(
    routeKey: string,
    day: string,
    updatedAt: Date
  ): Promise<void> {
    const start = Math.floor(Date.parse(`${day}T00:00:00+05:00`) / 1_000);
    const rows = await this.db.all(`
      SELECT origin_code, destination_code, trip_class, price
      FROM route_price_observations
      WHERE route_key = :routeKey AND observed_at >= :start AND observed_at < :end
      ORDER BY price ASC
    `, { ':routeKey': routeKey, ':start': start, ':end': start + 86_400 });
    if (rows.length === 0) return;
    const prices = rows.map((row) => requiredNumber(row, 'price'));
    const middle = Math.floor(prices.length / 2);
    const right = prices[middle] ?? 0;
    const median = prices.length % 2 === 1
      ? right
      : Math.round(((prices[middle - 1] ?? right) + right) / 2);
    const total = prices.reduce((sum, price) => sum + price, 0);
    const first = rows[0];
    if (first === undefined) return;
    await this.db.run(`
      INSERT INTO route_price_daily (
        route_key, day, origin_code, destination_code, trip_class,
        min_price, avg_price, median_price, max_price, sample_count, updated_at
      ) VALUES (
        :routeKey, :day, :origin, :destination, :tripClass,
        :minPrice, :avgPrice, :medianPrice, :maxPrice, :sampleCount, :updatedAt
      )
      ON CONFLICT(route_key, day) DO UPDATE SET
        min_price = excluded.min_price,
        avg_price = excluded.avg_price,
        median_price = excluded.median_price,
        max_price = excluded.max_price,
        sample_count = excluded.sample_count,
        updated_at = excluded.updated_at
    `, {
      ':routeKey': routeKey,
      ':day': day,
      ':origin': requiredString(first, 'origin_code'),
      ':destination': requiredString(first, 'destination_code'),
      ':tripClass': requiredString(first, 'trip_class'),
      ':minPrice': prices[0] ?? 0,
      ':avgPrice': Math.round(total / prices.length),
      ':medianPrice': median,
      ':maxPrice': prices.at(-1) ?? 0,
      ':sampleCount': prices.length,
      ':updatedAt': seconds(updatedAt)
    });
  }

  public async getDailySeries(
    routeKey: string,
    days: number,
    now: Date
  ): Promise<readonly RouteDailyPoint[]> {
    const from = new Date(now.getTime() - Math.max(0, days - 1) * 86_400_000);
    const rows = await this.db.all(`
      SELECT day, min_price, avg_price, median_price, max_price, sample_count
      FROM route_price_daily
      WHERE route_key = :routeKey AND day >= :fromDay
      ORDER BY day ASC
    `, { ':routeKey': routeKey, ':fromDay': dateInTimeZone(from, 'Asia/Tashkent') });
    return rows.map((row) => ({
      day: requiredString(row, 'day'),
      minPrice: requiredNumber(row, 'min_price'),
      averagePrice: requiredNumber(row, 'avg_price'),
      medianPrice: requiredNumber(row, 'median_price'),
      maxPrice: requiredNumber(row, 'max_price'),
      sampleCount: requiredNumber(row, 'sample_count')
    }));
  }

  public async pruneObservations(olderThan: Date): Promise<number> {
    const rows = await this.db.all(`
      DELETE FROM route_price_observations
      WHERE observed_at < :olderThan
      RETURNING id
    `, { ':olderThan': seconds(olderThan) });
    return rows.length;
  }

  public async hasRecentClick(
    userId: number,
    ticketId: number,
    since: Date
  ): Promise<boolean> {
    return await this.db.get(`
      SELECT 1 AS found FROM link_clicks
      WHERE user_id = :userId AND ticket_id = :ticketId AND clicked_at >= :since
      LIMIT 1
    `, {
      ':userId': userId,
      ':ticketId': ticketId,
      ':since': seconds(since)
    }) !== null;
  }

  public async addClick(input: {
    ticket: StoredTicket;
    userId: number | null;
    source: ClickSource;
    subscriptionId: number | null;
    userAgentKind: UserAgentKind;
    clickedAt: Date;
  }): Promise<number> {
    const row = await this.db.get(`
      INSERT INTO link_clicks (
        ticket_id, user_id, source, origin_code, destination_code,
        departure_date, price, currency_code, subscription_id,
        user_agent_kind, clicked_at
      ) VALUES (
        :ticketId, :userId, :source, :origin, :destination,
        :departureDate, :price, :currency, :subscriptionId,
        :userAgentKind, :clickedAt
      ) RETURNING id
    `, {
      ':ticketId': input.ticket.id,
      ':userId': input.userId,
      ':source': input.source,
      ':origin': input.ticket.originCode,
      ':destination': input.ticket.destinationCode,
      ':departureDate': input.ticket.departureDate,
      ':price': input.ticket.price,
      ':currency': input.ticket.currencyCode,
      ':subscriptionId': input.subscriptionId,
      ':userAgentKind': input.userAgentKind,
      ':clickedAt': seconds(input.clickedAt)
    });
    if (row === null) throw new Error('Не удалось записать переход');
    return requiredNumber(row, 'id');
  }

  public async findMatching(ticket: Ticket): Promise<readonly Subscription[]> {
    const rows = await this.db.all(`
      SELECT * FROM subscriptions
      WHERE is_active = 1 AND origin_code = :origin AND currency_code = :currency
        AND (destination_code IS NULL OR destination_code = :destination)
        AND departure_date_from <= :departureDate AND departure_date_to >= :departureDate
        AND (max_price IS NULL OR max_price >= :price)
        AND (direct_only = 0 OR :isDirect = 1)
        AND (round_trip_only = 0 OR :hasReturn = 1)
    `, {
      ':origin': ticket.originCode,
      ':currency': ticket.currencyCode,
      ':destination': ticket.destinationCode,
      ':departureDate': ticket.departureDate,
      ':price': ticket.price,
      ':isDirect': ticket.isDirect ? 1 : 0,
      ':hasReturn': ticket.returnDate !== null ? 1 : 0
    });
    return rows.map(mapSubscription);
  }

  public async listByUser(userId: number): Promise<readonly Subscription[]> {
    return (await this.db.all(
      'SELECT * FROM subscriptions WHERE user_id = :userId ORDER BY created_at DESC',
      { ':userId': userId }
    )).map(mapSubscription);
  }

  public async countActiveByUser(userId: number): Promise<number> {
    const row = await this.db.get(
      'SELECT count(*) AS count FROM subscriptions WHERE user_id = :userId AND is_active = 1',
      { ':userId': userId }
    );
    return row === null ? 0 : requiredNumber(row, 'count');
  }

  public async create(
    input: Omit<Subscription, 'id' | 'isActive'>,
    now: Date
  ): Promise<Subscription> {
    const row = await this.db.get(`
      INSERT INTO subscriptions (
        user_id, origin_code, destination_code, currency_code, departure_date_from,
        departure_date_to, max_price, direct_only, round_trip_only, baggage_required, is_active,
        created_at, updated_at
      ) VALUES (
        :userId, :origin, :destination, :currency, :dateFrom,
        :dateTo, :maxPrice, :directOnly, :roundTripOnly, :baggageRequired, 1, :now, :now
      ) RETURNING *
    `, {
      ':userId': input.userId,
      ':origin': input.originCode,
      ':destination': input.destinationCode,
      ':currency': input.currencyCode,
      ':dateFrom': input.departureDateFrom,
      ':dateTo': input.departureDateTo,
      ':maxPrice': input.maxPrice,
      ':directOnly': input.directOnly ? 1 : 0,
      ':roundTripOnly': input.roundTripOnly ? 1 : 0,
      ':baggageRequired': input.baggageRequired ? 1 : 0,
      ':now': seconds(now)
    });
    if (row === null) throw new Error('Не удалось создать подписку');
    return mapSubscription(row);
  }

  public async deactivateOwned(userId: number, subscriptionId: number, now: Date): Promise<boolean> {
    const rows = await this.db.all(`
      UPDATE subscriptions SET is_active = 0, updated_at = :now
      WHERE id = :id AND user_id = :userId AND is_active = 1 RETURNING id
    `, { ':now': seconds(now), ':id': subscriptionId, ':userId': userId });
    return rows.length === 1;
  }

  public async findByUserId(userId: number): Promise<UserSession | null> {
    const row = await this.db.get('SELECT * FROM user_sessions WHERE user_id = :userId', { ':userId': userId });
    return row === null ? null : mapSession(row);
  }

  public async save(session: UserSession): Promise<void> {
    await this.db.run(`
      INSERT INTO user_sessions (
        user_id, flow, step, payload, expires_at, created_at, updated_at
      ) VALUES (:userId, :flow, :step, :payload, :expiresAt, :createdAt, :updatedAt)
      ON CONFLICT(user_id) DO UPDATE SET flow = excluded.flow, step = excluded.step,
        payload = excluded.payload, expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `, {
      ':userId': session.userId,
      ':flow': session.flow,
      ':step': session.step,
      ':payload': JSON.stringify(session.payload),
      ':expiresAt': seconds(session.expiresAt),
      ':createdAt': seconds(session.createdAt),
      ':updatedAt': seconds(session.updatedAt)
    });
  }

  public async deleteByUserId(userId: number): Promise<void> {
    await this.db.run('DELETE FROM user_sessions WHERE user_id = :userId', { ':userId': userId });
  }

  public async exists(
    userId: number,
    subscriptionId: number,
    ticketId: number,
    price: number
  ): Promise<boolean> {
    return await this.db.get(`
      SELECT 1 AS found FROM notification_history
      WHERE user_id = :userId AND subscription_id = :subscriptionId
        AND ticket_id = :ticketId AND notified_price = :price
    `, {
      ':userId': userId,
      ':subscriptionId': subscriptionId,
      ':ticketId': ticketId,
      ':price': price
    }) !== null;
  }

  public async addNotification(input: {
    userId: number;
    subscriptionId: number;
    ticketId: number;
    notifiedPrice: number;
    notificationType: TicketEventType;
    telegramMessageId: number;
    sentAt: Date;
  }): Promise<void> {
    await this.db.run(`
      INSERT INTO notification_history (
        user_id, subscription_id, ticket_id, notified_price,
        notification_type, telegram_message_id, sent_at
      ) VALUES (
        :userId, :subscriptionId, :ticketId, :price, :type, :messageId, :sentAt
      ) ON CONFLICT(user_id, subscription_id, ticket_id, notified_price) DO NOTHING
    `, {
      ':userId': input.userId,
      ':subscriptionId': input.subscriptionId,
      ':ticketId': input.ticketId,
      ':price': input.notifiedPrice,
      ':type': input.notificationType,
      ':messageId': input.telegramMessageId,
      ':sentAt': seconds(input.sentAt)
    });
  }

  public async findEnabled(): Promise<readonly SyncSource[]> {
    return (await this.db.all(
      'SELECT * FROM sync_sources WHERE is_enabled = 1 ORDER BY id ASC'
    )).map(mapSyncSource);
  }

  public async ensureInitialSource(now: Date): Promise<void> {
    await this.db.run(`
      UPDATE sync_sources SET is_enabled = 0, updated_at = :now
      WHERE origin_code <> 'TAS' OR currency_code <> 'UZS'
    `, { ':now': seconds(now) });
    await this.db.run(`
      INSERT INTO sync_sources (origin_code, currency_code, is_enabled, created_at, updated_at)
      VALUES ('TAS', 'UZS', 1, :now, :now)
      ON CONFLICT(origin_code, currency_code) DO UPDATE SET
        is_enabled = 1, updated_at = excluded.updated_at
    `, { ':now': seconds(now) });
  }

  public async start(source: SyncSourceKey, startedAt: Date): Promise<number> {
    const row = await this.db.get(`
      INSERT INTO sync_runs (origin_code, currency_code, status, started_at)
      VALUES (:origin, :currency, 'running', :startedAt) RETURNING id
    `, {
      ':origin': source.originCode,
      ':currency': source.currencyCode,
      ':startedAt': seconds(startedAt)
    });
    if (row === null) throw new Error('Не удалось создать sync run');
    return requiredNumber(row, 'id');
  }

  public async complete(runId: number, result: SyncResult, finishedAt: Date): Promise<void> {
    await this.db.run(`
      UPDATE sync_runs SET status = :status, fetched_count = :fetched,
        inserted_count = :inserted, updated_count = :updated,
        notification_count = :notifications, finished_at = :finishedAt
      WHERE id = :id
    `, {
      ':status': result.status,
      ':fetched': result.fetched,
      ':inserted': result.inserted,
      ':updated': result.updated,
      ':notifications': result.notificationsSent,
      ':finishedAt': seconds(finishedAt),
      ':id': runId
    });
  }

  public async fail(runId: number, errorMessage: string, finishedAt: Date): Promise<void> {
    await this.db.run(`
      UPDATE sync_runs SET status = 'failed', error_message = :error,
        finished_at = :finishedAt WHERE id = :id
    `, { ':error': errorMessage.slice(0, 1_000), ':finishedAt': seconds(finishedAt), ':id': runId });
  }

  public async acquire(key: string, ttlSeconds: number): Promise<boolean> {
    const now = seconds(this.clock.now());
    const owner = `${now}-${this.ownerSequence++}`;
    const row = await this.db.get(`
      INSERT INTO sync_locks (key, owner, expires_at, created_at, updated_at)
      VALUES (:key, :owner, :expiresAt, :now, :now)
      ON CONFLICT(key) DO UPDATE SET owner = excluded.owner,
        expires_at = excluded.expires_at, updated_at = excluded.updated_at
      WHERE sync_locks.expires_at <= :now
      RETURNING key
    `, { ':key': key, ':owner': owner, ':expiresAt': now + ttlSeconds, ':now': now });
    if (row === null) return false;
    this.lockOwners.set(key, owner);
    return true;
  }

  public async release(key: string): Promise<void> {
    const owner = this.lockOwners.get(key);
    if (owner === undefined) return;
    await this.db.run(
      'DELETE FROM sync_locks WHERE key = :key AND owner = :owner',
      { ':key': key, ':owner': owner }
    );
    this.lockOwners.delete(key);
  }
}
