import { Worker } from "bullmq";
import type Redis from "ioredis";
import type { ProviderRegistry } from "../core/provider-registry.js";
import { runWithRequestContext } from "../core/request-context.js";
import type { ProviderName } from "../types/payment.js";
import type { WebhookJobData } from "./webhook-queue.js";

export class WebhookWorker {
  private worker: Worker<WebhookJobData> | null = null;

  constructor(redisClient: Redis | null, registry: ProviderRegistry) {
    if (redisClient) {
      this.worker = new Worker<WebhookJobData>(
        "webhook-processing",
        createProcessor(registry),
        {
          connection: redisClient,
          concurrency: 5,
        },
      );

      this.worker.on("failed", (job, err) => {
        console.error(
          `[WebhookWorker] Job ${job?.id} failed for provider ${job?.data.provider}:`,
          err.message,
        );
      });

      this.worker.on("completed", (job) => {
        console.log(
          `[WebhookWorker] Job ${job.id} completed for provider ${job.data.provider}`,
        );
      });
    }
  }

  get isRunning(): boolean {
    return this.worker !== null;
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
  }
}

export function createProcessor(registry: ProviderRegistry) {
  return async (job: import("bullmq").Job<WebhookJobData>) => {
    const correlationId = job.data.correlationId;

    return runWithRequestContext(
      { correlationId: correlationId ?? "unknown" },
      async () => processWebhookEvent(job.data, registry),
    );
  };
}

export async function processWebhookEvent(
  data: WebhookJobData,
  registry: ProviderRegistry,
) {
  const { provider, body } = data;

  // Validate provider exists (throws ProviderNotFoundError if unknown)
  registry.resolve(provider as ProviderName);

  // The webhook signature was already verified in the route handler.
  // The worker processes the business event (e.g., updating transaction status).
  // TODO: Parse the webhook body to extract event type and update the
  // transaction record in the database accordingly.
  // Example: if event === "charge.succeeded", update txn status to "settled".

  const event = extractEventType(body);

  return {
    success: true,
    provider,
    event,
    processedAt: new Date().toISOString(),
  };
}

export function extractEventType(body: unknown): string {
  if (body && typeof body === "object") {
    const typed = body as Record<string, unknown>;

    // Stripe: event.type
    if (typeof typed.type === "string") {
      return typed.type;
    }

    // Midtrans: body.transaction_status or body.status_code
    if (typeof typed.transaction_status === "string") {
      return typed.transaction_status;
    }

    // Xendit: body.status or body.event
    if (typeof typed.status === "string") {
      return typed.status;
    }
    if (typeof typed.event === "string") {
      return typed.event;
    }
  }

  return "unknown";
}
