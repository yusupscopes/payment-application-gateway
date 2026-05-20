import type { Database } from "@payment-application-gateway/db";
import { createDb } from "@payment-application-gateway/db";
import { env } from "@payment-application-gateway/env/server";
import { createRedisClient } from "@payment-application-gateway/redis";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type Redis from "ioredis";
import type { Logger } from "pino";
import { MidtransAdapter } from "./adapters/midtrans/midtrans-adapter.js";
import { StripeAdapter } from "./adapters/stripe/stripe-adapter.js";
import { XenditAdapter } from "./adapters/xendit/xendit-adapter.js";
import { AuditLogger } from "./core/audit-logger.js";
import { createLogger } from "./core/logger.js";
import { PaymentGateway } from "./core/payment-gateway.js";
import { ProviderRegistry } from "./core/provider-registry.js";
import { RetryManager } from "./core/retry-manager.js";
import { createApiKeyAuth, parseApiKeys } from "./middleware/api-key-auth.js";
import { bodySizeLimit } from "./middleware/body-size-limit.js";
import { correlationId } from "./middleware/correlation-id.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createRateLimiter } from "./middleware/rate-limiter.js";
import { createRequestLogger } from "./middleware/request-logger.js";
import { WebhookQueue } from "./queue/webhook-queue.js";
import { WebhookWorker } from "./queue/webhook-worker.js";
import { createHealthRoutes } from "./routes/health.js";
import { createMetricsRoutes } from "./routes/metrics.js";
import { createPaymentRoutes } from "./routes/payments.js";
import { createWebhookRoutes } from "./routes/webhooks.js";

export interface AppResources {
  app: Hono;
  db: Database;
  redisClient: Redis | undefined;
  webhookQueue: WebhookQueue | undefined;
  webhookWorker: WebhookWorker | undefined;
  logger: Logger;
  shutdown: () => Promise<void>;
}

export function createApp(
  options: { database?: Database; registry?: ProviderRegistry } = {},
): AppResources {
  const app = new Hono();
  const logger = createLogger({ level: env.LOG_LEVEL });

  app.use(
    createRequestLogger(logger, {
      logBodies: env.LOG_WEBHOOK_BODIES === "true",
    }),
  );
  app.use(
    "/*",
    cors({
      origin: env.CORS_ORIGIN,
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  app.onError(errorHandler);

  // Correlation ID for observability
  app.use(correlationId());

  // Core infrastructure
  const db = options.database ?? createDb();
  const registry = options.registry ?? new ProviderRegistry();
  const retryManager = new RetryManager();
  const auditLogger = new AuditLogger(db);

  // Register adapters only if registry was not provided
  if (!options.registry) {
    registry.register(
      new StripeAdapter({
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      }),
    );
    registry.register(
      new MidtransAdapter({ serverKey: env.MIDTRANS_SERVER_KEY }),
    );
    registry.register(new XenditAdapter({ secretKey: env.XENDIT_SECRET_KEY }));
  }

  // Gateway orchestrator
  const gateway = new PaymentGateway(registry, retryManager, auditLogger);

  // Routes
  const apiKeys = parseApiKeys(env.API_KEYS);
  const paymentHandlers = createPaymentRoutes(gateway);

  // Create a wrapper app for payments so middleware runs before route handlers
  const paymentRoutes = new Hono();

  // Payment routes: 1MB body limit
  paymentRoutes.use("/*", bodySizeLimit("1mb"));

  if (apiKeys.size > 0) {
    paymentRoutes.use(createApiKeyAuth(apiKeys));

    // Add per-API-key rate limiting when Redis is available (skip in test env)
    if (env.NODE_ENV !== "test") {
      try {
        const redisClient = createRedisClient(env.REDIS_URL);
        paymentRoutes.use(
          createRateLimiter({
            client: redisClient,
            windowMs: 60000,
            limit: 100,
            keyGenerator: (c) => c.req.header("x-api-key") ?? "anonymous",
          }),
        );
      } catch (error) {
        logger.warn(
          { err: error instanceof Error ? error.message : String(error) },
          "Redis rate limiting unavailable",
        );
      }
    }
  }

  paymentRoutes.route("/", paymentHandlers);

  app.route("/v1/payments", paymentRoutes);

  // Shutdown state shared with health endpoint
  let shuttingDown = false;
  const isShuttingDown = () => shuttingDown;

  // Health endpoint
  app.route("/health", createHealthRoutes(registry, isShuttingDown));

  // Metrics endpoint
  app.route("/metrics", createMetricsRoutes());

  // Webhook queue with graceful degradation
  let webhookQueue: WebhookQueue | undefined;
  let webhookWorker: WebhookWorker | undefined;
  let redisClient: Redis | undefined;

  if (env.NODE_ENV !== "test") {
    try {
      redisClient = createRedisClient(env.REDIS_URL);
      webhookQueue = new WebhookQueue(redisClient);
      webhookWorker = new WebhookWorker(redisClient, registry, logger);
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        "Redis webhook queue unavailable",
      );
    }
  }

  // Webhook routes: 5MB body limit
  const webhookRoutes = new Hono();
  webhookRoutes.use("/*", bodySizeLimit("5mb"));
  const dedupTtlHours = Number.parseInt(env.WEBHOOK_DEDUP_TTL_HOURS, 10);
  webhookRoutes.route(
    "/",
    createWebhookRoutes(registry, webhookQueue, redisClient, dedupTtlHours),
  );
  app.route("/v1/webhooks", webhookRoutes);

  app.get("/", (c) => {
    return c.text("OK");
  });

  const shutdown = async (): Promise<void> => {
    shuttingDown = true;

    if (webhookWorker) {
      await webhookWorker.close();
    }

    if (webhookQueue) {
      await webhookQueue.close();
    }

    if (redisClient) {
      await redisClient.quit();
    }

    // Flush logger before exit
    logger.flush();
  };

  return {
    app,
    db,
    redisClient,
    webhookQueue,
    webhookWorker,
    logger,
    shutdown,
  };
}
