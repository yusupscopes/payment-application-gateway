import type { MiddlewareHandler } from "hono";
import type { ClientRateLimitInfo, Store } from "hono-rate-limiter";
import { rateLimiter } from "hono-rate-limiter";
import type { Redis } from "ioredis";

export class IoredisStore implements Store {
  client: Redis;
  prefix: string;
  windowMs: number;

  constructor(options: { client: Redis; prefix?: string }) {
    this.client = options.client;
    this.prefix = options.prefix ?? "rate-limit:";
    this.windowMs = 60000;
  }

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const data = await this.client.get(this.prefixKey(key));
    if (!data) return undefined;

    const parsed = JSON.parse(data) as { totalHits: number; resetTime: string };
    return {
      totalHits: parsed.totalHits,
      resetTime: new Date(parsed.resetTime),
    };
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const prefixedKey = this.prefixKey(key);

    // Atomic Lua script: get current value, increment, preserve or set TTL
    const script = `
      local key = KEYS[1]
      local windowMs = tonumber(ARGV[1])
      local current = redis.call('GET', key)
      local ttl = redis.call('PTTL', key)

      if current == false or ttl <= 0 then
        redis.call('SET', key, 1, 'PX', windowMs)
        return {1, windowMs}
      else
        local newVal = tonumber(current) + 1
        redis.call('SET', key, newVal, 'PX', ttl)
        return {newVal, ttl}
      end
    `;

    const result = (await this.client.eval(
      script,
      1,
      prefixedKey,
      this.windowMs,
    )) as [number, number];

    const totalHits = result[0];
    const ttlMs = result[1];
    const resetTime = new Date(Date.now() + ttlMs);

    return { totalHits, resetTime };
  }

  async decrement(key: string): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    const script = `
      local key = KEYS[1]
      local current = redis.call('GET', key)
      if current ~= false then
        local newVal = math.max(0, tonumber(current) - 1)
        local ttl = redis.call('PTTL', key)
        if ttl > 0 then
          redis.call('SET', key, newVal, 'PX', ttl)
        end
      end
    `;
    await this.client.eval(script, 1, prefixedKey);
  }

  async resetKey(key: string): Promise<void> {
    await this.client.del(this.prefixKey(key));
  }

  private prefixKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}

export function createRateLimiter(options: {
  client: Redis;
  windowMs?: number;
  limit?: number;
  keyGenerator?: (c: {
    req: { header: (name: string) => string | undefined };
  }) => string;
}): MiddlewareHandler {
  const store = new IoredisStore({ client: options.client });

  return rateLimiter({
    windowMs: options.windowMs ?? 60000,
    limit: options.limit ?? 100,
    standardHeaders: true,
    keyGenerator: (c) => {
      if (options.keyGenerator) {
        return options.keyGenerator(c);
      }
      // Default: use x-api-key header
      return c.req.header("x-api-key") ?? "anonymous";
    },
    handler: (c) => {
      return c.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests, please try again later.",
            retryable: true,
          },
        },
        429,
      );
    },
    store,
  });
}
