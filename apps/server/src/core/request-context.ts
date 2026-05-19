import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
  correlationId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

export function getCorrelationIdFromContext(): string | undefined {
  return asyncLocalStorage.getStore()?.correlationId;
}

export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return asyncLocalStorage.run(context, fn);
}
