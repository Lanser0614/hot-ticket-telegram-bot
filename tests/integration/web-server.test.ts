import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MiniAppService } from '../../src/application/miniapp.js';
import type { Clock, Logger } from '../../src/application/ports.js';
import { SubscriptionService } from '../../src/application/subscriptions.js';
import { SignedTrackedLinkFactory } from '../../src/application/tracked-links.js';
import type { Ticket } from '../../src/domain/ticket.js';
import { createWebServer } from '../../src/infrastructure/http/web-server.js';
import { openSqliteDatabase } from '../../src/infrastructure/sqlite/database.js';
import type { SqliteDatabase } from '../../src/infrastructure/sqlite/database.js';
import { applyMigrations } from '../../src/infrastructure/sqlite/migrations.js';
import { ApplicationRepositories } from '../../src/infrastructure/sqlite/repositories.js';

const botToken = '123456:test-token';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-08-21T10:00:00Z');
  }
}

class SilentLogger implements Logger {
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

const ticket: Ticket = {
  externalKey: 'web-ticket',
  originCode: 'TAS',
  destinationCode: 'IST',
  departureDate: '2026-09-15',
  departureAt: '2026-09-15T16:50:00',
  returnDate: null,
  price: 1_700_000,
  currencyCode: 'UZS',
  airlineCode: 'HY',
  airlineName: 'Uzbekistan Airways',
  isDirect: true,
  tripClass: 'economy',
  hasBaggage: true,
  ticketLink: 'https://www.aviasales.uz/search/TAS1509IST1',
  rawTicketLink: '/TAS1509IST1',
  rawPayload: {}
};

function initData(clock: Clock): string {
  const parameters = new URLSearchParams({
    auth_date: String(Math.floor(clock.now().getTime() / 1_000)),
    user: JSON.stringify({ id: 100, first_name: 'Ali' })
  });
  const dataCheckString = [...parameters.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  parameters.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return parameters.toString();
}

describe('Mini App web server', () => {
  let root = '';
  let closeServer: (() => Promise<void>) | null = null;
  let closeDatabase: (() => void) | null = null;
  let baseUrl = '';
  let repositories: ApplicationRepositories;
  let database: SqliteDatabase;
  let clock: Clock;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'hot-ticket-web-'));
    database = openSqliteDatabase(join(root, 'database.sqlite'));
    closeDatabase = () => database.close();
    applyMigrations(database, resolve('migrations'));
    clock = new FixedClock();
    repositories = new ApplicationRepositories(database, clock);
    await repositories.upsertTelegramProfile({
      telegramUserId: 100,
      telegramChatId: 200,
      username: null,
      firstName: 'Ali',
      lastName: null,
      languageCode: 'ru'
    }, clock.now());
    await repositories.upsert(ticket, clock.now());
    const links = new SignedTrackedLinkFactory({
      publicBaseUrl: 'https://ticket.crosfit.uz',
      signingSecret: 'a'.repeat(32)
    });
    const app = createWebServer({
      miniApp: new MiniAppService(
        repositories,
        repositories,
        repositories,
        new SubscriptionService(repositories, repositories, clock),
        links,
        clock
      ),
      tickets: repositories,
      clicks: repositories,
      clock,
      logger: new SilentLogger(),
      telegramBotToken: botToken,
      authMaxAgeSeconds: 900,
      clickSigningSecret: 'a'.repeat(32),
      affiliate: {
        marker: null,
        template: 'https://www.aviasales.uz/search/{search_code}'
      },
      staticDirectory: resolve('webapp')
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      const server = app.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        closeServer = () => new Promise((resolveClose, rejectClose) => {
          server.close((error) => error === undefined ? resolveClose() : rejectClose(error));
        });
        resolveListen();
      });
      server.on('error', rejectListen);
    });
  });

  afterEach(async () => {
    await closeServer?.();
    closeServer = null;
    closeDatabase?.();
    closeDatabase = null;
    rmSync(root, { force: true, recursive: true });
  });

  it('отклоняет API без Telegram initData', async () => {
    const response = await fetch(`${baseUrl}/api/v1/deals`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('отдаёт каталог только владельцу подписанной Telegram-сессии', async () => {
    const response = await fetch(`${baseUrl}/api/v1/deals`, {
      headers: { authorization: `tma ${initData(clock)}` }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: 1, originCode: 'TAS', destinationCode: 'IST', price: 1_700_000 }]
    });
  });

  it('сохраняет язык и город вылета из onboarding только для Узбекистана', async () => {
    const response = await fetch(`${baseUrl}/api/v1/onboarding`, {
      method: 'POST',
      headers: {
        authorization: `tma ${initData(clock)}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ languageCode: 'uz', defaultOriginCode: 'SKD' })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      languageCode: 'uz', defaultOriginCode: 'SKD', onboardingCompleted: true
    });
    await expect(repositories.findByTelegramUserId(100)).resolves.toMatchObject({
      languageCode: 'uz', defaultOriginCode: 'SKD', onboardingCompleted: true
    });

    const subscription = await fetch(`${baseUrl}/api/v1/subscriptions`, {
      method: 'POST',
      headers: {
        authorization: `tma ${initData(clock)}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        destinationCode: 'IST',
        departureDateFrom: '2026-09-10',
        departureDateTo: '2026-09-20',
        maxPrice: null,
        directOnly: false,
        roundTripOnly: false,
        baggageRequired: false
      })
    });
    expect(subscription.status).toBe(201);
    await expect(subscription.json()).resolves.toMatchObject({ originCode: 'SKD' });

    const profileUpdate = await fetch(`${baseUrl}/api/v1/me`, {
      method: 'PATCH',
      headers: {
        authorization: `tma ${initData(clock)}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        preferredTripClass: 'economy',
        baggageRequired: false,
        defaultOriginCode: 'BHK'
      })
    });
    expect(profileUpdate.status).toBe(200);
    await expect(profileUpdate.json()).resolves.toMatchObject({ defaultOriginCode: 'BHK' });

    const invalid = await fetch(`${baseUrl}/api/v1/onboarding`, {
      method: 'POST',
      headers: {
        authorization: `tma ${initData(clock)}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ languageCode: 'ru', defaultOriginCode: 'ALA' })
    });
    expect(invalid.status).toBe(400);
  });

  it('локализует названия городов для узбекского пользователя', async () => {
    await repositories.upsertTelegramProfile({
      telegramUserId: 100,
      telegramChatId: 200,
      username: null,
      firstName: 'Ali',
      lastName: null,
      languageCode: 'uz'
    }, clock.now());

    const response = await fetch(`${baseUrl}/api/v1/deals`, {
      headers: { authorization: `tma ${initData(clock)}` }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ originName: 'Toshkent', destinationName: 'Istanbul' }]
    });
  });

  it('фиксирует человеческий переход один раз и редиректит на Aviasales', async () => {
    const catalog = await fetch(`${baseUrl}/api/v1/deals`, {
      headers: { authorization: `tma ${initData(clock)}` }
    });
    const payload = await catalog.json() as { items: Array<{ openUrl: string }> };
    const tracked = new URL(payload.items[0]?.openUrl ?? '');
    const localTrackedUrl = `${baseUrl}${tracked.pathname}${tracked.search}`;

    const first = await fetch(localTrackedUrl, { redirect: 'manual' });
    const second = await fetch(localTrackedUrl, { redirect: 'manual' });

    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe('https://www.aviasales.uz/search/TAS1509IST1');
    expect(second.status).toBe(302);
    await expect(repositories.hasRecentClick(1, 1, new Date(clock.now().getTime() - 60_000)))
      .resolves.toBe(true);
    await expect(database.get('SELECT count(*) AS count FROM link_clicks'))
      .resolves.toEqual({ count: 1 });
  });

  it('раздаёт Mini App с CSP и без долгого browser-cache', async () => {
    const response = await fetch(`${baseUrl}/app/`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('cache-control')).toContain('max-age=0');
  });
});
