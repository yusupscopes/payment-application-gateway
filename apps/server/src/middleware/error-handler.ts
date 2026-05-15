import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { ProviderNotFoundError } from "../core/provider-registry.js";

export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (error) {
    if (error instanceof HTTPException) {
      return c.json(
        {
          error: {
            code: "HTTP_ERROR",
            message: error.message,
          },
        },
        error.status,
      );
    }

    if (error instanceof ZodError) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request data",
            details: error.flatten(),
          },
        },
        422,
      );
    }

    if (error instanceof ProviderNotFoundError) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: error.message,
          },
        },
        404,
      );
    }

    if (error instanceof Error) {
      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message:
              c.env.NODE_ENV === "production"
                ? "Internal server error"
                : error.message,
          },
        },
        500,
      );
    }

    return c.json(
      {
        error: {
          code: "UNKNOWN_ERROR",
          message: "An unknown error occurred",
        },
      },
      500,
    );
  }
}
