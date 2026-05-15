import { MidtransAdapter } from "./midtrans-adapter.js";

describe("MidtransAdapter Contract", () => {
  it("should have correct provider name", () => {
    const adapter = new MidtransAdapter({ serverKey: "test" });
    expect(adapter.name).toBe("midtrans");
  });

  it("should implement IPaymentProvider interface", () => {
    const adapter = new MidtransAdapter({ serverKey: "test" });
    expect(typeof adapter.charge).toBe("function");
    expect(typeof adapter.refund).toBe("function");
    expect(typeof adapter.verify).toBe("function");
    expect(typeof adapter.verifyWebhook).toBe("function");
  });
});
