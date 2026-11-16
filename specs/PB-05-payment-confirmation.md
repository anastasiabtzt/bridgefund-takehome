# PB-05: Payment confirmation

Status: approved on 2026-11-12 and committed before implementation.
Implemented in `07942ad`; see [journal](../JOURNAL.md) for verification and review evidence.
Sources: [brief](../BRIEF.md), [provider](../docs/payment-provider.md),
[simulator](../simulator/README.md), [architecture](../docs/architecture.md).
Use the approved [shared lifecycle](PB-04-check-out.md#shared-lifecycle).

## Requirements and approved pilot policies

Confirmed: payment attempts have distinct IDs, integer-cent EUR amounts and PAID
or FAILED status. Provider delivery is at least once and unordered; a response
must arrive within five seconds to avoid retry. Late FAILED cannot undo another
attempt's successful payment. The provider retries non-2xx calls for up to 24 hours.

Approved pilot settlement: only an exact EUR amount matching the frozen positive
checkout charge can settle an AWAITING_PAYMENT session. No partial payments,
overpayments, refunds or pending-event mechanism. PAID completes the session and
releases its space atomically under the approved lifecycle. FAILED records the
attempt without completing, releasing or reversing payment. After checkout,
correctly authenticated, structurally valid FAILED events are durably accepted
with 204 after commit regardless of amount/currency mismatch; only PAID settlement
requires an exact EUR match. Preserve original amount, currency and status.

## Authentication and contract

`POST /webhooks/payments`, `Content-Type: application/json`, required `X-Signature`:
lowercase hex HMAC-SHA256 over the exact raw body with the configured shared secret.
Validate its format and compare securely; JSON reserialization is not signature
input. Verify signatures before business effects or replay. Keep secrets out of logs.
Reject non-identity Content-Encoding with 415 UNSUPPORTED_MEDIA_TYPE before
decompression on this webhook route; do not authenticate an inflated representation
as the original request bytes. Uncompressed JSON retains the 4 KiB limit.

```json
{
  "paymentId": "pay_123",
  "parkingSessionId": "550e8400-e29b-41d4-a716-446655440000",
  "amount": { "value": 1000, "currency": "EUR" },
  "status": "PAID"
}
```

Approved pilot validation: exact documented fields; valid session UUID; nonempty payment
ID up to 128 Unicode code points, excluding NUL and unpaired high/low surrogates;
reject those invalid identifiers with 400 before opening a transaction. Preserve
valid Unicode exactly, without normalization or replacement, for locking, storage
and replay. Other fields: safe nonnegative integer amount; three-uppercase-letter
currency string (only EUR is supported for settlement) and exact status enum;
no coercion; 4 KiB body limit. Respond `204 No Content` after durable acceptance,
including exact duplicates already accepted. This acknowledges processing, not a
claim that every accepted FAILED represents paid parking.

The unsigned legacy-header request contradicts authenticated provider-only access.
Approved safe pilot policy: reject missing/invalid signatures even if
`X-Legacy-Exit: 1` is present. Legacy-only simulator calls should fail authentication.
This is a final developer-selected pilot decision, not pending employer approval:
the legacy header proves no identity. Unsigned legacy terminals are unsupported;
their events cannot establish trusted settlement. This operational limitation is
accepted to preserve provider authentication; no bypass or new integration is added.

## Ordering, deduplication and atomicity

Transport JSON parsing precedes signature authentication: malformed or oversized
JSON may receive 400/413 before authentication. For parseable requests, authenticate
before business validation or effects.

Processing order: authenticate and structurally validate, then start the application
transaction and acquire a transaction-scoped advisory lock for canonical
`(provider, paymentId)`. Derive keys deterministically and consistently across
instances in a payment-event namespace separate from gate-request keys. Resolve
the existing provider/payment-ID binding before session lookup or state evaluation.
Replay an accepted matching duplicate or reject conflicting reuse, including a changed
unknown session ID. Only a new event proceeds to session lookup/state checks and
atomic processing. Retain accepted payment bindings throughout the pilot.

Deduplicate by the fixed pilot provider identity (`pilot`) and payment ID, not session alone.
Bind each accepted ID immutably to canonical session UUID, integer amount, currency
and status. Exact accepted duplicates return 204 without repeating effects.
Conflicting reuse returns 409 PAYMENT_ID_REUSED, preserving the original outcome.
Do not overwrite an accepted FAILED with PAID under the same attempt ID; the
provider contract gives a new attempt its own ID.

Approved smallest safe pre-checkout policy: return 409 CHECKOUT_REQUIRED for PAID
or FAILED while PARKED. Do not durably accept/deduplicate that rejection, so the
same signed event can be reevaluated after checkout. No event buffer is added.
Non-2xx intentionally triggers provider redelivery; if checkout does not happen
within its delivery window, automatic recovery is not guaranteed. Acknowledging
204 and discarding an early PAID would instead risk permanently losing settlement.

For AWAITING_PAYMENT, validate charge/currency only for PAID settlement; accept
a structurally valid FAILED without charge matching and with no billing, settlement
or allocation effects. For COMPLETED,
exact accepted duplicates still return 204. A new valid FAILED can be recorded
without changing settlement. A distinct correctly authenticated, structurally valid
PAID event is durably recorded as an unexpected event requiring reconciliation,
with its immutable payment-ID/payload binding, then acknowledged with 204 only
after commit. Do not settle or release again, or require its amount to match the
already settled charge before recording it for investigation. This also covers
zero-charge completed sessions. Recording the event does not establish that a
duplicate charge actually occurred. Reconciliation is a minimal durable designation
for investigation, not a refund workflow, queue, worker or additional infrastructure.
Identical redeliveries return 204; conflicting reuse still returns PAYMENT_ID_REUSED.

One application transaction owns attempt binding, applicable charge validation,
reconciliation designation or payment/session changes and release. Coordinate
with checkout using the building-then-session lock order after payment-identity locking. Any preliminary
session lookup is only for identification/access; revalidate business state under
these locks before applying a new event. INSERT its complete immutable accepted
binding once, never a pending row followed by UPDATE. PostgreSQL constraints and
locking prevent two distinct PAIDs settling/releasing twice. Concurrent exact duplicates replay
after commit; rollback leaves no new accepted attempt or partial release. Bound
database waits; 503 is transient and not a terminal deduplication result. A lost
commit acknowledgment is reconciled through the original payment ID.

## Errors

Use PB-03's error envelope. 400 INVALID_REQUEST; 401 INVALID_SIGNATURE;
404 SESSION_NOT_FOUND; 413 PAYLOAD_TOO_LARGE; 415 UNSUPPORTED_MEDIA_TYPE;
409 CHECKOUT_REQUIRED, PAYMENT_ID_REUSED or PAYMENT_MISMATCH;
503 PAYMENT_TEMPORARILY_UNAVAILABLE; 500 INTERNAL_ERROR.
Mismatch includes unsupported currency or a charge mismatch when settling an
AWAITING_PAYMENT session for PAID. FAILED amount/currency mismatches are accepted
after checkout. A structurally valid new PAID after completion is instead
recorded for reconciliation, even with an unexpected amount/currency.
Shape/type errors are 400. Authenticate before disclosing session existence.
Only accepted business events are bound for deduplication; rejected events do not
replace accepted bindings. Non-2xx errors do not tell the provider to stop retrying.

## Essential acceptance tests

- HTTP tests: exact raw-body HMAC including simulator whitespace/newline, changed
  bytes, missing/malformed/incorrect signatures and legacy-header-only rejection.
- FAILED then distinct PAID, repeated PAID, late FAILED, same-ID payload conflict,
  wrong amount/currency while awaiting settlement and unknown session.
- Mismatched FAILED after checkout, both AWAITING_PAYMENT and COMPLETED: commit
  original amount/currency/status and return 204; billing, settlement, session and
  allocation remain unchanged. Duplicate replays; conflicting reuse returns 409.
- Resolve accepted IDs before session lookup: conflicting reuse with an unknown
  session still returns PAYMENT_ID_REUSED, while an exact duplicate replays 204.
- New PAID after paid or zero-charge completion: commit one unexpected-event
  reconciliation record and immutable binding before 204; no additional settlement,
  release or session change, and no assertion that a duplicate charge occurred.
  Include unexpected amounts/currencies, identical redelivery and conflicting reuse.
- Rollback of reconciliation recording must not acknowledge 204 or retain a partial
  binding; redelivery can record it. Concurrent identical events create one record;
  concurrent distinct events each remain investigable without repeat release.
- PAID before checkout returns 409 without accepted binding; identical redelivery
  after checkout can settle. Race outcome depends on serialized checkout order.
- Real PostgreSQL/separate connections: duplicate and distinct concurrent PAIDs,
  checkout/payment races, rollback and atomic release/active-plate deactivation.
- No acceptance test should interpret webhook 204 as a signal delivered to a gate.

HMAC-only authentication, settlement/reconciliation policies, uncached pre-checkout
409 with its 24-hour redelivery limitation and the shared lifecycle are approved.
HMAC-only authentication is a final developer-selected pilot decision; unsigned
legacy terminals remain unsupported. Backend scope covers settlement and durable
session completion, but excludes payment-success delivery to exit controllers and
physical barrier commands. Checkout 200 and webhook 204 are not barrier-open
commands. How the gate learns payment success remains unresolved; no endpoint or
callback is assumed and no end-to-end barrier integration is claimed.
The acceptance criteria above were specified before implementation; actual executed
checks and their outcomes are recorded in the [journal](../JOURNAL.md).
