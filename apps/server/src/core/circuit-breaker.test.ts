import { CircuitBreaker, CircuitBreakerOpenError } from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    jest.useFakeTimers();
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      monitoringPeriodMs: 60000,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("state transitions", () => {
    it("starts in Closed state", () => {
      expect(circuitBreaker.getState()).toBe("closed");
      expect(circuitBreaker.canExecute()).toBe(true);
    });

    it("opens after failure threshold is reached", () => {
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure();
      }

      expect(circuitBreaker.getState()).toBe("open");
      expect(circuitBreaker.canExecute()).toBe(false);
    });

    it("does not open before failure threshold is reached", () => {
      for (let i = 0; i < 4; i++) {
        circuitBreaker.recordFailure();
      }

      expect(circuitBreaker.getState()).toBe("closed");
      expect(circuitBreaker.canExecute()).toBe(true);
    });

    it("transitions to HalfOpen after reset timeout", () => {
      // Reach threshold
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure();
      }
      expect(circuitBreaker.getState()).toBe("open");

      // Simulate time passing
      jest.advanceTimersByTime(30001);

      expect(circuitBreaker.getState()).toBe("half-open");
      expect(circuitBreaker.canExecute()).toBe(true);
    });

    it("closes from HalfOpen on success", () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure();
      }
      jest.advanceTimersByTime(30001);
      expect(circuitBreaker.getState()).toBe("half-open");

      circuitBreaker.recordSuccess();

      expect(circuitBreaker.getState()).toBe("closed");
    });

    it("re-opens from HalfOpen on failure", () => {
      // Open the circuit
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure();
      }
      jest.advanceTimersByTime(30001);
      expect(circuitBreaker.getState()).toBe("half-open");

      circuitBreaker.recordFailure();

      expect(circuitBreaker.getState()).toBe("open");
    });
  });

  describe("execute wrapper", () => {
    it("returns result when circuit is closed", async () => {
      const result = await circuitBreaker.execute(async () => "success");
      expect(result).toBe("success");
    });

    it("throws CircuitBreakerOpenError when circuit is open", async () => {
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure();
      }

      await expect(
        circuitBreaker.execute(async () => "success"),
      ).rejects.toThrow(CircuitBreakerOpenError);
    });

    it("records success when wrapped function succeeds", async () => {
      await circuitBreaker.execute(async () => "success");

      // Should not open even after 4 failures because success resets counter
      for (let i = 0; i < 4; i++) {
        circuitBreaker.recordFailure();
      }

      expect(circuitBreaker.getState()).toBe("closed");
    });

    it("records failure when wrapped function throws", async () => {
      await expect(
        circuitBreaker.execute(async () => {
          throw new Error("failure");
        }),
      ).rejects.toThrow("failure");

      // Circuit should have recorded one failure
      expect(circuitBreaker.getState()).toBe("closed");
    });
  });

  describe("failure tracking outside monitoring period", () => {
    it("does not count failures outside the monitoring period", () => {
      // Record 3 failures
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordFailure();
      }

      // Advance past monitoring period
      jest.advanceTimersByTime(60001);

      // These should not open the circuit because previous failures expired
      for (let i = 0; i < 3; i++) {
        circuitBreaker.recordFailure();
      }

      expect(circuitBreaker.getState()).toBe("closed");
    });
  });

  describe("default options", () => {
    it("uses sensible defaults when no options provided", () => {
      const defaultBreaker = new CircuitBreaker();

      expect(defaultBreaker.getState()).toBe("closed");
      expect(defaultBreaker.canExecute()).toBe(true);
    });
  });
});
