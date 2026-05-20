# Implementation Plan: Operational Readiness for Payment Gateway

## Overview

Add production-grade operational behaviors to the payment gateway: graceful shutdown with LB drain signaling, structured JSON logging via pino with `messageKey: "message"`, request/response logging middleware, Redis-backed webhook deduplication (72h TTL), and per-route body size limits. Every operational concern is built end-to-end before moving to the next, leaving the system in a working state after each task.

## Architecture Decisions

1. **Logger returns from `createApp()`** — `createApp()` will return `{ app, db, redisClient, webhookQueue, webhookWorker }` so `index.ts` can close resources during shutdown. This is the minimal change to the factory pattern.
2. **Body size limits use Hono's built-in `bodyLimit` middleware** — Hono 4.x has `hono/body-limit` which is simpler and more reliable than custom parsing. We configure it per-route with different limits.
3. **Webhook dedup is inline in the webhook route** — No separate module needed. The dedup logic is 10-15 lines: extract key, check Redis `SET NX EX`, return `200` if already processed.
4. **Request logger replaces `hono/logger()` in all environments** — The spec suggests coexistence, but having different log formats between dev and prod is confusing. We'll use pino-based request logging everywhere, with `debug` level for payment bodies.
5. **`pino` added as a runtime dependency** — The spec already approved this. It's the standard for Node.js structured logging.

## Task List

### Phase 1: Foundation

- [ ] **Task 1: Add operational env vars to packages/env**
  - **Description:** Add `LOG_LEVEL`, `LOG_WEBHOOK_BODIES`, `SHUTDOWN_TIMEOUT_MS`, and `WEBHOOK_DEDUP_TTL_HOURS` to the server env schema with sensible defaults.
  - **Acceptance criteria:**
    - [ ] `LOG_LEVEL` validates as a zod enum of pino levels, defaults to `info`
    - [ ] `LOG_WEBHOOK_BODIES` validates as zod boolean, defaults to `false`
    - [ ] `SHUTDOWN_TIMEOUT_MS` validates as zod number (coerced from string), defaults to `10000`
    - [ ] `WEBHOOK_DEDUP_TTL_HOURS` validates as zod number (coerced from string), defaults to `72`
    - [ ] `pnpm check-types` passes for `packages/env`
  - **Verification:**
    - [ ] `pnpm check-types` passes
    - [ ] Manual: `console.log(env.LOG_LEVEL)` in a test script returns `"info"`
  - **Dependencies:** None
  - **Files:** `packages/env/src/server.ts`
  - **Estimated scope:** Small (1 file)

