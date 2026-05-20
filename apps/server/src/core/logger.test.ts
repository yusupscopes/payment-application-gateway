import { Writable } from "node:stream";
import { describe, expect, it } from "@jest/globals";
import { createLogger, getContextualLogger } from "./logger.js";
import * as requestContext from "./request-context.js";

function parseFirstLog(logs: string[]): Record<string, unknown> {
  return JSON.parse(logs[0] ?? "{}") as Record<string, unknown>;
}

describe("createLogger", () => {
  it("outputs JSON with message key instead of msg", () => {
    const logs: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logs.push(chunk.toString());
        callback();
      },
    });

    const logger = createLogger({ level: "info", stream });
    logger.info("hello world");

    expect(logs.length).toBe(1);
    const parsed = parseFirstLog(logs);
    expect(parsed.message).toBe("hello world");
    expect(parsed.msg).toBeUndefined();
    expect(parsed.level).toBe(30); // pino info level number
    expect(parsed.service).toBe("payment-gateway");
  });

  it("uses the provided log level", () => {
    const logs: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logs.push(chunk.toString());
        callback();
      },
    });

    const logger = createLogger({ level: "warn", stream });
    logger.info("this should not appear");
    logger.warn("this should appear");

    expect(logs.length).toBe(1);
    const parsed = parseFirstLog(logs);
    expect(parsed.message).toBe("this should appear");
  });
});

describe("getContextualLogger", () => {
  it("returns a child logger with correlationId when in context", () => {
    const logs: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logs.push(chunk.toString());
        callback();
      },
    });

    const logger = createLogger({ level: "info", stream });

    // Mock the request context to return a correlationId
    const mockContext = { correlationId: "corr-123" };
    jest
      .spyOn(requestContext, "getRequestContext")
      .mockReturnValue(mockContext);

    const contextual = getContextualLogger(logger);
    contextual.info("test message");

    expect(logs.length).toBe(1);
    const parsed = parseFirstLog(logs);
    expect(parsed.message).toBe("test message");
    expect(parsed.correlationId).toBe("corr-123");
  });

  it("returns the base logger when no context is present", () => {
    const logs: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logs.push(chunk.toString());
        callback();
      },
    });

    const logger = createLogger({ level: "info", stream });

    jest.spyOn(requestContext, "getRequestContext").mockReturnValue(undefined);

    const contextual = getContextualLogger(logger);
    contextual.info("test message");

    expect(logs.length).toBe(1);
    const parsed = parseFirstLog(logs);
    expect(parsed.message).toBe("test message");
    expect(parsed.correlationId).toBeUndefined();
  });
});
