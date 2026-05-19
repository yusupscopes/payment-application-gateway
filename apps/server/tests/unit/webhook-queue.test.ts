import { WebhookQueue } from "../../src/queue/webhook-queue.js";

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: "job-123" }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe("WebhookQueue", () => {
  it("should add job when Redis is available", async () => {
    const mockRedis = {} as import("ioredis").default;
    const queue = new WebhookQueue(mockRedis);

    const jobId = await queue.add({
      provider: "stripe",
      signature: "sig",
      body: { event: "charge.succeeded" },
    });

    expect(jobId).toBe("job-123");
    expect(queue.isAvailable).toBe(true);
  });

  it("should return null when Redis is unavailable", async () => {
    const queue = new WebhookQueue(null);

    const jobId = await queue.add({
      provider: "stripe",
      signature: "sig",
      body: { event: "charge.succeeded" },
    });

    expect(jobId).toBeNull();
    expect(queue.isAvailable).toBe(false);
  });
});
