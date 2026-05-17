import { Hono } from "hono";
import type { ProviderRegistry } from "../core/provider-registry.js";

export function createWebhookRoutes(registry: ProviderRegistry) {
  const app = new Hono();

  app.post("/:provider", async (c) => {
    const providerName = c.req.param("provider");

    if (
      providerName !== "stripe" &&
      providerName !== "midtrans" &&
      providerName !== "xendit"
    ) {
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

    const provider = registry.resolve(providerName);

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
      provider: providerName,
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

    return c.json(result, 200);
  });

  return app;
}
