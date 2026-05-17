import { StripeAdapter } from "./stripe-adapter.js";

describe("StripeAdapter Contract", () => {
  it("should have correct provider name", () => {
    const adapter = new StripeAdapter({ secretKey: "test" });
    expect(adapter.name).toBe("stripe");
  });

  it("should accept webhook secret in constructor", () => {
    const adapter = new StripeAdapter({
      secretKey: "test",
      webhookSecret: "whsec_test",
    });
    expect(adapter.name).toBe("stripe");
  });

  it("should implement IPaymentProvider interface", () => {
    const adapter = new StripeAdapter({ secretKey: "test" });
    expect(typeof adapter.charge).toBe("function");
    expect(typeof adapter.refund).toBe("function");
    expect(typeof adapter.verify).toBe("function");
    expect(typeof adapter.verifyWebhook).toBe("function");
  });
});
