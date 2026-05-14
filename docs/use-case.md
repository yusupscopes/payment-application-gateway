# Stop Writing Payment Integrations. Write One Gateway.

**Case Study — Node.js · TypeScript · OOP**

> Centralized Application Gateway that abstracts 3 payment providers behind a single unified interface — so internal teams interact with one API, not three.

---

## At a Glance

| Metric                         | Result                   |
| ------------------------------ | ------------------------ |
| Providers unified              | 3                        |
| API surface for all operations | 1                        |
| Operations supported           | charge · refund · verify |
| Provider logic in consumers    | 0                        |

---

## 01 — Problem

### Three Providers, Three Codebases, One Mess

Every internal team that needed to handle payments had to learn the quirks of whichever provider they were using. Different auth mechanisms, different error codes, different retry behaviors, different webhook shapes. When we added a third provider, the fragmentation became unsustainable.

**What was breaking:**

- **Duplicated integration logic across services** — Each team that touched payments re-implemented provider auth, request signing, and error parsing. Three services, three versions of the same Stripe client wrapper.

- **Inconsistent error handling** — Midtrans returns `status_code: "406"` as a string. Stripe throws typed exceptions. Xendit uses HTTP status codes. Every consumer handled failures differently — or silently swallowed them.

- **Adding a new provider meant touching everything** — When the business wanted to add a regional provider, every service that handled payments needed to be updated. There was no single place to make the change.

- **No centralized audit trail** — Payment interactions were logged inconsistently. Finance and ops had no single place to investigate failed transactions.

---

## 02 — Solution

### One Gateway. Every Provider Behind It.

The gateway is a standalone internal service — the **only thing that knows about payment providers**. Internal teams call a single, stable API. The gateway handles provider selection, request translation, retry logic, error normalization, and audit logging. Consumers are completely insulated from provider-specific behavior.

> **Design principle:** "Internal services should never import a payment SDK. They should never know whether a charge went through Stripe or Midtrans. That's the gateway's problem — not theirs."

**Before vs. After:**

|                | Before (Direct Integration)              | After (Via Gateway)                |
| -------------- | ---------------------------------------- | ---------------------------------- |
| SDK imports    | Each service imports Stripe SDK directly | One REST API for all payment ops   |
| Error handling | Error codes differ per provider          | Normalized error shape everywhere  |
| Retry logic    | Duplicated everywhere                    | Lives in one place                 |
| New provider   | Update N services                        | Write one new adapter              |
| Audit trail    | Inconsistent or missing                  | Every transaction logged centrally |

---

## 03 — Providers Integrated

Each provider is implemented as an isolated adapter — same interface, completely different internals. The gateway doesn't care which one it's calling.

### 💳 Stripe

REST API with typed SDK. Exception-based error handling. Idempotency keys for safe retries. Webhook signature verification via HMAC.

- Key challenge: `idempotency keys`

### 🏦 Midtrans

Indonesian payment gateway. Status codes returned as strings in the response body — not HTTP status. Requires server-key auth via Basic Auth header.

- Key challenge: `string status codes`

### ⚡ Xendit

Southeast Asian gateway. Callback-based payment flows (virtual account, e-wallet). Webhook verification via `x-callback-token` header.

- Key challenge: `callback-based flow`

---

## 04 — Architecture

### How the Gateway Is Structured

The architecture has three clear layers:

- **API layer** — accepts requests from internal services
- **Gateway core** — selects the right adapter, applies retry logic, normalizes errors, writes to audit log
- **Adapter layer** — contains all provider-specific code, isolated and replaceable

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

---

## 05 — Interface Design

### The Contract Every Adapter Must Keep

The power of the system comes from one thing: every adapter implements the same interface. The gateway core programs entirely to the interface — it never imports a provider-specific class directly. This is the **Open/Closed Principle** in practice.

```typescript
// core/payment-provider.interface.ts
// The contract. Every adapter implements this — nothing more, nothing less.

export interface IPaymentProvider {
  readonly name: ProviderName;

  charge(payload: ChargePayload): Promise<PaymentResult>;
  refund(payload: RefundPayload): Promise<RefundResult>;
  verify(payload: VerifyPayload): Promise<VerifyResult>;
}

// Normalized result — same shape regardless of provider
export interface PaymentResult {
  success: boolean;
  transactionId: string;
  amount: number;
  currency: string;
  provider: ProviderName;
  providerRef: string; // raw provider transaction ID
  raw: unknown; // original response, always stored
  error?: NormalizedError;
}

// Unified error — no more string status_code parsing in consumers
export interface NormalizedError {
  code: PaymentErrorCode; // 'INSUFFICIENT_FUNDS' | 'CARD_DECLINED' | ...
  message: string;
  retryable: boolean;
}

export type ProviderName = "stripe" | "midtrans" | "xendit";
```

**How one adapter hides provider quirks:**

