import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";

export interface RequestLoggerOptions {
  logBodies?: boolean;
}

export function createRequestLogger(
  logger: Logger,
  options: RequestLoggerOptions = {},
): MiddlewareHandler {
  const { logBodies = false } = options;

  return async (c, next) => {
    const path = c.req.path;

    // Skip logging for health and metrics endpoints
    if (path === "/health" || path === "/metrics") {
      await next();
      return;
    }

    const start = Date.now();
    const correlationId =
      (c.get("correlationId") as string | undefined) ??
      c.req.header("x-correlation-id");

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    const apiKey = c.req.header("x-api-key");
    const hashedApiKey = apiKey
      ? `sha256:${createHash("sha256").update(apiKey).digest("hex")}`
      : undefined;

    const logData: Record<string, unknown> = {
      method: c.req.method,
      path,
      statusCode: status,
      durationMs: duration,
    };

    if (correlationId) {
      logData.correlationId = correlationId;
    }

    if (hashedApiKey) {
      logData.apiKey = hashedApiKey;
    }

    if (status >= 500) {
      logger.error(logData, "HTTP request");
    } else if (status >= 400) {
      logger.warn(logData, "HTTP request");
    } else {
      logger.info(logData, "HTTP request");
    }

    // Log payment request bodies at debug level only
    if (
      logBodies &&
      path.startsWith("/v1/payments") &&
      c.req.method !== "GET"
    ) {
      try {
        const body = await c.req.json();
        logger.debug({ body, path }, "Request body");
      } catch {
        // Body already consumed or not JSON — ignore
      }
    }
  };
}
