import type { Clock, Logger } from '../../application/ports.js';

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}

export class ConsoleLogger implements Logger {
  public info(event: string, context?: Readonly<Record<string, unknown>>): void {
    console.info(event, context ?? {});
  }

  public warn(event: string, context?: Readonly<Record<string, unknown>>): void {
    console.warn(event, context ?? {});
  }

  public error(event: string, context?: Readonly<Record<string, unknown>>): void {
    console.error(event, context ?? {});
  }
}
