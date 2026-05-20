# Code Review: Operational Readiness Implementation

## Context

Review of the operational readiness feature implementation that adds graceful shutdown, structured logging (pino), request/response logging middleware, webhook deduplication, and body size limits to the payment gateway.

**Files reviewed:**
- `packages/env/src/server.ts`
- `apps/server/src/core/logger.ts` + `logger.test.ts`
- `apps/server/src/middleware/body-size-limit.ts` + `body-size-limit.test.ts`
- `apps/server/src/middleware/request-logger.ts` + `request-logger.test.ts`
- `apps/server/src/routes/webhooks.ts` + `webhooks.dedup.test.ts` + `webhooks.errors.test.ts`
- `apps/server/src/routes/health.ts` + `health.shutdown.test.ts`
- `apps/server/src/queue/webhook-worker.ts`
- `apps/server/src/app.ts` + `app.shutdown.test.ts`
- `apps/server/src/index.ts`

**Tests:** 163 pass, coverage 90.14%
**Lint:** Biome clean
**Types:** TypeScript compiles without errors

---

## 1. Correctness

### Critical: Webhook dedup key fallback for Stripe is wrong

**File:** `src/routes/webhooks.ts` lines 18-25

```typescript
// Stripe event payload has event.id
if (
  typed.data &&
  typeof typed.data === "object" &&
  typed.data !== null &&
  typeof (typed.data as Record<string, unknown>).id === "string"
) {
  return `webhook:stripe:${(typed.data as Record<string, unknown>).id}`;
}
```

**Problem:** The fallback to `data.id` creates dedup collisions. A Stripe webhook event has a unique `id` at the top level (`evt_123`). The `data.id` is the ID of the object the event is about (e.g., `pi_xxx` for a PaymentIntent). Multiple events about the same PaymentIntent (e.g., `payment_intent.created`, `payment_intent.succeeded`) would share the same `data.id`, causing false duplicate detection.

**Fix:** Remove the `data.id` fallback. If `typed.id` is missing, the event isn't a valid Stripe event and shouldn't be deduplicated.

```typescript
case "stripe": {
  if (typeof typed.id === "string") {
    return `webhook:stripe:${typed.id}`;
  }
  return null;
}
```

### Important: Request body logged at wrong level

**File:** `src/middleware/request-logger.ts` lines 55-66, 77-79

The request body is added to `logData` (which gets logged at info/warn/error level depending on status code), AND a separate debug log is emitted. This means:
- The body appears in the main request log (which is often at info level)
- The body ALSO appears in a separate debug log

The spec says "Payment request bodies are logged at debug level only." The body should NOT be in the main request log.

**Fix:** Remove body from `logData`. Only log it in the separate debug statement.

```typescript
// Remove this block (lines 55-66):
if (logBodies && path.startsWith("/v1/payments") && c.req.method !== "GET") {
  try {
    const body = await c.req.json();
    logData.body = body;  // <-- remove this
  } catch {
    // ignore
  }
}

// Keep the debug log (lines 77-79) but log the body there:
if (logBodies && path.startsWith("/v1/payments") && c.req.method !== "GET") {
  try {
    const body = await c.req.json();
    logger.debug({ body, path }, "Request body");
  } catch {
    // ignore
  }
}
```

### Important: getContextualLogger creates new pino instance on every call

**File:** `src/core/logger.ts` line 24

```typescript
export function getContextualLogger(baseLogger?: Logger): Logger {
  const logger = baseLogger ?? createLogger();  // <-- new instance every time!
```

If no `baseLogger` is passed, a brand new pino instance is created on every call. This is wasteful (allocates streams, serializers, etc.).

**Fix:** Create a default logger once at module level.

```typescript
const defaultLogger = createLogger();

export function getContextualLogger(baseLogger?: Logger): Logger {
  const logger = baseLogger ?? defaultLogger;
  // ...
}
```

### Nit: Shutdown timeout parsing without NaN guard

**File:** `src/index.ts` line 17

```typescript
const shutdownTimeoutMs = Number.parseInt(env.SHUTDOWN_TIMEOUT_MS, 10);
```

If `SHUTDOWN_TIMEOUT_MS` is set to an invalid value like `"abc"`, `parseInt` returns `NaN`. The `setTimeout` on line 32 will fire immediately (or behave unpredictably with `NaN`).

**Fix:** Add a fallback.

```typescript
const shutdownTimeoutMs = Number.parseInt(env.SHUTDOWN_TIMEOUT_MS, 10) || 10000;
```

---

## 2. Readability & Simplicity

### Optional: `app.ts` is getting long (195 lines)

The `createApp` function is approaching 200 lines. Consider extracting the webhook route setup into a helper, or the payment route setup. Not required for this PR, but worth noting for future refactors.

### Nit: `extractDedupKey` uses nested `as` casts

**File:** `src/routes/webhooks.ts` lines 18-25

The nested `as Record<string, unknown>` casts in the Stripe `data.id` fallback are hard to read. Since this fallback should be removed per the correctness finding above, this becomes moot.

### Optional: `index.ts` has redundant `server.close()`

**File:** `src/index.ts` lines 23 and 34

