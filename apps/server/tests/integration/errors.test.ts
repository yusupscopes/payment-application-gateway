import { createApp } from "../../src/app.js";

const TEST_API_KEY = "test-api-key-1";

describe("Integration: Error Handling", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  it("should return 400 for validation errors", async () => {
    const res = await app.request("/v1/payments/charge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": TEST_API_KEY,
      },
      body: JSON.stringify({
        provider: "stripe",
        amount: "not-a-number",
        currency: "USD",
        paymentMethod: "pm_test",
      }),
    });

    expect(res.status).toBe(400);
  });

  it("should return 400 for missing required fields", async () => {
    const res = await app.request("/v1/payments/charge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": TEST_API_KEY,
      },
      body: JSON.stringify({
        provider: "stripe",
      }),
    });

    expect(res.status).toBe(400);
  });

  it("should return 400 for unknown webhook provider", async () => {
    const res = await app.request("/v1/webhooks/unknown-provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("should return 200 for health check", async () => {
    const res = await app.request("/", {
      method: "GET",
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("OK");
  });
});
