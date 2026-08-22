import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import type { MiniAppDealQuery, MiniAppDealSort, MiniAppService } from '../../application/miniapp.js';
import type {
  Clock,
  ClickRepository,
  Logger,
  RoutePriceRepository,
  SubscriptionRepository,
  TicketRepository
} from '../../application/ports.js';
import { buildAffiliateLink, type AffiliateConfig } from '../../domain/affiliate-link.js';
import { classifyUserAgent, parseClickSource } from '../../domain/click-tracking.js';
import { verifyClickSignature, type ClickPayload } from '../../domain/click-signature.js';
import { normalizeIataCode } from '../../domain/codes.js';
import { dateInTimeZone } from '../../domain/dates.js';
import { RateLimitError, ValidationError } from '../../domain/errors.js';
import { validateMiniAppInitData } from '../../domain/miniapp-auth.js';
import { FixedWindowRateLimiter } from '../../domain/rate-limit.js';
import type { TripClass } from '../../domain/travel-preferences.js';
import { createRouteKey } from '../../domain/route-price.js';
import { calculateTrackedSavingsSnapshot } from '../../domain/tracked-savings.js';

export interface WebServerDependencies {
  readonly miniApp: MiniAppService;
  readonly tickets: TicketRepository;
  readonly clicks: ClickRepository;
  readonly routePrices: RoutePriceRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly telegramBotToken: string;
  readonly authMaxAgeSeconds: number;
  readonly clickSigningSecret: string | null;
  readonly affiliate: AffiliateConfig;
  readonly staticDirectory: string;
}

type AsyncHandler = (request: Request, response: Response, next: NextFunction) => Promise<void>;

function asyncHandler(handler: AsyncHandler) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response, next).catch(next);
  };
}

function firstValue(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function optionalInteger(value: unknown): number | null {
  const raw = firstValue(value);
  if (raw === null || raw.length === 0) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ValidationError('Некорректное число');
  return parsed;
}

function booleanValue(value: unknown): boolean {
  const raw = firstValue(value);
  return raw === '1' || raw === 'true';
}

function dealSort(value: unknown): MiniAppDealSort {
  const raw = firstValue(value);
  if (raw === 'cheapest' || raw === 'recent' || raw === 'departing_soon') return raw;
  return 'best';
}

function authenticate(request: Request, dependencies: WebServerDependencies): number {
  const authorization = request.get('authorization') ?? '';
  if (!authorization.startsWith('tma ')) throw new ValidationError('Требуется Telegram Mini App');
  return validateMiniAppInitData(
    authorization.slice(4),
    dependencies.telegramBotToken,
    dependencies.clock.now(),
    dependencies.authMaxAgeSeconds
  ).id;
}

function authenticatedUser(response: Response): number {
  const value: unknown = response.locals.telegramUserId;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Не найден авторизованный Telegram user');
  }
  return value;
}

function positiveId(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ValidationError('Некорректный ID');
  return parsed;
}

function nullableBodyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requiredBodyString(value: unknown, name: string): string {
  const parsed = nullableBodyString(value);
  if (parsed === null) throw new ValidationError(`Отсутствует ${name}`);
  return parsed;
}

function bodyBoolean(value: unknown): boolean {
  return value === true;
}

function optionalBodyBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new ValidationError('Ожидалось логическое значение');
  return value;
}

function optionalBodyInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value)) throw new ValidationError('Ожидалось целое число');
  return value as number;
}

function bodyOptionalMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError('Некорректная цена');
  }
  return value;
}

function tripClass(value: unknown): TripClass {
  if (value === 'economy' || value === 'business') return value;
  throw new ValidationError('Некорректный класс перелёта');
}

function optionalTripClass(value: unknown): TripClass | undefined {
  return value === undefined ? undefined : tripClass(value);
}

function subscriptionBody(body: Readonly<Record<string, unknown>>) {
  return {
    destinationCode: nullableBodyString(body.destinationCode),
    departureDateFrom: requiredBodyString(body.departureDateFrom, 'departureDateFrom'),
    departureDateTo: requiredBodyString(body.departureDateTo, 'departureDateTo'),
    maxPrice: bodyOptionalMoney(body.maxPrice),
    directOnly: bodyBoolean(body.directOnly),
    roundTripOnly: bodyBoolean(body.roundTripOnly),
    baggageRequired: optionalBodyBoolean(body.baggageRequired),
    tripClass: optionalTripClass(body.tripClass)
  };
}

