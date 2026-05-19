import { randomUUID } from "node:crypto";
import type {
  ChargePayload,
  NormalizedError,
  PaymentResult,
  ProviderName,
  RefundPayload,
  RefundResult,
  TransactionStatus,
  VerifyPayload,
  VerifyResult,
} from "../types/payment.js";
import type { AuditLogger } from "./audit-logger.js";
import { recordError, recordOperation, recordRetry } from "./metrics.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { RetryManager } from "./retry-manager.js";

interface OperationResult {
  success: boolean;
  transactionId: string;
  providerRef: string;
  raw: unknown;
  error?: NormalizedError;
}

type OperationType = "charge" | "refund" | "verify";

export class PaymentGateway {
  constructor(
    private registry: ProviderRegistry,
    private retryManager: RetryManager,
    private auditLogger: AuditLogger,
  ) {}

  async charge(payload: ChargePayload): Promise<PaymentResult> {
    return this.executeOperation(
      payload.provider,
      "charge",
      (provider, transactionId) => provider.charge(payload, transactionId),
      () => payload.amount,
      () => payload.currency,
      (result) => (result.success ? "captured" : "failed"),
    ) as Promise<PaymentResult>;
  }

  async refund(payload: RefundPayload): Promise<RefundResult> {
    return this.executeOperation(
      payload.provider,
      "refund",
      (provider, transactionId) => provider.refund(payload, transactionId),
      (result) => (result as RefundResult).amount,
      (result) => (result as RefundResult).currency,
      (result) => (result.success ? "refunded" : "failed"),
    ) as Promise<RefundResult>;
  }

  async verify(payload: VerifyPayload): Promise<VerifyResult> {
    return this.executeOperation(
      payload.provider,
      "verify",
      (provider, transactionId) => provider.verify(payload, transactionId),
      () => 0,
      () => "",
      (result) => (result as VerifyResult).status,
    ) as Promise<VerifyResult>;
  }

  private async executeOperation(
    providerName: ProviderName,
    operation: OperationType,
    callProvider: (
      provider: import("../types/payment.js").IPaymentProvider,
      transactionId: string,
    ) => Promise<OperationResult>,
    getAuditAmount: (result: OperationResult) => number,
    getAuditCurrency: (result: OperationResult) => string,
    getAuditStatus: (result: OperationResult) => TransactionStatus,
  ): Promise<OperationResult> {
    const provider = this.registry.resolve(providerName);
    const transactionId = this.generateTransactionId();
    const startTime = Date.now();

    const result = await this.retryManager.execute(
      async () => {
        const providerResult = await callProvider(provider, transactionId);
        providerResult.transactionId = transactionId;

        if (!providerResult.success && providerResult.error?.retryable) {
          throw providerResult.error;
        }

        return providerResult;
      },
      (error) => {
        if (error && typeof error === "object" && "retryable" in error) {
          return Boolean((error as { retryable: boolean }).retryable);
        }
        return false;
      },
      (_attempt) => {
        recordRetry(providerName, operation);
      },
    );

    const durationMs = Date.now() - startTime;
    const status = result.success ? "success" : "failure";
    recordOperation(providerName, operation, status, durationMs);

    if (!result.success && result.error) {
      recordError(providerName, operation, result.error.code);
    }

    // Audit log is written exactly once per transaction, after the final result
    await this.auditLogger.log({
      transactionId,
      provider: providerName,
      providerRef: result.providerRef,
      operation,
      amount: getAuditAmount(result),
      currency: getAuditCurrency(result),
      status: getAuditStatus(result),
      rawResponse: result.raw,
      error: result.error,
    });

    return result;
  }

  private generateTransactionId(): string {
    return `txn_${randomUUID().replace(/-/g, "")}`;
  }
}
