import type { UserSession } from './models.js';
import type { Clock, SessionRepository } from './ports.js';

const SESSION_TTL_MS = 30 * 60 * 1_000;

export class SessionService {
  public constructor(
    private readonly sessions: SessionRepository,
    private readonly clock: Clock
  ) {}

  public async start(
    userId: number,
    flow: string,
    step: string,
    payload: Readonly<Record<string, unknown>> = {}
  ): Promise<UserSession> {
    const now = this.clock.now();
    const session: UserSession = {
      userId,
      flow,
      step,
      payload,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      createdAt: now,
      updatedAt: now
    };
    await this.sessions.save(session);
    return session;
  }

  public async advance(
    session: UserSession,
    step: string,
    payload: Readonly<Record<string, unknown>>
  ): Promise<UserSession> {
    const now = this.clock.now();
    const updated: UserSession = {
      ...session,
      step,
      payload,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      updatedAt: now
    };
    await this.sessions.save(updated);
    return updated;
  }

  public async getActive(userId: number): Promise<UserSession | null> {
    return (await this.getActiveState(userId)).session;
  }

  public async getActiveState(userId: number): Promise<{
    session: UserSession | null;
    expired: boolean;
  }> {
    const session = await this.sessions.findByUserId(userId);
    if (session === null) return { session: null, expired: false };
    if (session.expiresAt <= this.clock.now()) {
      await this.sessions.deleteByUserId(userId);
      return { session: null, expired: true };
    }
    return { session, expired: false };
  }

  public cancel(userId: number): Promise<void> {
    return this.sessions.deleteByUserId(userId);
  }
}

