import { describe, expect, it } from "@jest/globals";
import type { ProviderRegistry } from "../core/provider-registry.js";
import { createHealthRoutes } from "./health.js";

describe("createHealthRoutes shutdown", () => {
  it("returns 503 when shutting down", async () => {
    const registry = {
      getRegisteredProviders: () => [],
    } as unknown as ProviderRegistry;

    const isShuttingDown = () => true;
    const app = createHealthRoutes(registry, isShuttingDown);

    const res = await app.request("/");

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("shutting_down");
  });

  it("returns 200 when not shutting down and no providers", async () => {
    const registry = {
      getRegisteredProviders: () => [],
    } as unknown as ProviderRegistry;

    const app = createHealthRoutes(registry);

    const res = await app.request("/");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("healthy");
  });
});
