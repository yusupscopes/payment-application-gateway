import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    DATABASE_URL_TEST: z.string().min(1),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    MIDTRANS_SERVER_KEY: z.string().min(1),
    XENDIT_SECRET_KEY: z.string().min(1),
    API_KEYS: z.string().min(1).optional(),
    REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),
    LOG_WEBHOOK_BODIES: z.string().default("false"),
    SHUTDOWN_TIMEOUT_MS: z.string().default("10000"),
    WEBHOOK_DEDUP_TTL_HOURS: z.string().default("72"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
