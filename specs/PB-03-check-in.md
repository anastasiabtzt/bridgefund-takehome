# PB-03: Check-in

Status: draft for user review. Implementation requires review and a separate spec commit first.

## Scope and sources

Start a parking session and allocate a space through `POST /check-in`.
Sources: [brief](../BRIEF.md), [gate notes](../docs/gates.md),
[approved architecture](../docs/architecture.md) and the user's PB-03 directions.
Checkout, billing, payment processing and multi-building management are excluded.

### Requirement and decision status

- **Confirmed by the brief/integration notes:** pilot building `PB-AMS-9X4T`;
  entrance gates only; request and success shapes below; exclusive allocation;
  equivalent plate representations; gate timeout/retry behavior below.
- **Directed for this draft:** eligible ranges, lowest available allocation,
  building/operation/request-ID scope, durable success replay, retryable full
  outcomes, payload-conflict handling and database-enforced plate uniqueness.
- **Approved PB-03 review decisions:** terminal duplicate-plate rejection replay;
  configurable full-attempt retry window (default 60 seconds from first durable
  binding); fixed deadlines and record retention throughout the pilot. Resident
  eligibility and the 60-second default remain explicit pilot assumptions, not
  confirmed vendor requirements.
- **Approved architecture:** Parking owns check-in; one application use case owns
  the transaction; PostgreSQL/Drizzle provide persistence and concurrency control.
- **Approved pilot API decisions:** per-gate bearer authentication and entrance
  authorization, strict JSON validation with the provisional limits below,
  building-wide check-in request-ID scope and a 1.5-second processing target.
  These are project design decisions, not vendor-confirmed requirements or an SLA.

## API contract

`POST /check-in` over HTTPS, with `Content-Type: application/json` and exactly one
`X-Request-Id` containing a valid UUID. UUID text is compared canonically.

Approved pilot authentication: `Authorization: Bearer <gate-secret>`, using independently
configured high-entropy gate credentials outside version control. The credential
maps to a gate identity, building and entrance permission. The pilot building is
derived from trusted configuration, never a body field. Authenticate every retry;
the request ID is not a credential. No outbound provider integration is needed.

```json
{ "vehicleType": "CAR", "isResident": false, "licensePlate": "AB-123-C" }
```

- Require exactly these fields; reject unknown fields, missing values and coercion.
- `vehicleType`: exactly `CAR` or `MOTOR`; `isResident`: JSON boolean.
- Approved provisional plate validation: 1–32 ASCII characters before normalization, containing
  only letters, digits, ASCII spaces and hyphens. Uppercase and remove spaces and
  hyphens; the result must contain 1–16 letters/digits. These limits are assumptions,
  not a claim to recognize every national plate format.
- The canonical payload is `(vehicleType, isResident, normalizedLicensePlate)`;
  JSON ordering and equivalent plate formatting do not cause conflicts.
- Approved provisional JSON body limit: 4 KiB. Do not return or log credentials or plate values
  in error messages. Do not expose an existing session ID on duplicate-plate errors.

Successful new check-in and successful replay return the same original status and body:

```http
201 Created
Content-Type: application/json
```

```json
{ "parkingSessionId": "550e8400-e29b-41d4-a716-446655440000", "parkingSpaceId": 51 }
```

The session ID is a UUID and the space ID an integer. Send success only after commit.
Never return a pending `202` or another success status before allocation is durable.