function profileJson(user: Awaited<ReturnType<MiniAppService['getProfile']>>) {
  return {
    telegramUserId: user.telegramUserId,
    firstName: user.firstName,
    username: user.username,
    languageCode: user.languageCode,
    defaultOriginCode: user.defaultOriginCode,
    onboardingCompleted: user.onboardingCompleted,
    preferredTripClass: user.preferredTripClass,
    baggageRequired: user.baggageRequired,
    instantNotificationsEnabled: user.instantNotificationsEnabled,
    morningDigestEnabled: user.morningDigestEnabled,
    quietHoursEnabled: user.quietHoursEnabled,
    quietStartMinute: user.quietStartMinute,
    quietEndMinute: user.quietEndMinute,
    trackedSavings: user.trackedSavings,
    referralCount: user.referralCount,
    referralShareUrl: user.referralShareUrl
  };
}

function optionalPayloadId(value: unknown): number | null {
  const raw = firstValue(value);
  if (raw === null || raw.length === 0) return null;
  return positiveId(raw);
}

export function createWebServer(dependencies: WebServerDependencies): Express {
  const app = express();
  const clickRateLimit = new FixedWindowRateLimiter(60);
  const apiRateLimit = new FixedWindowRateLimiter(120);
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '32kb' }));

  app.get('/healthz', (_request, response) => {
    response.type('text/plain').send('ok');
  });

  app.get('/go/:ticketId', asyncHandler(async (request, response) => {
    const client = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    if (!clickRateLimit.allow(client, dependencies.clock.now())) {
      response.status(429).json({ error: { code: 'rate_limited', message: 'Слишком много переходов' } });
      return;
    }
    const ticketId = positiveId(firstValue(request.params.ticketId) ?? '');
    const source = parseClickSource(firstValue(request.query.s) ?? '');
    const userId = optionalPayloadId(request.query.u);
    const subscriptionId = optionalPayloadId(request.query.b);
    const signature = firstValue(request.query.sig) ?? '';
    const payload: ClickPayload = { ticketId, source, userId, subscriptionId };
    if (
      dependencies.clickSigningSecret === null
      || !verifyClickSignature(payload, signature, dependencies.clickSigningSecret)
    ) {
      response.status(400).json({ error: { code: 'invalid_click_signature', message: 'Некорректная ссылка' } });
      return;
    }
    const ticket = await dependencies.tickets.findTicketById(ticketId);
    if (ticket === null) {
      response.redirect(302, 'https://www.aviasales.uz/');
      return;
    }
    const userAgentKind = classifyUserAgent(request.get('user-agent'));
    let clickId: number | null = null;
    try {
      const duplicate = userAgentKind === 'human' && userId !== null
        ? await dependencies.clicks.hasRecentClick(
          userId,
          ticket.id,
          new Date(dependencies.clock.now().getTime() - 60_000),
          { source, subscriptionId }
        )
        : false;
      if (!duplicate) {
        let benchmarkPrice: number | null = null;
        let estimatedSavings: number | null = null;
        const trackedSource = source === 'bot_notification' || source === 'miniapp_watchlist';
        if (trackedSource && userId !== null && subscriptionId !== null && ticket.currencyCode === 'UZS') {
          const subscription = await dependencies.subscriptions.findSubscriptionById(subscriptionId);
          const contextual = subscription !== null
            && subscription.userId === userId
            && subscription.isActive
            && ticket.originCode === subscription.originCode
            && ticket.currencyCode === subscription.currencyCode
            && (subscription.destinationCode === null || ticket.destinationCode === subscription.destinationCode)
            && ticket.departureDate >= subscription.departureDateFrom
            && ticket.departureDate <= subscription.departureDateTo
            && (!subscription.directOnly || ticket.isDirect)
            && (!subscription.roundTripOnly || ticket.returnDate !== null)
            && (!subscription.baggageRequired || ticket.hasBaggage)
            && ticket.tripClass === subscription.tripClass;
          if (contextual) {
            const history = (await dependencies.routePrices.getDailySeries(
              createRouteKey(ticket.originCode, ticket.destinationCode, ticket.tripClass),
              31,
              dependencies.clock.now()
            )).filter((point) => (
              point.day < dateInTimeZone(dependencies.clock.now(), 'Asia/Tashkent')
            )).slice(-30);
            ({ benchmarkPrice, estimatedSavings } = calculateTrackedSavingsSnapshot(
              ticket.price,
              ticket.currencyCode,
              history
            ));
          }
        }
        clickId = await dependencies.clicks.addClick({
          ticket,
          userId,
          source,
          subscriptionId,
          userAgentKind,
          benchmarkPrice,
          estimatedSavings,
          clickedAt: dependencies.clock.now()
        });
      }
    } catch (error: unknown) {
      dependencies.logger.error('click_log_failed', {
        ticketId,
        error: error instanceof Error ? error.message : 'Неизвестная ошибка'
      });
    }
    let destination = ticket.ticketLink;
    try {
      destination = buildAffiliateLink(ticket.ticketLink, source, clickId, dependencies.affiliate);
    } catch (error: unknown) {
      dependencies.logger.error('affiliate_link_failed', {
        ticketId,
        error: error instanceof Error ? error.message : 'Неизвестная ошибка'
      });
    }
    response.set('Cache-Control', 'no-store');
    response.set('Referrer-Policy', 'no-referrer');
    response.redirect(302, destination);
  }));

  app.get('/app', (request, response, next) => {
    if (request.path !== '/app') {
      next();
      return;
    }
    response.redirect(302, '/app/');
  });
  app.use('/app', (_request, response, next) => {
    response.set('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' https://telegram.org",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'"
    ].join('; '));
    next();
  }, express.static(dependencies.staticDirectory, {
    index: 'index.html',
    maxAge: 0
  }));

  app.use('/api/v1', (request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      const telegramUserId = authenticate(request, dependencies);
      if (!apiRateLimit.allow(String(telegramUserId), dependencies.clock.now())) {
        throw new RateLimitError();
      }
      response.locals.telegramUserId = telegramUserId;
      next();
    } catch (error: unknown) {
      next(error);
    }
  });

  app.get('/api/v1/deals', asyncHandler(async (request, response) => {
    const telegramUserId = authenticatedUser(response);
    const limit = Math.min(50, optionalInteger(request.query.limit) ?? 20);
    const query: MiniAppDealQuery = {
      destinationCode: firstValue(request.query.destination),
      departureDateFrom: firstValue(request.query.date_from),
      departureDateTo: firstValue(request.query.date_to),
      maxPrice: optionalInteger(request.query.max_price),
      directOnly: booleanValue(request.query.direct),
      baggageRequired: booleanValue(request.query.baggage),
      sort: dealSort(request.query.sort),
      limit,
      cursor: firstValue(request.query.cursor)
    };
    response.json(await dependencies.miniApp.listDeals(telegramUserId, query));
  }));

  app.get('/api/v1/tickets/:ticketId', asyncHandler(async (request, response) => {
    const telegramUserId = authenticatedUser(response);
    response.json(await dependencies.miniApp.getTicket(
      telegramUserId,
      positiveId(firstValue(request.params.ticketId) ?? ''),
      optionalPayloadId(request.query.subscription_id)
    ));
  }));

  app.get('/api/v1/routes/:origin/:destination/history', asyncHandler(async (request, response) => {
    const telegramUserId = authenticatedUser(response);
    response.json({ items: await dependencies.miniApp.getHistory(
      telegramUserId,
      normalizeIataCode(firstValue(request.params.origin) ?? ''),
      normalizeIataCode(firstValue(request.params.destination) ?? ''),
      optionalInteger(request.query.days) ?? 30
    ) });
  }));

  app.get('/api/v1/destinations', asyncHandler(async (request, response) => {
    response.json({
      items: await dependencies.miniApp.listDestinations(authenticatedUser(response))
    });
  }));

  app.get('/api/v1/subscriptions', asyncHandler(async (request, response) => {
    response.json({
      items: await dependencies.miniApp.listSubscriptions(authenticatedUser(response))
    });
  }));

  app.post('/api/v1/subscriptions', asyncHandler(async (request, response) => {
    const telegramUserId = authenticatedUser(response);
    const body = request.body as Readonly<Record<string, unknown>>;
    const subscription = await dependencies.miniApp.createSubscription(
      telegramUserId,
      subscriptionBody(body)
    );
    response.status(201).json(subscription);
  }));

  app.patch('/api/v1/subscriptions/:subscriptionId', asyncHandler(async (request, response) => {
    const body = request.body as Readonly<Record<string, unknown>>;
    const subscription = await dependencies.miniApp.updateSubscription(
      authenticatedUser(response),
      positiveId(firstValue(request.params.subscriptionId) ?? ''),
      subscriptionBody(body)
    );
    if (subscription === null) {
      response.status(404).json({ error: { code: 'not_found', message: 'Подписка не найдена' } });
      return;
    }
    response.json(subscription);
  }));

  app.delete('/api/v1/subscriptions/:subscriptionId', asyncHandler(async (request, response) => {
    const telegramUserId = authenticatedUser(response);
    const changed = await dependencies.miniApp.deactivateSubscription(
      telegramUserId,
      positiveId(firstValue(request.params.subscriptionId) ?? '')
    );
    if (!changed) {
      response.status(404).json({ error: { code: 'not_found', message: 'Подписка не найдена' } });
      return;
    }
    response.status(204).send();
  }));

  app.get('/api/v1/me', asyncHandler(async (request, response) => {
    const user = await dependencies.miniApp.getProfile(authenticatedUser(response));
    response.json(profileJson(user));
  }));

  app.post('/api/v1/onboarding', asyncHandler(async (request, response) => {
    const telegramUserId = authenticatedUser(response);
    const body = request.body as Readonly<Record<string, unknown>>;
    const languageCode = requiredBodyString(body.languageCode, 'languageCode');
    if (languageCode !== 'ru' && languageCode !== 'uz') {
      throw new ValidationError('Поддерживаются только русский и узбекский языки');
    }
    await dependencies.miniApp.completeOnboarding(
      telegramUserId,
      languageCode,
      requiredBodyString(body.defaultOriginCode, 'defaultOriginCode')
    );
    response.json(profileJson(await dependencies.miniApp.getProfile(telegramUserId)));
  }));

  app.patch('/api/v1/me', asyncHandler(async (request, response) => {
    const telegramUserId = authenticatedUser(response);
    const body = request.body as Readonly<Record<string, unknown>>;
    const languageCode = body.languageCode === undefined
      ? undefined
      : requiredBodyString(body.languageCode, 'languageCode');
    if (languageCode !== undefined && languageCode !== 'ru' && languageCode !== 'uz') {
      throw new ValidationError('Поддерживаются только русский и узбекский языки');
    }
    await dependencies.miniApp.updateProfile(telegramUserId, {
      preferredTripClass: optionalTripClass(body.preferredTripClass),
      baggageRequired: optionalBodyBoolean(body.baggageRequired),
      defaultOriginCode: body.defaultOriginCode === undefined
        ? undefined
        : requiredBodyString(body.defaultOriginCode, 'defaultOriginCode'),
      languageCode,
      instantNotificationsEnabled: optionalBodyBoolean(body.instantNotificationsEnabled),
      morningDigestEnabled: optionalBodyBoolean(body.morningDigestEnabled),
      quietHoursEnabled: optionalBodyBoolean(body.quietHoursEnabled),
      quietStartMinute: optionalBodyInteger(body.quietStartMinute),
      quietEndMinute: optionalBodyInteger(body.quietEndMinute)
    });
    response.json(profileJson(await dependencies.miniApp.getProfile(telegramUserId)));
  }));

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    void _next;
    if (error instanceof RateLimitError) {
      response.status(429).json({ error: { code: 'rate_limited', message: error.message } });
      return;
    }
    if (error instanceof ValidationError) {
      const unauthorized = error.message.includes('Telegram') || error.message.includes('/start');
      response.status(unauthorized ? 401 : 400).json({
        error: { code: unauthorized ? 'unauthorized' : 'invalid_request', message: error.message }
      });
      return;
    }
    dependencies.logger.error('web_request_failed', {
      error: error instanceof Error ? error.message : 'Неизвестная ошибка'
    });
    response.status(500).json({ error: { code: 'internal_error', message: 'Внутренняя ошибка' } });
  });

  return app;
}
