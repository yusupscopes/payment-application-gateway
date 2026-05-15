export const db = {
  insert: () => ({
    values: () => Promise.resolve(),
  }),
  select: () => ({
    from: () => Promise.resolve([]),
  }),
};

export function createDb() {
  return db;
}

export const transactions = {
  id: "id",
  provider: "provider",
  providerRef: "provider_ref",
  operation: "operation",
  amount: "amount",
  currency: "currency",
  status: "status",
  rawResponse: "raw_response",
  errorCode: "error_code",
  errorMessage: "error_message",
  retryable: "retryable",
  createdAt: "created_at",
  updatedAt: "updated_at",
};

export const transactionLogs = {
  id: "id",
  transactionId: "transaction_id",
  level: "level",
  message: "message",
  metadata: "metadata",
  createdAt: "created_at",
};
