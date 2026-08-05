import { describe, expect, it } from 'vitest';

import type { Logger } from '../../../src/application/ports.js';
import { LongPollingRunner } from '../../../src/infrastructure/telegram/long-polling.js';
import type { TelegramUpdate } from '../../../src/infrastructure/telegram/updates.js';

class FakeApi {
  public updates: readonly TelegramUpdate[] = [];
  public offsets: number[] = [];

  public getUpdates(input: { offset: number }, signal: AbortSignal): Promise<readonly TelegramUpdate[]> {
    void signal;
    this.offsets.push(input.offset);
    return Promise.resolve(this.updates);
  }
}

class FakeOffsetStore {
  public current = 0;
  public readonly saved: number[] = [];

  public read(): Promise<number> {
    return Promise.resolve(this.current);
  }

  public save(value: number): Promise<void> {
    this.current = value;
    this.saved.push(value);
    return Promise.resolve();
  }
}

class FakeRouter {
  public readonly events: string[] = [];
  public failuresRemaining = 0;

  public handleMessage(message: { text?: string }): Promise<void> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return Promise.reject(new Error('secret failure details'));
    }
    this.events.push(`message:${message.text ?? ''}`);
    return Promise.resolve();
  }

  public handleCallbackQuery(query: { data?: string }): Promise<void> {
    this.events.push(`callback:${query.data ?? ''}`);
    return Promise.resolve();
  }
}

class RecordingLogger implements Logger {
  public readonly errors: Array<{ event: string; context?: Readonly<Record<string, unknown>> }> = [];
  public info(): void {}
  public warn(): void {}
  public error(event: string, context?: Readonly<Record<string, unknown>>): void {
    this.errors.push(context === undefined ? { event } : { event, context });
  }
}

function update(updateId: number, kind: 'message' | 'callback' | 'unsupported'): TelegramUpdate {
  return {
    updateId,
    message: kind === 'message' ? { chat: { id: 1 }, text: '/start' } : null,
    callbackQuery: kind === 'callback'
      ? { id: 'callback', from: { id: 1 }, chatId: null, data: 'subscription:disable:3' }
      : null
  };
}

function fixture(maxAttempts = 3) {
  const api = new FakeApi();
  const offsets = new FakeOffsetStore();
  const router = new FakeRouter();
  const logger = new RecordingLogger();
  const sleeps: number[] = [];
  const runner = new LongPollingRunner({
    api,
    offsetStore: offsets,
    router,
    logger,
    pollTimeoutSeconds: 50,
    updateMaxAttempts: maxAttempts,
    sleep: (milliseconds) => {
      sleeps.push(milliseconds);
      return Promise.resolve();
    }
  });
  return { api, offsets, router, logger, sleeps, runner };
}

describe('LongPollingRunner', () => {
  it('обрабатывает updates последовательно и сохраняет offset после каждого', async () => {
    const subject = fixture();
    subject.api.updates = [update(7, 'message'), update(8, 'callback')];

    await subject.runner.pollOnce(new AbortController().signal);

    expect(subject.router.events).toEqual([
      'message:/start',
      'callback:subscription:disable:3'
    ]);
    expect(subject.offsets.saved).toEqual([8, 9]);
  });

  it('повторяет update три раза с backoff и затем продолжает', async () => {
    const subject = fixture();
    subject.router.failuresRemaining = 2;
    subject.api.updates = [update(7, 'message')];

    await subject.runner.pollOnce(new AbortController().signal);

    expect(subject.router.events).toEqual(['message:/start']);
    expect(subject.sleeps).toEqual([1_000, 2_000]);
    expect(subject.offsets.saved).toEqual([8]);
  });

  it('пропускает poison update после трёх ошибок без деталей ошибки в логах', async () => {
    const subject = fixture();
    subject.router.failuresRemaining = 3;
    subject.api.updates = [update(7, 'message'), update(8, 'unsupported')];

    await subject.runner.pollOnce(new AbortController().signal);

    expect(subject.offsets.saved).toEqual([8, 9]);
    expect(subject.logger.errors).toEqual([{
      event: 'telegram_update_skipped',
      context: { updateId: 7, errorType: 'Error' }
    }]);
    expect(JSON.stringify(subject.logger.errors)).not.toContain('secret failure');
  });

  it('пропускает повреждённый payload и продвигает offset', async () => {
    const subject = fixture();
    const malformed = {
      updateId: 7,
      message: null,
      callbackQuery: null,
      malformed: true
    } as TelegramUpdate;
    subject.api.updates = [malformed, update(8, 'unsupported')];

    await subject.runner.pollOnce(new AbortController().signal);

    expect(subject.sleeps).toEqual([1_000, 2_000]);
    expect(subject.offsets.saved).toEqual([8, 9]);
    expect(subject.logger.errors).toEqual([{
      event: 'telegram_update_skipped',
      context: { updateId: 7, errorType: 'TypeError' }
    }]);
  });

  it('завершает активный polling после abort', async () => {
    const controller = new AbortController();
    const subject = fixture();
    subject.api.getUpdates = (_input, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      controller.abort();
    });
    await expect(subject.runner.run(controller.signal)).resolves.toBeUndefined();
  });
});