Errors use `{ "error": { "code": "PARKING_FULL", "message": "No eligible space is available." } }`.
Clients branch on status/code, not message text.

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | INVALID_REQUEST | Malformed JSON, invalid/missing/duplicate request-ID header or invalid fields. |
| 401 | UNAUTHENTICATED | Missing or invalid gate credentials. |
| 403 | GATE_NOT_AUTHORIZED | Authenticated caller lacks entrance permission for the building. |
| 413 | PAYLOAD_TOO_LARGE | Body exceeds the provisional limit. |
| 415 | UNSUPPORTED_MEDIA_TYPE | Request is not JSON. |
| 409 | IDEMPOTENCY_KEY_REUSED | Retained key is bound to another canonical payload. |
| 409 | VEHICLE_ALREADY_CHECKED_IN | An unfinished, unexpired request finds an active session for the normalized plate in this building. Persist and replay this terminal rejection. |
| 409 | PARKING_FULL | No eligible space at the coordinated allocation decision point. Same-key reevaluation is permitted only within its fixed retry window. |
| 409 | CHECK_IN_ATTEMPT_EXPIRED | An unfinished attempt has reached its deadline. Persist/replay this terminal rejection without allocation; retain the binding. |
| 503 | CHECK_IN_TEMPORARILY_UNAVAILABLE | Bounded wait exceeded, database unavailable or transient transaction conflict not resolved within budget. Retry with the same key. |
| 500 | INTERNAL_ERROR | Unexpected failure; disclose no internals. An uncertain outcome must be reconciled with the same key. |

For valid authenticated requests, check payload conflict, then replay any committed
success or terminal rejection before expiry, duplicate-plate or capacity checks.
A successful replay is not rejected because its own session exists or its retry
window has expired. For unfinished attempts, check expiry before duplicate plate,
and duplicate plate before reporting full.

## Allocation and vehicle invariants

| Request | Eligible spaces |
| --- | --- |
| Resident, CAR or MOTOR | 1–50 |
| Visitor CAR | 51–130 |
| Visitor MOTOR | 131–150 |

Choose the lowest available eligible ID at the serialized allocation decision.
Do not spill into another range. Approved pilot assumptions: resident CAR and
MOTOR requests use 1–50, and the backend accepts resident status asserted through
an authenticated entrance gate. Gate authentication does not independently prove
resident entitlement. The brief and gate notes describe the resident selection
but do not explicitly confirm both vehicle types or entitlement verification;
business clarification remains pending (question 2 below).

Within a building, a space must never have two simultaneous allocations, and a
normalized plate must never have two simultaneously active sessions, regardless
of request ID, vehicle type or resident flag. Protect both with PostgreSQL
constraints, not application checks alone. Map plate conflicts to the specified
business error; do not treat exclusivity failures as successful allocation.

A new session is active and its space allocated. PB-03 does not decide when a
session becomes inactive or a space is released. Those lifecycle definitions
must be settled in the relevant checkout/payment specs; do not equate the two
concepts or assume that either checkout or payment releases a space.

## Idempotency and transaction guarantees

Scope identity by `(building, check-in operation, X-Request-Id)`, not individual
gate. Both entrance gates share this scope; authorize each request independently.
Persist the immutable canonical payload binding and each committed success or
terminal rejection's original status/body. Retain records throughout the pilot,
including after session changes. Attempt expiry must not delete or reset a binding.
Production data-retention/cleanup policy remains open.

An unfinished attempt may allocate only within a configurable retry window,
default 60 seconds, measured from the first durable request binding. Persist its
deadline. Once a durable binding exists, retries (including those returning 503)
and configuration changes do not extend its deadline. If an initial transaction
completely rolls back or fails before establishing a durable binding, a later
retry may establish a new binding and deadline; no original deadline survives.
The 60-second default is an approved provisional pilot assumption, not a vendor
requirement. At or after the deadline the attempt is expired. Record retention
protects identity/replay; it does not grant indefinite permission to allocate.

| Current outcome | Identical retry |
| --- | --- |
| Committed success | Replay original 201 indefinitely while retained, regardless of deadline or session state. |
| Terminal VEHICLE_ALREADY_CHECKED_IN | Replay original 409 even after the prior session ends. A new legitimate arrival needs a new ID. |
| Unfinished/full before deadline | Reevaluate; may become full again, successful, or terminal duplicate-plate rejection. |
| Unfinished at/after deadline | Become terminal CHECK_IN_ATTEMPT_EXPIRED; no allocation. |
| Terminal CHECK_IN_ATTEMPT_EXPIRED | Replay original 409; never reopen the attempt. |

Conflicting canonical payload always returns IDEMPOTENCY_KEY_REUSED for a retained
binding, including after rejection or expiry; it does not change the bound outcome.

One application transaction coordinates the following logical steps; this is a
behavioral/concurrency contract, not a table or class design:

