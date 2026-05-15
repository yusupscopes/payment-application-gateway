import { createApp } from "../../src/app.js";

describe("Integration: Payment Routes", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  describe("POST /v1/payments/charge", () => {
    it("should return 422 for invalid payload", async () => {
      const res = await app.request("/v1/payments/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "invalid-provider",
          amount: -100,
          currency: "US",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should return 400 for missing required fields", async () => {
      const res = await app.request("/v1/payments/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "stripe",
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /v1/payments/refund", () => {
    it("should return 400 for invalid payload", async () => {
      const res = await app.request("/v1/payments/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "stripe",
          amount: "not-a-number",
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /v1/payments/verify", () => {
    it("should return 400 for invalid payload", async () => {
      const res = await app.request("/v1/payments/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "stripe",
        }),
      });

      expect(res.status).toBe(400);
    });
  });
});
