# Spec: Operational Readiness for Payment Gateway

## Objective

Harden the Payment Application Gateway with production-grade operational behaviors: graceful shutdown, structured logging, request tracing, webhook deduplication, and request body size limits. These are the final gaps before the gateway is safe to run under real traffic and container orchestration.

**User:** Internal engineering teams consuming the gateway API, plus platform/ops engineers operating the service in production.

**Why now:** The gateway has solid architecture (adapters, circuit breaker, async webhooks, metrics) but lacks the operational surface area that prevents data loss during restarts and makes incidents debuggable at 3am.

**Success Criteria:**
- Server shuts down cleanly on `SIGTERM`: stops accepting connections, waits for active requests, closes BullMQ worker, Redis, and DB connections, then exits with code 0
- All logs are structured JSON with `timestamp`, `level`, `correlationId`, `message`, and context fields (pino configured with `messageKey: "message"`)
- Every HTTP request (except `/health` and `/metrics`) is logged with method, path, status, duration, and correlation ID
- Duplicate webhook events from any provider return `200 OK` without re-processing, using Redis-backed deduplication with per-provider TTLs
- Request bodies exceeding per-route limits return `413 Payload Too Large` with normalized error shape
- `pnpm check-types` and `pnpm test` pass; test coverage does not drop below current baseline
- Zero breaking changes to existing API contract

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Node.js 22+ | Existing |
| Language | TypeScript 5.6+ (strict mode) | Existing |
| Web Framework | Hono 4.x | Existing |
| Validation | Zod | Existing |
| Database | PostgreSQL 16+ | Existing |
| ORM | Drizzle ORM | Existing |
| Testing | Jest + ts-jest | Existing |
| Linting | Biome | Existing |
| **Logging** | **pino** | **New — structured JSON logger** |
| **Queue** | **BullMQ + Redis** | **Existing — used for webhook processing** |
| **Shutdown** | **Node.js signal handlers + Hono server close** | **New** |

---

## Commands

```bash
# Development
pnpm dev:server          # Start server in watch mode
pnpm docker:up           # Start PostgreSQL + Redis via Docker Compose
pnpm db:start            # Start PostgreSQL via Docker
pnpm redis:start         # Start Redis via Docker
pnpm db:push             # Push schema to database
pnpm db:studio           # Open Drizzle Studio

# Quality
pnpm check-types         # Type-check all packages
pnpm check               # Run Biome lint + format
pnpm test                # Run all tests
pnpm test -- --coverage  # Run tests with coverage report
pnpm test:watch          # Watch mode

# Build
pnpm build               # Build all packages and apps
```

**New commands to add:**
```bash
pnpm test:integration    # Run integration tests (requires DB + Redis)
```

---

## Project Structure

```
payment-application-gateway/
├── apps/
│   └── server/
│       ├── src/
│       │   ├── adapters/              # Provider adapters (unchanged)
│       │   ├── core/                  # Gateway core
│       │   │   ├── provider-registry.ts
│       │   │   ├── payment-gateway.ts
│       │   │   ├── retry-manager.ts
│       │   │   ├── circuit-breaker.ts
│       │   │   ├── audit-logger.ts
│       │   │   ├── metrics.ts
│       │   │   ├── request-context.ts
│       │   │   └── logger.ts              # NEW — pino logger wrapper
│       │   ├── routes/
│       │   │   ├── payments.ts
│       │   │   ├── webhooks.ts
│       │   │   ├── health.ts
│       │   │   └── metrics.ts
│       │   ├── middleware/
│       │   │   ├── error-handler.ts
│       │   │   ├── api-key-auth.ts
│       │   │   ├── rate-limiter.ts
│       │   │   ├── correlation-id.ts
│       │   │   ├── request-logger.ts      # NEW — structured request/response logging
│       │   │   └── body-size-limit.ts     # NEW — per-route body size limits
│       │   ├── queue/
│       │   │   ├── webhook-queue.ts
│       │   │   └── webhook-worker.ts
│       │   ├── types/                   # Shared types
│       │   ├── app.ts                 # App factory
│       │   └── index.ts               # Server bootstrap (NEW: signal handlers)
│       └── tests/
│           ├── __mocks__/             # Test mocks
│           ├── integration/           # Integration tests
│           └── unit/                  # Unit tests
├── packages/
│   ├── db/                            # Database schema & client
│   ├── env/                           # Environment validation
│   ├── redis/                         # Redis client
│   └── config/                        # Shared TS config
├── docs/
│   ├── specs/
│   │   └── operational-readiness.md   # THIS FILE
│   └── ideas/
│       └── operational-readiness.md   # Refined idea one-pager
└── package.json                       # Workspace config
```