1. Create or lock the uniquely constrained key binding. Concurrent duplicates
   coordinate through PostgreSQL and bounded waits, across application instances.
2. Compare canonical payload; conflict returns 409 without changing the binding.
   If success or terminal rejection exists, replay it without allocation or other
   session mutation.
3. Acquire a short transaction-scoped building allocation lock, then read current
   committed plate/allocation state in a fresh READ COMMITTED statement.
4. After obtaining the necessary coordination locks and before allocation, check
   the deadline using current time from the Clock, not a timestamp captured before
   lock waiting. If expired, commit terminal CHECK_IN_ATTEMPT_EXPIRED and return 409.
   Reaching the allocation decision before expiry permits its bounded transaction
   to finish; this is not a physical-entry deadline.
5. If the plate is already active, commit the canonical binding and original
   terminal VEHICLE_ALREADY_CHECKED_IN 409 outcome without a new session.
6. If genuinely full, commit the payload binding and fixed deadline without a
   terminal result. Return PARKING_FULL. Later same-payload attempts may allocate
   only before the deadline; conflicting payloads remain rejected.
7. Otherwise create one active session, allocate the lowest eligible space and
   persist the original response atomically. Commit before returning 201.

No independently committed processing claim, lease, Redis, external distributed
lock service or nested transaction is needed. A retained unsuccessful binding is
not owned by a worker; an unfinished, unexpired attempt can retry under database locking.
All availability-changing operations, including future release operations, must
follow the same building-lock protocol and consistent lock ordering. Database
constraints remain the final safeguard. Do not use SKIP LOCKED to infer fullness.

If the first transaction rolls back, its new binding and parking effects all
disappear, including its original timestamp; a waiter can proceed and establish a
new binding/window. Thus the window bounds durably remembered attempts, not time
since the first physical event or first received request. An older committed binding survives a failed
retry. If success commits but its response is lost, a retry replays success.
If commit acknowledgment is lost, the outcome is uncertain: never assume rollback
or generate a new key automatically. Replay protection lasts while records are retained.

Use bounded end-to-end waiting, including pool acquisition, key/allocation locks
and execution. Approved pilot server budget: 1.5 seconds, leaving nominal transport
margin below the gate's two seconds; this is a target to test, not a network SLA.
Wait exhaustion returns 503, never PARKING_FULL. A client disconnect does not
prove rollback. Two overlapping same-key requests may both observe full, or one
may observe full before another succeeds after a release; late responses can
arrive out of order. After success, subsequent decisions replay that success.

## Gate retries and limitations

Confirmed: gates wait two seconds and retry without an answer with the same UUID,
up to three retries; retries can overlap. The barrier acts on its first 2xx.
The API must therefore tolerate lost responses and overlapping processing.

Not confirmed: retries after explicit 409/503 responses, Retry-After support,
cross-gate retransmission, maximum delayed replay and treatment of late failures
after success. The API permits same-key reevaluation after full/503 only while
unfinished and within its window (committed outcomes still replay); it cannot guarantee
that existing gate firmware will do so, or that admission eventually succeeds.
A distinct event requires a fresh UUID; changing IDs to recover an uncertain
outcome is unsafe. Different IDs are not idempotency duplicates, but remain
subject to the active-plate invariant. A stale successful replay must not be
interpreted by the gate as authorization for a different physical arrival; the
gate must correlate responses with its current event. Backend replay safety alone
does not establish safe physical barrier behavior.

## Acceptance criteria and verification

