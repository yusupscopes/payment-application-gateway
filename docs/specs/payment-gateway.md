# Spec: Payment Application Gateway

## Assumptions I'm Making

1. This is a backend-only service (no frontend UI)
2. Authentication/authorization between internal services and the gateway is out of scope for this phase
3. The gateway runs as a single monolithic service (not microservices)
4. Webhook endpoints are exposed publicly (no internal-network-only restriction)
5. PostgreSQL is the only supported database (based on existing Drizzle setup)
6. All monetary amounts are stored in the smallest currency unit (e.g., cents) as integers
7. English is the primary language for error messages and logs

→ Correct me now or I'll proceed with these.

---

## Objective

Build a centralized Payment Gateway service that abstracts 3 payment providers (Stripe, Midtrans, Xendit) behind a single unified REST API. Internal teams interact with one API, not three.

### User Stories

- **As an internal service**, I want to charge a customer without knowing which provider handles it, so I don't need to learn provider-specific SDKs.
- **As an internal service**, I want to receive the same error shape regardless of provider, so my error handling is consistent.
- **As an operations engineer**, I want to query a single audit log for all payment transactions, so I can investigate failures quickly.
- **As a platform engineer**, I want to add a new provider by writing one adapter class, so I don't touch any consumer code.

### Acceptance Criteria

1. `POST /v1/payments/charge` accepts a provider-agnostic payload and returns a normalized `PaymentResult`
2. `POST /v1/payments/refund` refunds a previous transaction and returns a normalized `RefundResult`
3. `POST /v1/payments/verify` verifies a transaction status and returns a normalized `VerifyResult`
4. `POST /v1/webhooks/:provider` receives provider webhooks and normalizes them
5. Every transaction is persisted to the audit log before the response is returned
6. Retryable errors are retried up to 3 times with exponential backoff
7. Adding a new provider requires zero changes to the gateway core or consumers

---

## Tech Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Runtime | Node.js | 22+ | ESM native, `crypto.randomUUID()` built-in |
| Language | TypeScript | ^6 | Strict mode, workspace catalog |
| Web Framework | Hono | ^4.8.2 | Lightweight, Zod validator built-in, existing in stack |
| Validation | Zod | ^4.1.13 | Existing in stack, runtime + compile-time safety |
| Database | PostgreSQL | 16+ | Existing in stack |
| ORM | Drizzle ORM | ^0.45.1 | Existing in stack, type-safe SQL |
| Migrations | Drizzle Kit | ^0.31.8 | Existing in stack |
| Env Config | @t3-oss/env-core | ^0.13.1 | Existing in stack, Zod-based validation |
| Monorepo | pnpm workspaces + Turbo | ^2.8.12 | Existing in stack |
| Provider SDKs | stripe, midtrans-client, xendit-node | latest | Required for provider APIs |
| Retry Logic | Custom implementation | — | Simple exponential backoff, no external dep needed |
| Linting | Biome | ^2.2.0 | Existing in stack |
| Testing | Jest (to be added) | ^29 | Standard for Node.js/TypeScript |

---

## Commands

```bash
# Development
pnpm dev:server              # Start server in watch mode
pnpm db:start                # Start PostgreSQL via Docker Compose
pnpm db:push                 # Push Drizzle schema to database
pnpm db:studio               # Open Drizzle Studio

# Build & Type Check
pnpm build                   # Build all packages and apps
pnpm check-types             # Type-check all packages and apps
pnpm check                   # Run Biome lint + format

# Testing (to be added)
pnpm test                    # Run all tests
pnpm test -- --coverage     # Run tests with coverage
pnpm test -- --watch        # Run tests in watch mode
```

---

## Project Structure