```typescript
// adapters/midtrans/index.ts
export class MidtransAdapter implements IPaymentProvider {
  readonly name = "midtrans" as const;

  async charge(payload: ChargePayload): Promise<PaymentResult> {
    const res = await this.client.charge(this.toMidtransPayload(payload));

    // Midtrans returns status as string — normalize here, nowhere else
    const success = ["200", "201", "202"].includes(res.status_code);

    return {
      success,
      transactionId: generateId(),
      providerRef: res.transaction_id,
      amount: payload.amount,
      currency: payload.currency,
      provider: "midtrans",
      raw: res,
      error: success ? undefined : this.normalizeError(res),
    };
  }

  // Error normalization is the adapter's responsibility, not the caller's
  private normalizeError(res: MidtransResponse): NormalizedError {
    const retryable = ["408", "503"].includes(res.status_code);
    return {
      code: this.mapStatusToCode(res.status_code),
      message: res.status_message,
      retryable,
    };
  }
}
```

---

## 06 — Design Principles

### The OOP Principles That Drive the Design

**Open / Closed Principle**
Adding a fourth provider means creating a new adapter class. Zero changes to the gateway core, zero changes to consumers. The system is extended, never modified.

**Dependency Inversion**
The gateway core holds a reference to `IPaymentProvider`, never to `StripeAdapter` or `MidtransAdapter`. Provider selection happens at runtime via a registry — not compile-time imports.

**Single Responsibility**
`MidtransAdapter` knows about string status codes. `StripeAdapter` knows about idempotency keys. Neither knows about the other. The gateway core knows about neither.

**Encapsulation**
The Xendit callback flow, Midtrans Basic Auth, Stripe exception types — all of it is completely invisible to internal services. They see one clean result shape, always.

---

## 07 — Request Flow

### What Happens on Every Payment Request

1. **Internal service calls `POST /v1/payments/charge`** `[API Layer]`
   Request includes `provider` field, or omits it to use the default routing rule (e.g. currency-based selection). No provider SDK is imported by the caller.

2. **Gateway validates and routes to adapter** `[Core]`
   Request is validated against a shared schema. The `ProviderRegistry` resolves the correct `IPaymentProvider` instance. Routing rules support currency, region, and explicit override.

3. **Adapter executes the provider-specific request** `[Adapter]`
   All provider-specific logic (auth, payload translation, SDK calls) happens here. The adapter returns a `NormalizedResult` — never a raw provider response.

4. **Retry manager handles retryable failures** `[Core]`
   If `error.retryable === true`, the gateway retries up to 3 times with exponential backoff. Non-retryable errors (insufficient funds, card declined) fail immediately.

5. **Transaction written to audit log** `[Audit]`
   Every request — successful or failed — is persisted with the full normalized result, the raw provider response, request metadata, and latency. **This happens before the response is returned.**

6. **Normalized result returned to caller** `[API Layer]`
   The internal service receives a `PaymentResult` object — same shape regardless of which provider processed it. The caller never handles provider-specific error codes.

---

## 08 — Outcomes

| Outcome                                                        | Result      |
| -------------------------------------------------------------- | ----------- |
| Time to add a fourth provider                                  | 1 day       |
| Provider-specific imports across consuming services            | 0           |
| Transaction audit coverage                                     | 100%        |
| Reduction in time to diagnose a failed payment                 | 3× faster   |
| Payment-related code surface affected by a provider API change | −80%        |
| Error shapes consumers need to handle                          | 1 (unified) |

The most meaningful outcome was invisible to end users — it was felt entirely by the engineering team. The reduction in cognitive load when handling payments went from "which provider is this again?" to "call the gateway."

---

## 09 — Lessons Learned

**01. Design the error taxonomy before any adapter**
I added `NormalizedError` codes incrementally as I built each adapter. This caused inconsistencies — Stripe's `card_declined` and Midtrans's equivalent mapped to slightly different internal codes initially. Designing the full `PaymentErrorCode` enum upfront forces you to think across all providers at once.

**02. Store the raw response — always, immediately**
Twice during development, a provider changed their response schema mid-integration. Because the raw response was stored on every transaction, we could re-parse historical records when the adapter was updated. If we'd only stored the normalized output, that data would be gone.

**03. Idempotency is the gateway's responsibility, not the caller's**
Initially, internal services were expected to pass idempotency keys. In practice, they sometimes forgot. Moving idempotency key generation into the gateway core meant it was automatic — callers couldn't accidentally create duplicate charges even under retry conditions.

**04. Retryable vs non-retryable is a domain decision, not a technical one**
The retry logic seemed like infrastructure at first. It's actually business logic — retrying an "insufficient funds" error wastes API quota and delays the customer experience. The adapter's `normalizeError()` method is where this classification lives, not in a generic HTTP retry wrapper.

---

## 10 — Stack

`Node.js` `TypeScript` `Hono` `Stripe SDK` `Midtrans SDK` `Xendit SDK` `PostgreSQL` `Zod` `Jest` `Docker` `GitHub Actions`

---

_Yusup — Backend Engineer · [yusupwork.com](https://yusupwork.com) · [LinkedIn](https://www.linkedin.com/in/yusup-work)_
