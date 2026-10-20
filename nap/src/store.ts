import { Redis } from '@upstash/redis';
import type { NapResult } from './nap';

export interface Store {
  get(id: string): Promise<NapResult | null>;
  set(id: string, result: NapResult, ttlSeconds: number): Promise<void>;
  /** Increment a counter, starting its expiry on first hit. Returns the new count. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export class MemoryStore implements Store {
  private naps = new Map<string, { value: NapResult; expires: number }>();
  private counters = new Map<string, { count: number; expires: number }>();

  constructor(private readonly max = 1000, private readonly now: () => number = Date.now) {}

  async get(id: string): Promise<NapResult | null> {
    const e = this.naps.get(id);
    if (!e) return null;
    if (e.expires < this.now()) {
      this.naps.delete(id);
      return null;
    }
    return e.value;
  }

  async set(id: string, value: NapResult, ttlSeconds: number): Promise<void> {
    this.naps.set(id, { value, expires: this.now() + ttlSeconds * 1000 });
    while (this.naps.size > this.max) {
      const oldest = this.naps.keys().next().value;
      if (oldest === undefined) break;
      this.naps.delete(oldest);
    }
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const now = this.now();
    const c = this.counters.get(key);
    if (!c || c.expires < now) {
      this.counters.set(key, { count: 1, expires: now + ttlSeconds * 1000 });
      return 1;
    }
    c.count += 1;
    return c.count;
  }
}

export class RedisStore implements Store {
  constructor(private readonly redis: Redis) {}

  async get(id: string): Promise<NapResult | null> {
    return (await this.redis.get<NapResult>(`nap:${id}`)) ?? null;
  }

  async set(id: string, value: NapResult, ttlSeconds: number): Promise<void> {
    await this.redis.set(`nap:${id}`, value, { ex: ttlSeconds });
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const k = `rl:${key}`;
    const n = await this.redis.incr(k);
    if (n === 1) await this.redis.expire(k, ttlSeconds);
    return n;
  }
}

let shared: Store | undefined;

/**
 * Upstash Redis when configured (Vercel's Upstash integration sets either
 * UPSTASH_REDIS_REST_* or KV_REST_API_*), otherwise an in-process store.
 */
export function getStore(): Store {
  if (shared) return shared;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) {
    shared = new RedisStore(new Redis({ url, token }));
  } else {
    if (process.env.VERCEL) {
      console.warn('nap: no Redis configured. Share links and rate limits reset on every cold start. Add the Upstash integration.');
    }
    shared = new MemoryStore();
  }
  return shared;
}
