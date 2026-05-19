import {
  recordError,
  recordOperation,
  recordRetry,
  registry,
} from "./metrics.js";

describe("metrics", () => {
  it("should record successful operation", async () => {
    recordOperation("stripe", "charge", "success", 150);

    const metrics = await registry.metrics();
    expect(metrics).toContain("payment_gateway_operations_total");
    expect(metrics).toContain('provider="stripe"');
    expect(metrics).toContain('operation="charge"');
    expect(metrics).toContain('status="success"');
  });

  it("should record failed operation", async () => {
    recordOperation("stripe", "refund", "failure", 200);

    const metrics = await registry.metrics();
    expect(metrics).toContain("payment_gateway_operations_total");
    expect(metrics).toContain('status="failure"');
  });

  it("should record error with code", async () => {
    recordError("midtrans", "charge", "RATE_LIMITED");

    const metrics = await registry.metrics();
    expect(metrics).toContain("payment_gateway_errors_total");
    expect(metrics).toContain('error_code="RATE_LIMITED"');
  });

  it("should record retry", async () => {
    recordRetry("xendit", "verify");

    const metrics = await registry.metrics();
    expect(metrics).toContain("payment_gateway_retries_total");
    expect(metrics).toContain('provider="xendit"');
    expect(metrics).toContain('operation="verify"');
  });

  it("should expose metrics via registry", async () => {
    recordOperation("stripe", "charge", "success", 100);
    recordError("stripe", "charge", "CARD_DECLINED");

    const metrics = await registry.metrics();
    expect(metrics).toContain("payment_gateway_operations_total");
    expect(metrics).toContain("payment_gateway_errors_total");
    expect(metrics).toContain('error_code="CARD_DECLINED"');
  });
});
