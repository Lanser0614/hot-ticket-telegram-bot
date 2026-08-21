import type { StoredTicket } from './models.js';
import type { TrackedLinkFactory } from './ports.js';
import type { ClickSource } from '../domain/click-tracking.js';
import { signClickPayload } from '../domain/click-signature.js';

export interface TrackingLinkConfig {
  readonly publicBaseUrl: string | null;
  readonly signingSecret: string | null;
}

export class SignedTrackedLinkFactory implements TrackedLinkFactory {
  public constructor(private readonly config: TrackingLinkConfig) {}

  public create(input: {
    ticket: StoredTicket;
    source: ClickSource;
    userId: number | null;
    subscriptionId: number | null;
  }): string {
    if (this.config.publicBaseUrl === null || this.config.signingSecret === null) {
      return input.ticket.ticketLink;
    }
    const payload = {
      ticketId: input.ticket.id,
      source: input.source,
      userId: input.userId,
      subscriptionId: input.subscriptionId
    };
    const url = new URL(`/go/${String(input.ticket.id)}`, this.config.publicBaseUrl);
    url.searchParams.set('s', input.source);
    if (input.userId !== null) url.searchParams.set('u', String(input.userId));
    if (input.subscriptionId !== null) url.searchParams.set('b', String(input.subscriptionId));
    url.searchParams.set('sig', signClickPayload(payload, this.config.signingSecret));
    return url.toString();
  }
}
