import client from "prom-client";

// Create a custom registry so we don't pollute the global default
export const registry = new client.Registry();

// Counter for total operations by provider and operation type
export const operationsCounter = new client.Counter({
  name: "payment_gateway_operations_total",
  help: "Total number of payment operations",
  labelNames: ["provider", "operation", "status"],
  registers: [registry],
});

// Counter for errors by provider and error code
export const errorsCounter = new client.Counter({
  name: "payment_gateway_errors_total",
  help: "Total number of payment errors",
  labelNames: ["provider", "operation", "error_code"],
  registers: [registry],
});

// Counter for retries by provider and operation
export const retriesCounter = new client.Counter({
  name: "payment_gateway_retries_total",
  help: "Total number of retries",
  labelNames: ["provider", "operation"],
  registers: [registry],
});

// Histogram for operation latency
export const operationDurationHistogram = new client.Histogram({
  name: "payment_gateway_operation_duration_seconds",
  help: "Duration of payment operations in seconds",
  labelNames: ["provider", "operation"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export function recordOperation(
  provider: string,
  operation: string,
  status: "success" | "failure",
  durationMs: number,
): void {
  operationsCounter.inc({ provider, operation, status });
  operationDurationHistogram.observe(
    { provider, operation },
    durationMs / 1000,
  );
}

export function recordError(
  provider: string,
  operation: string,
  errorCode: string,
): void {
  errorsCounter.inc({ provider, operation, error_code: errorCode });
}

export function recordRetry(provider: string, operation: string): void {
  retriesCounter.inc({ provider, operation });
}
