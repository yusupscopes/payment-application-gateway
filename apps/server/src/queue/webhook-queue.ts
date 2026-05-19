import { Queue } from "bullmq";
import type Redis from "ioredis";

export interface WebhookJobData {
  provider: string;
  signature: string;
  body: unknown;
  correlationId?: string;
}

export class WebhookQueue {
  private queue: Queue<WebhookJobData> | null = null;

  constructor(redisClient: Redis | null) {
    if (redisClient) {
      this.queue = new Queue<WebhookJobData>("webhook-processing", {
        connection: redisClient,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      });
    }
  }

  async add(data: WebhookJobData): Promise<string | null> {
    if (!this.queue) {
      return null;
    }

    const job = await this.queue.add("process-webhook", data);
    return job?.id ?? null;
  }

  get isAvailable(): boolean {
    return this.queue !== null;
  }

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
  }
}
