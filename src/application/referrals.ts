import { randomBytes } from 'node:crypto';

import type { Clock, ReferralRepository } from './ports.js';

export interface ReferralStartPayload {
  readonly code: string;
  readonly ticketId: number | null;
}

export function parseReferralStartPayload(value: string | null): ReferralStartPayload | null {
  if (value === null || value.length > 64) return null;
  const shared = /^s_([A-Za-z0-9_-]{8,24})_(\d{1,12})$/u.exec(value);
  if (shared !== null) {
    const ticketId = Number(shared[2]);
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0) return null;
    return { code: shared[1] ?? '', ticketId };
  }
  const generic = /^r_([A-Za-z0-9_-]{8,24})$/u.exec(value);
  return generic === null ? null : { code: generic[1] ?? '', ticketId: null };
}

export class ReferralService {
  private readonly codePromises = new Map<number, Promise<string>>();

  public constructor(
    private readonly referrals: ReferralRepository,
    private readonly botUsername: string | null,
    private readonly clock: Clock
  ) {}

  public async createShareUrl(userId: number, ticketId: number | null): Promise<string | null> {
    if (this.botUsername === null) return null;
    const code = await this.ensureCode(userId);
    const payload = ticketId === null ? `r_${code}` : `s_${code}_${String(ticketId)}`;
    const url = new URL(`https://t.me/${this.botUsername}`);
    url.searchParams.set('start', payload);
    return url.toString();
  }

  public async attributeNewUser(
    userId: number,
    payload: ReferralStartPayload
  ): Promise<boolean> {
    const referrerUserId = await this.referrals.findUserIdByCode(payload.code);
    if (referrerUserId === null || referrerUserId === userId) return false;
    return this.referrals.attribute({
      referredUserId: userId,
      referrerUserId,
      referralCode: payload.code,
      sharedTicketId: payload.ticketId,
      attributedAt: this.clock.now()
    });
  }

  public countForUser(userId: number): Promise<number> {
    return this.referrals.countReferrals(userId);
  }

  public savePendingTicket(userId: number, ticketId: number): Promise<void> {
    return this.referrals.savePendingSharedTicket(userId, ticketId, this.clock.now());
  }

  public takePendingTicket(userId: number): Promise<number | null> {
    return this.referrals.takePendingSharedTicket(userId);
  }

  private async ensureCode(userId: number): Promise<string> {
    const cached = this.codePromises.get(userId);
    if (cached !== undefined) return cached;
    const pending = this.loadOrCreateCode(userId);
    this.codePromises.set(userId, pending);
    try {
      return await pending;
    } catch (error: unknown) {
      this.codePromises.delete(userId);
      throw error;
    }
  }

  private async loadOrCreateCode(userId: number): Promise<string> {
    const existing = await this.referrals.findCodeByUserId(userId);
    if (existing !== null) return existing;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomBytes(9).toString('base64url');
      if (await this.referrals.createCode(userId, code, this.clock.now())) return code;
      const concurrent = await this.referrals.findCodeByUserId(userId);
      if (concurrent !== null) return concurrent;
    }
    throw new Error('Не удалось создать реферальный код');
  }
}
