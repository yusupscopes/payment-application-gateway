import {
  getCorrelationIdFromContext,
  getRequestContext,
  runWithRequestContext,
} from "./request-context.js";

describe("request-context", () => {
  it("should return undefined when outside of context", () => {
    expect(getRequestContext()).toBeUndefined();
    expect(getCorrelationIdFromContext()).toBeUndefined();
  });

  it("should store and retrieve correlation ID within context", async () => {
    const context = { correlationId: "corr_test123" };

    await runWithRequestContext(context, async () => {
      expect(getRequestContext()).toEqual(context);
      expect(getCorrelationIdFromContext()).toBe("corr_test123");
    });
  });

  it("should isolate contexts between concurrent operations", async () => {
    const results: string[] = [];

    await Promise.all([
      runWithRequestContext({ correlationId: "a" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const id = getCorrelationIdFromContext();
        if (id) results.push(id);
      }),
      runWithRequestContext({ correlationId: "b" }, async () => {
        const id = getCorrelationIdFromContext();
        if (id) results.push(id);
      }),
    ]);

    expect(results).toContain("a");
    expect(results).toContain("b");
  });
});
