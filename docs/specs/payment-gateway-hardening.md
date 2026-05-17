# Spec: Payment Gateway Production Hardening

## Objective

Harden the Payment Application Gateway from a well-architected prototype into production-grade infrastructure suitable for replicated deployment handling 100-1,000 transactions per day.

**User:** Internal engineering teams consuming the gateway via REST API, plus platform/ops engineers operating the service.

**Why now:** The gateway is functionally correct but has critical security, reliability, and operational gaps that will become incidents under real traffic or replicated deployment. These gaps are localized and fixable without architectural changes.

**Success Criteria:**
- Webhook verification works correctly for all three providers (Stripe, Midtrans, Xendit)
- No duplicate audit records are created on retry
- Retry backoff includes jitter to prevent thundering herd
- Payment endpoints are rate-limited
- Health endpoint reports provider connectivity status
- All changes are backward-compatible with existing API contract
- Test coverage does not drop below current 84%
- `pnpm check-types` and `pnpm test` pass after every change

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
| **Queue** | **BullMQ + Redis** | **New — async webhook processing** |
| **Rate Limiting** | **hono-rate-limiter + Redis** | **New — per-API-key rate limiting** |
| **Auth** | **API Key middleware** | **New — required before rate limiting** |
| **Metrics** | **prom-client** | **New — Prometheus metrics endpoint** |

---

## Commands

```bash
# Development
pnpm dev:server          # Start server in watch mode
pnpm db:start            # Start PostgreSQL via Docker
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
pnpm redis:start         # Start Redis via Docker Compose
pnpm test:integration    # Run integration tests (requires DB + Redis)
```

---

## Project Structure

```
payment-application-gateway/
├── apps/
│   └── server/
│       ├── src/
│       │   ├── adapters/              # Provider adapters
│       │   │   ├── stripe/
│       │   │   ├── midtrans/
│       │   │   └── xendit/
│       │   ├── core/                  # Gateway core
│       │   │   ├── provider-registry.ts
│       │   │   ├── retry-manager.ts
│       │   │   ├── audit-logger.ts
│       │   │   ├── payment-gateway.ts
│       │   │   ├── circuit-breaker.ts       # NEW
│       │   │   ├── metrics.ts             # NEW
│       │   │   └── operation-executor.ts    # NEW — DRY extraction
│       │   ├── routes/
│       │   │   ├── payments.ts
│       │   │   ├── webhooks.ts
│       │   │   └── health.ts              # NEW
│       │   ├── middleware/
│       │   │   ├── error-handler.ts
│       │   │   ├── api-key-auth.ts        # NEW
│       │   │   ├── rate-limiter.ts        # NEW
│       │   │   └── correlation-id.ts      # NEW
│       │   ├── queue/                     # NEW
│       │   │   ├── webhook-queue.ts
│       │   │   └── queue-worker.ts
│       │   ├── types/
│       │   │   └── payment.ts
│       │   ├── app.ts
│       │   └── index.ts
│       ├── tests/
│       │   ├── __mocks__/
│       │   ├── integration/
│       │   └── unit/                      # NEW — for queue/circuit tests
│       └── package.json
├── packages/
│   ├── db/
│   ├── env/
│   ├── config/
│   └── redis/                             # NEW — Redis client package
├── docker-compose.yml                     # UPDATED — adds Redis service
└── docs/
    ├── specs/
    │   └── payment-gateway-hardening.md   # THIS FILE
    └── ideas/
        └── payment-gateway-improvements.md
```

---

## Code Style

Follow existing conventions. Example of good output:

```typescript
// Prefer early returns over nested conditionals
// Use explicit types on public method signatures
// Use `readonly` for immutable properties
// Prefer `unknown` over `any` for catch clauses

export class RetryManager {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;

  constructor(options: { maxAttempts?: number; baseDelayMs?: number } = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
  }

  async execute<T>(
    fn: () => Promise<T>,
    isRetryable: (error: unknown) => boolean,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        const canRetry = isRetryable(error);
        const isLastAttempt = attempt === this.maxAttempts;

        if (!canRetry || isLastAttempt) {
          throw error;
        }

        const delayMs = this.calculateBackoff(attempt);
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  private calculateBackoff(attempt: number): number {
    const base = this.baseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.random() * base * 0.5; // 0-50% jitter
    return Math.floor(base + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

**Key conventions:**
- Private methods prefixed with `_` are **not** used in this codebase — use `private` keyword.
- File names: `kebab-case.ts` for modules, `PascalCase.ts` for classes.
- Test files: colocated with source (`*.test.ts`) for unit tests, `tests/integration/` for integration tests.
- Error classes extend `Error` and set `this.name`.
- All `catch` blocks should use `unknown` and narrow with type guards.

---

## Testing Strategy

**Framework:** Jest + ts-jest (existing)

**Test locations:**
- Unit tests: Colocated with source (`*.test.ts`) — core logic, adapters, utilities
- Integration tests: `tests/integration/` — full HTTP request/response cycles
- Contract tests: `*-adapter.contract.test.ts` — adapter interface verification

**Coverage expectations:**
- Overall: maintain ≥ 84% (current baseline)
- Core (registry, retry, audit, circuit breaker): ≥ 90%
- Adapters: ≥ 80%
- Routes: bring from 70% to ≥ 85%

**Test levels:**
| Concern | Level |
|---------|-------|
| Error normalization logic | Unit |
| Retry manager with jitter | Unit |
| Circuit breaker state machine | Unit |
| Adapter/provider API mapping | Unit + Contract |
| Queue worker behavior | Unit (with mocked Redis) |
| Rate limiting | Integration |
| Health endpoint | Integration |
| Full payment flow end-to-end | Integration |

**New test dependencies:**
- `ioredis-mock` or in-memory BullMQ for queue unit tests
- `supertest` (or Hono's `testClient`) for integration HTTP tests

---

## Boundaries

### Always do:
- Run `pnpm check-types` and `pnpm test` before every commit
- Add tests for new features or bug fixes (no untested code)
- Update the spec if architectural decisions change mid-implementation
- Use the existing adapter pattern — no new provider logic in routes or core
- Preserve backward compatibility on public API shape
- Write audit log exactly once per logical transaction

### Ask first:
- Adding new runtime dependencies (especially non-DevDeps)
- Changing database schema (Drizzle migrations)
- Modifying CI/CD configuration
- Changing environment variable names or adding new required env vars
- Removing existing features or endpoints

### Never do:
- Commit secrets or credentials (even test keys)
- Skip webhook verification for any provider
- Edit files in `node_modules/` or `.claude/`
- Remove or disable existing tests without replacing them
- Change the normalized error shape (breaking change for consumers)
- Use `any` type — always use `unknown` with type guards

---

## Success Criteria (Detailed)

### Phase 1: Security & Reliability
- [ ] Stripe webhook uses `STRIPE_WEBHOOK_SECRET` (not API secret key) for signature verification
- [ ] Midtrans webhook verifies notification signature before accepting events
- [ ] Webhook route captures raw request body before any parsing
- [ ] Retry manager adds 0-50% jitter to exponential backoff
- [ ] Circuit breaker wraps provider calls and opens after threshold failures
- [ ] API key authentication middleware validates `x-api-key` header against configured keys
- [ ] Per-API-key rate limiter restricts `/v1/payments/*` to configurable requests per window per key
- [ ] All existing tests pass; new tests cover jitter, circuit breaker, and rate limiting

### Phase 2: Core Refactoring
- [ ] `PaymentGateway` uses single `executeOperation()` helper instead of duplicated logic in `charge/refund/verify`
- [ ] Adapters no longer generate their own transaction IDs; gateway ID is passed through
- [ ] Audit log is written exactly once per transaction, after final result (not inside retry loop)
- [ ] Webhook route queries registry for valid provider names instead of hardcoding
- [ ] Route test coverage reaches ≥ 85%

### Phase 3: Observability & Async Webhooks
- [ ] `GET /health` returns 200 with per-provider connectivity status
- [ ] Correlation IDs are generated per request and propagated to adapters + audit logs
- [ ] Prometheus metrics endpoint (`/metrics`) exposes operation latency, retry count, error rate
- [ ] Webhooks are accepted synchronously but processed asynchronously via BullMQ queue
- [ ] Queue worker retries failed webhook processing with exponential backoff
- [ ] Redis is required for replicated deployments; graceful degradation when Redis is unavailable

---

## Decisions

| Question | Decision |
|----------|----------|
| **Queue library** | **BullMQ** — full feature set for future growth, built-in retries, delayed jobs, and Bull Dashboard |
| **Rate limiting granularity** | **Per-API-key** — requires API key authentication middleware to be built first |
| **Redis deployment** | **Docker Compose** — Redis added to existing `docker-compose.yml` for one-command local dev; external Redis configurable via env var for production |
| **Circuit breaker thresholds** | **5 failures in 60 seconds → open for 30 seconds** — conservative defaults, configurable via constructor options |
