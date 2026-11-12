# PB-04: Check-out

Status: approved on 2026-11-12; implementation approved after independent
architecture review. Commit authorization remains separate.
Sources: [brief](../BRIEF.md), [gates](../docs/gates.md),
[architecture](../docs/architecture.md), [PB-03](PB-03-check-in.md).

## Requirements and decision status

Confirmed: exit gates request checkout with session ID and resident flag; the
response includes space, duration and amount. Residents park free. Calendar-day
caps use Amsterdam local time. Gate retries can overlap after a two-second timeout.

Approved tariff decision: visitor cars cost 500 cents per started hour, capped at
3000 cents per Amsterdam day; motorcycles cost 300 cents, capped at 1800 cents.
A 70-minute car visit within one day costs 1000 cents. This deliberately follows
the published tariff rather than the brief's 583-cent example. The discrepancy
remains a known source contradiction. This is a final developer-selected pilot
decision, not a vendor-confirmed correction or a pending employer approval.
All monetary values are integer euro cents.

The lifecycle below is approved pilot behavior. Completion represents
logical exit eligibility, not observed physical departure. No exit-status endpoint
or outbound barrier integration is introduced.

## Shared lifecycle

This table also governs [PB-05](PB-05-payment-confirmation.md) and
[PB-06](PB-06-occupancy.md). FAILED is an attempt outcome, not a session state.

| Event | Prior state | Result | Billing effect | Allocation | Exit eligibility |
| --- | --- | --- | --- | --- | --- |
| Check-in | No active session | PARKED | Start time recorded | Allocated | No |
| First checkout, charge > 0 | PARKED | AWAITING_PAYMENT | Freeze duration/charge | Retained | No |
| First checkout, charge = 0 | PARKED | COMPLETED | Freeze zero charge | Released | Yes after commit |
| Repeat checkout | AWAITING_PAYMENT / COMPLETED | Unchanged | Return frozen result | Unchanged | Unchanged |
| Valid exact PAID | AWAITING_PAYMENT | COMPLETED | Settle frozen charge | Released | Yes after commit |
| Accepted FAILED | AWAITING_PAYMENT / COMPLETED | Unchanged | Record attempt; never undo PAID | Unchanged | Unchanged |
| Distinct valid PAID after completion | COMPLETED | COMPLETED | Record unexpected event for reconciliation; no second settlement | Unchanged | No new authorization |
| Exact accepted webhook duplicate | Any | Unchanged | No extra effect | Unchanged | Unchanged |
| Payment event before checkout | PARKED | Unchanged | Reject; provider may redeliver | Retained | No |

Approved: billing stops at the first committed checkout; waiting for payment adds
no charge. Completion atomically releases the allocation and makes the session
inactive for PB-03's active-plate invariant. Before completion, including while
awaiting payment, the session remains active. Physical departure is not measured.
Trade-offs: a completed car may briefly remain in its released space; an abandoned
unpaid checkout retains its space while its frozen bill does not increase.
These are approved pilot assumptions, not behavior established by the brief.

## Billing calculation

Approved interpretation: use the elapsed interval [check-in, checkout),
split at Europe/Amsterdam local midnights. For each nonempty daily segment, charge
ceil(elapsed duration / one hour) times its vehicle rate, limited by that day's cap;
sum the daily charges. A zero-length interval costs zero. Exact-hour boundaries
do not add another hour. Use actual elapsed time across DST changes; calendar days
need not be 24 hours. No floating-point money or rounding of time before charging.
Examples: 60 minutes car = 500; 60 minutes plus any positive duration = 1000;
23:30–00:30 car = 500 + 500, because two local calendar days are involved.
This daily segmentation is the approved developer-selected pilot interpretation.

Use the stored check-in resident status and vehicle type, never a new tariff
classification from checkout. Approved: reject a mismatching resident flag with
409 RESIDENT_STATUS_MISMATCH rather than grant a visitor free parking.

## API and idempotency

`POST /check-out`, JSON, per-gate bearer authentication with exit permission for
the session's building; required UUID `X-Request-Id`. Apply PB-03's strict body
validation and 4 KiB limit. Request fields are exactly:

```json
{ "parkingSessionId": "550e8400-e29b-41d4-a716-446655440000", "isResident": false }
```

`200 OK` after commit, for example for a 70-minute visitor car visit:

```json
{ "parkingSpaceId": 51, "sessionLengthInMinutes": 70, "amountDue": { "value": 1000, "currency": "EUR" } }
```

Approved duration presentation: whole elapsed minutes rounded down; monetary
calculation uses unrounded duration. The amount is the original checkout charge,
not a live outstanding balance, and remains unchanged after payment.

Scope the request key by building, check-out operation and UUID. Canonical payload
is canonical session UUID plus boolean resident flag. Atomically persist the
binding and original 200 or terminal business rejection. Identical retries replay;
conflicting reuse returns 409 IDEMPOTENCY_KEY_REUSED. Retain throughout the pilot.
Another request ID for the same checked-out session returns its established result
after validation/resident checks; it never recalculates or releases twice.
Malformed/unauthorized requests and transient 503/500 failures are not terminal
idempotency results. Unknown sessions cannot create a building-scoped binding.

