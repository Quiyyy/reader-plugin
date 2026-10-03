import { setTimeout as delay } from 'node:timers/promises';
import { RuleError } from './rules.js';
export interface Rate { count: number; interval: number; }
export function parseRate(value: unknown): Rate | undefined {
  if (value === undefined || value === '' || value === '0' || value === 0) return;
  const match = String(value).match(/^(?:(\d{1,3})\/)?(\d{1,7})$/);
  const count = match?.[1] ? Number(match[1]) : 1, interval = Number(match?.[2]);
  if (!match || count < 1 || count > 100 || interval < 1 || interval > 3600000) throw new RuleError('blocked', '限速须为正毫秒数或 次数/毫秒（最多 100 次、3600000 毫秒）');
  return { count, interval };
}
/** Rolling window is at least as conservative as the source's a/b fixed window. */
export class SourceRateLimiter {
  private records = new Map<string, number[]>();
  async wait(key: string, rate: Rate | undefined, signal: AbortSignal) {
    if (!rate) return;
    for (;;) {
      signal.throwIfAborted();
      const now = Date.now(), times = (this.records.get(key) ?? []).filter(time => now - time < rate.interval);
      this.records.set(key, times);
      if (times.length < rate.count) { times.push(now); return; }
      await delay(Math.max(1, times[0] + rate.interval - now), undefined, { signal });
    }
  }
}
