# Payment Application Gateway

<p align="center">
  <strong>One Gateway. Every Payment Provider.</strong>
</p>

<p align="center">
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/Node.js-22+-43853D?style=flat-square&logo=node.js&logoColor=white" alt="Node.js">
  </a>
  <a href="https://www.typescriptlang.org/">
    <img src="https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  </a>
  <a href="https://hono.dev/">
    <img src="https://img.shields.io/badge/Hono-4.x-E36002?style=flat-square" alt="Hono">
  </a>
  <a href="https://www.postgresql.org/">
    <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
  </a>
  <a href="https://orm.drizzle.team/">
    <img src="https://img.shields.io/badge/Drizzle-ORM-000?style=flat-square" alt="Drizzle ORM">
  </a>
  <a href="https://redis.io/">
    <img src="https://img.shields.io/badge/Redis-7+-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis">
  </a>
</p>

<p align="center">
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License: MIT">
  </a>
  <img src="https://img.shields.io/badge/tests-138%20passing-brightgreen?style=flat-square" alt="Tests">
  <img src="https://img.shields.io/badge/coverage-92%25-brightgreen?style=flat-square" alt="Coverage">
</p>

---

## What is this?

A **centralized Payment Gateway** that abstracts multiple payment providers behind a single, unified REST API. Instead of every internal service importing Stripe, Midtrans, or Xendit SDKs, they call one API. The gateway handles provider selection, request translation, retry logic, error normalization, and audit logging.

> **Design principle:** *"Internal services should never import a payment SDK. They should never know whether a charge went through Stripe or Midtrans. That's the gateway's problem — not theirs."*

---

## At a Glance

| Metric | Result |
|--------|--------|
| Providers unified | 3 (Stripe, Midtrans, Xendit) |
| API surface for all operations | 1 |
| Operations supported | `charge` · `refund` · `verify` |
| Observability | Correlation IDs, Prometheus metrics, health checks |
| Async webhooks | BullMQ queue with exponential backoff |
| Provider logic in consumers | 0 |
| Time to add a new provider | ~1 day |

---

## Why This Exists

### The Problem

- **Duplicated integration logic** — Every team re-implements provider auth, request signing, and error parsing
- **Inconsistent error handling** — Midtrans returns `status_code: "406"` as strings, Stripe throws typed exceptions, Xendit uses HTTP codes
- **Adding providers touches everything** — No single place to add a new regional gateway
- **No audit trail** — Payment interactions logged inconsistently across services

### The Solution

| | Before (Direct Integration) | After (Via Gateway) |
|---|---|---|
| SDK imports | Each service imports Stripe directly | One REST API for all ops |
| Error handling | Codes differ per provider | Normalized error shape everywhere |
| Retry logic | Duplicated everywhere | Lives in one place |
| New provider | Update N services | Write one adapter |
| Audit trail | Inconsistent or missing | Every transaction logged centrally |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      PAYMENT GATEWAY SERVICE                         │
└─────────────────────────────────────────────────────────────────────┘

Billing Service  ─────┐
Order Service    ─────┤──► POST /v1/payments/charge
Subscription Svc ─────┘    POST /v1/payments/refund
                           POST /v1/payments/verify
                           GET  /health  ← provider connectivity
                           GET  /metrics ← Prometheus metrics
                                      │
                            ┌──────────▼──────────┐
                            │    Gateway Core      │
                            │  ┌─────────────────┐ │
                            │  │ Provider Router │ │  ← selects adapter
                            │  │ Retry Manager   │ │  ← 3 attempts + jitter
                            │  │ Circuit Breaker │ │  ← opens after 5 failures
                            │  │ Error Normalizer│ │  ← unified error shape
                            │  │ Audit Logger    │ │  ← every tx logged
                            │  │ Metrics         │ │  ← latency, errors, retries
                            │  └─────────────────┘ │
                            └──────────┬────────────┘
                                       │
                ┌─────────────────────┼─────────────────────┐
                ▼                     ▼                     ▼
       StripeAdapter         MidtransAdapter         XenditAdapter
    (implements IPaymentProvider)
                │                     │                     │
          Stripe API           Midtrans API           Xendit API

Async Webhook Pipeline (BullMQ + Redis)
  POST /v1/webhooks/:provider → verify → enqueue → worker processes
