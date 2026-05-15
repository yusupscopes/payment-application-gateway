import { XenditAdapter } from "./xendit-adapter.js";

describe("XenditAdapter Contract", () => {
  it("should have correct provider name", () => {
    const adapter = new XenditAdapter({ secretKey: "test" });
    expect(adapter.name).toBe("xendit");
  });

  it("should implement IPaymentProvider interface", () => {
    const adapter = new XenditAdapter({ secretKey: "test" });
    expect(typeof adapter.charge).toBe("function");
    expect(typeof adapter.refund).toBe("function");
    expect(typeof adapter.verify).toBe("function");
    expect(typeof adapter.verifyWebhook).toBe("function");
  });
});
