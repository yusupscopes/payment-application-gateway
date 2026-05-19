import { Hono } from "hono";
import type { ProviderRegistry } from "../core/provider-registry.js";

export function createHealthRoutes(registry: ProviderRegistry) {
  const app = new Hono();

  app.get("/", async (c) => {
    const providers = registry.getRegisteredProviders();
    const checks = await Promise.all(
      providers.map(async (name) => {
        const provider = registry.resolve(name);
        const startTime = Date.now();

        if (!provider.healthCheck) {
          return {
            name,
            status: "unknown" as const,
            healthy: true,
            message: "Health check not implemented",
          };
        }

        try {
          const result = await provider.healthCheck();
          return {
            name,
            status: result.healthy
              ? ("healthy" as const)
              : ("unhealthy" as const),
            healthy: result.healthy,
            latencyMs: result.latencyMs ?? Date.now() - startTime,
            message: result.message,
          };
        } catch (error) {
          return {
            name,
            status: "unhealthy" as const,
            healthy: false,
            latencyMs: Date.now() - startTime,
            message: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }),
    );

    const allHealthy = checks.every((check) => check.healthy);
    const statusCode = allHealthy ? 200 : 503;

    return c.json(
      {
        status: allHealthy ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
        providers: checks,
      },
      statusCode,
    );
  });

  return app;
}