| Case | Expected evidence |
| --- | --- |
| Eligible allocation | Resident CAR/MOTOR and both visitor types receive the lowest free ID in their range, including range boundaries and gaps. |
| Range full | Full eligible range returns PARKING_FULL even if other ranges have capacity; no session/allocation is created. |
| Capacity later available | Before the fixed deadline, a controlled availability change lets an identical full-key retry succeed once; binding remains payload-protected. No production release policy is inferred. |
| Fixed retry window | Default is 60 seconds from first durable binding; configured duration applies to new bindings. Once a durable binding exists, repeated full/503 retries and configuration changes preserve its deadline. |
| 503 before durable binding | If an initial attempt fails or completely rolls back without a durable binding, repeated 503 responses do not establish or preserve an original deadline. A later retry may commit a new binding and deadline. Contrast with 503 after an existing durable binding: that deadline remains unchanged. |
| Expired attempt | At and after deadline, an unfinished full-key attempt returns terminal CHECK_IN_ATTEMPT_EXPIRED even with free capacity. Binding remains; repeated retries cannot allocate or reset its deadline. |
| Deadline after lock wait | Request begins before expiry but obtains coordination locks at/after deadline: expired, no allocation. Test with controlled Clock and real lock overlap. |
| Validation/authentication | Invalid UUID/body/types/plate, unsupported content type, oversize body and unauthorized callers receive the specified errors with no new key/session/allocation. |
| Lost success response | Commit and discard the response; retry yields original 201/body and exactly one session/allocation. |
| Canonical replay | Different JSON ordering, plate case/spaces/dashes and UUID text case replay the same successful result. |
| Payload conflict | Change resident/type/normalized plate under a retained key after full, success, terminal duplicate-plate rejection or expiry: 409 IDEMPOTENCY_KEY_REUSED, original binding/outcome unchanged. |
| Concurrent duplicates | Separate connections/application instances with the same payload/key create at most one session; waiters replay success or receive bounded 503. Concurrent conflicting payloads cannot both bind successfully. |
| Simultaneous distinct vehicles | Overlapping check-ins receive distinct lowest IDs in serialization order; with one eligible space left, exactly one succeeds and the other is full. Arrival order is not guaranteed. |
| Duplicate plate | Sequential or racing distinct keys, including different resident flags and equivalent plates, produce one active session and VEHICLE_ALREADY_CHECKED_IN for the other; no extra allocation. |
| Terminal duplicate-plate replay | End the earlier session through controlled test setup; the rejected key still replays its original 409, including after retry-window expiry. A new legitimate arrival uses a new ID. |
| Constraint protection | Bypassing application prechecks still cannot commit duplicate active plates or simultaneous space allocations. |
| Rollback | Inject failure before commit: no partial success, new binding or original timestamp remains. A waiting retry may establish a fresh window; an older binding/deadline survives a retry rollback. |
| Temporary contention | Hold coordination locks: timeout produces 503, not full. Releasing locks within budget allows normal reevaluation. |
| Concurrent release | Availability changes follow the same building lock; full means full at a decision point, not full forever. Both-full and full-then-success duplicate outcomes remain safe. |
| Historical replay | After deadline and a controlled later session-state change, successful key still returns original 201 without reactivation/allocation. Gate must not treat it as a new physical arrival. |

Critical race, locking, rollback and constraint tests must use real PostgreSQL,
separate connections and coordinated overlap, not mocks or a shared rollback-only
test transaction. Unit tests cover normalization/eligibility; HTTP tests cover
the full contract. No tests have been implemented or run for this draft.

## Questions requiring review

1. Pilot API choices are approved: per-gate bearer authentication and entrance
   authorization, strict validation/provisional limits, building-wide scope and
   the 1.5-second performance target. They are not vendor-confirmed requirements.
2. Seek business confirmation of both resident vehicle types and entitlement
   policy. For now, approved pilot assumptions allow both in 1–50 without overflow
   and accept gate-asserted status without independently proving entitlement.
3. Confirm actual firmware behavior under the approved building-wide scope after full/503,
   delayed/reordered responses and cross-gate retries.
4. Confirm vendor timing/abandoned-event behavior against the provisional default
   60-second window. Retention throughout the pilot, terminal duplicate-plate
   replay and terminal attempt expiry are approved; define production retention
   before cleanup. First receipt cannot be aged after complete rollback without
   additional evidence; this limitation is accepted in the current design.
5. Define session inactivity and space release in later lifecycle specifications.
   Until then, PB-03 only creates active sessions; do not invent a release endpoint.
6. Pricing contradiction and unsigned legacy payment authentication remain open
   in the architecture. Neither is resolved or implemented by check-in.

If business clarification is unavailable, approved assumptions must stay explicit,
justified and revisable. They must never be presented as confirmed requirements.
