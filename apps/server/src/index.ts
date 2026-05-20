import { serve } from "@hono/node-server";
import { env } from "@payment-application-gateway/env/server";
import { createApp } from "./app.js";

const { app, logger, shutdown } = createApp();

const server = serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    logger.info(`Server is running on http://localhost:${info.port}`);
  },
);

const shutdownTimeoutMs = Number.parseInt(env.SHUTDOWN_TIMEOUT_MS, 10) || 10000;

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Wait for active requests to finish (with timeout)
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      logger.warn(
        `Shutdown timeout (${shutdownTimeoutMs}ms) exceeded. Forcefully exiting.`,
      );
      resolve();
    }, shutdownTimeoutMs);

    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });

  // Close resources (workers, queues, Redis, etc.)
  await shutdown();

  logger.info("Graceful shutdown complete. Exiting.");
  process.exit(0);
}

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});