NestJS body parsing precedes guards: malformed or oversized JSON may receive
transport-level 400/413 before authentication. For structurally valid requests,
authenticate the credential and authorize its exit-gate role before business
processing, then validate the request fields. Derive building scope from trusted
gate configuration.
In the application transaction, acquire the transaction-scoped advisory lock for
canonical `(building, check-out, X-Request-Id)`, then resolve an existing outcome
before looking up the supplied session. Key derivation must be deterministic and
consistent across instances, using the gate-request namespace, separate from
payment-event keys.
A matching binding replays; conflicting reuse returns IDEMPOTENCY_KEY_REUSED even
if the changed session ID is unknown. Only for a new key, look up and authorize
session access: unknown or inaccessible sessions return 404 without a binding.
403 denotes gate-role failure, not disclosure of a session in another building.
Any preliminary session lookup is for identification/access checks only, not an
authoritative state check. For a new request, acquire the building lock then the
session lock and revalidate business state before mutation. INSERT the complete
terminal outcome exactly once before commit; `gate_request_outcomes` never holds
a pending/placeholder row that is subsequently updated.

For the first valid PARKED checkout, acquire required coordination locks and verify
session state, then obtain one checkoutAt timestamp from Clock. Use this same
instant for duration and billing and persist it atomically with the frozen result.
If checkoutAt is earlier than checkInAt, return 500 CLOCK_INCONSISTENCY without
state/allocation changes or a persisted terminal request outcome. A later retry
can execute normally. Repeated checkout returns the frozen result without obtaining
a new billing timestamp or recalculating.

Use one application-owned transaction for request coordination, frozen billing,
state/allocation changes and response persistence. Coordinate session changes with
payment handling and follow PB-03's building allocation lock protocol for release.
Use consistent lock order across use cases. Rollback leaves no partial checkout;
lost commit responses are recovered with the same key. Keep bounded waiting and
the approved 1.5-second processing target; contention is 503, not a business result.

Errors use PB-03's error envelope: 400 INVALID_REQUEST, 401 UNAUTHENTICATED,
403 GATE_NOT_AUTHORIZED, 404 SESSION_NOT_FOUND (including inaccessible sessions),
413 PAYLOAD_TOO_LARGE, 415 UNSUPPORTED_MEDIA_TYPE, 409 RESIDENT_STATUS_MISMATCH,
409 IDEMPOTENCY_KEY_REUSED, 503 CHECK_OUT_TEMPORARILY_UNAVAILABLE, 500 CLOCK_INCONSISTENCY or INTERNAL_ERROR.

## Gate integration limitation

The gate notes mention acting on the first 2xx and separately require payment
before opening the exit. They do not fully specify how checkout acknowledgment,
payment-success notification and physical barrier action interact. A checkout 200
reports a frozen charge. Neither checkout 200 nor payment webhook 204 is a
barrier-open command. Backend scope includes checkout, payment settlement and
durable completion; payment-success delivery to exit controllers and physical
barrier commands are excluded. How the exit gate learns payment succeeded remains
an unresolved integration question. No endpoint, polling, callback or undocumented
gate behavior is assumed, and no end-to-end barrier integration is claimed.

## Essential acceptance tests

- Unit tests: resident zero charge, both rates/caps, 70-minute contradiction,
  zero/exact-hour boundaries, per-day splitting, midnight and both DST transitions.
- HTTP tests: bearer/exit permission, strict fields, unknown session, resident
  mismatch, UUID conflict and duration/cent response formats.
- Binding-first lookup: reuse a committed checkout key with a different unknown
  session ID and receive IDEMPOTENCY_KEY_REUSED, not 404; a fresh key for an unknown
  or inaccessible session returns 404 without binding. Wrong gate role returns 403.
- Controlled Clock/lock overlap: timestamp is sampled once after locks/state check;
  earlier-than-check-in time returns CLOCK_INCONSISTENCY without persisted effects
  or terminal binding. Repeats preserve the original timestamp/result.
- Real PostgreSQL with separate connections: simultaneous checkouts freeze one
  time/charge; duplicate and different-ID repeats do not recalculate; positive
  charge retains allocation; zero charge completes/releases exactly once.
- Lost response replay, terminal rejection replay, rollback and transient 503
  recovery; races with PAID leave one consistent frozen charge and completion.
- Completed sessions allow a genuinely new PB-03 event; an unpaid session does not.

## External clarification and implementation gate

Lifecycle/release, daily tariff segmentation, duration presentation and resident
mismatch handling are approved. The tariff interpretation is a final developer-selected
pilot decision despite the conflicting source example. Payment-success delivery to
exit gates remains unspecified and outside backend scope; this prevents claiming
end-to-end barrier integration, not backend implementation. The specification
preceded implementation in Git history. PB-04 tests are implemented; execution
evidence is recorded in the [journal](../JOURNAL.md). Checkout/payment endpoint
race tests remain deferred to PB-05.
