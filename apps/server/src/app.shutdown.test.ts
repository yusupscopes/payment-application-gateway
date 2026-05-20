import { describe, expect, it } from "@jest/globals";
import { createApp } from "./app.js";

describe("createApp shutdown", () => {
  it("returns a shutdown function that sets health to 503", async () => {
    const result = createApp();
    const { app, shutdown } = result;

    // Health should be 200 before shutdown
    const res1 = await app.request("/health");
    expect(res1.status).toBe(200);

    // Call shutdown
    await shutdown();

    // Health should be 503 after shutdown
    const res2 = await app.request("/health");
    expect(res2.status).toBe(503);
    const body = await res2.json();
    expect(body.status).toBe("shutting_down");
  });
});
