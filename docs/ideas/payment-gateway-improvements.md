# Payment Gateway Production Hardening

## Problem Statement

How might we harden this payment gateway from a well-architected prototype into production-grade infrastructure without compromising its clean adapter pattern and zero-core-change philosophy?

## Recommended Direction

A phased hardening approach that prioritizes **fixing critical security and reliability gaps first**, then **refactoring duplicated core logic**, and finally **adding production observability**. This sequence minimizes risk: you don't want to refactor the core while webhook verification is broken.

The gateway's architecture is genuinely good — the adapter pattern is clean, the registry abstraction is solid, and the test coverage (84%) is a strong foundation. But there are specific code-level issues that will cause production incidents if not addressed. The good news: most fixes are localized and don't require architectural changes.

---

### Direction 1: Fix Critical Security & Reliability Gaps (Do This First)

**The issues here are not theoretical — they are bugs I found in the code.**

1. **Stripe webhook verification is broken.** `StripeAdapter.verifyWebhook` passes `this.config.secretKey` to `constructEvent`, but Stripe webhook verification requires a **separate webhook endpoint secret** (`whsec_...`), not the API secret key. With the current code, signature verification will always fail in production — or worse, if Stripe's library has any fallback behavior, it might accept invalid signatures.
2. **Midtrans webhook verification is a no-op stub.** `verifyWebhook` returns `{ success: true }` unconditionally. This means anyone can POST to `/v1/webhooks/midtrans` and forge payment events.
3. **Webhook route destroys raw body before verification.** `webhooks.ts` calls `await c.req.json()` to get the body, but HMAC verification requires the **exact raw bytes** of the request body. Once JSON is parsed and re-stringified, the signature won't match.
4. **Retry manager lacks jitter.** Pure exponential backoff (`delayMs = baseDelayMs * 2^(attempt - 1)`) without randomization causes thundering herd problems when a provider recovers. All retrying clients hit simultaneously.
5. **No circuit breaker.** The retry manager will hammer a failing provider 3 times per request. Under load, this multiplies failures instead of containing them.
6. **No rate limiting on payment endpoints.** `/v1/payments/charge` and `/v1/payments/refund` are exposed without any request throttling. This is a vector for abuse and accidental cost spikes.

**Why this first:** These are painkillers, not vitamins. A forged webhook or a thundering herd on a failing provider are production incidents. The fixes are small and localized.

---

### Direction 2: DRY Up the Gateway Core & Fix Audit Integrity

