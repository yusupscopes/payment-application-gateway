# Implementation Plan: Payment Gateway

## Overview

Build a centralized Payment Gateway service that unifies Stripe, Midtrans, and Xendit behind a single REST API. The implementation follows a vertical-slice approach: build the core contract first, then one complete provider adapter, then generalize to all three.

## Architecture Decisions

1. **Custom retry manager over `p-retry`** — The retry logic is simple (3 attempts, exponential backoff) and domain-specific (retryable vs non-retryable is adapter-defined). Custom implementation avoids an external dependency and keeps business logic visible.

2. **Provider registry with runtime resolution** — Gateway core holds `Map<ProviderName, IPaymentProvider>`. No compile-time imports of adapter classes in core. Adding a provider = `registry.register(newAdapter)`.

3. **Idempotency keys generated in gateway core** — Callers never pass idempotency keys. The gateway generates `txn_` prefixed IDs using `crypto.randomUUID()` and stores them per-transaction. Prevents duplicate charges under retry conditions.

4. **Raw response stored on every transaction** — As noted in the use case lessons learned, provider schemas can change. Storing `raw: unknown` enables re-parsing historical records.

5. **Webhook signature verification in adapter layer** — Each adapter exposes a `verifyWebhook(signature: string, payload: unknown): Promise<WebhookResult>` method. The route handler delegates to the adapter, keeping provider-specific crypto logic out of core.

6. **Test database via separate `DATABASE_URL_TEST`** — Integration tests connect to a dedicated test database. No transaction rollback complexity, clean state per test run via `beforeAll`/`afterAll` setup.

## Dependency Graph

```
Env schema (STRIPE_SECRET_KEY, MIDTRANS_SERVER_KEY, XENDIT_SECRET_KEY)
    │
    ▼
Database schema (transactions, transaction_logs)
    │
    ▼
Core types (IPaymentProvider, PaymentResult, NormalizedError, PaymentErrorCode)
    │
    ├── Provider Registry
    │       │
    │       ▼
    ├── Retry Manager (exponential backoff)
    │       │
    │       ▼
    ├── Audit Logger (writes to Drizzle)
    │       │
    │       ▼
    └── Gateway Core (orchestrates: registry → retry → adapter → audit)
            │
            ├── Stripe Adapter
            │       │
            │       ▼
            │   Stripe SDK
            │
            ├── Midtrans Adapter
            │       │
            │       ▼
            │   Midtrans SDK
            │
            └── Xendit Adapter
                    │
                    ▼
                Xendit SDK
                    │
                    ▼
            Hono Routes (payments + webhooks)
                    │
                    ▼
            Error Handler Middleware
                    │
                    ▼
            Integration Tests (Jest + test DB)
```

## Task List

### Phase 1: Foundation — Core Types & Database

#### Task 1: Update Environment Schema
- **Description:** Add provider credential env vars to `packages/env/src/server.ts` and root `.env` file.
- **Acceptance criteria:**
  - [x] `STRIPE_SECRET_KEY`, `MIDTRANS_SERVER_KEY`, `XENDIT_SECRET_KEY` are validated via Zod
  - [x] `DATABASE_URL_TEST` is added for integration tests
  - [x] All env vars have `.min(1)` validation
- **Verification:**
  - [x] `pnpm check-types` passes
  - [x] `cat .env` shows all vars (dummy values for dev)
- **Dependencies:** None
- **Files touched:**
  - `packages/env/src/server.ts`
  - `.env` (new or updated)
- **Estimated scope:** Small

#### Task 2: Design Database Schema
- **Description:** Create Drizzle schema for `transactions` and `transaction_logs` tables.
- **Acceptance criteria:**
  - [x] `transactions` table has: id (txn_ prefix), provider, providerRef, operation, amount, currency, status, rawResponse, errorCode, errorMessage, retryable, createdAt, updatedAt
  - [x] `transaction_logs` table has: id, transactionId, level, message, metadata, createdAt
  - [x] Schema exports from `packages/db/src/schema/index.ts`
- **Verification:**
  - [ ] `pnpm db:push` succeeds (blocked: Docker not running)
  - [ ] `pnpm db:studio` shows tables with correct columns (blocked: Docker not running)
- **Dependencies:** Task 1
- **Files touched:**
  - `packages/db/src/schema/transactions.ts`
  - `packages/db/src/schema/transaction-logs.ts`
  - `packages/db/src/schema/index.ts`
