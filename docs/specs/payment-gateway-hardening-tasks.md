# Tasks: Payment Gateway Production Hardening

## Phase 1: Security & Reliability

---

### Task 1.1: Add Redis to Docker Compose & Create Redis Package
- **Description:** Add Redis service to the existing Docker Compose and create a shared `packages/redis` package for the monorepo.
- **Acceptance:** `docker compose up -d` starts both PostgreSQL and Redis. `packages/redis` exports a typed Redis client factory.
- **Verify:** `docker compose ps` shows both services running. `pnpm check-types` passes for `packages/redis`.
- **Files:**
  - `packages/db/docker-compose.yml` (or root `docker-compose.yml`)
  - `packages/redis/package.json`
  - `packages/redis/src/index.ts`
  - `packages/redis/tsconfig.json`

---

### Task 1.2: Fix Stripe Webhook Verification
- **Description:** Update `StripeAdapter` to use a separate `webhookSecret` for signature verification instead of the API `secretKey`.
- **Acceptance:** `StripeAdapter.verifyWebhook` passes `webhookSecret` to `constructEvent`. `app.ts` injects `env.STRIPE_WEBHOOK_SECRET`. Tests verify signature validation.
- **Verify:** `pnpm test -- stripe-adapter` passes. Contract test covers both valid and invalid signatures.
- **Files:**
  - `packages/env/src/server.ts`
  - `apps/server/src/adapters/stripe/stripe-adapter.ts`
  - `apps/server/src/app.ts`
  - `apps/server/src/adapters/stripe/stripe-adapter.test.ts`
  - `apps/server/src/adapters/stripe/stripe-adapter.contract.test.ts`

---

### Task 1.3: Fix Midtrans Webhook Verification
- **Description:** Implement actual signature verification in `MidtransAdapter.verifyWebhook` instead of the no-op stub.
- **Acceptance:** Midtrans webhook notifications are verified against the server-key hash before acceptance. Invalid signatures return `401`.
- **Verify:** `pnpm test -- midtrans-adapter` passes. Contract test verifies signature check.
- **Files:**
  - `apps/server/src/adapters/midtrans/midtrans-adapter.ts`
  - `apps/server/src/adapters/midtrans/midtrans-adapter.test.ts`
  - `apps/server/src/adapters/midtrans/midtrans-adapter.contract.test.ts`

---

### Task 1.4: Capture Raw Webhook Body Before Parsing
- **Description:** Update the webhook route to read raw body text before JSON parsing so HMAC verification has exact bytes.
- **Acceptance:** Webhook route uses `c.req.text()` first, then `JSON.parse()` if needed. All provider webhook tests still pass.
- **Verify:** `pnpm test -- webhooks` passes. Integration test confirms raw body matches signature.
- **Files:**
  - `apps/server/src/routes/webhooks.ts`
  - `apps/server/tests/integration/webhooks.test.ts`

---

### Task 1.5: Add Jitter to Retry Manager
- **Description:** Add randomized jitter (0-50%) to `RetryManager` exponential backoff.
- **Acceptance:** `calculateBackoff(attempt)` exists and returns values with jitter. Unit tests confirm jitter range.
- **Verify:** `pnpm test -- retry-manager` passes. Test checks that jittered delay is ≥ base and ≤ base * 1.5.
- **Files:**
  - `apps/server/src/core/retry-manager.ts`
  - `apps/server/src/core/retry-manager.test.ts`

---

### Task 1.6: Add Circuit Breaker
- **Description:** Create a standalone circuit breaker module and integrate it into `PaymentGateway`.
- **Acceptance:** `CircuitBreaker` has `Closed/Open/HalfOpen` states. Opens after 5 failures in 60s. Closes after 30s + 1 success. When open, provider calls return `GATEWAY_ERROR` immediately.
- **Verify:** `pnpm test -- circuit-breaker` passes. Integration test confirms open circuit behavior on payment route.
- **Files:**
  - `apps/server/src/core/circuit-breaker.ts`
  - `apps/server/src/core/circuit-breaker.test.ts`
  - `apps/server/src/core/payment-gateway.ts`
  - `apps/server/src/core/payment-gateway.test.ts`

---

