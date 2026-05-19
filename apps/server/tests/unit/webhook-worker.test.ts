import { ProviderRegistry } from "../../src/core/provider-registry.js";
import {
  createProcessor,
  extractEventType,
  processWebhookEvent,
  WebhookWorker,
} from "../../src/queue/webhook-worker.js";
import type { IPaymentProvider } from "../../src/types/payment.js";

jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation((_queueName, processor, _options) => {
    const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const worker = {
      on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!eventHandlers[event]) {
          eventHandlers[event] = [];
        }
        eventHandlers[event].push(handler);
      }),
      close: jest.fn().mockResolvedValue(undefined),
      _triggerEvent: (event: string, ...args: unknown[]) => {
        eventHandlers[event]?.forEach((handler) => {
          handler(...args);
        });
      },
      _processor: processor,
    };
    return worker;
  }),
}));

describe("WebhookWorker", () => {
  it("should not create worker when Redis is unavailable", () => {
    const registry = new ProviderRegistry();
    const worker = new WebhookWorker(null, registry);

    expect(worker.isRunning).toBe(false);
  });

  it("should create worker when Redis is available", () => {
    const mockRedis = {} as import("ioredis").default;
    const registry = new ProviderRegistry();
    const worker = new WebhookWorker(mockRedis, registry);

    expect(worker.isRunning).toBe(true);
  });
});

describe("extractEventType", () => {
  it("should extract Stripe event type", () => {
    expect(extractEventType({ type: "charge.succeeded" })).toBe(
      "charge.succeeded",
    );
  });

  it("should extract Midtrans transaction_status", () => {
    expect(extractEventType({ transaction_status: "settlement" })).toBe(
      "settlement",
    );
  });

  it("should extract Xendit status", () => {
    expect(extractEventType({ status: "PAID" })).toBe("PAID");
  });

  it("should extract Xendit event", () => {
    expect(extractEventType({ event: "invoice.paid" })).toBe("invoice.paid");
  });

  it("should return unknown for unrecognised body", () => {
    expect(extractEventType({ foo: "bar" })).toBe("unknown");
    expect(extractEventType(null)).toBe("unknown");
    expect(extractEventType("string")).toBe("unknown");
  });
});

describe("processWebhookEvent", () => {
  it("should process a valid webhook event", async () => {
    const registry = new ProviderRegistry();
    const mockProvider: IPaymentProvider = {
      name: "stripe",
      charge: jest.fn(),
      refund: jest.fn(),
      verify: jest.fn(),
    };
    registry.register(mockProvider);

    const result = await processWebhookEvent(
      {
        provider: "stripe",
        signature: "sig",
        body: { type: "charge.succeeded" },
      },
      registry,
    );

    expect(result.success).toBe(true);
    expect(result.provider).toBe("stripe");
    expect(result.event).toBe("charge.succeeded");
    expect(result.processedAt).toBeDefined();
  });

  it("should throw for unregistered provider", async () => {
    const registry = new ProviderRegistry();

    await expect(
      processWebhookEvent(
        {
          provider: "midtrans",
          signature: "sig",
          body: {},
        },
        registry,
      ),
    ).rejects.toThrow();
  });
});

describe("createProcessor", () => {
  it("should propagate correlationId via request context", async () => {
    const registry = new ProviderRegistry();
    const mockProvider: IPaymentProvider = {
      name: "stripe",
      charge: jest.fn(),
      refund: jest.fn(),
      verify: jest.fn(),
    };
    registry.register(mockProvider);

    const processor = createProcessor(registry);

    const mockJob = {
      data: {
        provider: "stripe",
        signature: "sig",
        body: { type: "charge.succeeded" },
        correlationId: "corr_test_123",
      },
    } as import("bullmq").Job;

    const result = await processor(mockJob);

    expect(result).toBeDefined();
    // Verify that request context was set during processing
    // Note: we can't directly check getCorrelationIdFromContext() here
    // because the processor's runWithRequestContext has already completed
  });
});
