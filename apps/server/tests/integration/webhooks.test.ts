import { createApp } from "../../src/app.js";

describe("Integration: Webhook Routes", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  it("should return 400 for unknown provider", async () => {
    const res = await app.request("/v1/webhooks/unknown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("should return 401 for invalid Xendit webhook", async () => {
    const res = await app.request("/v1/webhooks/xendit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-callback-token": "wrong-token",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});
