import { IoredisStore } from "./rate-limiter.js";

function createMockRedis() {
  const store = new Map<string, string>();

  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, ..._args: unknown[]) => {
      store.set(key, value);
      return "OK";
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    eval: jest.fn(
      async (
        script: string,
        _numKeys: number,
        key: string,
        windowMs?: number,
      ) => {
        // Simplified Lua script simulation - inspect script to determine operation
        const data = store.get(key);

        if (script.includes("+ 1")) {
          // Increment operation
          if (!data) {
            store.set(
              key,
              JSON.stringify({
                totalHits: 1,
                resetTime: new Date(
                  Date.now() + (windowMs ?? 60000),
                ).toISOString(),
              }),
            );
            return [1, windowMs ?? 60000];
          }
          const parsed = JSON.parse(data) as {
            totalHits: number;
            resetTime: string;
          };
          const newHits = parsed.totalHits + 1;
          store.set(
            key,
            JSON.stringify({ totalHits: newHits, resetTime: parsed.resetTime }),
          );
          return [
            newHits,
            Math.max(0, new Date(parsed.resetTime).getTime() - Date.now()),
          ];
        }

        if (script.includes("- 1")) {
          // Decrement operation
          if (data) {
            const parsed = JSON.parse(data) as {
              totalHits: number;
              resetTime: string;
            };
            const newHits = Math.max(0, parsed.totalHits - 1);
            store.set(
              key,
              JSON.stringify({
                totalHits: newHits,
                resetTime: parsed.resetTime,
              }),
            );
          }
          return [];
        }

        return [];
      },
    ),
  } as unknown as import("ioredis").Redis;
}

describe("IoredisStore", () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let redisStore: IoredisStore;

  beforeEach(() => {
    mockRedis = createMockRedis();
    redisStore = new IoredisStore({ client: mockRedis });
    redisStore.init({ windowMs: 60000 });
  });

  describe("increment", () => {
    it("should increment hit count atomically", async () => {
      const result1 = await redisStore.increment("key1");
      expect(result1.totalHits).toBe(1);

      const result2 = await redisStore.increment("key1");
      expect(result2.totalHits).toBe(2);

      const result3 = await redisStore.increment("key1");
      expect(result3.totalHits).toBe(3);
    });

    it("should set reset time on first increment", async () => {
      const before = Date.now();
      const result = await redisStore.increment("key1");
      const after = Date.now();

      expect(result.resetTime.getTime()).toBeGreaterThanOrEqual(before + 60000);
      expect(result.resetTime.getTime()).toBeLessThanOrEqual(after + 60000);
    });

    it("should use Redis eval for atomicity", async () => {
      await redisStore.increment("key1");
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    });
  });

  describe("get", () => {
    it("should return undefined for non-existent key", async () => {
      const result = await redisStore.get("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should return current hit count and reset time", async () => {
      await redisStore.increment("key1");
      const result = await redisStore.get("key1");

      expect(result).toBeDefined();
      expect(result?.totalHits).toBe(1);
      expect(result?.resetTime).toBeInstanceOf(Date);
    });
  });

  describe("decrement", () => {
    it("should decrement hit count", async () => {
      await redisStore.increment("key1");
      await redisStore.increment("key1");
      await redisStore.decrement("key1");

      const result = await redisStore.get("key1");
      expect(result?.totalHits).toBe(1);
    });

    it("should not go below zero", async () => {
      await redisStore.increment("key1");
      await redisStore.decrement("key1");
      await redisStore.decrement("key1");

      const result = await redisStore.get("key1");
      expect(result?.totalHits).toBe(0);
    });
  });

  describe("resetKey", () => {
    it("should remove key from store", async () => {
      await redisStore.increment("key1");
      await redisStore.resetKey("key1");

      const result = await redisStore.get("key1");
      expect(result).toBeUndefined();
    });
  });
});
