import type {
  IPaymentProvider,
  PaymentResult,
  RefundResult,
  VerifyResult,
} from "../types/payment.js";
import { AuditLogger } from "./audit-logger.js";
import { PaymentGateway } from "./payment-gateway.js";
import { ProviderRegistry } from "./provider-registry.js";
import { RetryManager } from "./retry-manager.js";

const mockLog = jest.fn();

jest.mock("./audit-logger.js", () => {
  return {
    AuditLogger: jest.fn().mockImplementation(() => ({
      log: mockLog,
    })),
  };
});

class MockProvider implements IPaymentProvider {
  readonly name = "stripe" as const;
  charge = jest.fn();
  refund = jest.fn();
  verify = jest.fn();
  verifyWebhook = jest.fn();
}

describe("PaymentGateway", () => {
  let gateway: PaymentGateway;
  let registry: ProviderRegistry;
  let retryManager: RetryManager;
  let auditLogger: AuditLogger;
  let mockProvider: MockProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    mockProvider = new MockProvider();
    registry = new ProviderRegistry();
    registry.register(mockProvider);
    retryManager = new RetryManager({ maxAttempts: 2, baseDelayMs: 10 });
    auditLogger = new AuditLogger(
      {} as unknown as Parameters<typeof AuditLogger.prototype.constructor>[0],
    );
    gateway = new PaymentGateway(registry, retryManager, auditLogger);
  });

  describe("charge", () => {
    it("should charge via provider and log to audit", async () => {
      const chargeResult: PaymentResult = {
        success: true,
        transactionId: "",
        amount: 1000,
        currency: "USD",
        provider: "stripe",
        providerRef: "pi_test",
        raw: { id: "pi_test" },
      };
      mockProvider.charge.mockResolvedValue(chargeResult);

      const result = await gateway.charge({
        provider: "stripe",
        amount: 1000,
        currency: "USD",
        paymentMethod: "pm_test",
      });

      expect(result.success).toBe(true);
      expect(result.providerRef).toBe("pi_test");
      expect(result.transactionId).toMatch(/^txn_/);
      expect(mockProvider.charge).toHaveBeenCalledTimes(1);
      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(mockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "stripe",
          operation: "charge",
          amount: 1000,
          currency: "USD",
          status: "captured",
        }),
      );
    });

    it("should retry on retryable error then succeed", async () => {
      const errorResult: PaymentResult = {
        success: false,
        transactionId: "",
        amount: 1000,
        currency: "USD",
        provider: "stripe",
        providerRef: "",
        raw: {},
        error: {
          code: "RATE_LIMITED",
          message: "Rate limited",
          retryable: true,
        },
      };
      const successResult: PaymentResult = {
        success: true,
        transactionId: "",
        amount: 1000,
        currency: "USD",
        provider: "stripe",
        providerRef: "pi_test",
        raw: { id: "pi_test" },
      };

      mockProvider.charge
        .mockResolvedValueOnce(errorResult)
        .mockResolvedValueOnce(successResult);

      const result = await gateway.charge({
        provider: "stripe",
        amount: 1000,
        currency: "USD",
        paymentMethod: "pm_test",
      });

      expect(result.success).toBe(true);
      expect(mockProvider.charge).toHaveBeenCalledTimes(2);
    });

    it("should not retry on non-retryable error", async () => {
      const errorResult: PaymentResult = {
        success: false,
        transactionId: "",
        amount: 1000,
        currency: "USD",
        provider: "stripe",
        providerRef: "",
        raw: {},
        error: { code: "CARD_DECLINED", message: "Declined", retryable: false },
      };

      mockProvider.charge.mockResolvedValue(errorResult);

      const result = await gateway.charge({
        provider: "stripe",
        amount: 1000,
        currency: "USD",
        paymentMethod: "pm_test",
      });

      expect(result.success).toBe(false);
      expect(mockProvider.charge).toHaveBeenCalledTimes(1);
    });
  });

  describe("refund", () => {
    it("should refund via provider and log to audit", async () => {
      const refundResult: RefundResult = {
        success: true,
        transactionId: "",
        refundId: "re_test",
        amount: 500,
        currency: "USD",
        provider: "stripe",
        providerRef: "re_test",
        raw: { id: "re_test" },
      };
      mockProvider.refund.mockResolvedValue(refundResult);

      const result = await gateway.refund({
        provider: "stripe",
        transactionId: "pi_test",
        amount: 500,
      });

      expect(result.success).toBe(true);
      expect(mockProvider.refund).toHaveBeenCalledTimes(1);
      expect(mockLog).toHaveBeenCalledTimes(1);
    });
  });

  describe("verify", () => {
    it("should verify via provider and log to audit", async () => {
      const verifyResult: VerifyResult = {
        success: true,
        transactionId: "",
        status: "settled",
        provider: "stripe",
        providerRef: "pi_test",
        raw: { id: "pi_test" },
      };
      mockProvider.verify.mockResolvedValue(verifyResult);

      const result = await gateway.verify({
        provider: "stripe",
        transactionId: "pi_test",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("settled");
      expect(mockProvider.verify).toHaveBeenCalledTimes(1);
      expect(mockLog).toHaveBeenCalledTimes(1);
    });
  });
});
