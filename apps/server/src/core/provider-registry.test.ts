import type {
  ChargePayload,
  IPaymentProvider,
  PaymentResult,
  RefundPayload,
  RefundResult,
  VerifyPayload,
  VerifyResult,
} from "../types/payment.js";
import {
  ProviderNotFoundError,
  ProviderRegistry,
} from "./provider-registry.js";

class MockAdapter implements IPaymentProvider {
  readonly name = "stripe" as const;

  async charge(
    _payload: ChargePayload,
    _transactionId: string,
  ): Promise<PaymentResult> {
    return {
      success: true,
      transactionId: _transactionId,
      amount: 100,
      currency: "USD",
      provider: "stripe",
      providerRef: "pi_test",
      raw: {},
    };
  }

  async refund(
    _payload: RefundPayload,
    _transactionId: string,
  ): Promise<RefundResult> {
    return {
      success: true,
      transactionId: _transactionId,
      refundId: "re_test",
      amount: 100,
      currency: "USD",
      provider: "stripe",
      providerRef: "re_test",
      raw: {},
    };
  }

  async verify(
    _payload: VerifyPayload,
    _transactionId: string,
  ): Promise<VerifyResult> {
    return {
      success: true,
      transactionId: _transactionId,
      status: "captured",
      provider: "stripe",
      providerRef: "pi_test",
      raw: {},
    };
  }
}

describe("ProviderRegistry", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  describe("register", () => {
    it("should register a provider", () => {
      const adapter = new MockAdapter();
      registry.register(adapter);

      expect(registry.getRegisteredProviders()).toContain("stripe");
    });

    it("should allow registering multiple providers", () => {
      const stripeAdapter = new MockAdapter();
      const midtransAdapter = {
        ...new MockAdapter(),
        name: "midtrans" as const,
      };

      registry.register(stripeAdapter);
      registry.register(midtransAdapter);

      expect(registry.getRegisteredProviders()).toHaveLength(2);
      expect(registry.getRegisteredProviders()).toContain("stripe");
      expect(registry.getRegisteredProviders()).toContain("midtrans");
    });
  });

  describe("resolve", () => {
    it("should resolve a registered provider", () => {
      const adapter = new MockAdapter();
      registry.register(adapter);

      const resolved = registry.resolve("stripe");

      expect(resolved).toBe(adapter);
    });

    it("should throw ProviderNotFoundError for unregistered provider", () => {
      expect(() => registry.resolve("stripe")).toThrow(ProviderNotFoundError);
      expect(() => registry.resolve("stripe")).toThrow(
        'Payment provider "stripe" is not registered',
      );
    });

    it("should throw ProviderNotFoundError with correct provider name", () => {
      try {
        registry.resolve("midtrans");
        fail("Expected ProviderNotFoundError");
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderNotFoundError);
        expect((error as ProviderNotFoundError).providerName).toBe("midtrans");
      }
    });
  });

  describe("hasProvider", () => {
    it("should return true for registered provider", () => {
      registry.register(new MockAdapter());

      expect(registry.hasProvider("stripe")).toBe(true);
    });

    it("should return false for unregistered provider", () => {
      expect(registry.hasProvider("stripe")).toBe(false);
    });

    it("should return false for unknown provider name", () => {
      expect(registry.hasProvider("unknown")).toBe(false);
    });

    it("should return false for non-string provider name", () => {
      expect(registry.hasProvider("")).toBe(false);
    });
  });

  describe("getRegisteredProviders", () => {
    it("should return empty array when no providers registered", () => {
      expect(registry.getRegisteredProviders()).toEqual([]);
    });

    it("should return all registered provider names", () => {
      registry.register(new MockAdapter());
      registry.register({ ...new MockAdapter(), name: "midtrans" as const });
      registry.register({ ...new MockAdapter(), name: "xendit" as const });

      const providers = registry.getRegisteredProviders();

      expect(providers).toHaveLength(3);
      expect(providers).toContain("stripe");
      expect(providers).toContain("midtrans");
      expect(providers).toContain("xendit");
    });
  });
});