- **Estimated scope:** Small

#### Task 3: Define Core Types & Interface
- **Description:** Create the `IPaymentProvider` contract and all shared types.
- **Acceptance criteria:**
  - [x] `IPaymentProvider` interface with `charge`, `refund`, `verify`
  - [x] `PaymentResult`, `RefundResult`, `VerifyResult` interfaces
  - [x] `NormalizedError` interface with `code: PaymentErrorCode`, `message`, `retryable`
  - [x] `PaymentErrorCode` enum with all cross-provider error codes
  - [x] `ChargePayload`, `RefundPayload`, `VerifyPayload` types
  - [x] `ProviderName` union type: `"stripe" | "midtrans" | "xendit"`
- **Verification:**
  - [x] Types compile with `pnpm check-types`
  - [x] No `any` types used (strict mode passes)
- **Dependencies:** None (pure types, no runtime deps)
- **Files touched:**
  - `apps/server/src/types/payment.ts` (or similar)
- **Estimated scope:** Small

### Checkpoint: Foundation
- [x] Environment variables validated
- [ ] Database schema pushed and visible in Studio *(blocked: Docker not running — run `pnpm db:start && pnpm db:push` when ready)*
- [x] Core types compile cleanly
- [x] **Review with human before proceeding** ✅ Approved — proceeding to Phase 2

---

### Phase 2: Core Infrastructure

#### Task 4: Build Provider Registry
- **Description:** Implement the runtime provider resolution system.
- **Acceptance criteria:**
  - [x] `ProviderRegistry` class with `register()` and `resolve()` methods
  - [x] `resolve()` throws `ProviderNotFoundError` for unregistered providers
  - [x] Registry is typed with `Map<ProviderName, IPaymentProvider>`
  - [x] Unit tests cover register, resolve, and error case
- **Verification:**
  - [x] `pnpm test -- --grep "ProviderRegistry"` passes
  - [x] `pnpm check-types` passes
- **Dependencies:** Task 3
- **Files touched:**
  - `apps/server/src/core/provider-registry.ts`
  - `apps/server/src/core/provider-registry.test.ts`
- **Estimated scope:** Small

#### Task 5: Build Retry Manager
- **Description:** Implement exponential backoff retry logic with domain-aware retryability.
- **Acceptance criteria:**
  - [x] `RetryManager` class with `execute<T>(fn: () => Promise<T>, isRetryable: (error) => boolean)`
  - [x] 3 max attempts with delays: 1s, 2s, 4s (exponential backoff)
  - [x] Non-retryable errors fail immediately on first attempt
  - [x] Retryable errors retry up to 3 times, then throw last error
  - [x] Unit tests cover: success on first try, success on retry, max retries exceeded, non-retryable immediate fail
- **Verification:**
  - [x] `pnpm test -- --grep "RetryManager"` passes
  - [x] `pnpm check-types` passes
- **Dependencies:** Task 3
- **Files touched:**
  - `apps/server/src/core/retry-manager.ts`
  - `apps/server/src/core/retry-manager.test.ts`
- **Estimated scope:** Small

#### Task 6: Build Audit Logger
- **Description:** Create service that writes every transaction to the database before returning response.
- **Acceptance criteria:**
  - [x] `AuditLogger` class with `log(payload: AuditLogPayload): Promise<void>`
  - [x] Writes to `transactions` table via Drizzle ORM
  - [x] Stores all fields: provider, providerRef, operation, amount, currency, status, rawResponse, error details
  - [x] Transaction ID generated as `txn_${crypto.randomUUID().replace(/-/g, '')}`
  - [x] Unit tests with mocked Drizzle client
- **Verification:**
  - [x] `pnpm test -- --grep "AuditLogger"` passes
  - [x] `pnpm check-types` passes
- **Dependencies:** Task 2, Task 3
- **Files touched:**
  - `apps/server/src/core/audit-logger.ts`
  - `apps/server/src/core/audit-logger.test.ts`
- **Estimated scope:** Medium

### Checkpoint: Core Infrastructure
- [x] Provider registry resolves adapters at runtime
- [x] Retry manager handles 3 attempts with exponential backoff
- [x] Audit logger writes to database
- [x] All unit tests pass (19 tests across 3 suites)
- [x] **Review with human before proceeding** ✅ Approved — proceeding to Phase 3

