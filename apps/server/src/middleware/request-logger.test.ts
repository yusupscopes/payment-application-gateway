import { createHash } from "node:crypto";
import { describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import type { Logger } from "pino";
import { createRequestLogger } from "./request-logger.js";

function createMockLogger(): { logger: Logger; logs: unknown[] } {
  const logs: unknown[] = [];
  const mockLogger = {
    info: jest.fn((obj: unknown, msg?: string) => {
      logs.push({ level: "info", obj, msg });
    }),
    debug: jest.fn((obj: unknown, msg?: string) => {
      logs.push({ level: "debug", obj, msg });
    }),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => mockLogger as unknown as Logger),
  } as unknown as Logger;
  return { logger: mockLogger, logs };
}

describe("createRequestLogger", () => {
  it("logs request with method, path, status, duration, correlationId", async () => {
    const { logger, logs } = createMockLogger();
    const app = new Hono();
    app.use(createRequestLogger(logger));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test", {
      headers: { "x-correlation-id": "abc-123" },
    });
    expect(res.status).toBe(200);

    expect(logs.length).toBe(1);
    const logEntry = logs[0] as { obj: Record<string, unknown> };
    expect(logEntry.obj.method).toBe("GET");
    expect(logEntry.obj.path).toBe("/test");
    expect(logEntry.obj.statusCode).toBe(200);
    expect(typeof logEntry.obj.durationMs).toBe("number");
    expect(logEntry.obj.correlationId).toBe("abc-123");
  });

  it("hashes the API key in logs", async () => {
    const { logger, logs } = createMockLogger();
    const app = new Hono();
    app.use(createRequestLogger(logger));
    app.post("/test", (c) => c.json({ ok: true }));

    const apiKey = "secret-api-key-123";
    await app.request("/test", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(logs.length).toBe(1);
    const logEntry = logs[0] as { obj: Record<string, unknown> };
    const expectedHash = createHash("sha256").update(apiKey).digest("hex");
    expect(logEntry.obj.apiKey).toBe(`sha256:${expectedHash}`);
  });

  it("skips logging for /health", async () => {
    const { logger, logs } = createMockLogger();
    const app = new Hono();
    app.use(createRequestLogger(logger));
    app.get("/health", (c) => c.json({ status: "ok" }));

    await app.request("/health");

    expect(logs.length).toBe(0);
  });

  it("skips logging for /metrics", async () => {
    const { logger, logs } = createMockLogger();
    const app = new Hono();
    app.use(createRequestLogger(logger));
    app.get("/metrics", (c) => c.text("# metrics"));

    await app.request("/metrics");

    expect(logs.length).toBe(0);
  });

  it("logs payment request bodies at debug level when configured", async () => {
    const { logger, logs } = createMockLogger();
    const app = new Hono();
    app.use(createRequestLogger(logger, { logBodies: true }));
    app.post("/v1/payments/charge", (c) => c.json({ ok: true }));

    const body = JSON.stringify({ provider: "stripe", amount: 1000 });
    await app.request("/v1/payments/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    // Main request log should NOT contain body
    const infoEntry = logs.find(
      (l: unknown) => (l as { level: string }).level === "info",
    );
    expect(infoEntry).toBeDefined();
    const infoLog = infoEntry as { obj: Record<string, unknown> };
    expect(infoLog.obj.body).toBeUndefined();

    // Debug log should contain body
    const debugEntry = logs.find(
      (l: unknown) => (l as { level: string }).level === "debug",
    );
    expect(debugEntry).toBeDefined();
    const debugLog = debugEntry as { obj: Record<string, unknown> };
    expect(debugLog.obj.body).toEqual({ provider: "stripe", amount: 1000 });
  });

  it("does not log payment bodies when logBodies is false", async () => {
    const { logger, logs } = createMockLogger();
    const app = new Hono();
    app.use(createRequestLogger(logger, { logBodies: false }));
    app.post("/v1/payments/charge", (c) => c.json({ ok: true }));

    await app.request("/v1/payments/charge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "stripe" }),
    });

    const debugEntry = logs.find(
      (l: unknown) => (l as { level: string }).level === "debug",
    );
    expect(debugEntry).toBeUndefined();
  });
});