```
payment-application-gateway/
├── apps/
│   └── server/                          # Hono HTTP server
│       ├── src/
│       │   ├── index.ts                 # Entry point: Hono app + server bootstrap
│       │   ├── routes/
│       │   │   ├── payments.ts          # POST /v1/payments/* endpoints
│       │   │   └── webhooks.ts          # POST /v1/webhooks/:provider endpoints
│       │   ├── middleware/
│       │   │   └── error-handler.ts     # Global error normalization middleware
│       │   └── types/
│       │       └── hono.d.ts            # Hono type augmentations
│       └── package.json
├── packages/
│   ├── db/                              # Database package (existing)
│   │   ├── src/
│   │   │   ├── index.ts                 # Drizzle client + connection
│   │   │   ├── schema/
│   │   │   │   ├── index.ts             # Schema exports
│   │   │   │   ├── transactions.ts      # Transaction audit log table
│   │   │   │   └── transaction-logs.ts  # Detailed transaction logs table
│   │   │   └── seed.ts                  # Seed data for development
│   │   └── drizzle.config.ts
│   ├── env/                             # Environment validation (existing)
│   │   └── src/
│   │       └── server.ts                # Zod-based env schema
│   └── config/                          # Shared TS config (existing)
│       └── tsconfig.base.json
├── docs/
│   ├── use-case.md                      # Original case study
│   └── specs/
│       └── payment-gateway.md           # This spec
├── skills/                              # Agent skills (existing)
└── package.json                         # Root workspace config
```

---

## Code Style

### Naming Conventions
- **Files**: `kebab-case.ts` for modules, `PascalCase.ts` for classes/interfaces
- **Interfaces**: `IPaymentProvider` (prefix with `I` for public contracts)
- **Types/Enums**: `PascalCase`
- **Functions/Variables**: `camelCase`
- **Constants**: `SCREAMING_SNAKE_CASE` for true constants

### Key Patterns

```typescript
// Adapter interface — the core contract
export interface IPaymentProvider {
  readonly name: ProviderName;

  charge(payload: ChargePayload): Promise<PaymentResult>;
  refund(payload: RefundPayload): Promise<RefundResult>;
  verify(payload: VerifyPayload): Promise<VerifyResult>;
}

// Normalized result — same shape everywhere
export interface PaymentResult {
  success: boolean;
  transactionId: string;
  amount: number;
  currency: string;
  provider: ProviderName;
  providerRef: string;
  raw: unknown;
  error?: NormalizedError;
}

// Unified error shape
export interface NormalizedError {
  code: PaymentErrorCode;
  message: string;
  retryable: boolean;
}

// Provider registry — runtime resolution, no compile-time imports
export class ProviderRegistry {
  private providers = new Map<ProviderName, IPaymentProvider>();

  register(provider: IPaymentProvider): void {
    this.providers.set(provider.name, provider);
  }

  resolve(name: ProviderName): IPaymentProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new ProviderNotFoundError(name);
    }
    return provider;
  }
}
```

### Error Handling
- All provider errors are normalized to `NormalizedError` at the adapter boundary
- Gateway core never handles provider-specific error types
- HTTP responses use consistent `APIError` shape:

```typescript
interface APIError {
  error: {
    code: string;        // e.g., "PROVIDER_ERROR", "VALIDATION_ERROR"
    message: string;
    details?: unknown;
  };
}
```

### Idempotency
- Gateway generates idempotency keys internally using `crypto.randomUUID()`
- Callers do not pass idempotency keys
- Keys are stored per-transaction for deduplication

---

## Testing Strategy

