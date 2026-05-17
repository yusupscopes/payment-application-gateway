import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

function unauthorizedResponse(message: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "UNAUTHORIZED",
        message,
      },
    }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

export function createApiKeyAuth(validKeys: Set<string>) {
  return async (c: Context, next: Next) => {
    const apiKey = c.req.header("x-api-key");

    if (!apiKey) {
      throw new HTTPException(401, {
        message: "Missing API key",
        res: unauthorizedResponse("API key is required"),
      });
    }

    if (!validKeys.has(apiKey)) {
      throw new HTTPException(401, {
        message: "Invalid API key",
        res: unauthorizedResponse("Invalid API key"),
      });
    }

    await next();
  };
}

export function parseApiKeys(keysString?: string): Set<string> {
  if (!keysString) {
    return new Set();
  }

  return new Set(
    keysString
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
}
