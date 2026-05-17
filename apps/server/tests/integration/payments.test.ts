import { createApp } from "../../src/app.js";

const TEST_API_KEY = "test-api-key-1";

describe("Integration: Payment Routes", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  describe("API Key Authentication", () => {
    it("should return 401 for missing API key", async () => {
      const res = await app.request("/v1/payments/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "stripe",
          amount: 1000,
          currency: "USD",
          paymentMethod: "pm_card_visa",
        }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toBe("API key is required");
    });

    it("should return 401 for invalid API key", async () => {
      const res = await app.request("/v1/payments/charge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "invalid-key",
        },
        body: JSON.stringify({
          provider: "stripe",
          amount: 1000,
          currency: "USD",
          paymentMethod: "pm_card_visa",
        }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toBe("Invalid API key");
    });
  });

  describe("POST /v1/payments/charge", () => {
    it("should return 400 for invalid provider", async () => {
      const res = await app.request("/v1/payments/charge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
        body: JSON.stringify({
          provider: "invalid-provider",
          amount: -100,
          currency: "US",
          paymentMethod: "pm_card_visa",
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
  });

  describe("POST /v1/payments/refund", () => {
    it("should return 400 for invalid payload", async () => {
      const res = await app.request("/v1/payments/refund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": TEST_API_KEY,
        },
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
  });
});