### Framework
- **Jest** with `ts-jest` for TypeScript support
- **Supertest** (or Hono's built-in `app.request`) for HTTP endpoint testing

### Test Levels
1. **Unit tests** — Adapter logic, error normalization, retry manager
   - Location: `apps/server/src/**/*.test.ts` (colocated)
   - Focus: Pure functions, isolated adapter behavior

2. **Integration tests** — Database + API endpoints
   - Location: `apps/server/tests/integration/`
   - Focus: Request → validation → adapter → database → response
   - Use test database (separate PostgreSQL instance or transaction rollback)

3. **Contract tests** — Provider adapter interfaces
   - Location: `apps/server/src/adapters/**/*.contract.test.ts`
   - Focus: Each adapter implements `IPaymentProvider` correctly
   - Mock provider SDKs, don't hit real APIs

### Coverage Expectations
- Core logic (gateway, adapters, retry manager): **≥ 90%**
- API routes: **≥ 80%**
- Database schema: Not applicable (no logic to test)

### Test Naming
```typescript
describe("MidtransAdapter", () => {
  describe("charge", () => {
    it("should normalize string status_code '200' to success=true", async () => {});
    it("should mark '408' errors as retryable", async () => {});
    it("should mark '406' errors as non-retryable", async () => {});
  });
});
```

---

## Boundaries

### Always Do
- Run `pnpm check-types` and `pnpm check` before committing
- Validate all external input at API boundaries using Zod
- Store the raw provider response on every transaction
- Normalize errors in the adapter, never in the gateway core or consumer
- Write audit log before returning the HTTP response
- Add tests for every adapter method
- Use the provider registry for runtime resolution (never hardcode provider imports in core)

### Ask First
- Adding new dependencies beyond the 3 provider SDKs and Jest
- Changing the database schema after initial migration
- Modifying the `IPaymentProvider` interface (breaks all adapters)
- Adding new environment variables
- Changing CI/CD configuration
- Introducing caching (Redis, etc.)

### Never Do
- Commit secrets or API keys to version control
- Import provider SDKs in the gateway core or route handlers
- Expose raw provider errors or status codes in HTTP responses
- Skip writing to the audit log
- Remove or modify failing tests without approval
- Use `any` type for provider responses (use `unknown` + validation)

---

## Success Criteria

### Functional
- [ ] `POST /v1/payments/charge` returns `PaymentResult` with `success`, `transactionId`, `providerRef`, and optional `error`
- [ ] `POST /v1/payments/refund` returns `RefundResult` with normalized shape
- [ ] `POST /v1/payments/verify` returns `VerifyResult` with normalized shape
- [ ] `POST /v1/webhooks/:provider` accepts webhooks from all 3 providers
- [ ] Every request writes one row to the `transactions` table before response
- [ ] Retryable errors trigger up to 3 retries with exponential backoff
- [ ] Non-retryable errors fail immediately without retry
- [ ] Adding a 4th provider requires only: (1) new adapter class, (2) register in registry, (3) add env vars

### Technical
- [ ] TypeScript compiles with `strict: true` and zero errors
- [ ] All 3 provider SDKs are installed and type-safe
- [ ] Database schema is migrated and testable
- [ ] Unit test coverage for adapters ≥ 90%
- [ ] Integration tests pass for all 3 payment operations
- [ ] Biome linting passes with zero warnings

### Quality
- [ ] Error taxonomy (`PaymentErrorCode` enum) is designed upfront, not incrementally
- [ ] No provider-specific imports in `apps/server/src/routes/` or `apps/server/src/middleware/`
- [ ] Raw provider responses are stored on every transaction
- [ ] Idempotency keys are generated internally, not passed by callers

---

## Open Questions (Resolved)

1. **Provider credentials**: ✅ `STRIPE_SECRET_KEY`, `MIDTRANS_SERVER_KEY`, `XENDIT_SECRET_KEY`
2. **Webhook security**: ✅ Verify signatures/tokens in this phase (Stripe HMAC, Xendit `x-callback-token`, Midtrans notification hash)
3. **Default provider routing**: ✅ Require explicit `provider` field in all requests
4. **Database for tests**: ✅ Separate test database (`DATABASE_URL_TEST`)
5. **Transaction ID format**: ✅ Prefixed like `txn_xxxxxxxx` (use `nanoid` or `crypto.randomUUID()` with prefix)