```

### Core Design Principles

- **Open/Closed Principle** — Adding a provider = one new adapter. Zero changes to core or consumers.
- **Dependency Inversion** — Core references `IPaymentProvider`, never concrete adapters.
- **Single Responsibility** — Each adapter knows only its provider's quirks.
- **Encapsulation** — Provider auth, webhooks, and error codes are invisible to consumers.
- **Observability** — Every request gets a correlation ID. Every operation emits Prometheus metrics.
- **Resilience** — Circuit breaker prevents cascade failures. Jittered backoff avoids thundering herd.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ |
| Language | TypeScript 5.6+ (strict mode) |
| Web Framework | Hono |
| Validation | Zod |
| Database | PostgreSQL 16+ |
| ORM | Drizzle ORM |
| Queue | BullMQ + Redis |
| Metrics | Prometheus (prom-client) |
| Testing | Jest + ts-jest |
| Monorepo | pnpm workspaces + Turborepo |
| Linting | Biome |
| CI/CD | GitHub Actions |

### Provider SDKs

- **Stripe** — `stripe` (Payment Intents, Refunds, Webhook HMAC verification)
- **Midtrans** — `midtrans-client` (Core API, Snap, notification handling)
- **Xendit** — `xendit-node` (Invoices, Refunds, callback token verification)

---

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 10+
- PostgreSQL 16+ (or Docker)
- Redis 7+ (or Docker)

### 1. Clone & Install

```bash
git clone https://github.com/yourusername/payment-application-gateway.git
cd payment-application-gateway
pnpm install
```

### 2. Configure Environment

```bash
cp apps/server/.env.example apps/server/.env
```

Edit `apps/server/.env`:

```env
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/payment_gateway
DATABASE_URL_TEST=postgresql://postgres:password@localhost:5432/payment_gateway_test

# Redis (required for rate limiting, queue, and replicated deployments)
REDIS_URL=redis://localhost:6379

# Provider credentials
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
MIDTRANS_SERVER_KEY=SB-Mid-server-...
XENDIT_SECRET_KEY=xnd_test_...

# API Key authentication (comma-separated)
API_KEYS=api-key-1,api-key-2

# Server
CORS_ORIGIN=http://localhost:3001
NODE_ENV=development
```

### 3. Start Infrastructure

```bash
# Using Docker Compose (PostgreSQL + Redis)
pnpm docker:up

# Or start services individually
pnpm db:start
pnpm redis:start
```

### 4. Push Schema

```bash
pnpm db:push
```

### 5. Run Development Server

```bash
pnpm dev:server
```

The API is running at `http://localhost:3000`.

---

## API Reference

### Payment Operations

#### Charge

```bash
POST /v1/payments/charge
```

```json
{
  "provider": "stripe",
  "amount": 1000,
  "currency": "USD",
  "paymentMethod": "pm_card_visa",
  "description": "Order #12345",
  "metadata": { "orderId": "12345" },
  "customerId": "cus_xxx"
}
```

**Response:**

```json
{
  "success": true,
  "transactionId": "txn_abc123...",
  "amount": 1000,
  "currency": "USD",
  "provider": "stripe",
  "providerRef": "pi_xxx",
  "raw": { /* full provider response */ }
}
```

#### Refund

```bash
POST /v1/payments/refund
```

```json
{
  "provider": "stripe",
  "transactionId": "txn_abc123...",
  "amount": 1000,
  "reason": "requested_by_customer"
}
```

#### Verify

```bash
POST /v1/payments/verify
```

```json
{
  "provider": "stripe",
  "transactionId": "pi_xxx"
}
```

### Webhooks

```bash
POST /v1/webhooks/:provider
```

Providers accept webhooks at:
- `/v1/webhooks/stripe` — verifies `stripe-signature` header
- `/v1/webhooks/midtrans` — verifies notification signature
- `/v1/webhooks/xendit` — verifies `x-callback-token` header

**Async Processing:** When Redis is available, webhooks are verified synchronously and then enqueued for async processing via BullMQ (returns `202 Accepted` with `queued: true`). When Redis is unavailable, they fall back to synchronous processing (`200 OK`).

### Health

```bash
GET /health
```

Returns per-provider connectivity status. `200` if all providers are healthy, `503` if any are degraded.

### Metrics

```bash
GET /metrics
```

Prometheus exposition endpoint with operation latency, error rate, and retry counters.

---

## Provider Configuration

Each provider is configured via environment variables and registered at runtime.

