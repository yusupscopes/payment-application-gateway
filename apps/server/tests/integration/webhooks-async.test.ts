import { ProviderRegistry } from "../../src/core/provider-registry.js";
import type { WebhookQueue } from "../../src/queue/webhook-queue.js";
import { createWebhookRoutes } from "../../src/routes/webhooks.js";
import type {
  IPaymentProvider,
  WebhookResult,
} from "../../src/types/payment.js";

describe("Webhook Routes - Async Queue", () => {
  it("should enqueue webhook when queue is available", async () => {
    const registry = new ProviderRegistry();
    const mockProvider: IPaymentProvider = {
      name: "stripe",
      charge: jest.fn(),
      refund: jest.fn(),
      verify: jest.fn(),
      verifyWebhook: jest.fn().mockResolvedValue({
        success: true,
        event: "charge.succeeded",
        transactionId: "txn_test",
        providerRef: "pi_test",
        raw: {},
      } as WebhookResult),
    };
    registry.register(mockProvider);

    const mockQueue: WebhookQueue = {
      isAvailable: true,
      add: jest.fn().mockResolvedValue("job-123"),
      close: jest.fn(),
    } as unknown as WebhookQueue;

    const app = createWebhookRoutes(registry, mockQueue);

    const res = await app.request("/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: JSON.stringify({ id: "evt_test" }),
    });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.queued).toBe(true);
    expect(body.jobId).toBe("job-123");
    expect(mockQueue.add).toHaveBeenCalled();
  });

  it("should process webhook synchronously when queue is unavailable", async () => {
    const registry = new ProviderRegistry();
    const mockProvider: IPaymentProvider = {
      name: "stripe",
      charge: jest.fn(),
      refund: jest.fn(),
      verify: jest.fn(),
      verifyWebhook: jest.fn().mockResolvedValue({
        success: true,
        event: "charge.succeeded",
        transactionId: "txn_test",
        providerRef: "pi_test",
        raw: {},
      } as WebhookResult),
    };
    registry.register(mockProvider);

    const app = createWebhookRoutes(registry);

    const res = await app.request("/stripe", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: JSON.stringify({ id: "evt_test" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.queued).toBeUndefined();
    expect(body.success).toBe(true);
  });
});