1. **Massive boilerplate duplication in `PaymentGateway`.** `charge()`, `refund()`, and `verify()` each contain identical retry logic, error-throwing logic, and audit logging patterns. This should be extracted into a single `executeOperation()` private method.
2. **Duplicate transaction ID generation.** Every adapter (`StripeAdapter`, `MidtransAdapter`, `XenditAdapter`) has its own `generateTransactionId()` method. But the gateway also generates one. This is a bug risk — if a retry occurs, does the adapter generate a new ID? (It doesn't in the current code because the gateway ID wins, but the duplication is unnecessary and confusing.)
3. **Audit log duplication on retries.** Because the audit log is written *inside* the retry lambda, a failed-then-retried operation creates **multiple audit records** for the same logical transaction. The audit should be written once, after the final result is known.
4. **Webhook route hardcodes provider names.** `providerName !== "stripe" && providerName !== "midtrans" && providerName !== "xendit"` breaks the registry abstraction. The route should ask the registry what providers are valid.
5. **Route coverage is 70%** — the lowest in the codebase. The duplicate logic in `PaymentGateway` makes it harder to test thoroughly. Extracting it will make the route tests simpler.

**Why this second:** It's high-feasibility refactoring that reduces bug surface and makes adding new providers genuinely zero-touch. But it's safe to do after the security fixes are in.

---

### Direction 3: Production Observability & Operational Controls

1. **Add a `/health` endpoint with provider connectivity checks.** The roadmap mentions this. It should attempt a lightweight operation (e.g., Stripe balance retrieval, Midtrans ping) and report which providers are reachable.
2. **Add structured request logging with correlation IDs.** The current `hono/logger()` is just access logging. Payment operations need correlation IDs propagated to adapters and audit logs so a single charge can be traced end-to-end.
3. **Add Prometheus metrics:** operation latency histograms (labeled by provider), retry counts, error rates by normalized code, and webhook verification failure rates.
4. **Add rate limiting middleware** on `/v1/payments/*` (e.g., via `hono-rate-limiter`).

**Why this third:** These are operational table stakes. They matter most once the gateway is handling real traffic.

---

## Key Assumptions to Validate

- [ ] **Adapters should not generate their own transaction IDs.** The gateway already generates `txn_` IDs. Adapters should receive and use the gateway-generated ID. (Validate by checking if any adapter needs its own ID for provider-specific requirements.)
- [ ] **Webhook verification requires raw body access.** Hono's default JSON parsing breaks Stripe HMAC verification. (Validate by testing webhook verification with actual Stripe test events.)
- [ ] **Audit logs should be idempotent.** Writing the audit log once per logical transaction (not per retry attempt) is the correct behavior. (Validate against compliance/audit requirements.)
- [ ] **The gateway can accept a separate `STRIPE_WEBHOOK_SECRET` env var.** This is a configuration change, not a code change. (Validate that ops can inject this.)

## MVP Scope

If I were picking the **smallest set of changes that makes this production-safe**, it would be:

**In:**
- Fix Stripe webhook verification to use a proper webhook secret
- Implement Midtrans webhook signature verification (or at least reject unverified requests)
- Capture raw webhook body before JSON parsing
- Add jitter to retry backoff
- Add a basic `/health` endpoint
- Add rate limiting on payment routes

**Out:**
- Full circuit breaker implementation (can be added after jitter)
- Prometheus metrics (can be added after basic logging)
- DRY refactoring of `PaymentGateway` (important but not a production blocker)
- Redis-based idempotency caching (the current in-memory tx ID approach works for single-instance; Redis is only needed at scale)

## Not Doing (and Why)

- **Rewriting the adapter architecture** — The current architecture is solid. The problems are implementation gaps, not design flaws. Don't fix what isn't broken.
- **Adding more providers (PayPal, Braintree)** — The README says "~1 day" to add a provider, but that's only true if the core is stable. Adding providers before fixing webhook verification and audit duplication just spreads the bugs.
- **Building a dashboard or admin UI** — Not mentioned in the README, and not a production blocker. The target user is internal services calling an API, not humans staring at a UI.
- **Full OpenAPI/Swagger docs** — Valuable, but the API surface is small (3 endpoints + webhooks). A README snippet is sufficient until the API stabilizes.

## Open Questions — Answered

- **What's the target deployment topology?** → **Replicated for scalability.** This means we **do need Redis** for idempotency key caching and distributed rate limiting, since in-memory state won't survive across instances.
- **Are there compliance requirements (PCI-DSS, SOC2)?** → **No compliance requirements at the moment.** Audit log retention and webhook verification can follow best practices without regulatory constraints.
- **What's the current traffic volume?** → **100-1,000 transactions per day.** This is low enough that a circuit breaker isn't urgent, but jitter + rate limiting are still cheap wins that prevent incidents during traffic spikes or provider outages.
- **Should webhook handlers be asynchronous (queued) or synchronous?** → **Asynchronous (queued).** The current synchronous implementation blocks the HTTP connection on provider callbacks. We need an in-memory or Redis-backed queue to accept webhooks immediately and process them asynchronously.

## Updated Assumptions

- [x] **Redis is required for replicated deployments.** Idempotency caching and rate limiting must be distributed. We should introduce Redis early, even at 100-1,000 trx/day, to avoid a painful migration later.
- [x] **Webhook handlers must queue events before processing.** Asynchronous handling prevents timeouts and allows retries of failed webhook processing independent of the provider's retry policy.
- [x] **No compliance constraints, but we should follow security best practices anyway.** Proper webhook verification, raw body preservation, and audit trail integrity are still mandatory for operational trust.
