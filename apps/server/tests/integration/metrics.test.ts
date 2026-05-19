import { recordOperation } from "../../src/core/metrics.js";
import { createMetricsRoutes } from "../../src/routes/metrics.js";

describe("Metrics Routes", () => {
  it("should return Prometheus metrics", async () => {
    recordOperation("stripe", "charge", "success", 100);

    const app = createMetricsRoutes();
    const res = await app.request("/");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(body).toContain("payment_gateway_operations_total");
    expect(body).toContain('provider="stripe"');
  });
});
