import { randomUUID } from "node:crypto";
import Stripe from "stripe";
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

export class StripeAdapter implements IPaymentProvider {
  readonly name = "stripe" as const;
  private client: Stripe;

  constructor(private config: { secretKey: string; webhookSecret?: string }) {
    this.client = new Stripe(config.secretKey);
  }

  async charge(
    payload: ChargePayload,
    transactionId: string,
  ): Promise<PaymentResult> {
    try {
      const paymentIntent = await this.client.paymentIntents.create({
        amount: payload.amount,
        currency: payload.currency.toLowerCase(),
        payment_method: payload.paymentMethod,
        description: payload.description,
        metadata: payload.metadata as Record<string, string>,
        customer: payload.customerId,
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      });

      const success = paymentIntent.status === "succeeded";

      return {
        success,
        transactionId,
        amount: payload.amount,
        currency: payload.currency,
        provider: "stripe",
        providerRef: paymentIntent.id,
        raw: paymentIntent,
        error: success
          ? undefined
          : this.normalizeError({
              code: "card_declined",
              message: `Payment intent status: ${paymentIntent.status}`,
              retryable: false,
            }),
      };
    } catch (error) {
      return {
        success: false,
        transactionId,
        amount: payload.amount,
        currency: payload.currency,
        provider: "stripe",
        providerRef: "",
        raw: error,
        error: this.normalizeStripeError(error),
      };
    }
  }

  async refund(
    payload: RefundPayload,
    transactionId: string,
  ): Promise<RefundResult> {
    try {
      const refund = await this.client.refunds.create({
        payment_intent: payload.transactionId,
        amount: payload.amount,
        reason: payload.reason as Stripe.RefundCreateParams.Reason,
      });

      const success = refund.status === "succeeded";

      return {
        success,
        transactionId,
        refundId: `ref_${randomUUID().replace(/-/g, "")}`,
        amount: refund.amount,
        currency: refund.currency.toUpperCase(),
        provider: "stripe",
        providerRef: refund.id,
        raw: refund,
        error: success
          ? undefined
          : this.normalizeError({
              code: "processing_error",
              message: `Refund status: ${refund.status}`,
              retryable: false,
            }),
      };
    } catch (error) {
      return {
        success: false,
        transactionId,
        refundId: `ref_${randomUUID().replace(/-/g, "")}`,
        amount: payload.amount ?? 0,
        currency: "",
        provider: "stripe",
        providerRef: "",
        raw: error,
        error: this.normalizeStripeError(error),
      };
    }
  }

  async verify(
    payload: VerifyPayload,
    transactionId: string,
  ): Promise<VerifyResult> {
    try {
      const paymentIntent = await this.client.paymentIntents.retrieve(
        payload.transactionId,
      );

      return {
        success: true,
        transactionId,
        status: this.mapStripeStatus(paymentIntent.status),
        provider: "stripe",
        providerRef: paymentIntent.id,
        raw: paymentIntent,
      };
    } catch (error) {
      return {
        success: false,
        transactionId,
        status: "failed",
        provider: "stripe",
        providerRef: "",
        raw: error,
        error: this.normalizeStripeError(error),
      };
    }
  }

  async verifyWebhook(payload: WebhookPayload): Promise<WebhookResult> {
    if (!this.config.webhookSecret) {
      return {
        success: false,
        event: "invalid",
        raw: {},
        error: {
          code: "UNAUTHORIZED",
          message: "Webhook secret not configured",
          retryable: false,
        },
      };
    }

    try {
      const event = this.client.webhooks.constructEvent(
        JSON.stringify(payload.body),
        payload.signature,
        this.config.webhookSecret,
      );

      return {
        success: true,
        event: event.type,
        transactionId: this.extractTransactionId(event),
        providerRef: this.extractProviderRef(event),
        raw: event,
      };
    } catch (error) {
      return {
        success: false,
        event: "invalid",
        raw: error,
        error: this.normalizeError({
          code: "INVALID_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Invalid webhook signature",
          retryable: false,
        }),
      };
    }
  }

