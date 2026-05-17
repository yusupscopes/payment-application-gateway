import Redis from "ioredis";

let redisClient: Redis | null = null;

export function createRedisClient(connectionString?: string): Redis {
  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis(connectionString || "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
  });
  return redisClient;
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    throw new Error(
      "Redis client not initialized. Call createRedisClient() first.",
    );
  }
  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
