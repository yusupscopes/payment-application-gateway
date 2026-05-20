import type { Writable } from "node:stream";
import type { Logger } from "pino";
import { pino } from "pino";
import { getRequestContext } from "./request-context.js";

export interface LoggerOptions {
  level?: string;
  stream?: Writable;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino(
    {
      level: options.level ?? "info",
      base: { service: "payment-gateway" },
      timestamp: pino.stdTimeFunctions.isoTime,
      messageKey: "message",
    },
    options.stream,
  );
}

const defaultLogger = createLogger();

export function getContextualLogger(baseLogger?: Logger): Logger {
  const logger = baseLogger ?? defaultLogger;
  const context = getRequestContext();
  if (context?.correlationId) {
    return logger.child({ correlationId: context.correlationId });
  }
  return logger;
}