```typescript
// Adapters are registered in src/app.ts
registry.register(new StripeAdapter({ secretKey: env.STRIPE_SECRET_KEY }));
registry.register(new MidtransAdapter({ serverKey: env.MIDTRANS_SERVER_KEY }));
registry.register(new XenditAdapter({ secretKey: env.XENDIT_SECRET_KEY }));
```

### Adding a New Provider

1. Create a new adapter in `src/adapters/<provider>/`
2. Implement `IPaymentProvider` interface
3. Register in `src/app.ts`
4. Add tests in `src/adapters/<provider>/<provider>-adapter.test.ts`

That's it. Zero changes to routes, core, or consumers.

---

## Security

- **API Key Authentication** — All payment endpoints require `x-api-key` header against a configured allowlist
- **Per-Key Rate Limiting** — Redis-backed rate limiting restricts each API key to 100 requests/minute
- **Webhook Signature Verification** — Stripe (HMAC-SHA256), Midtrans (SHA512), and Xendit (callback token) signatures are verified before accepting events
- **Circuit Breaker** — Prevents cascade failures by opening after repeated provider errors
- **Audit Logging** — Every transaction is recorded in PostgreSQL with correlation IDs for traceability

## Error Handling

All errors are normalized to a unified shape:

```json
{
  "error": {
    "code": "CARD_DECLINED",
    "message": "The card was declined",
    "retryable": false
  }
}
```

### Error Codes

| Code | Description | Retryable |
|------|-------------|-----------|
| `INSUFFICIENT_FUNDS` | Card has insufficient balance | No |
| `CARD_DECLINED` | Card was declined by issuer | No |
| `EXPIRED_CARD` | Card has expired | No |
| `RATE_LIMITED` | Too many requests | Yes |
| `GATEWAY_ERROR` | Provider API error | Yes |
| `INVALID_REQUEST` | Bad request data | No |
| `UNAUTHORIZED` | Authentication failed | No |
| `NOT_FOUND` | Provider not registered | No |

---

## Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test -- --coverage

# Watch mode
pnpm test:watch

# Run specific test file
pnpm test -- --testPathPatterns="stripe-adapter"
```

### Test Structure

- **Unit tests** — Colocated with source (`*.test.ts`)
- **Integration tests** — `tests/integration/`
- **Unit tests** — `tests/unit/`
- **Contract tests** — Adapter interface verification

### Coverage (as of latest run)

| Suite | Coverage |
|-------|----------|
| Overall | 92% |
| Core (registry, retry, audit, circuit breaker, metrics) | 99% |
| Adapters | 77-94% |
| Routes | 99% |
| Middleware | 85% |
| Queue | 87% |

---

## Project Structure

```
payment-application-gateway/
├── apps/
│   └── server/
│       ├── src/
│       │   ├── adapters/          # Provider adapters
│       │   │   ├── stripe/
│       │   │   ├── midtrans/
│       │   │   └── xendit/
│       │   ├── core/              # Gateway core
│       │   │   ├── provider-registry.ts
│       │   │   ├── payment-gateway.ts
│       │   │   ├── retry-manager.ts
│       │   │   ├── circuit-breaker.ts
│       │   │   ├── audit-logger.ts
│       │   │   ├── metrics.ts
│       │   │   └── request-context.ts
│       │   ├── routes/            # API routes
│       │   │   ├── payments.ts
│       │   │   ├── webhooks.ts
│       │   │   ├── health.ts
│       │   │   └── metrics.ts
│       │   ├── middleware/        # Middleware
│       │   │   ├── error-handler.ts
│       │   │   ├── api-key-auth.ts
│       │   │   ├── rate-limiter.ts
│       │   │   └── correlation-id.ts
│       │   ├── queue/             # BullMQ queue + worker
│       │   │   ├── webhook-queue.ts
│       │   │   └── webhook-worker.ts
│       │   ├── types/             # Shared types
│       │   ├── app.ts             # App factory
│       │   └── index.ts           # Server bootstrap
│       └── tests/
│           ├── __mocks__/         # Test mocks
│           ├── integration/       # Integration tests
│           └── unit/              # Unit tests
├── packages/
│   ├── db/                        # Database schema & client
│   ├── env/                       # Environment validation
│   ├── redis/                     # Redis client
│   └── config/                    # Shared TS config
├── docs/
│   ├── use-case.md               # Case study
│   └── specs/                    # Implementation specs
└── package.json                   # Workspace config
```

---

## Scripts

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

# Build
pnpm build               # Build all packages and apps
```

