import { randomUUID } from "node:crypto";
import type { Database } from "@payment-application-gateway/db";
import { transactions } from "@payment-application-gateway/db";
import type {
  NormalizedError,
  ProviderName,
  TransactionStatus,
} from "../types/payment.js";
import { getCorrelationIdFromContext } from "./request-context.js";

export interface AuditLogPayload {
  transactionId?: string;
  provider: ProviderName;
  providerRef: string;
  operation: "charge" | "refund" | "verify";
  amount: number;
  currency: string;
  status: TransactionStatus;
  rawResponse: unknown;
  error?: NormalizedError;
}

export class AuditLogger {
  constructor(private db: Database) {}

  async log(payload: AuditLogPayload): Promise<string> {
    const transactionId = payload.transactionId ?? this.generateTransactionId();
    const correlationId = getCorrelationIdFromContext();

    await this.db.insert(transactions).values({
      id: transactionId,
      provider: payload.provider,
      providerRef: payload.providerRef,
      operation: payload.operation,
      amount: payload.amount,
      currency: payload.currency,
      status: payload.status,
      rawResponse: payload.rawResponse,
      errorCode: payload.error?.code ?? null,
      errorMessage: payload.error?.message ?? null,
      retryable: payload.error?.retryable ?? null,
      correlationId: correlationId ?? null,
    });

    return transactionId;
  }

  private generateTransactionId(): string {
    return `txn_${randomUUID().replace(/-/g, "")}`;
  }
}
