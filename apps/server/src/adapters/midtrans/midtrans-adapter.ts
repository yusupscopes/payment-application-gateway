import { randomUUID } from "node:crypto";
import { CoreApi } from "midtrans-client";
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

export class MidtransAdapter implements IPaymentProvider {
  readonly name = "midtrans" as const;
  private client: CoreApi;

  constructor(config: { serverKey: string }) {
    this.client = new CoreApi({
      isProduction: false,
      serverKey: config.serverKey,
      clientKey: "",
    });
  }

  async charge(payload: ChargePayload): Promise<PaymentResult> {
    try {
      const response = await this.client.charge({
        payment_type: payload.paymentMethod,
        transaction_details: {
          order_id: this.generateTransactionId(),
          gross_amount: payload.amount,
        },
        currency: payload.currency,
        custom_field1: payload.description,
      });

      const midtransResponse = response as MidtransResponse;
      const success = ["200", "201", "202"].includes(
        midtransResponse.status_code,
      );

      return {
        success,
        transactionId: this.generateTransactionId(),
        amount: payload.amount,
        currency: payload.currency,
        provider: "midtrans",
        providerRef: midtransResponse.transaction_id ?? "",
        raw: midtransResponse,
        error: success ? undefined : this.normalizeError(midtransResponse),
      };
    } catch (error) {
      return {
        success: false,
        transactionId: this.generateTransactionId(),
        amount: payload.amount,
        currency: payload.currency,
        provider: "midtrans",
        providerRef: "",
        raw: error,
        error: this.normalizeMidtransError(error),
      };
    }
  }

  async refund(payload: RefundPayload): Promise<RefundResult> {
    try {
      const response = await this.client.refund(payload.transactionId, {
        amount: payload.amount,
        reason: payload.reason,
      });

      const midtransResponse = response as MidtransResponse;
      const success = ["200", "201", "202"].includes(
        midtransResponse.status_code,
      );

      return {
        success,
        transactionId: payload.transactionId,
        refundId: this.generateTransactionId(),
        amount: payload.amount ?? 0,
        currency: "IDR",
        provider: "midtrans",
        providerRef: midtransResponse.transaction_id ?? "",
        raw: midtransResponse,
        error: success ? undefined : this.normalizeError(midtransResponse),
      };
    } catch (error) {
      return {
        success: false,
        transactionId: payload.transactionId,
        refundId: this.generateTransactionId(),
        amount: payload.amount ?? 0,
        currency: "IDR",
        provider: "midtrans",
        providerRef: "",
        raw: error,
        error: this.normalizeMidtransError(error),
      };
    }
  }

  async verify(payload: VerifyPayload): Promise<VerifyResult> {
    try {
      const response = await this.client.transaction.status(
        payload.transactionId,
      );

      const midtransResponse = response as MidtransResponse;
      const success = ["200", "201", "202"].includes(
        midtransResponse.status_code,
      );

      return {
        success,
        transactionId: payload.transactionId,
        status: this.mapMidtransStatus(midtransResponse.transaction_status),
        provider: "midtrans",
        providerRef: midtransResponse.transaction_id ?? "",
        raw: midtransResponse,
        error: success ? undefined : this.normalizeError(midtransResponse),
      };
    } catch (error) {
      return {
        success: false,
        transactionId: payload.transactionId,
        status: "failed",
        provider: "midtrans",
        providerRef: "",
        raw: error,
        error: this.normalizeMidtransError(error),
      };
    }
  }

  async verifyWebhook(_payload: WebhookPayload): Promise<WebhookResult> {
    // Midtrans webhook notification verification typically involves
    // checking the signature in the notification payload
    // For now, we accept the notification and return success
    // In production, this should verify the notification hash
    return {
      success: true,
      event: "notification",
      raw: {},
    };
  }

  private normalizeError(response: MidtransResponse): NormalizedError {
    const retryable = ["408", "503"].includes(response.status_code);
    return {
      code: this.mapMidtransStatusCode(response.status_code),
      message: response.status_message || "Unknown Midtrans error",
      retryable,
    };
  }

  private normalizeMidtransError(error: unknown): NormalizedError {
    if (this.isMidtransError(error)) {
      const statusCode = String(error.httpStatusCode || "500");
      const retryable = ["408", "503"].includes(statusCode);
      return {
        code: this.mapMidtransStatusCode(statusCode),
        message: error.message,
        retryable,
      };
    }

    return {
      code: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
      retryable: false,
    };
  }

  private isMidtransError(
    error: unknown,
  ): error is Error & { httpStatusCode?: number } {
    return error instanceof Error && "httpStatusCode" in error;
  }

  private mapMidtransStatusCode(statusCode: string): PaymentErrorCode {
    const codeMap: Record<string, PaymentErrorCode> = {
      "200": "PROCESSING_ERROR",
      "201": "PROCESSING_ERROR",
      "202": "PROCESSING_ERROR",
      "400": "INVALID_REQUEST",
      "401": "UNAUTHORIZED",
      "402": "INSUFFICIENT_FUNDS",
      "403": "UNAUTHORIZED",
      "404": "NOT_FOUND",
      "406": "CARD_DECLINED",
      "408": "RATE_LIMITED",
      "409": "CONFLICT",
      "500": "GATEWAY_ERROR",
      "502": "GATEWAY_ERROR",
      "503": "RATE_LIMITED",
    };

    return codeMap[statusCode] || "UNKNOWN_ERROR";
  }

  private mapMidtransStatus(status?: string): VerifyResult["status"] {
    const statusMap: Record<string, VerifyResult["status"]> = {
      pending: "pending",
      authorize: "authorized",
      capture: "captured",
      settlement: "settled",
      deny: "failed",
      cancel: "cancelled",
      expire: "expired",
      refund: "refunded",
      partial_refund: "refunded",
    };

    return statusMap[status ?? ""] || "failed";
  }

  private generateTransactionId(): string {
    return `txn_${randomUUID().replace(/-/g, "")}`;
  }
}

interface MidtransResponse {
  status_code: string;
  status_message?: string;
  transaction_id?: string;
  transaction_status?: string;
}