---

## Design Decisions

### 1. Custom Retry Manager (not `p-retry`)

The retry logic is domain-specific: **retryable vs non-retryable is a business decision**, not infrastructure. Adapters classify errors. The retry manager just executes with jittered exponential backoff.

### 2. Circuit Breaker

Provider failures are isolated. After 5 failures in 60 seconds, the circuit opens for 30 seconds, returning fast failures instead of slow timeouts.

### 3. Idempotency in Gateway Core

Callers don't pass idempotency keys. The gateway generates `txn_` prefixed IDs automatically. Prevents duplicate charges under retry.

### 4. Raw Response Storage

Every transaction stores the **raw provider response** alongside the normalized result. When providers change schemas, historical data is preserved.

### 5. Runtime Provider Resolution

The `ProviderRegistry` uses a `Map<ProviderName, IPaymentProvider>`. No compile-time imports of adapter classes in the gateway core.

### 6. AsyncLocalStorage for Correlation IDs

Instead of passing a Hono `Context` through every function signature, we use Node.js `AsyncLocalStorage` to propagate correlation IDs into core logic, adapters, and background workers transparently.

### 7. Graceful Degradation

Redis is required for full functionality (rate limiting, async webhooks), but the gateway starts and serves requests without it. Missing features log warnings rather than crashing.

---

## Roadmap

### Completed

- [x] Add Docker Compose for one-command setup
- [x] Implement webhook event queue (Redis/BullMQ)
- [x] Add health check endpoint with provider status
- [x] Add metrics and monitoring (Prometheus)
- [x] Implement API key authentication and rate limiting (Redis)
- [x] Add correlation ID propagation for observability
- [x] Circuit breaker for provider resilience
- [x] Jittered exponential backoff in retry manager

### Next Up

**Operational Readiness (do these first):**
- [ ] Graceful shutdown (`SIGTERM`/`SIGINT`) — close workers, flush logs, disconnect Redis/DB
- [ ] Structured JSON logging — replace `console.log` with correlation-aware JSON logger
- [ ] Request/response logging middleware — log every HTTP request with timing + status
- [ ] Webhook event deduplication — store processed event IDs in Redis (with TTL)
- [ ] Request body size limits — prevent DoS via enormous webhook payloads

**API Completeness:**
- [ ] Add OpenAPI/Swagger documentation
- [ ] `GET /v1/payments/:transactionId` — query transaction status by ID
- [ ] Database migrations — replace `db:push` with versioned Drizzle migrations

**Security & Reliability:**
- [ ] Webhook IP allowlisting — restrict to known provider IP ranges
- [ ] Admin/ops endpoints (`/admin/queue-status`, retry failed jobs, drain queue)
- [ ] Implement idempotency key caching (Redis)

**CI/CD & Deployment:**
- [ ] GitHub Actions CI pipeline — type check, lint, test, build on every PR
- [ ] Staging deployment pipeline — auto-deploy `main` branch to staging environment
- [ ] Production deployment pipeline — tagged releases with rollback capability
- [ ] Docker image build and push to registry (GHCR or ECR)
- [ ] Database migration verification in CI — validate migrations run cleanly
- [ ] Smoke tests after deployment — verify `/health` and sample charge/refund in staging
- [ ] Secrets management — migrate from `.env` files to secrets manager (AWS Secrets Manager, HashiCorp Vault)
- [ ] Infrastructure as Code — Terraform or Pulumi for staging and production environments

**Strategic:**
- [ ] Support for more providers (PayPal, Braintree, etc.)
- [ ] Transaction reconciliation job — periodic worker comparing gateway vs provider state
- [ ] Load testing / performance benchmarks — documented in CI
- [ ] Multi-environment deployment config — K8s manifests or Terraform
- [ ] Redis Sentinel / Cluster support — failover for replicated deployments
- [ ] Add Bull Dashboard for queue monitoring

---

## Contributing

Contributions are welcome! Please read the following before submitting PRs:

1. Follow the existing code style (Biome handles most of this)
2. Write tests for new features
3. Update the spec if you change architecture
4. Ensure `pnpm check-types` and `pnpm test` pass

```bash
# Before committing
pnpm check        # Format & lint
pnpm check-types  # Type check
pnpm test         # Run tests
```

---

## License

[MIT](./LICENSE) © Yusup

---

<p align="center">
  <sub>Built with ❤️ for teams tired of writing payment integrations.</sub>
</p>
