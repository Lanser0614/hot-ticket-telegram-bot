export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; startedAt: number }>();

  public constructor(
    private readonly maximum: number,
    private readonly windowMilliseconds = 60_000
  ) {}

  public allow(key: string, now: Date): boolean {
    const timestamp = now.getTime();
    const current = this.windows.get(key);
    if (current === undefined || timestamp - current.startedAt >= this.windowMilliseconds) {
      this.windows.set(key, { count: 1, startedAt: timestamp });
      this.prune(timestamp);
      return true;
    }
    if (current.count >= this.maximum) return false;
    current.count += 1;
    return true;
  }

  private prune(now: number): void {
    if (this.windows.size < 1_000) return;
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.windowMilliseconds) this.windows.delete(key);
    }
  }
}