  private normalizeStripeError(error: unknown): NormalizedError {
    if (this.isStripeError(error)) {
      return this.normalizeError({
        code: error.code || "unknown_error",
        message: error.message,
        retryable: this.isRetryableStripeError(error),
      });
    }

    return this.normalizeError({
      code: "UNKNOWN_ERROR",
      message: error instanceof Error ? error.message : "Unknown error",
      retryable: false,
    });
  }

  private isStripeError(
    error: unknown,
  ): error is { type: string; code: string | null; message: string } {
    return (
      error instanceof Error &&
      "type" in error &&
      typeof (error as Record<string, unknown>).type === "string" &&
      "code" in error
    );
  }

  private normalizeError(error: {
    code: string | null | undefined;
    message: string;
    retryable: boolean;
  }): NormalizedError {
    return {
      code: this.mapStripeErrorCode(error.code),
      message: error.message,
      retryable: error.retryable,
    };
  }

  private mapStripeErrorCode(
    code: string | null | undefined,
  ): PaymentErrorCode {
    const validCodes: PaymentErrorCode[] = [
      "INSUFFICIENT_FUNDS",
      "CARD_DECLINED",
      "INVALID_CARD",
      "EXPIRED_CARD",
      "INCORRECT_CVC",
      "PROCESSING_ERROR",
      "RATE_LIMITED",
      "INVALID_REQUEST",
      "UNAUTHORIZED",
      "NOT_FOUND",
      "CONFLICT",
      "GATEWAY_ERROR",
      "UNKNOWN_ERROR",
    ];

    // If already a normalized code, return as-is
    if (code && validCodes.includes(code as PaymentErrorCode)) {
      return code as PaymentErrorCode;
    }

    const codeMap: Record<string, PaymentErrorCode> = {
      card_declined: "CARD_DECLINED",
      insufficient_funds: "INSUFFICIENT_FUNDS",
      expired_card: "EXPIRED_CARD",
      incorrect_cvc: "INCORRECT_CVC",
      processing_error: "PROCESSING_ERROR",
      rate_limit: "RATE_LIMITED",
      api_connection_error: "RATE_LIMITED",
      api_error: "GATEWAY_ERROR",
      authentication_error: "UNAUTHORIZED",
      invalid_request_error: "INVALID_REQUEST",
      idempotency_error: "CONFLICT",
      unknown_error: "UNKNOWN_ERROR",
    };

    return codeMap[code ?? "unknown_error"] || "UNKNOWN_ERROR";
  }

  private isRetryableStripeError(error: { type: string }): boolean {
    return (
      error.type === "idempotency_error" ||
      error.type === "rate_limit_error" ||
      error.type === "api_error" ||
      error.type === "api_connection_error"
    );
  }

  private mapStripeStatus(status: string): VerifyResult["status"] {
    const statusMap: Record<string, VerifyResult["status"]> = {
      requires_payment_method: "pending",
      requires_confirmation: "pending",
      requires_action: "pending",
      processing: "pending",
      requires_capture: "authorized",
      canceled: "cancelled",
      succeeded: "settled",
    };

    return statusMap[status] || "failed";
  }

  private extractTransactionId(event: Stripe.Event): string | undefined {
    const object = event.data.object as unknown as Record<string, unknown>;
    if (
      "metadata" in object &&
      object.metadata &&
      typeof object.metadata === "object"
    ) {
      const metadata = object.metadata as Record<string, string>;
      return metadata.transactionId;
    }
    return undefined;
  }

  private extractProviderRef(event: Stripe.Event): string | undefined {
    const object = event.data.object as unknown as Record<string, unknown>;
    if ("id" in object && typeof object.id === "string") {
      return object.id;
    }
    return undefined;
  }
}