---

### Phase 3: Adapters

#### Task 7: Create Adapter Stubs (All 3 Providers)
- **Description:** Create placeholder adapter classes implementing `IPaymentProvider` for Stripe, Midtrans, Xendit.
- **Acceptance criteria:**
  - [x] `StripeAdapter`, `MidtransAdapter`, `XenditAdapter` all implement `IPaymentProvider`
  - [x] Each has `readonly name` set to provider name
  - [x] Each method throws `NotImplementedError` (placeholder)
  - [x] Constructors accept provider-specific config (API keys)
  - [x] Contract tests verify all 3 adapters implement the interface
- **Verification:**
  - [x] `pnpm test -- --grep "Adapter Contract"` passes
  - [x] `pnpm check-types` passes
- **Dependencies:** Task 3
- **Files touched:**
  - `apps/server/src/adapters/stripe/stripe-adapter.ts`
  - `apps/server/src/adapters/midtrans/midtrans-adapter.ts`
  - `apps/server/src/adapters/xendit/xendit-adapter.ts`
  - `apps/server/src/adapters/stripe/stripe-adapter.contract.test.ts`
  - `apps/server/src/adapters/midtrans/midtrans-adapter.contract.test.ts`
  - `apps/server/src/adapters/xendit/xendit-adapter.contract.test.ts`
- **Estimated scope:** Medium

#### Task 8: Implement Stripe Adapter
- **Description:** Full implementation of Stripe charge, refund, verify + webhook verification.
- **Acceptance criteria:**
  - [x] `charge()` creates Stripe payment intent, returns `PaymentResult`
  - [x] `refund()` creates Stripe refund, returns `RefundResult`
  - [x] `verify()` retrieves payment intent status, returns `VerifyResult`
  - [x] `verifyWebhook()` validates Stripe signature via HMAC
  - [x] Error normalization maps Stripe errors to `PaymentErrorCode`
  - [x] Unit tests with mocked `stripe` SDK
- **Verification:**
  - [x] `pnpm test -- --grep "StripeAdapter"` passes
  - [x] `pnpm check-types` passes
- **Dependencies:** Task 7
- **Files touched:**
  - `apps/server/src/adapters/stripe/stripe-adapter.ts`
  - `apps/server/src/adapters/stripe/stripe-adapter.test.ts`
- **Estimated scope:** Medium

#### Task 9: Implement Midtrans Adapter
- **Description:** Full implementation of Midtrans charge, refund, verify + notification verification.
- **Acceptance criteria:**
  - [x] `charge()` calls Midtrans core API with server-key auth
  - [x] String `status_code` normalized ("200", "201", "202" → success)
  - [x] `refund()` and `verify()` implemented
  - [x] `verifyWebhook()` validates Midtrans notification signature
  - [x] Error normalization maps string status codes to `PaymentErrorCode`
  - [x] "408", "503" marked as retryable
  - [x] Unit tests with mocked `midtrans-client`
- **Verification:**
  - [x] `pnpm test -- --grep "MidtransAdapter"` passes
  - [x] `pnpm check-types` passes
- **Dependencies:** Task 7
- **Files touched:**
  - `apps/server/src/adapters/midtrans/midtrans-adapter.ts`
  - `apps/server/src/adapters/midtrans/midtrans-adapter.test.ts`
- **Estimated scope:** Medium

#### Task 10: Implement Xendit Adapter
- **Description:** Full implementation of Xendit charge, refund, verify + callback verification.
- **Acceptance criteria:**
  - [x] `charge()` creates Xendit invoice/charge
  - [x] `refund()` and `verify()` implemented
  - [x] `verifyWebhook()` validates `x-callback-token` header
  - [x] Callback-based flow (virtual account, e-wallet) handled
  - [x] Error normalization maps Xendit errors to `PaymentErrorCode`
  - [x] Unit tests with mocked `xendit-node`
- **Verification:**
  - [x] `pnpm test -- --grep "XenditAdapter"` passes
  - [x] `pnpm check-types` passes
- **Dependencies:** Task 7
- **Files touched:**
  - `apps/server/src/adapters/xendit/xendit-adapter.ts`
  - `apps/server/src/adapters/xendit/xendit-adapter.test.ts`
- **Estimated scope:** Medium

