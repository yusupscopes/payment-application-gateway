import { createApp } from "../../src/app.js";
import { ProviderRegistry } from "../../src/core/provider-registry.js";
import type {
  ChargePayload,
  IPaymentProvider,
  PaymentResult,
  RefundPayload,
  RefundResult,
  VerifyPayload,
  VerifyResult,
} from "../../src/types/payment.js";

const TEST_API_KEY = "test-api-key-1";

class MockPaymentProvider implements IPaymentProvider {
  readonly name = "stripe" as const;
  charge = jest.fn();
  refund = jest.fn();
  verify = jest.fn();
  verifyWebhook = jest.fn();
}

describe("Integration: Payment Routes", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  describe("API Key Authentication", () => {
    it("should return 401 for missing API key", async () => {
      const res = await app.request("/v1/payments/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "stripe",
          amount: 1000,
          currency: "USD",
          paymentMethod: "pm_card_visa",
        }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toBe("API key is required");
    });

    it("should return 401 for invalid API key", async () => {
      const res = await app.request("/v1/payments/charge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "invalid-key",
        },
        body: JSON.stringify({
          provider: "stripe",
          amount: 1000,
          currency: "USD",
          paymentMethod: "pm_card_visa",
        }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toBe("Invalid API key");
    });
  });

  describe("POST /v1/payments/charge", () => {
    it("should return 400 for invalid provider", async () => {
      const res = await app.request("/v1/payments/charge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify({
          provider: "invalid-provider",
          amount: -100,
          currency: "US",
          paymentMethod: "pm_card_visa",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 for missing required fields", async () => {
      const res = await app.request("/v1/payments/charge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify({
          provider: "stripe",
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /v1/payments/refund", () => {
    it("should return 400 for invalid payload", async () => {
      const res = await app.request("/v1/payments/refund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify({
          provider: "stripe",
          amount: "not-a-number",
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /v1/payments/verify", () => {
    it("should return 400 for invalid payload", async () => {
      const res = await app.request("/v1/payments/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify({
          provider: "stripe",
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("End-to-end with mock provider", () => {
    let mockProvider: MockPaymentProvider;
    let mockApp: ReturnType<typeof createApp>;

    beforeEach(() => {
      mockProvider = new MockPaymentProvider();
      const registry = new ProviderRegistry();
      registry.register(mockProvider);
      mockApp = createApp({ registry });
    });

    it("should return 200 on successful charge", async () => {
      const chargeResult: PaymentResult = {
        success: true,
        transactionId: "txn_test",
        amount: 1000,
        currency: "USD",
        provider: "stripe",
        providerRef: "pi_test",
        raw: { id: "pi_test" },
      };
      mockProvider.charge.mockResolvedValue(chargeResult);

      const res = await mockApp.request("/v1/payments/charge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify({
          provider: "stripe",
          amount: 1000,
          currency: "USD",
          paymentMethod: "pm_test",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.providerRef).toBe("pi_test");
      expect(mockProvider.charge).toHaveBeenCalledTimes(1);
    });

    it("should return 502 on failed charge", async () => {
      const errorResult: PaymentResult = {
        success: false,
        transactionId: "txn_test",
        amount: 1000,
        currency: "USD",
        provider: "stripe",
        providerRef: "",
        raw: {},
        error: {
          code: "CARD_DECLINED",
          message: "Card declined",
          retryable: false,
        },
      };
      mockProvider.charge.mockResolvedValue(errorResult);

      const res = await mockApp.request("/v1/payments/charge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify({
          provider: "stripe",
          amount: 1000,
          currency: "USD",
          paymentMethod: "pm_test",
        }),
      });

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("CARD_DECLINED");
    });

    it("should return 200 on successful refund", async () => {
      const refundResult: RefundResult = {
        success: true,
        transactionId: "txn_test",
        refundId: "re_test",
        amount: 500,
        currency: "USD",
        provider: "stripe",
        providerRef: "re_test",
        raw: { id: "re_test" },
      };
      mockProvider.refund.mockResolvedValue(refundResult);

      const res = await mockApp.request("/v1/payments/refund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify({
          provider: "stripe",
          transactionId: "txn_test",
          amount: 500,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.providerRef).toBe("re_test");
    });

    it("should return 200 on successful verify", async () => {
      const verifyResult: VerifyResult = {
        success: true,
        transactionId: "txn_test",
        status: "settled",
        provider: "stripe",
        providerRef: "pi_test",
        raw: { id: "pi_test" },
      };
      mockProvider.verify.mockResolvedValue(verifyResult);

      const res = await mockApp.request("/v1/payments/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify({
          provider: "stripe",
          transactionId: "pi_test",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.status).toBe("settled");
    });

    it("should return 404 for unregistered provider", async () => {
      const res = await mockApp.request("/v1/payments/charge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify({
          provider: "midtrans",
          amount: 1000,
          currency: "USD",
          paymentMethod: "pm_test",
        }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });
});