### Task 1.7: Add API Key Authentication Middleware
- **Description:** Create middleware that validates `x-api-key` header against configured keys.
- **Acceptance:** `api-key-auth.ts` rejects missing/invalid keys with `401 UNAUTHORIZED` in normalized error shape. Valid keys proceed. Applied to `/v1/payments/*`.
- **Verify:** `pnpm test -- payments.test` passes (existing tests updated with valid API key). New integration tests cover missing/invalid keys.
- **Files:**
  - `packages/env/src/server.ts`
  - `apps/server/src/middleware/api-key-auth.ts`
  - `apps/server/src/routes/payments.ts`
  - `apps/server/tests/integration/payments.test.ts`
  - `apps/server/src/app.ts`

---

### Task 1.8: Add Per-API-Key Rate Limiting
- **Description:** Apply Redis-backed rate limiting to payment routes, keyed by API key.
- **Acceptance:** `rate-limiter.ts` uses `hono-rate-limiter` with Redis store. Default: 100 req/60s per API key. Returns `429` when exceeded. Webhooks are not rate-limited.
- **Verify:** Integration tests confirm 429 after threshold. Tests use `ioredis-mock` (no Docker needed in CI).
- **Files:**
  - `apps/server/src/middleware/rate-limiter.ts`
  - `apps/server/src/routes/payments.ts`
  - `apps/server/tests/integration/payments.test.ts`
  - `apps/server/package.json` (add `hono-rate-limiter`)
  - `packages/redis/src/index.ts` (if rate limiter uses shared client)

---

## Phase 2: Core Refactoring

---

### Task 2.1: Extract `executeOperation()` in PaymentGateway
- **Description:** DRY up the identical retry/audit/error logic in `charge()`, `refund()`, `verify()` into a single private helper.
- **Acceptance:** `PaymentGateway` has a private `executeOperation()` method. `charge/refund/verify` are one-liner delegations. Audit log is written once, after final result (not inside retry loop).
- **Verify:** `pnpm test -- payment-gateway` passes. Integration test confirms no duplicate audit records on retry.
- **Files:**
  - `apps/server/src/core/payment-gateway.ts`
  - `apps/server/src/core/payment-gateway.test.ts`
  - `apps/server/tests/integration/payments.test.ts`
  - `apps/server/src/core/audit-logger.ts` (if interface changes)

---

### Task 2.2: Remove Adapter-Side Transaction ID Generation
- **Description:** Gateway generates `txn_` IDs and passes them to adapters. Adapters stop generating their own.
- **Acceptance:** `IPaymentProvider` interface passes `transactionId` to all operations. Adapters' `generateTransactionId()` methods are removed. All tests pass.
- **Verify:** `pnpm test` passes. No `generateTransactionId` found in `src/adapters/`.
- **Files:**
  - `apps/server/src/types/payment.ts`
  - `apps/server/src/core/payment-gateway.ts`
  - `apps/server/src/adapters/stripe/stripe-adapter.ts`
  - `apps/server/src/adapters/midtrans/midtrans-adapter.ts`
  - `apps/server/src/adapters/xendit/xendit-adapter.ts`
  - All adapter `.test.ts` files

---

### Task 2.3: Refactor Webhook Route Provider Validation
- **Description:** Replace hardcoded provider name checks in `webhooks.ts` with `registry.hasProvider()`.
- **Acceptance:** `ProviderRegistry.hasProvider()` exists. Webhook route uses it. No inline `providerName !== "stripe"` checks remain.
- **Verify:** `pnpm test -- provider-registry` and `pnpm test -- webhooks` pass.
- **Files:**
  - `apps/server/src/core/provider-registry.ts`
  - `apps/server/src/core/provider-registry.test.ts`
  - `apps/server/src/routes/webhooks.ts`
  - `apps/server/tests/integration/webhooks.test.ts`

---

### Task 2.4: Improve Route Test Coverage to ≥ 85%
- **Description:** Add integration tests for error scenarios, rate limiting, and correlation IDs to bring route coverage up.
- **Acceptance:** `pnpm test -- --coverage` shows route coverage ≥ 85%.
- **Verify:** Coverage report confirms `routes/` at ≥ 85%.
- **Files:**
  - `apps/server/tests/integration/payments.test.ts`
  - `apps/server/tests/integration/errors.test.ts`
  - `apps/server/tests/integration/webhooks.test.ts`

