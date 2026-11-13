# ParkingBusiness architecture

Status: approved high-level design. PB-04–PB-06 now define the approved
pilot lifecycle and billing policies; genuine external questions remain below.

## Confirmed requirements and system context

The pilot serves building `PB-AMS-9X4T`, with 150 spaces, resident/car/motorcycle
eligibility rules, two entrance gates and two exit gates. Allocation must prevent
two vehicles receiving the same space. Calendar days use Amsterdam local time.
See [the brief](../BRIEF.md) for the requirements and its pricing contradiction.

- **Gates:** authenticated REST check-in/check-out over HTTPS. Requests can overlap
  and retry with the same `X-Request-Id`; the gate waits two seconds for a response.
  Plate representations can differ in case, spaces and dashes. See [gate notes](gates.md).
- **Payment provider:** payment-attempt confirmations can be duplicated and arrive
  out of order. Signed requests use HMAC-SHA256 over the raw body. The provider
  expects a response within five seconds. Its unsigned legacy exception conflicts
  with the authentication requirement. See [provider notes](payment-provider.md).
- **Public display:** reads occupancy without authentication; responses must not
  expose plates or session/payment details.
- **Simulator:** an external test client for signed confirmations, retries, failed
  attempts, out-of-order delivery and legacy calls. See [simulator documentation](../simulator/README.md).

The backend scope covers checkout, payment settlement and durable session completion
in PostgreSQL. It excludes outbound payment initiation, delivery of payment success
to exit-gate controllers and physical barrier commands. PB-03 through PB-06
endpoints are implemented. Checkout 200 and webhook 204 are not barrier-open commands.

## Architectural decisions

Use NestJS and TypeScript for a REST API, PostgreSQL with Drizzle for persistence,
and a modular monolith: one application deployment and one database. These are
chosen implementation decisions, not technologies mandated by the brief.

### Domain responsibilities and application modules

Parking and Payments are Nest application modules. Billing is calculation/domain
logic called by Parking checkout, without a separate Nest module.

| Area | Responsibilities |
| --- | --- |
| Parking | Allocation, session lifecycle, eligibility policies, plate normalization, gate-request idempotency and public occupancy reads. Owns space exclusivity. |
| Billing | Deterministic duration, tariff and rounding calculations, including Amsterdam calendar-day boundaries. Does not own session transitions or payments. The final developer-selected pilot tariff is documented in PB-04; the contradictory €5.83 source example remains noted, not an approval dependency. |
| Payments | Payment-attempt identity, duplicate/conflicting confirmations and payment-state rules. A late failed attempt must not undo a different successful payment. |

Keep allocation and sessions together because their invariants are tightly coupled.
Occupancy is a read-only Parking operation over committed state, with no separate
NestJS module or projection store. Modules expose narrow application operations
and do not access each other's persistence internals.

Keep building context explicit so the pilot does not depend on an implicit global
building. Do not implement multi-building management or tariff administration now.

### Domain, application and infrastructure

- **Domain:** explicit business invariants, policies and valid transitions in plain
  TypeScript, independent of NestJS, HTTP and Drizzle.
- **Application:** coordinate use cases and module interactions, obtain time,
  invoke domain behavior and own transaction boundaries.
- **Infrastructure:** REST controllers, caller authentication, raw-body signature
  verification, input validation, Drizzle persistence and configuration.

Use a minimal Clock abstraction for the current instant. Application use cases
obtain time through it and pass explicit timestamps into domain calculations.
Tests control time without sleeps; Amsterdam date interpretation belongs to
billing policy, not the Clock. Avoid generic repositories and speculative layers.

### Transactions, idempotency and concurrency

One application use case owns one database transaction, including coordinated
operations across modules. Participants use the same transaction context; they
must not independently start or commit transactions that permit partial updates.

| Use case | Atomic work |
| --- | --- |
| Check-in | Request deduplication, allocation, session creation and preservation of the replayable result. |
| Check-out | Session changes, the established Billing result and preservation of the replayable result. Freeze billing at checkout; zero-charge completion releases allocation. |
| Payment confirmation | Attempt deduplication, validated payment effects and any agreed Parking effects. Exact payment completes/releases atomically; extra PAID events after completion are recorded for reconciliation. |
| Occupancy | Read-only query of committed allocation state; no mutation workflow. |

`X-Request-Id` identifies a gate event; it does not itself guarantee idempotency.
Persist request identity, relevant payload and replayable outcome atomically with
the business effect. Coordinate simultaneous duplicates and detect reuse with a
conflicting payload instead of silently replaying or applying another operation.
Apply equivalent identity/conflict handling to payment confirmations. Exact key
scope, conflict responses and retention belong in feature specifications.