---

## Code Style

Follow existing conventions. Example of good output:

```typescript
// Prefer early returns over nested conditionals
// Use explicit types on public method signatures
// Use `readonly` for immutable properties
// Prefer `unknown` over `any` for catch clauses
// Use pino's child loggers for contextual fields

import { pino } from "pino";
import { getCorrelationIdFromContext } from "./request-context.js";

export function createLogger(options: { level?: string } = {}) {
  const logger = pino({
    level: options.level ?? "info",
    base: { service: "payment-gateway" },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: "message",
  });

  return logger;
}

export function getContextualLogger(): pino.Logger {
  const correlationId = getCorrelationIdFromContext();
  if (correlationId) {
    return createLogger().child({ correlationId });
  }
  return createLogger();
}
```

**Key conventions:**
- Private methods prefixed with `_` are **not** used in this codebase — use `private` keyword.
- File names: `kebab-case.ts` for modules, `PascalCase.ts` for classes.
- Test files: colocated with source (`*.test.ts`) for unit tests, `tests/integration/` for integration tests.
- Error classes extend `Error` and set `this.name`.
- All `catch` blocks should use `unknown` and narrow with type guards.
- **New:** Logger calls should use the child logger pattern: `logger.info({ orderId }, "Charge completed")` not `logger.info("Charge completed for order " + orderId)`.
- **New:** Never use `console.log` or `console.error` in production code — always use the logger.

---

## Testing Strategy

**Framework:** Jest + ts-jest (existing)

**Test locations:**
- Unit tests: Colocated with source (`*.test.ts`) — core logic, middleware, utilities
- Integration tests: `tests/integration/` — full HTTP request/response cycles

**Coverage expectations:**
- Overall: maintain ≥ 92% (current baseline per README)
- Core (logger, request context, middleware): ≥ 90%
- Routes: maintain ≥ 99% (current baseline)
- Shutdown logic: covered via integration tests (spawn server, send SIGTERM, assert graceful exit)

**Test levels:**
| Concern | Level |
|---------|-------|
| Logger JSON output format | Unit |
| Logger correlation ID injection | Unit |
| Request logger middleware | Integration |
| Body size limit middleware | Integration |
| Webhook dedup logic | Unit + Integration |
| Graceful shutdown sequence | Integration |
| Health endpoint 503 during shutdown | Integration |

**New test dependencies:**
- `get-port` or similar for finding an available port in integration tests
- `pino-test` (optional) for asserting on logger output in unit tests

---

## Boundaries

### Always do:
- Run `pnpm check-types` and `pnpm test` before every commit
- Add tests for new features or bug fixes (no untested code)
- Update the spec if architectural decisions change mid-implementation
- Use the existing adapter pattern — no new provider logic in routes or core
- Preserve backward compatibility on public API shape
- Use the logger instead of `console.log` / `console.error` in all new and modified code
- Keep `AsyncLocalStorage` context propagation working for correlation IDs

### Ask first:
- Adding new runtime dependencies (especially non-DevDeps)
- Changing database schema (Drizzle migrations)
- Modifying CI/CD configuration
- Changing environment variable names or adding new required env vars
- Removing existing features or endpoints
- Changing the normalized error shape

### Never do:
- Commit secrets or credentials (even test keys)
- Skip webhook verification for any provider
- Edit files in `node_modules/` or `.claude/`
- Remove or disable existing tests without replacing them
- Change the normalized error shape (breaking change for consumers)
- Use `any` type — always use `unknown` with type guards
- Use `console.log` / `console.error` in production code paths

---

