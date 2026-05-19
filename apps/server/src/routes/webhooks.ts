import { Hono } from "hono";
import type { ProviderRegistry } from "../core/provider-registry.js";
import { getCorrelationId } from "../middleware/correlation-id.js";
import type { WebhookQueue } from "../queue/webhook-queue.js";
import type { ProviderName } from "../types/payment.js";

export function createWebhookRoutes(
  registry: ProviderRegistry,
  queue?: WebhookQueue,
) {
  const app = new Hono();

  app.post("/:provider", async (c) => {
    const providerName = c.req.param("provider");

    if (!registry.hasProvider(providerName)) {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: `Unknown provider: ${providerName}`,
          },
        },
        400,
      );
    }

    const validatedProviderName = providerName as ProviderName;
    const provider = registry.resolve(validatedProviderName);

    if (!provider.verifyWebhook) {
      return c.json(
        {
          error: {
            code: "NOT_IMPLEMENTED",
            message: `Webhook verification not implemented for provider: ${providerName}`,
          },
        },
        501,
      );
    }

    const signature =
      c.req.header("stripe-signature") ||
      c.req.header("x-callback-token") ||
      c.req.header("x-midtrans-signature") ||
      "";

    // Capture raw body first for HMAC verification
    const rawBody = await c.req.text();
    let body: unknown;
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return c.json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid JSON body",
          },
        },
        400,
      );
    }

    const result = await provider.verifyWebhook({
      provider: validatedProviderName,
      signature,
      body,
    });

    if (!result.success) {
      return c.json(
        {
          error: {
            code: result.error?.code || "UNAUTHORIZED",
            message: result.error?.message || "Webhook verification failed",
          },
        },
        401,
      );
    }

    // If queue is available, enqueue for async processing
    if (queue?.isAvailable) {
      const jobId = await queue.add({
        provider: validatedProviderName,
        signature,
        body,
        correlationId: getCorrelationId(c),
      });

      return c.json(
        {
          success: true,
          event: result.event,
          transactionId: result.transactionId,
          providerRef: result.providerRef,
          queued: true,
          jobId,
        },
        202,
      );
    }

    return c.json(result, 200);
  });

  return app;
}
