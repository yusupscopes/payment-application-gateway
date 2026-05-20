import { describe, expect, it, jest } from "@jest/globals";
import type { ProviderRegistry } from "../core/provider-registry.js";
import { createWebhookRoutes } from "./webhooks.js";

function createMockRedis() {
  const stored = new Map<string, string>();
  return {
    set: jest.fn(async (key: string, _value: string, ..._args: string[]) => {
      if (stored.has(key)) {
        return null;
      }
      stored.set(key, "1");
      return "OK";
    }),
    stored,
  } as unknown as import("ioredis").default;
}

describe("createWebhookRoutes deduplication", () => {
  it("returns 200 with duplicate=true when event already processed", async () => {
    const mockRedis = createMockRedis();
    const registry = {
      hasProvider: () => true,
      resolve: () => ({
        verifyWebhook: async () => ({
          success: true,
          event: "charge.succeeded",
        }),
      }),
    } as unknown as ProviderRegistry;

    const app = createWebhookRoutes(registry, undefined, mockRedis, 72);

    // First request
    const res1 = await app.request("/stripe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "sig-123",
      },
      body: JSON.stringify({ id: "evt_123" }),
    });

    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.duplicate).toBeUndefined();

    // Second request with same event ID
    const res2 = await app.request("/stripe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "sig-123",
      },
      body: JSON.stringify({ id: "evt_123" }),
    });

    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.duplicate).toBe(true);
  });

  it("processes events with different IDs normally", async () => {
    const mockRedis = createMockRedis();
    const registry = {
      hasProvider: () => true,
      resolve: () => ({
        verifyWebhook: async () => ({
          success: true,
          event: "charge.succeeded",
        }),
      }),
    } as unknown as ProviderRegistry;

    const app = createWebhookRoutes(registry, undefined, mockRedis, 72);

    const res1 = await app.request("/stripe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "sig-1",
      },
      body: JSON.stringify({ id: "evt_1" }),
    });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/stripe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "sig-2",
      },
      body: JSON.stringify({ id: "evt_2" }),
    });
    expect(res2.status).toBe(200);

    expect(mockRedis.set).toHaveBeenCalledTimes(2);
  });

  it("processes normally when Redis is unavailable", async () => {
    const registry = {
      hasProvider: () => true,
      resolve: () => ({
        verifyWebhook: async () => ({
          success: true,
          event: "charge.succeeded",
        }),
      }),
    } as unknown as ProviderRegistry;

    const app = createWebhookRoutes(registry);

    const res = await app.request("/stripe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "sig-123",
      },
      body: JSON.stringify({ id: "evt_123" }),
    });

    expect(res.status).toBe(200);
  });
});