```typescript
server.close();  // line 23 - redundant

// ... inside promise:
server.close(() => {  // line 34 - this is the one that matters
  clearTimeout(timer);
  resolve();
});
```

The first `server.close()` on line 23 is unnecessary. The second call on line 34 both initiates closing and provides the completion callback. Remove line 23.

### Consider: `request-logger.test.ts` mock logger duplication

The `createMockLogger` helper is clean and well-structured. No changes needed.

---

## 3. Architecture

### Approve: Returning resources from `createApp()` is clean

The `AppResources` interface and the return value change are backward-compatible for consumers that only need `app` (they can destructure), while allowing `index.ts` to access shutdown resources. Good pattern.

### Approve: Logger integrates with existing AsyncLocalStorage

The `getContextualLogger` function piggybacks on the existing `runWithRequestContext` infrastructure. No new propagation mechanism needed. Clean reuse.

### Approve: Body size limit as standalone middleware

The `bodySizeLimit` middleware is decoupled from route logic and reusable. Good separation.

### Optional: `env.LOG_WEBHOOK_BODIES` is a string, not boolean

**File:** `packages/env/src/server.ts` line 22

```typescript
LOG_WEBHOOK_BODIES: z.string().default("false"),
```

This works because the comparison is `env.LOG_WEBHOOK_BODIES === "true"`, but it's inconsistent with how booleans are typically handled. The t3-oss/env-core package may not support boolean coercion, so this is acceptable. Just noting it.

---

## 4. Security

### Approve: API keys are hashed before logging

**File:** `src/middleware/request-logger.ts` lines 34-37

```typescript
const hashedApiKey = apiKey
  ? `sha256:${createHash("sha256").update(apiKey).digest("hex")`
  : undefined;
```

Raw API keys never appear in logs. Good.

### Approve: Webhook bodies require opt-in

`LOG_WEBHOOK_BODIES` defaults to `false`, so PII in webhook bodies isn't logged by default. Good conservative default.

### Approve: Body size limits prevent DoS

Payment routes capped at 1MB, webhooks at 5MB. Reasonable limits.

### Approve: No secrets in code

All secrets come from env vars. No hardcoded keys or credentials in the implementation.

---

## 5. Performance

### Approve: No synchronous I/O in hot paths

All Redis operations are async. Logging is synchronous (pino's default stdout mode), which is fast enough for the expected 100-1000 trx/day volume.

### Optional: `request-logger.ts` reads body twice

**File:** `src/middleware/request-logger.ts` lines 61 and 77-79

If `logBodies` is true, the code calls `c.req.json()` on line 61 (inside the `if` block), and potentially again on line 77-79 (if the separate debug log is kept after fixing the redundancy issue). Hono's request body can only be consumed once. The second `c.req.json()` would throw and be caught by the `catch` block, silently failing.

If you want to log the body at debug level only, you need to read it once and store it. But since the current code on line 61 is in the main log path and should be removed per the correctness finding, this becomes moot.

Actually, let me re-check. After the correctness fix:
- Remove the body from logData (lines 55-66)
- Keep only the debug log at the end

Then the body is only read once, which is correct.

---

## Simplification Opportunities

### 1. Remove Stripe `data.id` fallback in `extractDedupKey`

**Rationale:** Creates false duplicates. The top-level `id` is the correct dedup key for Stripe events.

### 2. Fix body logging to be debug-only

**Rationale:** Currently leaks payment bodies into info-level logs.

### 3. Cache default logger in `getContextualLogger`

**Rationale:** Avoids creating a new pino instance on every call.

### 4. Remove redundant `server.close()` in `index.ts`

**Rationale:** The second call with the callback is sufficient.

### 5. Add NaN guard for shutdown timeout

**Rationale:** Prevents immediate timeout if env var is malformed.

---

## Test Review

### Approve: Tests cover the right things

- Logger tests verify JSON output format and correlation ID injection
- Body size limit tests verify both pass and reject cases
- Request logger tests verify exclusion, hashing, and body logging
- Webhook dedup tests verify duplicate detection and Redis fallback
- Webhook error tests verify all error paths (unknown provider, unimplemented, invalid JSON, verification failure, queue enqueue)
- Health shutdown test verifies 503 during shutdown
- App shutdown test verifies the shutdown function works end-to-end

### Optional: Missing test for `getContextualLogger` without baseLogger

There's no test that calls `getContextualLogger()` without passing a `baseLogger`. This is the path that creates a new pino instance each time. After caching the default logger, this test becomes less critical.

---

## Dead Code Check

No dead code identified. All new files are used. All modified code paths are reachable.

---

## Verdict

**Approve with required changes.**

The implementation is solid and follows project conventions. Three required fixes before merge:

1. **Critical:** Remove Stripe `data.id` fallback in `extractDedupKey` (correctness)
2. **Important:** Fix request body to only log at debug level, not in main request log (correctness + security)
3. **Important:** Cache default logger in `getContextualLogger` (performance)

Two recommended cleanups:

4. Remove redundant `server.close()` in `index.ts` (simplicity)
5. Add NaN guard for shutdown timeout parsing (robustness)
