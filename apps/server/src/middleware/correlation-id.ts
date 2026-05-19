import { randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler, Next } from "hono";
import { runWithRequestContext } from "../core/request-context.js";

/**
 * Correlation ID middleware: generates or reuses a per-request tracing ID.
 *
 * We use two mechanisms:
 *  1. Hono's context (c.set/c.get) — accessible in route handlers and middleware.
 *  2. Node.js AsyncLocalStorage (via runWithRequestContext) — accessible in
 *     core code, adapters, and background workers without passing the Hono
 *     context through every function signature.
 *
 * getCorrelationId(c) reads from the Hono context.
 * getCorrelationIdFromContext() reads from AsyncLocalStorage.
 */

const CORRELATION_ID_HEADER = "x-correlation-id";

export function correlationId(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const existingId = c.req.header(CORRELATION_ID_HEADER);
    const correlationId =
      existingId ?? `corr_${randomUUID().replace(/-/g, "")}`;

    c.set("correlationId", correlationId);
    c.header(CORRELATION_ID_HEADER, correlationId);

    await runWithRequestContext({ correlationId }, next);
  };
}

export function getCorrelationId(c: Context): string | undefined {
  return c.get("correlationId") as string | undefined;
}