Gate coordination order, after authentication and structural validation:
transaction-scoped advisory lock for canonical `(building, operation, requestId)`,
then outcome lookup/replay or payload-conflict rejection. For a new request,
acquire the building lock, then any required session lock, revalidate business
state and perform the operation. Any preliminary session lookup is only for
identification/access checks, never authoritative business state. INSERT the
complete terminal outcome exactly once before commit. `gate_request_outcomes`
contains only immutable terminal outcomes: no pending/placeholder row or UPDATE.

Payment events use a separate advisory-lock namespace for canonical
`(provider, paymentId)`, followed by accepted-binding lookup and, for a new event,
the same building-then-session lock order and state revalidation. Advisory keys
must be derived deterministically and consistently across application instances;
gate-request and payment-event namespaces must be distinct. Locks are held until
transaction end.

Use PostgreSQL constraints as a final protection for exclusivity and identity,
with deliberate locking or conditional writes. Start with short READ COMMITTED
transactions and validate the locking strategy through concurrent tests; an
availability read followed by an unprotected write is insufficient. Acquire locks
consistently and bound retries for transient conflicts. In-process mutexes cannot
provide guarantees across restarts or multiple application instances.

Authenticate and validate requests before business effects. A webhook success
acknowledgment follows durable acceptance/commit; duplicates have no extra effect.
Keep external network calls outside database transactions. Aim to meet caller
timeouts and specify retryable contention responses. This provides atomic local
effects under repeated delivery, not exactly-once network delivery.

## Testing strategy

- **Unit tests:** domain transitions, normalization and agreed tariff examples,
  including midnight and daylight-saving boundaries, using controlled time.
- **Real PostgreSQL integration tests:** competing allocations, simultaneous
  duplicates, payload conflicts, checkout/payment races, rollback across module
  operations and payment replay/order handling. Use separate connections and
  coordinated overlap; mocks or one shared test transaction do not prove these guarantees.
- **HTTP tests:** caller permissions, validation/errors, raw-body HMAC verification,
  occupancy privacy and simulator compatibility.

Use test-first development selectively for critical invariants and regressions.
Prefer disposable local PostgreSQL and a PostgreSQL CI service; add Testcontainers
only if its reproducibility benefit justifies another dependency. CI must run
lint, tests and a dependency audit as required by the assignment.

## Trade-offs and rejected alternatives

| Decision | Benefit and cost / alternative |
| --- | --- |
| Modular monolith | Simple deployment and atomic cross-module work; module boundaries need discipline. Microservices would add distributed consistency problems. |
| Drizzle and explicit persistence behavior | Visible SQL and transaction semantics; requires deliberate concurrency design. Avoid a generic repository abstraction that hides these details. |
| PostgreSQL concurrency control | Works across processes and restarts; contention and retries need testing. In-memory locking is insufficient. |
| Synchronous processing | Straightforward failure/retry reasoning; constrained by request budgets. Defer queues and an outbox until asynchronous external effects require them. |
| Direct occupancy reads | One source of truth with some read load. Defer caches and duplicated projections. |
| Pragmatic DDD | Clear language, boundaries and invariants. CQRS frameworks, event sourcing and ceremonial patterns need a concrete justification. |

## Approved pilot decisions and external clarification

Pilot decisions below are approved; source contradictions and integration limits
are distinguished from externally confirmed requirements:

- Approved pilot lifecycle: billing freezes at checkout; paid or free completion
  deactivates the session and releases logical allocation. Physical departure is
  not observed; no physical-exit callback is defined.
- Approved pilot tariff: started hours and caps per Amsterdam calendar day, in
  integer cents. This final developer-selected interpretation follows the published
  tariff despite the conflicting 583-cent source example; no employer approval is
  required to implement it. Detailed boundaries are specified in PB-04.
- Final developer-selected pilot policy rejects unsigned legacy webhooks: the
  legacy header proves no identity. Unsigned legacy terminals are unsupported;
  their payment events cannot produce trusted backend settlement.
- Resident entitlement remains externally unverified; the pilot accepts gate-asserted
  residency and rejects a mismatching checkout flag as specified in PB-04.
- PB-05 specifies PAID settlement matching, mismatch-tolerant FAILED recording,
  uncached pre-checkout CHECKOUT_REQUIRED and post-completion reconciliation.
  Pre-checkout recovery depends on the provider's limited redelivery window.

### Open integration question: exit-gate payment notification

How does the exit gate learn that payment succeeded? The supplied contract does
not define this interaction. Payment-success delivery and physical barrier commands
are outside the backend pilot scope, not blockers for backend implementation. No
endpoint or notification mechanism is invented; end-to-end barrier integration
is not claimed.

If clarification is unavailable, record explicit, justified and revisable
assumptions in the relevant reviewed feature specifications before implementation.
Never present assumptions as confirmed requirements or infer answers from the
selected stack or module boundaries.
