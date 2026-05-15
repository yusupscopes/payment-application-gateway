export class RetryManager {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;

  constructor(options: { maxAttempts?: number; baseDelayMs?: number } = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
  }

  async execute<T>(
    fn: () => Promise<T>,
    isRetryable: (error: unknown) => boolean,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        const canRetry = isRetryable(error);
        const isLastAttempt = attempt === this.maxAttempts;

        if (!canRetry || isLastAttempt) {
          throw error;
        }

        const delayMs = this.baseDelayMs * 2 ** (attempt - 1);
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
