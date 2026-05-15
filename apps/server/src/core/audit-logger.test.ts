import { transactions } from "@payment-application-gateway/db";
import type { NormalizedError } from "../types/payment.js";
import { AuditLogger } from "./audit-logger.js";

// Mock the transactions table to avoid Drizzle schema resolution issues in tests
jest.mock("@payment-application-gateway/db", () => ({
  transactions: {
    id: "id",
    provider: "provider",
    providerRef: "provider_ref",
    operation: "operation",
    amount: "amount",
    currency: "currency",
    status: "status",
    rawResponse: "raw_response",
    errorCode: "error_code",
    errorMessage: "error_message",
    retryable: "retryable",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
}));

describe("AuditLogger", () => {
  let auditLogger: AuditLogger;
  let mockDb: { insert: jest.Mock };

  beforeEach(() => {
    mockDb = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      }),
    };
    auditLogger = new AuditLogger(
      mockDb as unknown as Parameters<
        typeof AuditLogger.prototype.constructor
      >[0],
    );
  });

  describe("log", () => {
    it("should log a successful transaction with generated transactionId", async () => {
      const payload = {
        provider: "stripe" as const,
        providerRef: "pi_test123",
        operation: "charge" as const,
        amount: 1000,
        currency: "USD",
        status: "captured" as const,
        rawResponse: { id: "pi_test123" },
      };

      const transactionId = await auditLogger.log(payload);

      expect(transactionId).toMatch(/^txn_[a-f0-9]{32}$/);
      expect(mockDb.insert).toHaveBeenCalledWith(transactions);
      expect(mockDb.insert().values).toHaveBeenCalledWith(
        expect.objectContaining({
          id: transactionId,
          provider: "stripe",
          providerRef: "pi_test123",
          operation: "charge",
          amount: 1000,
          currency: "USD",
          status: "captured",
          rawResponse: { id: "pi_test123" },
          errorCode: null,
          errorMessage: null,
          retryable: null,
        }),
      );
    });

    it("should use provided transactionId when given", async () => {
      const payload = {
        transactionId: "txn_custom123",
        provider: "midtrans" as const,
        providerRef: "midtrans-ref-456",
        operation: "refund" as const,
        amount: 500,
        currency: "IDR",
        status: "refunded" as const,
        rawResponse: { status_code: "200" },
      };

      const transactionId = await auditLogger.log(payload);

      expect(transactionId).toBe("txn_custom123");
      expect(mockDb.insert().values).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "txn_custom123",
        }),
      );
    });

    it("should log error details when error is provided", async () => {
      const error: NormalizedError = {
        code: "CARD_DECLINED",
        message: "The card was declined",
        retryable: false,
      };

      const payload = {
        provider: "stripe" as const,
        providerRef: "pi_error789",
        operation: "charge" as const,
        amount: 2000,
        currency: "USD",
        status: "failed" as const,
        rawResponse: { error: "card_declined" },
        error,
      };

      await auditLogger.log(payload);

      expect(mockDb.insert().values).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "CARD_DECLINED",
          errorMessage: "The card was declined",
          retryable: false,
        }),
      );
    });

    it("should handle retryable errors", async () => {
      const error: NormalizedError = {
        code: "RATE_LIMITED",
        message: "Too many requests",
        retryable: true,
      };

      const payload = {
        provider: "xendit" as const,
        providerRef: "xendit-ref-999",
        operation: "verify" as const,
        amount: 0,
        currency: "IDR",
        status: "failed" as const,
        rawResponse: { error: "rate_limited" },
        error,
      };

      await auditLogger.log(payload);

      expect(mockDb.insert().values).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "RATE_LIMITED",
          errorMessage: "Too many requests",
          retryable: true,
        }),
      );
    });

    it("should handle all supported operations", async () => {
      const operations: Array<"charge" | "refund" | "verify"> = [
        "charge",
        "refund",
        "verify",
      ];

      for (const operation of operations) {
        mockDb = {
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockResolvedValue(undefined),
          }),
        };
        auditLogger = new AuditLogger(
          mockDb as unknown as Parameters<
            typeof AuditLogger.prototype.constructor
          >[0],
        );

        await auditLogger.log({
          provider: "stripe",
          providerRef: "ref",
          operation,
          amount: 100,
          currency: "USD",
          status: "pending",
          rawResponse: {},
        });

        expect(mockDb.insert().values).toHaveBeenCalledWith(
          expect.objectContaining({
            operation,
          }),
        );
      }
    });
  });
});
