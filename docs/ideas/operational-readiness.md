# Operational Readiness for Payment Gateway

## Problem Statement

How might we ensure the payment gateway shuts down cleanly, logs observably, and resists abuse under production load without losing in-flight transactions or duplicate-processing webhooks?

## Recommended Direction

Take a **production-grade observability** approach that treats operational readiness as a first-class system layer, not an afterthought. The gateway already has excellent architecture (adapters, registry, circuit breaker, async webhooks, metrics). What's missing is the *operational surface area* — the behaviors that keep it healthy when containers restart, logs are queried at 3am, and a provider sends the same webhook three times.

The right sequence is: **shutdown safety first** (prevents data loss), **logging and request tracing second** (makes incidents debuggable), **webhook dedup and body limits third** (prevents duplicate work and abuse). This ordering matters because you can't debug a shutdown failure without logs, and you can't trust webhook logs without dedup.

This direction prioritizes **reliability over novelty**. Every item in the scope is a well-understood production pattern. The discipline is in doing them cohesively: the logger injects correlation IDs from the middleware, the middleware logs request timing, the shutdown handler flushes logs before exit, and the dedup TTL aligns with provider retry windows.

**Why not the "minimal viable ops" path?** The incremental cost of doing this well (configurable log levels, per-route body limits, health-drain integration) is small compared to the rework of ripping out a naive `console.log` → `pino` migration later. The gateway's architecture is clean; its operational layer should be too.

**Why not the "platform" path?** OpenTelemetry tracing and runtime config dashboards are valuable, but they're over-engineering for a gateway handling 100-1,000 transactions/day. The target user is internal services hitting a REST API, not a platform team operating a multi-tenant service.

## Key Assumptions to Validate

- [x] **Redis is available in production** for webhook event deduplication. Fallback: process normally if Redis is unavailable (graceful degradation).
- [x] **The gateway runs under Docker containers** that send SIGTERM on shutdown. Signal handlers are required.
- [x] **Webhook providers retry failed deliveries.** Stripe retries for 3 days, Midtrans for ~24 hours, Xendit varies. A universal TTL of **72 hours** covers all provider retry windows safely.
- [x] **Ops engineers can query logs by correlation ID.** Structured JSON logging is valuable; log aggregator will index the `correlationId` field.
- [x] **Payment request bodies stay under 1MB.** Confirmed (JSON with metadata and customer IDs). Webhook payloads vary, so per-route limits remain necessary.

## MVP Scope

### In

1. **Graceful shutdown with drain signaling**
   - Handle `SIGTERM` and `SIGINT` in `src/index.ts`
   - Stop accepting new HTTP connections (close Hono server)
   - Wait for active requests to finish (configurable timeout, default 10s)
   - Close BullMQ worker gracefully (finish current jobs, don't accept new ones)
   - Close Redis and DB connections
   - Set `/health` to return `503` during shutdown so load balancers drain traffic
   - Flush any buffered logs before exit

2. **Structured JSON logging with correlation awareness**
   - Replace all `console.log` / `console.error` calls with a JSON logger (e.g., `pino` or a lightweight custom wrapper)
    - Log format: `{ timestamp, level, correlationId, message, ...context }` (pino configured with `messageKey: "message"`)
   - Integrate with existing `AsyncLocalStorage` request context so adapters and workers automatically include correlation IDs
   - Configurable log level via `LOG_LEVEL` env var (default `info`)
   - Log startup events (server port, registered providers, Redis/DB connection status)

3. **Request/response logging middleware**
   - Replace `hono/logger()` with a custom middleware that logs structured request/response pairs
   - Include: method, path, status code, duration (ms), correlation ID, API key (hashed/anonymized)
   - Skip logging for `/health` and `/metrics` to prevent log noise
    - Log request body for payment operations (at `debug` level, not `info`)
    - Log webhook event type and ID only (not full body). Full webhook body logging configurable via `LOG_WEBHOOK_BODIES=true` env var

4. **Webhook event deduplication**
   - Extract event ID from each provider's webhook payload (Stripe: `event.id`, Midtrans: `order_id` + `transaction_status` + `status_code`, Xendit: `id` or `external_id`)
    - Store processed event IDs in Redis with a TTL of **72 hours** (universal, covers all provider retry windows)
   - Before processing a webhook, check Redis. If already processed, return `200 OK` immediately without re-enqueueing
   - Graceful fallback: if Redis is unavailable, process the webhook normally (risk of duplicate processing, but better than dropping events)

5. **Request body size limits**
   - Payment routes (`/v1/payments/*`): 1MB max body
   - Webhook routes (`/v1/webhooks/*`): 5MB max body (some providers send large payloads with nested objects)
   - Health and metrics routes: no body expected, but set a generous 10KB cap
   - Return `413 Payload Too Large` with normalized error shape when exceeded

### Out

- **OpenTelemetry tracing** — Valuable but overkill for current scale. The existing correlation ID + structured logs provide sufficient traceability.
- **Admin/ops endpoints for runtime config** — The roadmap mentions `/admin/queue-status` but that's a separate feature. Operational readiness is about behavior, not admin UI.
- **Log sampling or rate-limited logging** — Not needed until traffic exceeds 10,000 requests/minute.
- **Custom log shipping agent** — Assume logs go to stdout and the container runtime/aggregator handles shipping.

## Not Doing (and Why)

- **Adding a new logging dependency without evaluating pino vs. custom wrapper** — `pino` is the standard for Node.js JSON logging and has built-in `AsyncLocalStorage` support. A custom wrapper is unnecessary unless we need a specific serialization format. Decision: use `pino`.
- **Implementing webhook dedup in PostgreSQL first** — Redis is the right place for ephemeral dedup state with TTL. Using PostgreSQL would require a cleanup job and adds write load to the primary DB. Only fall back to PostgreSQL if Redis is proven unavailable in production.
- **Adding body size limits as a global Hono middleware** — A global cap is simpler but wrong. Webhooks can legitimately be larger than payment requests. Per-route limits are only marginally more complex and much safer.
- **Graceful shutdown as a complex state machine** — Some implementations use `Closed → Draining → ShutDown` state machines. For a single-process Hono server, the sequence is simple: stop server → wait for requests → close resources. Don't over-engineer.
- **Replacing `hono/logger()` with a third-party logging middleware** — The built-in Hono logger is fine for development. In production, we want our own middleware for consistent structured output. Both can coexist (Hono logger in dev, custom middleware in production).

## Open Questions — Answered

- **What is the provider retry window for webhooks?** → Stripe retries for 3 days, Midtrans for ~24 hours, Xendit varies. **Decision: 72 hours TTL** covers all providers safely.
- **Does the load balancer respect `503` on `/health` for draining?** → **Yes.** The LB checks `/health` and will drain traffic when it returns `503`.
- **What is the current log aggregation setup?** → stdout to external aggregator. **Decision: configure pino with `messageKey: "message"`** instead of default `msg`.
- **Should webhook body be logged at debug level?** → **Log event type and ID only by default.** Full webhook body logging configurable via `LOG_WEBHOOK_BODIES=true` env var.
