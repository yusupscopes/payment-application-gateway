import { Hono } from "hono";
import { registry } from "../core/metrics.js";

export function createMetricsRoutes() {
  const app = new Hono();

  app.get("/", async (c) => {
    const metrics = await registry.metrics();
    return c.text(metrics, 200, {
      "Content-Type": registry.contentType,
    });
  });

  return app;
}