## Success Criteria (Detailed)

### Graceful Shutdown
- [ ] `SIGTERM` and `SIGINT` handlers exist in `src/index.ts`
- [ ] On signal, Hono server stops accepting new connections (`server.close()`)
- [ ] Active requests are allowed to complete (configurable timeout, default 10s)
- [ ] BullMQ worker is closed gracefully (`worker.close()`)
- [ ] Redis connections are closed (`redis.quit()`)
- [ ] DB connections are closed (`db.$client.end()` or equivalent)
- [ ] Logger is flushed before process exit
- [ ] Process exits with code 0 after all resources are closed
- [ ] During shutdown, `GET /health` returns `503 Service Unavailable`

### Structured JSON Logging
- [ ] All `console.log` / `console.error` in `src/` are replaced with pino logger calls
- [ ] Logger outputs JSON with fields: `timestamp`, `level`, `message`, `service`, `correlationId` (when available)
- [ ] Log level is configurable via `LOG_LEVEL` env var (default `info`)
- [ ] Logger integrates with existing `AsyncLocalStorage` request context for automatic correlation ID injection
- [ ] Startup events are logged: server port, registered providers, Redis/DB connection status
- [ ] Webhook worker events are logged with correlation IDs

### Request/Response Logging Middleware
- [ ] Custom middleware replaces or supplements `hono/logger()`
- [ ] Logs include: `method`, `path`, `statusCode`, `durationMs`, `correlationId`
- [ ] API key is logged in hashed/anonymized form (e.g., `apiKey: "sha256:abc123..."`)
- [ ] `/health` and `/metrics` routes are excluded from request logging
- [ ] Payment request bodies are logged at `debug` level only
- [ ] Webhook event type and ID are logged. Full webhook body logging is controlled by `LOG_WEBHOOK_BODIES=true` env var (default: false)

### Webhook Event Deduplication
- [ ] Stripe event dedup key: `event.id` (from payload)
- [ ] Midtrans event dedup key: `order_id:transaction_status:status_code` (composite)
- [ ] Xendit event dedup key: `id` or `external_id` from payload
- [ ] Dedup state is stored in Redis with TTL of **72 hours** (universal, covers all provider retry windows)
- [ ] Before processing, webhook route checks Redis. If already processed, returns `200 OK` immediately
- [ ] If Redis is unavailable, webhook is processed normally (graceful degradation)
- [ ] Dedup check happens before queue enqueue (prevents duplicate jobs)

### Request Body Size Limits
- [ ] Payment routes (`/v1/payments/*`): 1MB max body
- [ ] Webhook routes (`/v1/webhooks/*`): 5MB max body
- [ ] Health and metrics routes: 10KB cap (or no body parsing)
- [ ] Returns `413 Payload Too Large` with normalized error shape when exceeded:
  ```json
  {
    "error": {
      "code": "PAYLOAD_TOO_LARGE",
      "message": "Request body exceeds maximum size of 1MB",
      "retryable": false
    }
  }
  ```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOG_LEVEL` | No | `info` | Pino log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `LOG_WEBHOOK_BODIES` | No | `false` | Set to `true` to log full webhook request bodies (may contain PII) |
| `SHUTDOWN_TIMEOUT_MS` | No | `10000` | Milliseconds to wait for active requests to finish before forceful shutdown |
| `WEBHOOK_DEDUP_TTL_HOURS` | No | `72` | Redis TTL for webhook dedup keys in hours |

---

## Open Questions — Answered

1. **Does the load balancer check `/health` for draining?** → **Yes.** The LB checks `/health` and drains traffic when it returns `503`.
2. **What is the current log aggregation setup?** → stdout to external aggregator. **Decision: configure pino with `messageKey: "message"`** instead of default `msg`.
3. **Should webhook bodies be logged at all?** → **Log event type and ID only by default.** Full webhook body logging configurable via `LOG_WEBHOOK_BODIES=true` env var.
4. **What is the exact Redis client API for TTL + key existence checks?** → Use `SET key value EX ttl NX` for atomic write-once dedup, or `GET` + `SET` with appropriate error handling. The 72-hour TTL is set at write time.
