import { randomUUID } from "node:crypto";
import { Xendit } from "xendit-node";
import type {
  ChargePayload,
  IPaymentProvider,
  NormalizedError,
  PaymentErrorCode,
  PaymentResult,
  RefundPayload,
  RefundResult,
  VerifyPayload,
  VerifyResult,
  WebhookPayload,
  WebhookResult,
} from "../../types/payment.js";

export class XenditAdapter implements IPaymentProvider {
  readonly name = "xendit" as const;
  private client: Xendit;

  constructor(private config: { secretKey: string }) {
    this.client = new Xendit({ secretKey: config.secretKey });
  }

  async charge(payload: ChargePayload): Promise<PaymentResult> {
    try {
      // For Xendit, we'll use Invoice API for charges
      const invoice = await this.client.Invoice.createInvoice({
        data: {
          amount: payload.amount,
          currency: payload.currency,
          description: payload.description,
          externalId: this.generateTransactionId(),
        },
      });

      return {
        success: true,
        transactionId: this.generateTransactionId(),
        amount: payload.amount,
        currency: payload.currency,
        provider: "xendit",
        providerRef: invoice.id ?? "",
        raw: invoice,
      };
    } catch (error) {
      return {
        success: false,
        transactionId: this.generateTransactionId(),
        amount: payload.amount,
        currency: payload.currency,
        provider: "xendit",
        providerRef: "",
        raw: error,
        error: this.normalizeXenditError(error),
      };
    }
  }

  async refund(payload: RefundPayload): Promise<RefundResult> {
    try {
      const refund = await this.client.Refund.createRefund({
        data: {
          invoiceId: payload.transactionId,
          amount: payload.amount,
          reason: payload.reason as unknown as undefined,
        },
      });

      return {
        success: true,
        transactionId: payload.transactionId,
        refundId: this.generateTransactionId(),
        amount: refund.amount ?? payload.amount ?? 0,
        currency: "IDR",
        provider: "xendit",
        providerRef: refund.id ?? "",
        raw: refund,
      };
    } catch (error) {
      return {
        success: false,
        transactionId: payload.transactionId,
        refundId: this.generateTransactionId(),
        amount: payload.amount ?? 0,
        currency: "IDR",
        provider: "xendit",
        providerRef: "",
        raw: error,
        error: this.normalizeXenditError(error),
      };
    }
  }

  async verify(payload: VerifyPayload): Promise<VerifyResult> {
    try {
      const invoice = await this.client.Invoice.getInvoiceById({
        invoiceId: payload.transactionId,
      });

      return {
        success: true,
        transactionId: payload.transactionId,
        status: this.mapXenditStatus(invoice.status),
        provider: "xendit",
        providerRef: invoice.id ?? "",
        raw: invoice,
      };
    } catch (error) {
      return {
        success: false,
        transactionId: payload.transactionId,
        status: "failed",
        provider: "xendit",
        providerRef: "",
        raw: error,
        error: this.normalizeXenditError(error),
      };
    }
  }

  async verifyWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    // Xendit webhook verification uses x-callback-token header
    // The secretKey serves as the callback token for verification
    const isValid = payload.signature === this.config.secretKey;

    if (!isValid) {
      return {
        success: false,
        event: "invalid",
        raw: payload.body,
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid callback token",
          retryable: false,
        },
      };
    }

    return {
      success: true,
      event: this.extractEventType(payload.body),
      transactionId: this.extractTransactionId(payload.body),
      providerRef: this.extractProviderRef(payload.body),
      raw: payload.body,
    };
  }

  private normalizeXenditError(error: unknown): NormalizedError {
    if (this.isXenditError(error)) {
      return {
        code: this.mapXenditErrorCode(error.errorCode),
        message: error.message,
        retryable: this.isRetryableXenditError(error),
      };
    }

    return {
      code: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
      retryable: false,
    };
  }

  private isXenditError(
    error: unknown,
  ): error is { errorCode: string; message: string } {
    return (
      error instanceof Error &&
      "errorCode" in error &&
      typeof (error as Record<string, unknown>).errorCode === "string"
    );
  }

  private isRetryableXenditError(error: { errorCode: string }): boolean {
    const retryableCodes = [
      "RATE_LIMITED",
      "SERVER_ERROR",
      "SERVICE_UNAVAILABLE",
    ];
    return retryableCodes.includes(error.errorCode);
  }

  private mapXenditErrorCode(code: string): PaymentErrorCode {
    const codeMap: Record<string, PaymentErrorCode> = {
      RATE_LIMITED: "RATE_LIMITED",
      SERVER_ERROR: "GATEWAY_ERROR",
      SERVICE_UNAVAILABLE: "GATEWAY_ERROR",
      INVALID_API_KEY: "UNAUTHORIZED",
      INVALID_REQUEST: "INVALID_REQUEST",
      NOT_FOUND: "NOT_FOUND",
      INSUFFICIENT_BALANCE: "INSUFFICIENT_FUNDS",
      PAYMENT_DECLINED: "CARD_DECLINED",
      EXPIRED_CARD: "EXPIRED_CARD",
      INCORRECT_CVC: "INCORRECT_CVC",
      UNKNOWN_ERROR: "UNKNOWN_ERROR",
    };

    return codeMap[code] || "UNKNOWN_ERROR";
  }

  private mapXenditStatus(status?: string): VerifyResult["status"] {
    const statusMap: Record<string, VerifyResult["status"]> = {
      PENDING: "pending",
      PAID: "settled",
      EXPIRED: "expired",
      SETTLED: "settled",
      FAILED: "failed",
    };

    return statusMap[status ?? ""] || "failed";
  }

  private extractEventType(body: unknown): string {
    if (typeof body === "object" && body !== null && "event" in body) {
      return String((body as Record<string, unknown>).event);
    }
    return "unknown";
  }

  private extractTransactionId(body: unknown): string | undefined {
    if (typeof body === "object" && body !== null && "external_id" in body) {
      const externalId = (body as Record<string, unknown>).external_id;
      if (typeof externalId === "string") return externalId;
    }
    return undefined;
  }

  private extractProviderRef(body: unknown): string | undefined {
    if (typeof body === "object" && body !== null && "id" in body) {
      const id = (body as Record<string, unknown>).id;
      if (typeof id === "string") return id;
    }
    return undefined;
  }

  private generateTransactionId(): string {
    return `txn_${randomUUID().replace(/-/g, "")}`;
  }
}
