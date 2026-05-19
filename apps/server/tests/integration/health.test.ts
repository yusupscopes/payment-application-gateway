import { ProviderRegistry } from "../../src/core/provider-registry.js";
import { createHealthRoutes } from "../../src/routes/health.js";
import type {
  HealthCheckResult,
  IPaymentProvider,
} from "../../src/types/payment.js";

describe("Health Routes", () => {
  it("should return 200 when all providers are healthy", async () => {
    const registry = new ProviderRegistry();
    const mockProvider: IPaymentProvider = {
      name: "stripe",
      charge: jest.fn(),
      refund: jest.fn(),
      verify: jest.fn(),
      healthCheck: jest.fn().mockResolvedValue({
        healthy: true,
        latencyMs: 50,
      } as HealthCheckResult),
    };
    registry.register(mockProvider);

    const app = createHealthRoutes(registry);
    const res = await app.request("/");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0].healthy).toBe(true);
    expect(body.providers[0].status).toBe("healthy");
  });

  it("should return 503 when a provider is unhealthy", async () => {
    const registry = new ProviderRegistry();
    const healthyProvider: IPaymentProvider = {
      name: "stripe",
      charge: jest.fn(),
      refund: jest.fn(),
      verify: jest.fn(),
      healthCheck: jest.fn().mockResolvedValue({
        healthy: true,
      } as HealthCheckResult),
    };
    const unhealthyProvider: IPaymentProvider = {
      name: "midtrans",
      charge: jest.fn(),
      refund: jest.fn(),
      verify: jest.fn(),
      healthCheck: jest.fn().mockResolvedValue({
        healthy: false,
        message: "Connection timeout",
      } as HealthCheckResult),
    };
    registry.register(healthyProvider);
    registry.register(unhealthyProvider);

    const app = createHealthRoutes(registry);
    const res = await app.request("/");
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.providers[0].healthy).toBe(true);
    expect(body.providers[1].healthy).toBe(false);
  });

  it("should return unknown status for providers without healthCheck", async () => {
    const registry = new ProviderRegistry();
    const mockProvider: IPaymentProvider = {
      name: "stripe",
      charge: jest.fn(),
      refund: jest.fn(),
      verify: jest.fn(),
    };
    registry.register(mockProvider);

    const app = createHealthRoutes(registry);
    const res = await app.request("/");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.providers[0].status).toBe("unknown");
  });

  it("should handle health check errors gracefully", async () => {
    const registry = new ProviderRegistry();
    const mockProvider: IPaymentProvider = {
      name: "stripe",
      charge: jest.fn(),
      refund: jest.fn(),
      verify: jest.fn(),
      healthCheck: jest.fn().mockRejectedValue(new Error("Network error")),
    };
    registry.register(mockProvider);

    const app = createHealthRoutes(registry);
    const res = await app.request("/");
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.providers[0].healthy).toBe(false);
    expect(body.providers[0].message).toBe("Network error");
  });
});
