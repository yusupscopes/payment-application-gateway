import { createHash, randomUUID } from "node:crypto";
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
  private config: { serverKey: string };

  constructor(config: { serverKey: string }) {
    this.config = config;
    this.client = new CoreApi({
      isProduction: false,
      serverKey: config.serverKey,
      clientKey: "",
    });
  }

  async charge(
    payload: ChargePayload,
    transactionId: string,
  ): Promise<PaymentResult> {
    try {
      const response = await this.client.charge({
        payment_type: payload.paymentMethod,
        transaction_details: {
          order_id: transactionId,
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
        transactionId,
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
        transactionId,
        amount: payload.amount,
        currency: payload.currency,
        provider: "midtrans",
        providerRef: "",
        raw: error,
        error: this.normalizeMidtransError(error),
      };
    }
  }

  async refund(
    payload: RefundPayload,
    transactionId: string,
  ): Promise<RefundResult> {
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
        transactionId,
        refundId: `ref_${randomUUID().replace(/-/g, "")}`,
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
        transactionId,
        refundId: `ref_${randomUUID().replace(/-/g, "")}`,
        amount: payload.amount ?? 0,
        currency: "IDR",
        provider: "midtrans",
        providerRef: "",
        raw: error,
        error: this.normalizeMidtransError(error),
      };
    }
  }

  async verify(
    payload: VerifyPayload,
    transactionId: string,
  ): Promise<VerifyResult> {
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
        transactionId,
        status: this.mapMidtransStatus(midtransResponse.transaction_status),
        provider: "midtrans",
        providerRef: midtransResponse.transaction_id ?? "",
        raw: midtransResponse,
        error: success ? undefined : this.normalizeError(midtransResponse),
      };
    } catch (error) {
      return {
        success: false,
        transactionId,
        status: "failed",
        provider: "midtrans",
        providerRef: "",
        raw: error,
        error: this.normalizeMidtransError(error),
      };
    }
  }

  async verifyWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    const body = payload.body as Record<string, unknown>;

    // Midtrans webhook signature verification
    // Signature is calculated as: SHA512(order_id + status_code + gross_amount + serverKey)
    const orderId = body.order_id;
    const statusCode = body.status_code;
    const grossAmount = body.gross_amount;
    const signatureKey = body.signature_key;

    if (
      typeof orderId !== "string" ||
      typeof statusCode !== "string" ||
      typeof grossAmount !== "string" ||
      typeof signatureKey !== "string"
    ) {
      return {
        success: false,
        event: "invalid",
        raw: body,
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid webhook payload: missing required fields",
          retryable: false,
        },
      };
    }

    const expectedSignature = createHash("sha512")
      .update(`${orderId}${statusCode}${grossAmount}${this.config.serverKey}`)
      .digest("hex");

    if (signatureKey !== expectedSignature) {
      return {
        success: false,
        event: "invalid",
        raw: body,
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid webhook signature",
          retryable: false,
        },
      };
    }

    return {
      success: true,
      event: String(body.transaction_status ?? "notification"),
      transactionId:
        typeof body.order_id === "string" ? body.order_id : undefined,
      providerRef:
        typeof body.transaction_id === "string"
          ? body.transaction_id
          : undefined,
      raw: body,
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
}

interface MidtransResponse {
  status_code: string;
  status_message?: string;
  transaction_id?: string;
  transaction_status?: string;
}
