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
    onRetry?: (attempt: number, error: unknown) => void,
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

        onRetry?.(attempt, error);

        const delayMs = this.calculateBackoff(attempt);
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  private calculateBackoff(attempt: number): number {
    const base = this.baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.random() * base * 0.5; // 0-50% jitter
    return Math.floor(base + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