---

## Phase 3: Observability & Async Webhooks

---

### Task 3.1: Add Health Endpoint
- **Description:** Create `GET /health` that checks provider connectivity and returns per-provider status.
- **Acceptance:** `routes/health.ts` exists. Returns `200` when all providers are reachable, `503` when any critical provider is down. Includes provider-specific status.
- **Verify:** `pnpm test -- health` passes (new test file). Manual `curl http://localhost:3000/health` works.
- **Files:**
  - `apps/server/src/routes/health.ts`
  - `apps/server/src/routes/health.test.ts`
  - `apps/server/src/app.ts`

---

### Task 3.2: Add Correlation ID Middleware
- **Description:** Generate or accept correlation IDs per request and propagate them.
- **Acceptance:** `middleware/correlation-id.ts` generates `x-correlation-id` or uses incoming header. Stored in Hono context. Returned in response headers. Passed to audit logger.
- **Verify:** Integration tests confirm correlation ID in response headers and audit records.
- **Files:**
  - `apps/server/src/middleware/correlation-id.ts`
  - `apps/server/src/app.ts`
  - `apps/server/src/core/audit-logger.ts`
  - `apps/server/tests/integration/payments.test.ts`

---

### Task 3.3: Add Prometheus Metrics
- **Description:** Instrument the gateway with `prom-client` and expose `/metrics`.
- **Acceptance:** `core/metrics.ts` defines operation latency histogram, retry counter, error counter. `PaymentGateway` records metrics. `GET /metrics` returns Prometheus text format.
- **Verify:** Unit tests confirm counters increment. Integration test fetches `/metrics` and checks for expected metrics.
- **Files:**
  - `apps/server/src/core/metrics.ts`
  - `apps/server/src/core/metrics.test.ts`
  - `apps/server/src/core/payment-gateway.ts`
  - `apps/server/src/routes/health.ts` (add `/metrics` here or new file)
  - `apps/server/src/app.ts`
  - `apps/server/package.json` (add `prom-client`)

---

### Task 3.4: Add BullMQ Webhook Queue
- **Description:** Accept webhooks synchronously (verify signature, return 202), process asynchronously via BullMQ worker.
- **Acceptance:** `queue/webhook-queue.ts` creates BullMQ queue. `queue/queue-worker.ts` processes events. Webhook route enqueues after verification. Worker retries failed processing 3x with backoff. Graceful degradation if Redis unavailable.
- **Verify:** Integration test: POST webhook → 202 Accepted → worker processes → audit log updated.
- **Files:**
  - `apps/server/src/queue/webhook-queue.ts`
  - `apps/server/src/queue/queue-worker.ts`
  - `apps/server/src/queue/queue.test.ts`
  - `apps/server/src/routes/webhooks.ts`
  - `apps/server/tests/integration/webhooks.test.ts`
  - `apps/server/src/app.ts`
  - `apps/server/package.json` (add `bullmq`)

---

## Task Dependency Graph

```
Phase 1
├── 1.1 Redis/Docker (no deps)
├── 1.2 Stripe webhook fix (no deps)
├── 1.3 Midtrans webhook fix (no deps)
├── 1.4 Raw body capture (no deps)
├── 1.5 Jitter (no deps)
├── 1.6 Circuit breaker (no deps)
├── 1.7 API key auth (no deps)
└── 1.8 Rate limiting (depends on 1.1, 1.7)

Phase 2
├── 2.1 executeOperation (depends on Phase 1)
├── 2.2 Adapter tx ID removal (depends on 2.1)
├── 2.3 Webhook route refactor (no deps)
└── 2.4 Route coverage (depends on 1.7, 1.8, 2.1, 2.3)

Phase 3
├── 3.1 Health endpoint (no deps)
├── 3.2 Correlation ID (no deps)
├── 3.3 Metrics (no deps)
└── 3.4 BullMQ queue (depends on 1.1)
```

**Parallel groups (no shared files, no dependency order):**
- Group A: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
- Group B: 3.1, 3.2, 3.3