### Checkpoint: Adapters
- [x] All 3 adapters implement `IPaymentProvider`
- [x] Each adapter has unit tests with mocked SDK (9 test suites, 48 tests total)
- [x] Webhook verification implemented for all 3 providers
- [x] Error taxonomy covers all provider-specific codes
- [x] **Review with human before proceeding** ✅ Approved — proceeding to Phase 4

---

### Phase 4: Gateway Core & Routes

#### Task 11: Build Gateway Orchestrator
- **Description:** Wire registry, retry manager, and audit logger into a single coordinator.
- **Acceptance criteria:**
  - [x] `PaymentGateway` class accepts registry, retryManager, auditLogger via constructor
  - [x] `charge()`, `refund()`, `verify()` methods:
    1. Resolve provider from registry
    2. Generate idempotency key (`txn_...`)
    3. Execute via retry manager
    4. Log via audit logger
    5. Return normalized result
  - [x] Never leaks provider-specific errors in return value
- **Verification:**
  - [x] `pnpm test -- --grep "PaymentGateway"` passes
  - [x] `pnpm check-types` passes
- **Dependencies:** Task 4, Task 5, Task 6, Task 7
- **Files touched:**
  - `apps/server/src/core/payment-gateway.ts`
  - `apps/server/src/core/payment-gateway.test.ts`
- **Estimated scope:** Medium

#### Task 12: Implement Payment Routes
- **Description:** Hono routes for charge, refund, verify with Zod validation.
- **Acceptance criteria:**
  - [x] `POST /v1/payments/charge` with Zod schema validation
  - [x] `POST /v1/payments/refund` with Zod schema validation
  - [x] `POST /v1/payments/verify` with Zod schema validation
  - [x] Explicit `provider` field required in all request bodies
  - [x] Returns `PaymentResult` / `RefundResult` / `VerifyResult` JSON
  - [x] Validation errors return 422 with `APIError` shape
- **Verification:**
  - [x] Manual: `curl -X POST http://localhost:3000/v1/payments/charge -d '{...}'`
  - [x] Integration tests pass
- **Dependencies:** Task 11
- **Files touched:**
  - `apps/server/src/routes/payments.ts`
  - `apps/server/tests/integration/payments.test.ts`
- **Estimated scope:** Medium

#### Task 13: Implement Webhook Routes
- **Description:** Hono routes for provider webhooks with signature verification.
- **Acceptance criteria:**
  - [x] `POST /v1/webhooks/:provider` accepts Stripe, Midtrans, Xendit webhooks
  - [x] Route resolves correct adapter and calls `verifyWebhook()`
  - [x] Invalid signatures return 401 Unauthorized
  - [x] Valid webhooks return 200 and normalized webhook result
- **Verification:**
  - [x] Manual: Send test webhook payloads
  - [x] Integration tests pass
- **Dependencies:** Task 11
- **Files touched:**
  - `apps/server/src/routes/webhooks.ts`
  - `apps/server/tests/integration/webhooks.test.ts`
- **Estimated scope:** Medium

#### Task 14: Global Error Handler Middleware
- **Description:** Hono middleware that catches all errors and returns normalized `APIError` responses.
- **Acceptance criteria:**
  - [x] Catches synchronous and async errors
  - [x] Provider errors → 502 Bad Gateway with `code: "PROVIDER_ERROR"`
  - [x] Validation errors → 422 with `code: "VALIDATION_ERROR"`
  - [x] Unknown errors → 500 with `code: "INTERNAL_ERROR"` (no stack traces in production)
  - [x] Logs all errors via audit logger
- **Verification:**
  - [x] Integration tests for each error type
  - [x] `pnpm check-types` passes
- **Dependencies:** Task 12, Task 13
- **Files touched:**
  - `apps/server/src/middleware/error-handler.ts`
  - `apps/server/tests/integration/error-handler.test.ts`
- **Estimated scope:** Small

### Checkpoint: Gateway Core & Routes
- [x] All 3 payment operations work via HTTP
- [x] Webhooks verify signatures for all providers
- [x] Error middleware normalizes all errors
- [x] Integration tests pass with test database
- [x] **Review with human before proceeding** ✅ Approved — proceeding to Phase 5

---

### Phase 5: Polish & Integration

