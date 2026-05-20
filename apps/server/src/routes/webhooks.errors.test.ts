import { describe, expect, it, jest } from "@jest/globals";
import type { ProviderRegistry } from "../core/provider-registry.js";
import { createWebhookRoutes } from "./webhooks.js";

describe("createWebhookRoutes error handling", () => {
  it("returns 400 for unknown provider", async () => {
    const registry = {
      hasProvider: () => false,
    } as unknown as ProviderRegistry;

    const app = createWebhookRoutes(registry);
    const res = await app.request("/unknown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 501 when verifyWebhook is not implemented", async () => {
    const registry = {
      hasProvider: () => true,
      resolve: () => ({
        verifyWebhook: undefined,
      }),
    } as unknown as ProviderRegistry;

    const app = createWebhookRoutes(registry);
    const res = await app.request("/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_IMPLEMENTED");
  });

  it("returns 400 for invalid JSON body", async () => {
    const registry = {
      hasProvider: () => true,
      resolve: () => ({
        verifyWebhook: async () => ({ success: true }),
      }),
    } as unknown as ProviderRegistry;

    const app = createWebhookRoutes(registry);
    const res = await app.request("/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns 401 when webhook verification fails", async () => {
    const registry = {
      hasProvider: () => true,
      resolve: () => ({
        verifyWebhook: async () => ({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Invalid signature" },
        }),
      }),
    } as unknown as ProviderRegistry;

    const app = createWebhookRoutes(registry);
    const res = await app.request("/stripe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "bad-sig",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 202 with queued=true when queue is available", async () => {
    const registry = {
      hasProvider: () => true,
      resolve: () => ({
        verifyWebhook: async () => ({
          success: true,
          event: "charge.succeeded",
        }),
      }),
    } as unknown as ProviderRegistry;

    const mockQueue = {
      isAvailable: true,
      add: jest.fn(async () => "job-123"),
    } as unknown as import("../queue/webhook-queue.js").WebhookQueue;

    const app = createWebhookRoutes(registry, mockQueue);
    const res = await app.request("/stripe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "sig",
      },
      body: JSON.stringify({ id: "evt_1" }),
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.queued).toBe(true);
    expect(body.jobId).toBe("job-123");
  });
});
