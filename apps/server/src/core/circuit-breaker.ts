export class CircuitBreakerOpenError extends Error {
  constructor(message = "Circuit breaker is open") {
    super(message);
    this.name = "CircuitBreakerOpenError";
  }
}

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  monitoringPeriodMs?: number;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly monitoringPeriodMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
    this.monitoringPeriodMs = options.monitoringPeriodMs ?? 60000;
  }

  getState(): CircuitState {
    return this.state;
  }

  canExecute(): boolean {
    return this.state !== "open";
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new CircuitBreakerOpenError();
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  recordSuccess(): void {
    if (this.state === "half-open") {
      this.transitionToClosed();
    }

    this.failureCount = 0;
    this.lastFailureTime = null;
  }

  recordFailure(): void {
    const now = Date.now();

    // Reset failure count if outside monitoring period
    if (
      this.lastFailureTime &&
      now - this.lastFailureTime > this.monitoringPeriodMs
    ) {
      this.failureCount = 0;
    }

    this.failureCount++;
    this.lastFailureTime = now;

    if (this.state === "half-open") {
      this.transitionToOpen();
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.transitionToOpen();
    }
  }

  private transitionToOpen(): void {
    this.state = "open";
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    this.resetTimer = setTimeout(() => {
      this.state = "half-open";
    }, this.resetTimeoutMs);
  }

  private transitionToClosed(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.lastFailureTime = null;

    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
  }
}
