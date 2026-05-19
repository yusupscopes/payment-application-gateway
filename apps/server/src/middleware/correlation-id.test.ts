import { Hono } from "hono";
import { correlationId, getCorrelationId } from "./correlation-id.js";

describe("correlationId middleware", () => {
  it("should generate a new correlation ID when header is missing", async () => {
    const app = new Hono();
    app.use(correlationId());
    app.get("/", (c) => {
      return c.json({ id: getCorrelationId(c) });
    });

    const res = await app.request("/");
    const body = await res.json();

    expect(res.headers.get("x-correlation-id")).toBe(body.id);
    expect(body.id).toMatch(/^corr_[a-f0-9]{32}$/);
  });

  it("should reuse existing correlation ID from header", async () => {
    const app = new Hono();
    app.use(correlationId());
    app.get("/", (c) => {
      return c.json({ id: getCorrelationId(c) });
    });

    const existingId = "corr_existing123";
    const res = await app.request("/", {
      headers: { "x-correlation-id": existingId },
    });
    const body = await res.json();

    expect(body.id).toBe(existingId);
    expect(res.headers.get("x-correlation-id")).toBe(existingId);
  });
});
