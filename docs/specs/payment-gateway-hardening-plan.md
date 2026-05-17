# Plan: Payment Gateway Production Hardening

## Overview

This plan implements the spec in three sequential phases, with each phase producing a working, testable increment. The phases are ordered by risk: security fixes first, then refactoring, then observability.

**Implementation order:** Sequential within each phase, but Phase 2 can begin immediately after Phase 1's security fixes are merged. Phase 3 observability work is largely additive (new files) and can overlap with Phase 2 refactoring if desired.

---

## Phase 1: Security & Reliability Fixes

### 1.1 Fix Webhook Verification
**What:** Correct broken webhook verification for Stripe and Midtrans, and preserve raw request body.

**Dependencies:**
- `STRIPE_WEBHOOK_SECRET` env var (new — ask first per boundaries)
- No other phase dependencies

**Implementation order:**
1. Add `STRIPE_WEBHOOK_SECRET` to `packages/env/src/server.ts` (optional, with fallback)
2. Update `StripeAdapter` constructor to accept `webhookSecret` alongside `secretKey`
3. Change `verifyWebhook` to pass `webhookSecret` to `constructEvent`
4. Implement Midtrans webhook signature verification using server-key hash check
5. Update webhook route to capture raw body (`c.req.text()` before `c.req.json()`)
6. Update `app.ts` to inject webhook secrets into adapters
7. Add contract + integration tests for both providers

**Risk:** Stripe test suite may fail if webhook secret is not configured in test env. Mitigate by making it optional in dev and required in production (validated at startup).

---

### 1.2 Add Jitter to Retry Manager
**What:** Modify `RetryManager` to add randomized jitter to exponential backoff.

**Dependencies:** None

**Implementation order:**
1. Add `calculateBackoff(attempt)` private method with 0-50% jitter
2. Update `execute()` to use new method
3. Add unit tests verifying jitter range and monotonic increase

**Risk:** Minimal — localized change with clear test coverage.

---

### 1.3 Add Circuit Breaker
**What:** Wrap provider calls in a circuit breaker to prevent cascading failures.

**Dependencies:** None (standalone core module)

**Implementation order:**
1. Create `core/circuit-breaker.ts` with states: `Closed`, `Open`, `HalfOpen`
2. Threshold: 5 failures in 60s → Open for 30s (configurable)
3. Integrate into `PaymentGateway` by wrapping `registry.resolve()` calls
4. When circuit is open, return `GATEWAY_ERROR` with `retryable: true` immediately
5. Add unit tests for state transitions and threshold behavior

**Risk:** Must not interfere with existing retry logic. Circuit breaker should wrap the *entire* provider call (including retries), not replace retries.

---

### 1.4 Add API Key Authentication
**What:** Require `x-api-key` header on payment routes, validate against configured keys.

**Dependencies:** None

