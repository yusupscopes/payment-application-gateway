import { StripeAdapter } from "./stripe-adapter.js";

const mockPaymentIntentsCreate = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();
const mockRefundsCreate = jest.fn();
const mockConstructEvent = jest.fn();

class MockStripeError extends Error {
  type: string;
  code: string | null;

  constructor(raw: { message: string; type: string; code: string | null }) {
    super(raw.message);
    this.type = raw.type;
    this.code = raw.code;
    this.name = "StripeError";
  }
}

jest.mock("stripe", () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: mockPaymentIntentsCreate,
      retrieve: mockPaymentIntentsRetrieve,
    },
    refunds: {
      create: mockRefundsCreate,
    },
    webhooks: {
      constructEvent: mockConstructEvent,
    },
    errors: {
      StripeError: MockStripeError,
    },
  }));
});

describe("StripeAdapter", () => {
  let adapter: StripeAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new StripeAdapter({ secretKey: "sk_test_123" });
  });

  describe("charge", () => {
    it("should create a payment intent and return success result", async () => {
      mockPaymentIntentsCreate.mockResolvedValue({
        id: "pi_test123",
        status: "succeeded",
        amount: 1000,
        currency: "usd",
      });

      const result = await adapter.charge({
        provider: "stripe",
        amount: 1000,
        currency: "USD",
        paymentMethod: "pm_test123",
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe("stripe");
      expect(result.providerRef).toBe("pi_test123");
      expect(result.amount).toBe(1000);
      expect(result.currency).toBe("USD");
      expect(result.transactionId).toMatch(/^txn_/);
      expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1000,
          currency: "usd",
          payment_method: "pm_test123",
          confirm: true,
        }),
      );
    });

    it("should return error result on card declined", async () => {
      mockPaymentIntentsCreate.mockRejectedValue(
        new MockStripeError({
          message: "Your card was declined.",
          type: "card_error",
          code: "card_declined",
        }),
      );

      const result = await adapter.charge({
        provider: "stripe",
        amount: 1000,
        currency: "USD",
        paymentMethod: "pm_test123",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("CARD_DECLINED");
      expect(result.error?.message).toBe("Your card was declined.");
      expect(result.error?.retryable).toBe(false);
    });

    it("should return retryable error on rate limit", async () => {
      mockPaymentIntentsCreate.mockRejectedValue(
        new MockStripeError({
          message: "Rate limit exceeded",
          type: "rate_limit_error",
          code: "rate_limit",
        }),
      );

      const result = await adapter.charge({
        provider: "stripe",
        amount: 1000,
        currency: "USD",
        paymentMethod: "pm_test123",
      });

      expect(result.error?.code).toBe("RATE_LIMITED");
      expect(result.error?.retryable).toBe(true);
    });
  });

  describe("refund", () => {
    it("should create a refund and return success result", async () => {
      mockRefundsCreate.mockResolvedValue({
        id: "re_test123",
        status: "succeeded",
        amount: 500,
        currency: "usd",
      });

      const result = await adapter.refund({
        provider: "stripe",
        transactionId: "pi_test123",
        amount: 500,
      });

      expect(result.success).toBe(true);
      expect(result.providerRef).toBe("re_test123");
      expect(result.amount).toBe(500);
      expect(result.currency).toBe("USD");
    });

    it("should return error result on refund failure", async () => {
      mockRefundsCreate.mockRejectedValue(
        new MockStripeError({
          message: "Refund failed",
          type: "api_error",
          code: "api_error",
        }),
      );

      const result = await adapter.refund({
        provider: "stripe",
        transactionId: "pi_test123",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("GATEWAY_ERROR");
    });
  });

  describe("verify", () => {
    it("should retrieve payment intent and return status", async () => {
      mockPaymentIntentsRetrieve.mockResolvedValue({
        id: "pi_test123",
        status: "succeeded",
      });

      const result = await adapter.verify({
        provider: "stripe",
        transactionId: "pi_test123",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("settled");
      expect(result.providerRef).toBe("pi_test123");
    });

    it("should return error on retrieve failure", async () => {
      mockPaymentIntentsRetrieve.mockRejectedValue(
        new MockStripeError({
          message: "Not found",
          type: "invalid_request_error",
          code: "resource_missing",
        }),
      );

      const result = await adapter.verify({
        provider: "stripe",
        transactionId: "pi_invalid",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
    });
  });

  describe("verifyWebhook", () => {
    it("should verify valid webhook signature", async () => {
      mockConstructEvent.mockReturnValue({
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: "pi_test123",
            metadata: { transactionId: "txn_test123" },
          },
        },
      });

      const result = await adapter.verifyWebhook({
        provider: "stripe",
        signature: "sig_test123",
        body: { id: "evt_test123" },
      });

      expect(result.success).toBe(true);
      expect(result.event).toBe("payment_intent.succeeded");
      expect(result.providerRef).toBe("pi_test123");
      expect(result.transactionId).toBe("txn_test123");
    });

    it("should return error on invalid signature", async () => {
      mockConstructEvent.mockReset();
      mockConstructEvent.mockImplementation(() => {
        throw new Error("Invalid signature");
      });

      const result = await adapter.verifyWebhook({
        provider: "stripe",
        signature: "invalid_sig",
        body: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("INVALID_REQUEST");
    });
  });
});
