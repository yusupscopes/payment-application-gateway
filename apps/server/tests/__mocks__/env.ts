export const env = {
  DATABASE_URL:
    "postgresql://postgres:password@localhost:5432/payment-application-gateway",
  DATABASE_URL_TEST:
    "postgresql://postgres:password@localhost:5432/payment-application-gateway-test",
  CORS_ORIGIN: "http://localhost:3001",
  NODE_ENV: "test",
  STRIPE_SECRET_KEY: "sk_test_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_test_placeholder",
  MIDTRANS_SERVER_KEY: "midtrans_test_placeholder",
  XENDIT_SECRET_KEY: "xendit_test_placeholder",
  API_KEYS: "test-api-key-1,test-api-key-2",
  REDIS_URL: "redis://localhost:6379",
};
