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
</p>

<p align="center">
  <a href="./LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License: MIT">
  </a>
  <img src="https://img.shields.io/badge/tests-63%20passing-brightgreen?style=flat-square" alt="Tests">
  <img src="https://img.shields.io/badge/coverage-84%25-brightgreen?style=flat-square" alt="Coverage">
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
                                     │
                           ┌──────────▼──────────┐
                           │    Gateway Core      │
                           │  ┌─────────────────┐ │
                           │  │ Provider Router │ │  ← selects adapter
                           │  │ Retry Manager   │ │  ← 3 attempts, exp. backoff
                           │  │ Error Normalizer│ │  ← unified error shape
                           │  │ Audit Logger    │ │  ← every tx logged
                           │  └─────────────────┘ │
                           └──────────┬────────────┘
                                      │
               ┌─────────────────────┼─────────────────────┐
               ▼                     ▼                     ▼
      StripeAdapter         MidtransAdapter         XenditAdapter
   (implements IPaymentProvider)
               │                     │                     │
         Stripe API           Midtrans API           Xendit API
```

### Core Design Principles

- **Open/Closed Principle** — Adding a provider = one new adapter. Zero changes to core or consumers.
- **Dependency Inversion** — Core references `IPaymentProvider`, never concrete adapters.
- **Single Responsibility** — Each adapter knows only its provider's quirks.
- **Encapsulation** — Provider auth, webhooks, and error codes are invisible to consumers.

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

# Provider credentials
STRIPE_SECRET_KEY=sk_test_...
MIDTRANS_SERVER_KEY=SB-Mid-server-...
XENDIT_SECRET_KEY=xnd_test_...

# Server
CORS_ORIGIN=http://localhost:3001
NODE_ENV=development
```

### 3. Start Database

```bash
# Using Docker
pnpm db:start

# Or use your existing PostgreSQL instance
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
- **Contract tests** — Adapter interface verification

### Coverage (as of latest run)

| Suite | Coverage |
|-------|----------|
| Overall | 84% |
| Core (registry, retry, audit) | 87% |
| Adapters | 78-94% |
| Routes | 70% |

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
│       │   │   ├── retry-manager.ts
│       │   │   ├── audit-logger.ts
│       │   │   └── payment-gateway.ts
│       │   ├── routes/            # API routes
│       │   │   ├── payments.ts
│       │   │   └── webhooks.ts
│       │   ├── middleware/        # Error handler
│       │   ├── types/             # Shared types
│       │   ├── app.ts             # App factory
│       │   └── index.ts           # Server bootstrap
│       └── tests/
│           ├── __mocks__/         # Test mocks
│           └── integration/       # Integration tests
├── packages/
│   ├── db/                        # Database schema & client
│   ├── env/                       # Environment validation
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
pnpm db:start            # Start PostgreSQL via Docker
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

The retry logic is domain-specific: **retryable vs non-retryable is a business decision**, not infrastructure. Adapters classify errors. The retry manager just executes.

### 2. Idempotency in Gateway Core

Callers don't pass idempotency keys. The gateway generates `txn_` prefixed IDs automatically. Prevents duplicate charges under retry.

### 3. Raw Response Storage

Every transaction stores the **raw provider response** alongside the normalized result. When providers change schemas, historical data is preserved.

### 4. Runtime Provider Resolution

The `ProviderRegistry` uses a `Map<ProviderName, IPaymentProvider>`. No compile-time imports of adapter classes in the gateway core.

---

## Roadmap

- [ ] Add Docker Compose for one-command setup
- [ ] Add OpenAPI/Swagger documentation
- [ ] Implement webhook event queue (Redis/Bull)
- [ ] Add health check endpoint with provider status
- [ ] Support for more providers (PayPal, Braintree, etc.)
- [ ] Add metrics and monitoring (Prometheus)
- [ ] Implement idempotency key caching (Redis)

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
