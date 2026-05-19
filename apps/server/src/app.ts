import type { Database } from "@payment-application-gateway/db";
import { createDb } from "@payment-application-gateway/db";
import { env } from "@payment-application-gateway/env/server";
import { createRedisClient } from "@payment-application-gateway/redis";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { MidtransAdapter } from "./adapters/midtrans/midtrans-adapter.js";
import { StripeAdapter } from "./adapters/stripe/stripe-adapter.js";
import { XenditAdapter } from "./adapters/xendit/xendit-adapter.js";
import { AuditLogger } from "./core/audit-logger.js";
import { PaymentGateway } from "./core/payment-gateway.js";
import { ProviderRegistry } from "./core/provider-registry.js";
import { RetryManager } from "./core/retry-manager.js";
import { createApiKeyAuth, parseApiKeys } from "./middleware/api-key-auth.js";
import { correlationId } from "./middleware/correlation-id.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createRateLimiter } from "./middleware/rate-limiter.js";
import { WebhookQueue } from "./queue/webhook-queue.js";
import { WebhookWorker } from "./queue/webhook-worker.js";
import { createHealthRoutes } from "./routes/health.js";
import { createMetricsRoutes } from "./routes/metrics.js";
import { createPaymentRoutes } from "./routes/payments.js";
import { createWebhookRoutes } from "./routes/webhooks.js";

export function createApp(
  options: { database?: Database; registry?: ProviderRegistry } = {},
) {
  const app = new Hono();

  app.use(logger());
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
        console.warn(
          "[Payment Gateway] Redis rate limiting unavailable:",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  paymentRoutes.route("/", paymentHandlers);

  app.route("/v1/payments", paymentRoutes);

  // Health endpoint
  app.route("/health", createHealthRoutes(registry));

  // Metrics endpoint
  app.route("/metrics", createMetricsRoutes());

  // Webhook queue with graceful degradation
  let webhookQueue: WebhookQueue | undefined;

  if (env.NODE_ENV !== "test") {
    try {
      const redisClient = createRedisClient(env.REDIS_URL);
      webhookQueue = new WebhookQueue(redisClient);
      // Worker is created for side effects (starts processing jobs)
      new WebhookWorker(redisClient, registry);
    } catch (error) {
      console.warn(
        "[Payment Gateway] Redis webhook queue unavailable:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  app.route("/v1/webhooks", createWebhookRoutes(registry, webhookQueue));

  app.get("/", (c) => {
    return c.text("OK");
  });

  return app;
}