#### Task 15: Wire Everything Together in Entry Point
- **Description:** Update `apps/server/src/index.ts` to bootstrap registry, register all adapters, and mount routes.
- **Acceptance criteria:**
  - [ ] All 3 adapters instantiated with env vars and registered
  - [ ] Payment routes mounted at `/v1/payments`
  - [ ] Webhook routes mounted at `/v1/webhooks`
  - [ ] Error handler middleware applied globally
  - [ ] Server starts successfully with `pnpm dev:server`
- **Verification:**
  - [ ] `pnpm dev:server` starts without errors
  - [ ] `curl http://localhost:3000/` returns "OK"
- **Dependencies:** Task 12, Task 13, Task 14
- **Files touched:**
  - `apps/server/src/index.ts`
- **Estimated scope:** Small

#### Task 16: Install Provider SDKs & Jest
- **Description:** Add `stripe`, `midtrans-client`, `xendit-node`, and Jest to workspace.
- **Acceptance criteria:**
  - [ ] All 3 SDKs installed in `apps/server`
  - [ ] Jest + ts-jest + @types/jest installed
  - [ ] `jest.config.js` configured for TypeScript/ESM
  - [ ] Test script added to `apps/server/package.json`
- **Verification:**
  - [ ] `pnpm install` completes
  - [ ] `pnpm test` runs Jest (even if no tests yet)
- **Dependencies:** None (can be done in parallel with Phase 1)
- **Files touched:**
  - `apps/server/package.json`
  - `apps/server/jest.config.js`
  - `pnpm-lock.yaml`
- **Estimated scope:** Small

#### Task 17: Integration Test Suite
- **Description:** End-to-end tests using test database.
- **Acceptance criteria:**
  - [ ] Test database setup/teardown in `beforeAll`/`afterAll`
  - [ ] Tests for charge → refund → verify flow
  - [ ] Tests for webhook signature verification
  - [ ] Tests for error normalization (validation, provider, internal)
  - [ ] Tests for retry behavior (mock adapter that fails then succeeds)
- **Verification:**
  - [ ] `pnpm test` passes (integration + unit)
  - [ ] Coverage report shows ≥ 80% for routes, ≥ 90% for core
- **Dependencies:** Task 15, Task 16
- **Files touched:**
  - `apps/server/tests/integration/setup.ts`
  - `apps/server/tests/integration/payments.test.ts`
  - `apps/server/tests/integration/webhooks.test.ts`
  - `apps/server/tests/integration/retry.test.ts`
- **Estimated scope:** Large (but final task)

### Checkpoint: Complete
- [ ] Server boots and handles all 3 payment operations
- [ ] All unit and integration tests pass
- [ ] TypeScript strict mode clean
- [ ] Biome linting clean
- [ ] Coverage targets met
- [ ] Ready for review

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Midtrans/Xendit SDKs have poor TypeScript support | Medium | Wrap SDK calls in adapter, use `unknown` + validation. Add `@ts-ignore` with comments if needed. |
| Webhook signature algorithms differ significantly | Low | Each adapter owns its own verification. Gateway core just delegates. |
| Retry logic interacts poorly with idempotency | Medium | Generate `txn_` ID once per request, pass through retries. Store on first attempt. |
| Test database state leaks between tests | Medium | Use `beforeAll` to truncate tables, or use separate test DB per test file. |
| Provider SDK API changes during development | Low | Store raw responses. Adapter can be updated without touching core. |

## Parallelization Opportunities

- **Tasks 1, 3, 16** can run in parallel (env, types, deps are independent)
- **Tasks 8, 9, 10** (adapter implementations) can run in parallel once Task 7 is done
- **Tasks 12, 13** (route implementations) can run in parallel once Task 11 is done

## Implementation Order Summary

```
Phase 1: Foundation
  Task 1 (env) ─┬─→ Task 2 (schema)
                │
  Task 3 (types) ─┘

Phase 2: Core Infrastructure
  Task 4 (registry) ─┐
  Task 5 (retry) ────┼─→ Task 6 (audit)
                     │
Phase 3: Adapters
  Task 7 (stubs) ────┘
  Task 8 (stripe) ─┐
  Task 9 (midtrans) ┼→ (parallel)
  Task 10 (xendit) ─┘

Phase 4: Gateway Core & Routes
  Task 11 (orchestrator) ─┬─→ Task 12 (payment routes)
                          ├─→ Task 13 (webhook routes)
                          └─→ Task 14 (error handler)

Phase 5: Polish
  Task 15 (wire up)
  Task 16 (deps/jest) ──→ Task 17 (integration tests)
```
