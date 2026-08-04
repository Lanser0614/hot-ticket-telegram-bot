import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Clock, Logger } from '../../src/application/ports.js';
import { loadVdsConfig } from '../../src/config.js';
import type { FetchLike } from '../../src/infrastructure/telegram/api-client.js';
import { createVdsRuntime } from '../../src/runtime/composition.js';

class FixedClock implements Clock {
  public now(): Date {
    return new Date('2026-08-04T12:00:00Z');
  }
}

class SilentLogger implements Logger {
  public info(): void {}
  public warn(): void {}
  public error(): void {}
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('VDS production composition', () => {
  it('обрабатывает /start и синхронизирует fixture через реальные SQLite repositories', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hot-ticket-vds-runtime-'));
    temporaryDirectories.push(directory);
    const aviasalesFixture = readFileSync(
      resolve('tests/fixtures/aviasales-hot-offers.json'),
      'utf8'
    );
    const telegramMethods: string[] = [];
    const fetch: FetchLike = (input) => {
      const url = String(input);
      if (url.startsWith('https://api.telegram.org/')) {
        telegramMethods.push(url.split('/').at(-1) ?? 'unknown');
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          result: { message_id: 1 }
        }), { status: 200 }));
      }
      if (url.startsWith('https://explore-api.aviasales.com/')) {
        return Promise.resolve(new Response(aviasalesFixture, { status: 200 }));
      }
      return Promise.reject(new Error('Unexpected test URL'));
    };
    const config = loadVdsConfig({
      TELEGRAM_BOT_TOKEN: '123:test-token',
      DATABASE_PATH: join(directory, 'database.sqlite'),
      AVIASALES_EXPLORE_BASE_URL: 'https://explore-api.aviasales.com'
    });
    const runtime = createVdsRuntime(config, {
      fetch,
      clock: new FixedClock(),
      logger: new SilentLogger(),
      sleeper: { sleep: () => Promise.resolve() }
    });

    await runtime.router.handleMessage({
      chat: { id: 200 },
      from: { id: 100, first_name: 'Ali', language_code: 'ru' },
      text: '/start'
    });
    await runtime.ensureInitialSource();
    const result = await runtime.syncJob.execute();

    expect(result).toEqual({ processedSources: 1 });
    expect(await runtime.database.get('SELECT count(*) AS count FROM users')).toEqual({ count: 1 });
    const ticketCount = await runtime.database.get('SELECT count(*) AS count FROM tickets');
    expect(Number(ticketCount?.count)).toBeGreaterThan(0);
    expect(await runtime.database.get('SELECT count(*) AS count FROM sync_runs')).toEqual({ count: 1 });
    expect(telegramMethods).toContain('sendMessage');
    runtime.close();
  });
});
