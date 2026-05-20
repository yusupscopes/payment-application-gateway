import type { MiddlewareHandler } from "hono";

function parseSize(size: number | string): number {
  if (typeof size === "number") {
    return size;
  }
  const normalized = size.toLowerCase().trim();
  const units: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!match) {
    throw new Error(`Invalid size format: ${size}`);
  }
  const valueStr = match[1];
  if (!valueStr) {
    throw new Error(`Invalid size format: ${size}`);
  }
  const value = Number.parseFloat(valueStr);
  const unit = match[2] ?? "b";
  const multiplier = units[unit];
  if (!multiplier) {
    throw new Error(`Invalid size unit: ${unit}`);
  }
  return value * multiplier;
}

export function bodySizeLimit(maxSize: number | string): MiddlewareHandler {
  const maxBytes = parseSize(maxSize);
  return async (c, next) => {
    const contentLength = c.req.header("content-length");
    if (contentLength) {
      const length = Number.parseInt(contentLength, 10);
      if (!Number.isNaN(length) && length > maxBytes) {
        const sizeStr =
          typeof maxSize === "number"
            ? `${maxSize} bytes`
            : String(maxSize).toUpperCase();
        return c.json(
          {
            error: {
              code: "PAYLOAD_TOO_LARGE",
              message: `Request body exceeds maximum size of ${sizeStr}`,
              retryable: false,
            },
          },
          413,
        );
      }
    }
    await next();
  };
}
