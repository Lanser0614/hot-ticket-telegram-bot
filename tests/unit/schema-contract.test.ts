import { describe, expect, it } from 'vitest';

import * as schema from '../../schema.js';
import type { TableDescriptor } from '../support/sdk-db.mock.js';

const requiredTables = [
  'notificationHistory',
  'subscriptions',
  'syncLocks',
  'syncRuns',
  'syncSources',
  'ticketPriceHistory',
  'tickets',
  'userSessions',
  'users'
] as const;

describe('Telegram schema', () => {
  it('экспортирует все обязательные таблицы', () => {
    expect(Object.keys(schema).sort()).toEqual([...requiredTables].sort());
  });

  it('задаёт уникальный ключ истории уведомлений', () => {
    const notificationHistory = schema.notificationHistory as unknown as TableDescriptor;
    expect(notificationHistory.constraints.notificationUnique).toMatchObject({
      kind: 'unique',
      columns: ['user_id', 'subscription_id', 'ticket_id', 'notified_price']
    });
  });

  it('задаёт индексы поиска билетов', () => {
    const tickets = schema.tickets as unknown as TableDescriptor;
    expect(Object.values(tickets.constraints).map((constraint) => constraint.name)).toEqual(expect.arrayContaining([
      'idx_tickets_origin',
      'idx_tickets_destination',
      'idx_tickets_departure_date',
      'idx_tickets_price',
      'idx_tickets_origin_currency',
      'idx_tickets_active'
    ]));
  });

  it('использует ключ блокировки как primary key', () => {
    const syncLocks = schema.syncLocks as unknown as TableDescriptor;
    expect(syncLocks.columns.key?.modifiers).toContain('primaryKey');
  });
});
