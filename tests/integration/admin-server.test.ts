import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AdminService,
  type AdminRepository,
  type AdminTicketRecord
} from '../../src/application/admin-service.js';
import type { Logger } from '../../src/application/ports.js';
import { basicAuth } from '../../src/infrastructure/http/basic-auth.js';
import { createAdminServer } from '../../src/infrastructure/http/admin-server.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };

const records: readonly AdminTicketRecord[] = [{
  id: 1,
  originCode: 'TAS',
  destinationCode: 'IST',
  price: 2_000_000,
  currencyCode: 'UZS',
  departureDate: '2026-09-15',
  returnDate: null,
  isDirect: true,
  tripClass: 'economy',
  hasBaggage: false,
  ticketLink: 'https://www.aviasales.uz/search/TAS1509IST1'
}];

const repository: AdminRepository = {
  listActiveTickets: () => Promise.resolve(records),
  listCachedDestinations: () => Promise.resolve(['IST']),
  getStats: () => Promise.resolve({
    totalTickets: 1,
    users: 1,
    activeSubscriptions: 0,
    userStats: {
      active: 1,
      new7Days: 1,
      new30Days: 1,
      withActiveSubscriptions: 0,
      referralsTotal: 0,
      referrals30Days: 0,
      recent: []
    },
    priceStats: {
      currentMinPrice: 2_000_000,
      currentAveragePrice: 2_000_000,
      currentMaxPrice: 2_000_000,
      trend30Days: [],
      routes30Days: []
    },
    clickStats: {
      clicks24Hours: 0,
      clicks7Days: 0,
      clicks30Days: 0,
      uniqueUsers30Days: 0,
      bySource30Days: [],
      daily30Days: [],
      topRoutes30Days: []
    },
    lastSync: null
  })
};

const servers: Array<{ close: (callback: () => void) => void }> = [];

async function startServer(runSync = () => Promise.resolve({ processedSources: 1 })): Promise<string> {
  const app = createAdminServer({
    adminService: new AdminService(repository),
    runSync,
    auth: basicAuth('admin', 'secret'),
    logger: silentLogger
  });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      servers.push(server);
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function authHeader(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('admin server', () => {
  it('отдаёт /healthz без авторизации', async () => {
    const base = await startServer();
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('перенаправляет / на /admin/', async () => {
    const base = await startServer();
    const response = await fetch(`${base}/`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/admin/');
  });

  it('требует Basic Auth на /admin/', async () => {
    const base = await startServer();
    const response = await fetch(`${base}/admin/`);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Basic');
  });

  it('рендерит панель с верными данными', async () => {
    const base = await startServer();
    const response = await fetch(`${base}/admin/`, {
      headers: { authorization: authHeader('admin', 'secret') }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const html = await response.text();
    expect(html).toContain('Hot Ticket');
    expect(html).toContain('Стамбул');
  });

  it('запускает синхронизацию по POST /admin/sync', async () => {
    let called = 0;
    const base = await startServer(() => {
      called += 1;
      return Promise.resolve({ processedSources: 2 });
    });
    const response = await fetch(`${base}/admin/sync`, {
      method: 'POST',
      redirect: 'manual',
      headers: { authorization: authHeader('admin', 'secret') }
    });
    expect(called).toBe(1);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/admin/?flash=');
    expect(decodeURIComponent(response.headers.get('location') ?? '')).toContain('Синхронизация завершена');
  });

  it('отклоняет неверный пароль', async () => {
    const base = await startServer();
    const response = await fetch(`${base}/admin/`, {
      headers: { authorization: authHeader('admin', 'nope') }
    });
    expect(response.status).toBe(401);
  });
});
