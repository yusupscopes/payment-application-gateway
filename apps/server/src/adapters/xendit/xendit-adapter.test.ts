import { XenditAdapter } from "./xendit-adapter.js";

const mockCreateInvoice = jest.fn();
const mockCreateRefund = jest.fn();
const mockGetInvoiceById = jest.fn();

jest.mock("xendit-node", () => {
  return {
    Xendit: jest.fn().mockImplementation(() => ({
      Invoice: {
        createInvoice: mockCreateInvoice,
        getInvoiceById: mockGetInvoiceById,
      },
      Refund: {
        createRefund: mockCreateRefund,
      },
    })),
  };
});

describe("XenditAdapter", () => {
  let adapter: XenditAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new XenditAdapter({ secretKey: "test-secret-key" });
  });

  describe("charge", () => {
    it("should create invoice and return success", async () => {
      mockCreateInvoice.mockResolvedValue({
        id: "xendit-inv-123",
        status: "PENDING",
        amount: 100000,
        currency: "IDR",
      });

      const result = await adapter.charge({
        provider: "xendit",
        amount: 100000,
        currency: "IDR",
        paymentMethod: "VIRTUAL_ACCOUNT",
      });

      expect(result.success).toBe(true);
      expect(result.provider).toBe("xendit");
      expect(result.providerRef).toBe("xendit-inv-123");
      expect(result.currency).toBe("IDR");
    });

    it("should return error on failure", async () => {
      mockCreateInvoice.mockRejectedValue(new Error("API Error"));

      const result = await adapter.charge({
        provider: "xendit",
        amount: 100000,
        currency: "IDR",
        paymentMethod: "VIRTUAL_ACCOUNT",
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("UNKNOWN_ERROR");
    });
  });

  describe("refund", () => {
    it("should create refund and return success", async () => {
      mockCreateRefund.mockResolvedValue({
        id: "xendit-refund-123",
        amount: 50000,
        status: "SUCCEEDED",
      });

      const result = await adapter.refund({
        provider: "xendit",
        transactionId: "xendit-inv-123",
        amount: 50000,
      });

      expect(result.success).toBe(true);
      expect(result.providerRef).toBe("xendit-refund-123");
    });
  });

  describe("verify", () => {
    it("should return settled status for paid invoice", async () => {
      mockGetInvoiceById.mockResolvedValue({
        id: "xendit-inv-123",
        status: "PAID",
        amount: 100000,
        currency: "IDR",
      });

      const result = await adapter.verify({
        provider: "xendit",
        transactionId: "xendit-inv-123",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("settled");
    });

    it("should return failed status", async () => {
      mockGetInvoiceById.mockResolvedValue({
        id: "xendit-inv-456",
        status: "FAILED",
      });

      const result = await adapter.verify({
        provider: "xendit",
        transactionId: "xendit-inv-456",
      });

      expect(result.status).toBe("failed");
    });
  });

  describe("verifyWebhook", () => {
    it("should verify valid callback token", async () => {
      const result = await adapter.verifyWebhook({
        provider: "xendit",
        signature: "test-secret-key",
        body: {
          id: "xendit-inv-123",
          external_id: "txn_test",
          event: "invoice.paid",
        },
      });

      expect(result.success).toBe(true);
      expect(result.event).toBe("invoice.paid");
      expect(result.providerRef).toBe("xendit-inv-123");
      expect(result.transactionId).toBe("txn_test");
    });

    it("should reject invalid callback token", async () => {
      const result = await adapter.verifyWebhook({
        provider: "xendit",
        signature: "wrong-token",
        body: {},
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("UNAUTHORIZED");
    });
  });
});
