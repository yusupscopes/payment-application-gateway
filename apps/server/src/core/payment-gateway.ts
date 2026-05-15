import { randomUUID } from "node:crypto";
import type {
  ChargePayload,
  PaymentResult,
  RefundPayload,
  RefundResult,
  VerifyPayload,
  VerifyResult,
} from "../types/payment.js";
import type { AuditLogger } from "./audit-logger.js";
import type { ProviderRegistry } from "./provider-registry.js";
import type { RetryManager } from "./retry-manager.js";

export class PaymentGateway {
  constructor(
    private registry: ProviderRegistry,
    private retryManager: RetryManager,
    private auditLogger: AuditLogger,
  ) {}

  async charge(payload: ChargePayload): Promise<PaymentResult> {
    const provider = this.registry.resolve(payload.provider);
    const transactionId = this.generateTransactionId();

    return this.retryManager.execute(
      async () => {
        const result = await provider.charge(payload);
        result.transactionId = transactionId;

        await this.auditLogger.log({
          transactionId,
          provider: payload.provider,
          providerRef: result.providerRef,
          operation: "charge",
          amount: payload.amount,
          currency: payload.currency,
          status: result.success ? "captured" : "failed",
          rawResponse: result.raw,
          error: result.error,
        });

        if (!result.success && result.error?.retryable) {
          throw result.error;
        }

        return result;
      },
      (error) => {
        if (error && typeof error === "object" && "retryable" in error) {
          return Boolean((error as { retryable: boolean }).retryable);
        }
        return false;
      },
    );
  }

  async refund(payload: RefundPayload): Promise<RefundResult> {
    const provider = this.registry.resolve(payload.provider);
    const transactionId = this.generateTransactionId();

    return this.retryManager.execute(
      async () => {
        const result = await provider.refund(payload);
        result.transactionId = transactionId;

        await this.auditLogger.log({
          transactionId,
          provider: payload.provider,
          providerRef: result.providerRef,
          operation: "refund",
          amount: result.amount,
          currency: result.currency,
          status: result.success ? "refunded" : "failed",
          rawResponse: result.raw,
          error: result.error,
        });

        if (!result.success && result.error?.retryable) {
          throw result.error;
        }

        return result;
      },
      (error) => {
        if (error && typeof error === "object" && "retryable" in error) {
          return Boolean((error as { retryable: boolean }).retryable);
        }
        return false;
      },
    );
  }

  async verify(payload: VerifyPayload): Promise<VerifyResult> {
    const provider = this.registry.resolve(payload.provider);
    const transactionId = this.generateTransactionId();

    return this.retryManager.execute(
      async () => {
        const result = await provider.verify(payload);
        result.transactionId = transactionId;

        await this.auditLogger.log({
          transactionId,
          provider: payload.provider,
          providerRef: result.providerRef,
          operation: "verify",
          amount: 0,
          currency: "",
          status: result.status,
          rawResponse: result.raw,
          error: result.error,
        });

        if (!result.success && result.error?.retryable) {
          throw result.error;
        }

        return result;
      },
      (error) => {
        if (error && typeof error === "object" && "retryable" in error) {
          return Boolean((error as { retryable: boolean }).retryable);
        }
        return false;
      },
    );
  }

  private generateTransactionId(): string {
    return `txn_${randomUUID().replace(/-/g, "")}`;
  }
}