- [ ] **Task 2: Create pino logger with AsyncLocalStorage integration**
  - **Description:** Create `core/logger.ts` that wraps pino with `messageKey: "message"`, integrates with the existing `AsyncLocalStorage` request context for automatic correlation ID injection, and exports `createLogger()` and `getContextualLogger()`.
  - **Acceptance criteria:**
    - [ ] Logger outputs JSON with `timestamp`, `level`, `message`, `service`, and `correlationId` (when in context)
    - [ ] Log level is read from `env.LOG_LEVEL`
    - [ ] `getContextualLogger()` returns a child logger with `correlationId` when inside an `AsyncLocalStorage` context
    - [ ] Logger flushes synchronously (pino's default sync mode for stdout)
  - **Verification:**
    - [ ] Unit tests pass: `pnpm test -- logger`
    - [ ] Test confirms JSON output contains `"message"` key, not `"msg"`
    - [ ] Test confirms correlation ID injection works
  - **Dependencies:** Task 1
  - **Files:** `apps/server/src/core/logger.ts`, `apps/server/src/core/logger.test.ts`
  - **Estimated scope:** Small (2 files)

- [ ] **Task 3: Create body size limit middleware**
  - **Description:** Create `middleware/body-size-limit.ts` using Hono's `bodyLimit` middleware with per-route configuration. Returns `413 Payload Too Large` with normalized error shape.
  - **Acceptance criteria:**
    - [ ] Payment routes (`/v1/payments/*`): 1MB max
    - [ ] Webhook routes (`/v1/webhooks/*`): 5MB max
    - [ ] Other routes: 10KB cap
    - [ ] Exceeding limit returns `{ error: { code: "PAYLOAD_TOO_LARGE", message: "...", retryable: false } }` with `413`
  - **Verification:**
    - [ ] Unit tests pass: `pnpm test -- body-size-limit`
    - [ ] Tests confirm 413 response for oversized bodies
    - [ ] Tests confirm normal processing for bodies under limit
  - **Dependencies:** None (can be parallel with Task 2 after Task 1)
  - **Files:** `apps/server/src/middleware/body-size-limit.ts`, `apps/server/src/middleware/body-size-limit.test.ts`
  - **Estimated scope:** Small (2 files)

### Checkpoint: Foundation
- [ ] `pnpm check-types` passes
- [ ] `pnpm test` passes
- [ ] Logger can be instantiated and produces JSON output
- [ ] Body size limit middleware rejects oversized requests

---

### Phase 2: Core Features

- [ ] **Task 4: Integrate body size limits and logger into app.ts**
  - **Description:** Wire the body size limit middleware into `app.ts` on the appropriate route groups. Replace `hono/logger()` with pino-based request logging. Return app resources from `createApp()` for shutdown.
  - **Acceptance criteria:**
    - [ ] Body size limits applied to `/v1/payments/*`, `/v1/webhooks/*`, and catch-all for other routes
    - [ ] `hono/logger()` is removed or replaced
    - [ ] `createApp()` returns `{ app, db, redisClient, webhookQueue, webhookWorker }`
    - [ ] `pnpm check-types` passes
  - **Verification:**
    - [ ] `pnpm test` passes (existing tests may need API key updates if any)
    - [ ] Integration test: POST oversized body to `/v1/payments/charge` → 413
  - **Dependencies:** Task 2, Task 3
  - **Files:** `apps/server/src/app.ts`, `apps/server/tests/integration/body-size-limit.test.ts`
  - **Estimated scope:** Medium (2 files + test)

- [ ] **Task 5: Create request logger middleware**
  - **Description:** Create `middleware/request-logger.ts` that logs structured request/response pairs with method, path, status, duration, correlation ID, and hashed API key. Excludes `/health` and `/metrics`. Logs payment bodies at `debug` level.
  - **Acceptance criteria:**
    - [ ] Logs include `method`, `path`, `statusCode`, `durationMs`, `correlationId`
    - [ ] API key is SHA-256 hashed in logs
    - [ ] `/health` and `/metrics` are not logged
    - [ ] Payment request bodies logged at `debug` level only
    - [ ] Webhook event type and ID logged; full body only if `LOG_WEBHOOK_BODIES=true`
  - **Verification:**
    - [ ] Unit tests pass: `pnpm test -- request-logger`
    - [ ] Test confirms excluded routes produce no log output
    - [ ] Test confirms API key is hashed (not raw)
  - **Dependencies:** Task 2
  - **Files:** `apps/server/src/middleware/request-logger.ts`, `apps/server/src/middleware/request-logger.test.ts`
  - **Estimated scope:** Small (2 files)

- [ ] **Task 6: Implement graceful shutdown**
  - **Description:** Add `SIGTERM` and `SIGINT` handlers to `index.ts` that: stop accepting connections, wait for active requests (timeout from env), close BullMQ worker, Redis, and DB connections, flush logs, then exit with code 0. Health endpoint returns `503` during shutdown.
  - **Acceptance criteria:**
    - [ ] Signal handlers registered in `index.ts`
    - [ ] Server stops accepting new connections on signal
    - [ ] Active requests allowed to finish within `SHUTDOWN_TIMEOUT_MS`
    - [ ] BullMQ worker closed gracefully
    - [ ] Redis connections closed (`redis.quit()`)
    - [ ] DB connections closed
    - [ ] Logger flushed before exit
    - [ ] Process exits with code 0
    - [ ] `GET /health` returns `503` during shutdown
  - **Verification:**
    - [ ] Integration test: spawn server, send SIGTERM, assert `/health` returns 503, assert process exits 0
    - [ ] Manual: `curl http://localhost:3000/health` during shutdown returns 503
  - **Dependencies:** Task 4 (needs resource references from createApp)
  - **Files:** `apps/server/src/index.ts`, `apps/server/src/routes/health.ts`, `apps/server/tests/integration/shutdown.test.ts`
  - **Estimated scope:** Medium (3 files + test)

- [ ] **Task 7: Implement webhook event deduplication**
  - **Description:** Add deduplication logic to the webhook route. Extract event ID from provider payload, check Redis with `SET key "1" EX ttl NX`. If already exists, return `200 OK` immediately. TTL from `WEBHOOK_DEDUP_TTL_HOURS` env var.
  - **Acceptance criteria:**
    - [ ] Stripe dedup key: `webhook:stripe:{event.id}`
    - [ ] Midtrans dedup key: `webhook:midtrans:{order_id}:{transaction_status}:{status_code}`
    - [ ] Xendit dedup key: `webhook:xendit:{id or external_id}`
    - [ ] Redis `SET NX EX` used for atomic write-once
    - [ ] Duplicate events return `200 OK` without re-enqueueing
    - [ ] If Redis unavailable, process normally (graceful degradation)
    - [ ] TTL = `WEBHOOK_DEDUP_TTL_HOURS` converted to seconds
  - **Verification:**
    - [ ] Unit tests pass: `pnpm test -- webhooks`
    - [ ] Integration test: POST same webhook twice → first processes, second returns 200 immediately
  - **Dependencies:** Task 1 (env var), Task 4 (app.ts has redis client reference)
  - **Files:** `apps/server/src/routes/webhooks.ts`, `apps/server/tests/integration/webhook-dedup.test.ts`
  - **Estimated scope:** Medium (2 files + test)

### Checkpoint: Core Features
- [ ] `pnpm check-types` passes
- [ ] `pnpm test` passes
- [ ] Server shuts down gracefully on SIGTERM
- [ ] Request logging outputs structured JSON
- [ ] Webhook dedup prevents duplicate processing

---

### Phase 3: Polish & Cleanup

- [ ] **Task 8: Replace all console.log / console.error with logger**
  - **Description:** Replace all `console.log`, `console.warn`, and `console.error` calls in `apps/server/src/` with appropriate pino logger calls via `getContextualLogger()` or a module-level logger.
  - **Acceptance criteria:**
    - [ ] `index.ts`: server startup log uses logger
    - [ ] `app.ts`: Redis unavailable warnings use logger
    - [ ] `webhook-worker.ts`: job completed/failed logs use logger with correlation ID
    - [ ] No `console.*` calls remain in `src/` (except in test files)
  - **Verification:**
    - [ ] `grep -r "console\." apps/server/src/` returns no matches (excluding test files)
    - [ ] `pnpm test` passes
  - **Dependencies:** Task 2, Task 4, Task 6, Task 7
  - **Files:** `apps/server/src/index.ts`, `apps/server/src/app.ts`, `apps/server/src/queue/webhook-worker.ts`
  - **Estimated scope:** Small (3 files)

- [ ] **Task 9: Integration tests for request logging**
  - **Description:** Add integration tests that verify request/response logging produces the expected JSON output with correct fields.
  - **Acceptance criteria:**
    - [ ] Test confirms payment request logs contain method, path, status, duration, correlationId
    - [ ] Test confirms `/health` is not logged
    - [ ] Test confirms API key is hashed in logs
  - **Verification:**
    - [ ] `pnpm test -- request-logging.integration` passes
  - **Dependencies:** Task 5, Task 4
  - **Files:** `apps/server/tests/integration/request-logging.test.ts`
  - **Estimated scope:** Small (1 file)

- [ ] **Task 10: Final verification and coverage check**
  - **Description:** Run full test suite, check coverage, ensure no regressions.
  - **Acceptance criteria:**
    - [ ] `pnpm check-types` passes
    - [ ] `pnpm check` passes (Biome lint + format)
    - [ ] `pnpm test` passes with 100% of existing tests still passing
    - [ ] Coverage does not drop below 92% overall
    - [ ] No `console.*` calls in production `src/` code
    - [ ] All new env vars have defaults (no breaking changes for existing deployments)
  - **Verification:**
    - [ ] `pnpm test -- --coverage` shows ≥ 92% overall
    - [ ] Manual smoke test: `pnpm dev:server`, `curl http://localhost:3000/health`, send SIGTERM, verify clean exit
  - **Dependencies:** All previous tasks
  - **Files:** Potentially any file needing last-minute fixes
  - **Estimated scope:** Small (verification only)

### Checkpoint: Complete
- [ ] All tests pass
- [ ] Coverage maintained ≥ 92%
- [ ] Manual smoke test succeeds
- [ ] Ready for review

---

## Task Dependency Graph

```
Task 1: Env vars
    │
    ├── Task 2: Logger
    │       │
    │       ├── Task 5: Request logger middleware
    │       │       │
    │       │       └── Task 4: Integrate into app.ts
    │       │
    │       └── Task 8: Replace console.logs
    │
    ├── Task 3: Body size limits
    │       │
    │       └── Task 4: Integrate into app.ts
    │
    └── Task 7: Webhook dedup
            │
            └── Task 4: Integrate into app.ts (redis reference)

Task 4: Integrate into app.ts
    │
    ├── Task 6: Graceful shutdown
    │       │
    │       └── Task 8: Replace console.logs (index.ts)
    │
    └── Task 9: Integration tests for request logging

Task 10: Final verification (depends on all)
```

**Parallel groups after Task 1:**
- Group A: Task 2 (logger) + Task 3 (body size limits)
- Group B: Task 5 (request logger) + Task 7 (webhook dedup) — both depend on Task 2 and Task 1 respectively, but are independent of each other

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `createApp()` returning resources breaks existing tests that call `createApp()` | High | Keep default return as Hono app; return resources as a second object or use a separate `createAppWithResources()` wrapper. Update tests minimally. |
| Pino's sync mode blocks the event loop on high log volume | Low | Pino's sync stdout is fast enough for 100-1,000 trx/day. If volume grows, switch to async mode later. |
| Redis unavailable during webhook dedup causes duplicate processing | Medium | Acceptable graceful degradation per spec. Monitor Redis availability separately. |
| Body size limits break existing integration tests with large payloads | Low | Current test payloads are small JSON. 1MB/5MB limits are generous. |
| Replacing `console.log` in `app.ts` loses startup warnings if logger isn't ready | Low | Create logger synchronously at module load time; it's just a pino instance, no async init. |

## Open Questions

None remaining — all answered in the spec.
