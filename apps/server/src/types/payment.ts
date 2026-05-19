export type ProviderName = "stripe" | "midtrans" | "xendit";

export type PaymentErrorCode =
  | "INSUFFICIENT_FUNDS"
  | "CARD_DECLINED"
  | "INVALID_CARD"
  | "EXPIRED_CARD"
  | "INCORRECT_CVC"
  | "PROCESSING_ERROR"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "GATEWAY_ERROR"
  | "UNKNOWN_ERROR";

export interface NormalizedError {
  code: PaymentErrorCode;
  message: string;
  retryable: boolean;
}

export interface PaymentResult {
  success: boolean;
  transactionId: string;
  amount: number;
  currency: string;
  provider: ProviderName;
  providerRef: string;
  raw: unknown;
  error?: NormalizedError;
}

export interface RefundResult {
  success: boolean;
  transactionId: string;
  refundId: string;
  amount: number;
  currency: string;
  provider: ProviderName;
  providerRef: string;
  raw: unknown;
  error?: NormalizedError;
}

export interface VerifyResult {
  success: boolean;
  transactionId: string;
  status: TransactionStatus;
  provider: ProviderName;
  providerRef: string;
  raw: unknown;
  error?: NormalizedError;
}

export type TransactionStatus =
  | "pending"
  | "authorized"
  | "captured"
  | "settled"
  | "refunded"
  | "failed"
  | "cancelled"
  | "expired";

export interface ChargePayload {
  provider: ProviderName;
  amount: number;
  currency: string;
  paymentMethod: string;
  description?: string;
  metadata?: Record<string, unknown>;
  customerId?: string;
}

export interface RefundPayload {
  provider: ProviderName;
  transactionId: string;
  amount?: number;
  reason?: string;
}

export interface VerifyPayload {
  provider: ProviderName;
  transactionId: string;
}

export interface WebhookPayload {
  provider: ProviderName;
  signature: string;
  body: unknown;
}

export interface WebhookResult {
  success: boolean;
  event: string;
  transactionId?: string;
  providerRef?: string;
  raw: unknown;
  error?: NormalizedError;
}

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs?: number;
  message?: string;
}

export interface IPaymentProvider {
  readonly name: ProviderName;

  charge(payload: ChargePayload, transactionId: string): Promise<PaymentResult>;
  refund(payload: RefundPayload, transactionId: string): Promise<RefundResult>;
  verify(payload: VerifyPayload, transactionId: string): Promise<VerifyResult>;
  verifyWebhook?(payload: WebhookPayload): Promise<WebhookResult>;
  healthCheck?(): Promise<HealthCheckResult>;
}
