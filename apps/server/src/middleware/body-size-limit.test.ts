import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import { bodySizeLimit } from "./body-size-limit.js";

describe("bodySizeLimit", () => {
  it("allows requests under the size limit", async () => {
    const app = new Hono();
    app.post("/test", bodySizeLimit("1mb"), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: "small payload" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects requests over the size limit with 413", async () => {
    const app = new Hono();
    app.post("/test", bodySizeLimit("1kb"), (c) => {
      return c.json({ ok: true });
    });

    const largeBody = "x".repeat(2048); // 2KB > 1KB limit
    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": String(largeBody.length),
      },
      body: largeBody,
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(body.error.retryable).toBe(false);
    expect(body.error.message).toContain("1KB");
  });

  it("rejects requests with numeric size limit", async () => {
    const app = new Hono();
    app.post("/test", bodySizeLimit(100), (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request("/test", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": "200",
      },
      body: "x".repeat(200),
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.message).toContain("100 bytes");
  });

  it("throws for invalid size format", () => {
    expect(() => bodySizeLimit("invalid")).toThrow("Invalid size format");
  });
});
