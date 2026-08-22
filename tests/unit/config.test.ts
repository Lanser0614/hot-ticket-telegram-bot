import { describe, expect, it } from 'vitest';

import { loadVdsConfig } from '../../src/config.js';

const baseEnvironment = {
  TELEGRAM_BOT_TOKEN: '123:secret',
  AVIASALES_EXPLORE_BASE_URL: 'https://explore-api.aviasales.com'
};

describe('VDS config', () => {
  it('создаёт production config с безопасными defaults', () => {
    const config = loadVdsConfig(baseEnvironment);

    expect(config.databasePath).toBe('./data/hot-ticket-bot.sqlite');
    expect(config.pollTimeoutSeconds).toBe(50);
    expect(config.updateMaxAttempts).toBe(3);
    expect(config.aviasales.aviasalesMarket).toBe('uz');
  });

  it('принимает допустимые overrides', () => {
    const config = loadVdsConfig({
      ...baseEnvironment,
      DATABASE_PATH: '/opt/hot-ticket-bot/data/database.sqlite',
      TELEGRAM_BOT_USERNAME: '@HotTicketBot',
      TELEGRAM_POLL_TIMEOUT_SECONDS: '25',
      TELEGRAM_UPDATE_MAX_ATTEMPTS: '5'
    });

    expect(config.databasePath).toBe('/opt/hot-ticket-bot/data/database.sqlite');
    expect(config.pollTimeoutSeconds).toBe(25);
    expect(config.updateMaxAttempts).toBe(5);
    expect(config.telegramBotUsername).toBe('HotTicketBot');
  });

  it.each([
    [{ ...baseEnvironment, TELEGRAM_BOT_TOKEN: '' }, 'TELEGRAM_BOT_TOKEN'],
    [{ ...baseEnvironment, TELEGRAM_POLL_TIMEOUT_SECONDS: '0' }, 'TELEGRAM_POLL_TIMEOUT_SECONDS'],
    [{ ...baseEnvironment, TELEGRAM_POLL_TIMEOUT_SECONDS: '50.5' }, 'TELEGRAM_POLL_TIMEOUT_SECONDS'],
    [{ ...baseEnvironment, TELEGRAM_UPDATE_MAX_ATTEMPTS: '6' }, 'TELEGRAM_UPDATE_MAX_ATTEMPTS'],
    [{ ...baseEnvironment, TELEGRAM_BOT_USERNAME: 'bad-name' }, 'TELEGRAM_BOT_USERNAME']
  ])('отклоняет некорректную настройку', (environment, setting) => {
    expect(() => loadVdsConfig(environment)).toThrow(setting);
  });

  it('не раскрывает токен при другой ошибке конфигурации', () => {
    const token = '123:very-secret';
    let message = '';
    try {
      loadVdsConfig({
        TELEGRAM_BOT_TOKEN: token,
        AVIASALES_EXPLORE_BASE_URL: 'http://unsafe.example'
      });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(token);
    expect(message).toContain('HTTPS');
  });
});
