import { MidtransAdapter } from "./midtrans-adapter.js";

const mockCharge = jest.fn();
const mockRefund = jest.fn();
const mockTransactionStatus = jest.fn();

jest.mock("midtrans-client", () => {
  return {
    CoreApi: jest.fn().mockImplementation(() => ({
      charge: mockCharge,
      refund: mockRefund,
      transaction: {
        status: mockTransactionStatus,
      },
    })),
    MidtransError: class MidtransError extends Error {
      httpStatusCode: number;
      constructor(message: string, httpStatusCode: number) {
        super(message);
        this.httpStatusCode = httpStatusCode;
        this.name = "MidtransError";
      }
    },
  };
});

describe("MidtransAdapter", () => {
  let adapter: MidtransAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new MidtransAdapter({ serverKey: "test-server-key" });
  });

  describe("charge", () => {
    it("should return success for status_code 200", async () => {
      mockCharge.mockResolvedValue({
        status_code: "200",
        transaction_id: "midtrans-123",
        status_message: "Success",
      });

      const result = await adapter.charge({
        provider: "midtrans",
        amount: 100000,
        currency: "IDR",
        paymentMethod: "bank_transfer",
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe("midtrans");
      expect(result.providerRef).toBe("midtrans-123");
    });

    it("should return error for status_code 406", async () => {
      mockCharge.mockResolvedValue({
        status_code: "406",
        transaction_id: "midtrans-456",
        status_message: "Transaction declined",
      });

      const result = await adapter.charge({
        provider: "midtrans",
        amount: 100000,
        currency: "IDR",
        paymentMethod: "bank_transfer",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("CARD_DECLINED");
      expect(result.error?.retryable).toBe(false);
    });

    it("should return retryable error for status_code 408", async () => {
      mockCharge.mockResolvedValue({
        status_code: "408",
        transaction_id: "midtrans-789",
        status_message: "Request timeout",
      });

      const result = await adapter.charge({
        provider: "midtrans",
        amount: 100000,
        currency: "IDR",
        paymentMethod: "bank_transfer",
      });

      expect(result.error?.code).toBe("RATE_LIMITED");
      expect(result.error?.retryable).toBe(true);
    });

    it("should handle MidtransError", async () => {
      const MidtransError = jest.requireMock("midtrans-client").MidtransError;
      mockCharge.mockRejectedValue(new MidtransError("Connection failed", 503));

      const result = await adapter.charge({
        provider: "midtrans",
        amount: 100000,
        currency: "IDR",
        paymentMethod: "bank_transfer",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("RATE_LIMITED");
      expect(result.error?.retryable).toBe(true);
    });
  });

  describe("refund", () => {
    it("should return success for status_code 200", async () => {
      mockRefund.mockResolvedValue({
        status_code: "200",
        transaction_id: "midtrans-refund-123",
        status_message: "Refund success",
      });

      const result = await adapter.refund({
        provider: "midtrans",
        transactionId: "txn_original",
        amount: 50000,
      });

      expect(result.success).toBe(true);
      expect(result.providerRef).toBe("midtrans-refund-123");
    });
  });

  describe("verify", () => {
    it("should return settled status", async () => {
      mockTransactionStatus.mockResolvedValue({
        status_code: "200",
        transaction_id: "midtrans-123",
        transaction_status: "settlement",
        status_message: "Success",
      });

      const result = await adapter.verify({
        provider: "midtrans",
        transactionId: "midtrans-123",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("settled");
    });

    it("should return failed status", async () => {
      mockTransactionStatus.mockResolvedValue({
        status_code: "200",
        transaction_id: "midtrans-456",
        transaction_status: "deny",
        status_message: "Success",
      });

      const result = await adapter.verify({
        provider: "midtrans",
        transactionId: "midtrans-456",
      });

      expect(result.status).toBe("failed");
    });
  });
});