**Implementation order:**
1. Add `API_KEYS` env var (comma-separated or JSON) to `packages/env`
2. Create `middleware/api-key-auth.ts` that validates header against allowed keys
3. Apply middleware to `/v1/payments/*` routes (not webhooks — providers don't send API keys)
4. Return `401 UNAUTHORIZED` with normalized error shape on invalid/missing key
5. Add integration tests for valid key, missing key, invalid key

**Risk:** This is a breaking behavioral change for existing consumers. Must be clearly documented in README and changelog.

---

### 1.5 Add Per-API-Key Rate Limiting
**What:** Rate limit payment operations per API key using Redis.

**Dependencies:** API key auth (1.4), Redis package

**Implementation order:**
1. Create `packages/redis` shared package with `ioredis` client
2. Add Redis to `docker-compose.yml`
3. Create `middleware/rate-limiter.ts` using `hono-rate-limiter` with Redis store
4. Default: 100 requests per 60s window per API key (configurable via env)
5. Return `429 TOO_MANY_REQUESTS` on exceeded limit
6. Add integration tests with mocked Redis (`ioredis-mock`)

**Risk:** Redis must be available in test environment. Use `ioredis-mock` for unit/integration tests to avoid Docker dependency in CI.

---

## Phase 2: Core Refactoring

### 2.1 Extract `executeOperation()` in `PaymentGateway`
**What:** DRY up the identical retry/audit/error logic in `charge()`, `refund()`, `verify()`.

**Dependencies:** Phase 1 complete (so audit logging behavior is stable before we refactor it)

**Implementation order:**
1. Create private `executeOperation<T>(operation, payload, auditContext)` method
2. Move retry wrapper, error throw, and audit log call into helper
3. Refactor `charge/refund/verify` to one-liner delegation
4. Ensure audit log is written *after* the retry loop, not inside it

**Risk:** The audit log timing change (from inside retry loop to after) is behaviorally different. Must verify with integration tests that retries no longer produce duplicate audit records.

---

### 2.2 Remove Adapter-Side Transaction ID Generation
**What:** Adapters should use the gateway-generated `txn_` ID, not generate their own.

**Dependencies:** Phase 2.1 (so gateway passes the ID to adapters consistently)

**Implementation order:**
1. Add `transactionId` to `ChargePayload`, `RefundPayload`, `VerifyPayload` (or pass separately)
2. Update `IPaymentProvider` methods to accept transaction ID
3. Remove `generateTransactionId()` from `StripeAdapter`, `MidtransAdapter`, `XenditAdapter`
4. Update all adapter tests

**Risk:** Breaking change to adapter interface. All adapters and mocks must be updated simultaneously.

---

### 2.3 Fix Webhook Route Provider Validation
**What:** Stop hardcoding provider names in `webhooks.ts`.

**Dependencies:** None

**Implementation order:**
1. Add `hasProvider(name: ProviderName): boolean` to `ProviderRegistry`
2. Update webhook route to use `registry.hasProvider()` instead of inline checks
3. Add unit test for `hasProvider`

**Risk:** Minimal.

---

### 2.4 Improve Route Test Coverage
**What:** Bring route coverage from 70% to ≥ 85%.

**Dependencies:** Phase 1 + 2.1, 2.2, 2.3 (routes should be fully featured before deep testing)

**Implementation order:**
1. Add integration tests for error scenarios (validation errors, provider not found, provider errors)
2. Add tests for rate limiting behavior on payment routes
3. Add tests for correlation ID propagation

---

## Phase 3: Observability & Async Webhooks

### 3.1 Add Health Endpoint
**What:** `GET /health` with per-provider connectivity checks.

**Dependencies:** None (standalone route)

**Implementation order:**
1. Create `routes/health.ts` with `GET /health`
2. Attempt lightweight provider operations (Stripe balance, Midtrans status ping, Xendit ping)
3. Return JSON with per-provider `status: "healthy" | "unhealthy"` and overall `status`
4. Return `503` if any critical provider is down
5. Add integration tests

---

### 3.2 Add Correlation ID Middleware
**What:** Generate and propagate correlation IDs for end-to-end request tracing.

**Dependencies:** None

**Implementation order:**
1. Create `middleware/correlation-id.ts` — generates `x-correlation-id` or uses incoming header
2. Store in Hono context (`c.set("correlationId", id)`)
3. Pass to adapters via context or explicit parameter
4. Include correlation ID in audit log records
5. Return correlation ID in response headers

---

### 3.3 Add Prometheus Metrics
**What:** Expose `/metrics` endpoint with operation latency, retry count, error rates.

**Dependencies:** None

**Implementation order:**
1. Create `core/metrics.ts` using `prom-client`
2. Define histogram: `gateway_operation_duration_seconds` (labels: provider, operation, status)
3. Define counter: `gateway_retries_total` (labels: provider, operation)
4. Define counter: `gateway_errors_total` (labels: provider, code)
5. Instrument `PaymentGateway` to record metrics around provider calls
6. Add `GET /metrics` route
7. Add unit tests for metric recording

---

### 3.4 Add BullMQ Webhook Queue
**What:** Accept webhooks synchronously, process asynchronously.

**Dependencies:** Redis package (Phase 1.5)

**Implementation order:**
1. Create `queue/webhook-queue.ts` — BullMQ queue + producer
2. Create `queue/queue-worker.ts` — BullMQ worker that processes webhook events
3. Update webhook route: verify signature synchronously, enqueue for async processing, return `202 Accepted`
4. Worker calls provider webhook handlers and writes audit log for webhook events
5. Add retry logic for failed webhook processing (3 attempts with backoff)
6. Add unit tests with mocked BullMQ
7. Add integration test for full async webhook flow

**Risk:** BullMQ adds a Redis dependency. Must fail gracefully if Redis is unavailable (fall back to synchronous processing or return `503`).

---

## Parallelization Opportunities

| Parallel Group | Tasks |
|----------------|-------|
| Group A (no deps) | 1.2 Jitter, 1.3 Circuit Breaker, 1.4 API Key Auth, 3.1 Health, 3.2 Correlation ID, 3.3 Metrics |
| Group B (needs 1.4 + Redis) | 1.1 Webhook fixes, 1.5 Rate Limiting, 3.4 BullMQ Queue |
| Group C (needs Phase 1) | 2.1 executeOperation, 2.3 Webhook route refactor, 2.4 Route coverage |
| Group D (needs 2.1) | 2.2 Adapter tx ID removal |

**Suggested sprint structure:**
- **Sprint 1:** Group A + Group B (Phase 1)
- **Sprint 2:** Group C + Group D (Phase 2)
- **Sprint 3:** Remaining Phase 3 tasks (if any not done in Sprint 1)

---

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| BullMQ dependency breaks tests without Redis | High | Use `ioredis-mock` or BullMQ's built-in in-memory mode for tests |
| API key auth breaks existing consumers | Medium | Document clearly; provide migration guide; make keys configurable via env |
| Audit log timing change loses retry visibility | Medium | Add a separate retry audit log (or structured log) if retry visibility is needed |
| Circuit breaker false-positives on transient errors | Medium | Conservative defaults (5 failures/60s); monitor and tune in production |
| Raw body capture changes Hono request handling | Low | Use `c.req.text()` which preserves body; tested with Hono 4.x |

---

## Verification Checkpoints

| Checkpoint | When | Verify With |
|-----------|------|-------------|
| Phase 1 complete | After 1.5 | `pnpm test` passes, webhook integration tests pass, rate limiting integration tests pass |
| Phase 2 complete | After 2.4 | `pnpm test -- --coverage` shows route coverage ≥ 85%, no duplicate audit records in integration tests |
| Phase 3 complete | After 3.4 | `pnpm test` passes, `/health` returns correct status, `/metrics` exposes expected counters, async webhook test passes |
