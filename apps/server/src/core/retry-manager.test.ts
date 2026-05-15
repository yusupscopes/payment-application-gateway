import { RetryManager } from "./retry-manager.js";

describe("RetryManager", () => {
  let retryManager: RetryManager;

  beforeEach(() => {
    retryManager = new RetryManager({ maxAttempts: 3, baseDelayMs: 100 });
  });

  describe("execute", () => {
    it("should return result on first successful attempt", async () => {
      const fn = jest.fn().mockResolvedValue("success");
      const isRetryable = jest.fn().mockReturnValue(true);

      const result = await retryManager.execute(fn, isRetryable);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
      expect(isRetryable).not.toHaveBeenCalled();
    });

    it("should retry on retryable error and return success", async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new Error("retryable error"))
        .mockResolvedValueOnce("success");
      const isRetryable = jest.fn().mockReturnValue(true);

      const result = await retryManager.execute(fn, isRetryable);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
      expect(isRetryable).toHaveBeenCalledTimes(1);
      expect(isRetryable).toHaveBeenCalledWith(
        expect.objectContaining({ message: "retryable error" }),
      );
    });

    it("should throw after max retries exceeded", async () => {
      const error = new Error("persistent error");
      const fn = jest.fn().mockRejectedValue(error);
      const isRetryable = jest.fn().mockReturnValue(true);

      await expect(retryManager.execute(fn, isRetryable)).rejects.toThrow(
        "persistent error",
      );

      expect(fn).toHaveBeenCalledTimes(3);
      expect(isRetryable).toHaveBeenCalledTimes(3);
    });

    it("should fail immediately for non-retryable errors", async () => {
      const error = new Error("non-retryable error");
      const fn = jest.fn().mockRejectedValue(error);
      const isRetryable = jest.fn().mockReturnValue(false);

      await expect(retryManager.execute(fn, isRetryable)).rejects.toThrow(
        "non-retryable error",
      );

      expect(fn).toHaveBeenCalledTimes(1);
      expect(isRetryable).toHaveBeenCalledTimes(1);
    });

    it("should apply exponential backoff between retries", async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = ((callback: () => void, ms?: number) => {
        if (ms) delays.push(ms);
        return originalSetTimeout(callback, 0);
      }) as typeof global.setTimeout;

      const fn = jest.fn().mockRejectedValue(new Error("retryable"));
      const isRetryable = jest.fn().mockReturnValue(true);

      await expect(retryManager.execute(fn, isRetryable)).rejects.toThrow(
        "retryable",
      );

      global.setTimeout = originalSetTimeout;

      expect(delays).toHaveLength(2);
      expect(delays[0]).toBe(100); // 100 * 2^0
      expect(delays[1]).toBe(200); // 100 * 2^1
    });

    it("should call isRetryable on every failed attempt including the last", async () => {
      const error = new Error("final error");
      const fn = jest.fn().mockRejectedValue(error);
      const isRetryable = jest.fn().mockReturnValue(true);

      await expect(retryManager.execute(fn, isRetryable)).rejects.toThrow(
        "final error",
      );

      // Should be called exactly maxAttempts times
      expect(fn).toHaveBeenCalledTimes(3);
      // isRetryable is called on all 3 attempts (to determine if error is retryable, even on last)
      expect(isRetryable).toHaveBeenCalledTimes(3);
    });

    it("should use default config when no options provided", async () => {
      const defaultRetryManager = new RetryManager();
      const fn = jest.fn().mockResolvedValue("default success");
      const isRetryable = jest.fn().mockReturnValue(true);

      const result = await defaultRetryManager.execute(fn, isRetryable);

      expect(result).toBe("default success");
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
