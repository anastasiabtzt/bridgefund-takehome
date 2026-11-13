# Development journal

Use dated entries for meaningful session or feature checkpoints, not every edit.
Record decisions and trade-offs, significant AI mistakes and corrections,
verification evidence, tools/models, and time/cost when available. Link specs,
decisions and commits rather than duplicating them. Distinguish observed facts,
user reports and assumptions; mark unavailable measurements as unknown.

## 2026-11-11 — Retrospective: repository and agent workflow setup

Retrospective entry based on local Git history and development notes.

- **Repository:** Restored the supplied bundle into the existing empty workspace,
  preserving original commit `a5004f917b036ca6161a2379cbf623d954b3d9a1`.
  Excluded `.idea/` locally and configured an SSH GitHub remote. The user reported
  verifying the repository as private and empty and completing the initial push
  in WebStorm after authentication failed in the agent environment.
- **Decisions and trade-offs:** Chose concise repository instructions and one
  local reusable procedure instead of adopting a larger external skill suite.
  The user refined the proposal to use selective test-first development,
  semantic commit boundaries and pragmatic DDD. PB-03–PB-06 specs require review
  and a commit before implementation; commits and pushes require explicit approval.
- **AI contribution and corrections:** ChatGPT was used for requirements and
  architecture discussion and technical review; Codex inspected the repository,
  drafted the workflow files and ran local checks. The developer selected and
  approved the approach. Review led to clearer DDD guidance, an explicit skill
  link and a rule requiring a reviewed spec commit for material behavior changes.
  An initial Git check ran outside the assignment repository; subsequent Git
  operations used the verified checkout.
- **Verification:** The bundle was verified as complete during setup. Workflow
  commit `af75ff180b90f541c204b7a36b2ea74e054f316c` contains only `AGENTS.md`
  and `.agents/skills/feature-workflow/SKILL.md` (74 added lines); its parent is
  the original commit. Full staged contents were reviewed and the staged
  whitespace check passed. The skill validator could not run because Python's
  `yaml` module was unavailable; no dependency was installed. No application tests
  were run for these instruction files.
- **Current evidence and limits:** Local Git history and staged-file checks
  confirmed the workflow commit and its scope. A separate review checked the
  committed workflow documents; repository privacy and remote commit identity
  were not established by that content review. The workflow was documented but
  had not yet been exercised on an application feature.
- **Tools/models:** ChatGPT, Codex, WebStorm, Git, shell/Python tools,
  bundled `skill-creator` guidance and external engineering references.
  Exact model identifiers are not recorded.
- **Time/cost:** Unknown. No reliable elapsed-time or cost measurements were
  recorded; commit timestamps are not a measure of effort.

## 2026-11-11 — PB-03 specification and critical design review

- **Process and roles:** Used the local `feature-workflow` procedure to discuss,
  draft and iteratively review the check-in contract before implementation. Codex
  proposed alternatives and authored revisions; the user challenged
  edge cases, chose the policies and explicitly approved the specification and
  its separate commit. No application implementation was performed.
- **Concurrency and invariants:** The proposed strategy uses PostgreSQL request-key
  coordination and a short transaction-scoped building allocation lock, with one
  application transaction owning binding, allocation, session and result changes.
  Database constraints protect space exclusivity and one active normalized plate
  per building, including races under different IDs/resident flags. The user
  directed lowest eligible-space allocation. Temporary contention returns 503,
  not PARKING_FULL; SKIP LOCKED was rejected as evidence of fullness because it
  can hide locked capacity. In-memory coordination, Redis and independently
  committed processing claims were unnecessary for this pilot.
- **Idempotency evolution:** Codex initially recommended replaying terminal full
  outcomes. The user chose same-key recovery when capacity becomes available.
  Review favored retaining canonical payload bindings separately from mutable
  session state: rolling back the binding on full would lose payload-conflict
  protection. Successful check-ins replay their original 201 without reallocating;
  conflicting payloads return 409. Full responses leave the attempt unfinished.
- **Mistake and correction:** The draft proposed reevaluating
  VEHICLE_ALREADY_CHECKED_IN later. Critical review exposed how a delayed retry
  could create an unintended session after the earlier session ended. The user
  approved persisting and replaying that terminal rejection instead; a legitimate
  later arrival requires a fresh ID. Successful replay precedes the active-plate check.
- **Stale retries and trade-offs:** Indefinite full-attempt reevaluation could also
  admit an abandoned event. Codex proposed a fixed 30-second window; the user
  selected a configurable default of 60 seconds from first durable binding as an
  explicit pilot assumption. Retention lasts throughout the pilot, but allocation
  permission expires: retries do not extend a durable binding's deadline, and
  expiry produces terminal CHECK_IN_ATTEMPT_EXPIRED. Check time after coordination
  locks; committed success still replays after expiry. Final review clarified
  that complete rollback leaves no durable binding/timestamp, so a later retry
  may establish a new window. The window cannot establish the physical event's age.
- **Assumptions and open questions:** The user approved provisional resident
  CAR/MOTOR eligibility in spaces 1–50 and acceptance of gate-asserted residency;
  gate authentication does not prove entitlement. Per-gate bearer authentication,
  strict validation/provisional limits, building-wide request scope and a
  1.5-second performance target were approved project choices, not vendor promises.
  Explicit full/503 retry behavior, delayed/cross-gate responses and stale-success
  handling remain unconfirmed. A replayed success must not authorize a different
  physical arrival. Session inactivity/release, production retention, pricing
  conflicts and legacy-payment authentication remain unresolved.
- **Verification evidence:** Reviewed the brief, gate notes and architecture for
  consistency. Local-link and direct whitespace/final-newline checks passed;
  `git diff --check` passed, with direct checks needed while the draft was untracked.
  Full staged contents and the sole staged file were verified before approved
  commit `8014b73abad7a4b06b12c0753b187d6997e9ff67` (only the PB-03 spec).
  Post-commit checks confirmed a clean working tree. Real PostgreSQL concurrency,
  rollback and constraint tests are specified but have not been implemented or run;
  no runtime guarantees have been experimentally demonstrated yet.
- **Tools/models:** Codex, the repository-local workflow skill, Git, shell/Python
  documentation checks and web research of official PostgreSQL documentation.
  Exact model identifier is unknown from the available evidence.
- **Time/cost:** Unknown; no reliable duration or cost measurements are available.

## 2026-11-12 — PB-03 terminal-full simplification

- **Decision and rationale:** The user approved terminal PARKING_FULL
  replay after revisiting the gate contract, which specifies same-ID retries
  when no response arrives but does not establish retries after explicit full
  responses. Codex revised the specification; the revised text awaits final review.
- **Trade-off:** A rejected event continues to receive its original 409 even
  after capacity becomes available. A new admission requires a new vehicle event
  and UUID. This replaces the previously approved retry window and expiry
  lifecycle with stable outcome replay.
- **Preserved guarantees:** Successful and duplicate-plate outcome replay,
  canonical payload conflicts, PostgreSQL coordination, space exclusivity and
  active-plate uniqueness. A wholly rolled-back request leaves no durable outcome.
  Transient infrastructure failures, including 503, are not terminal idempotency results.
- **Verification:** Documentation consistency review, local-link checks,
  whitespace/final-newline checks and `git diff --check` passed. No application
  code or runtime tests were implemented or executed.
- **Tools/time/cost:** Codex, Git and shell/Python checks. Exact model identifier,
  elapsed time and cost are unknown.

## 2026-11-12 — PB-04–PB-06 lifecycle, billing and payment approval

- **Process and decisions:** Codex drafted and revised the three specifications;
  the user explicitly approved PARKED → AWAITING_PAYMENT → COMPLETED,
  direct free completion, frozen billing at first checkout and atomic logical
  release/session deactivation on completion. Occupancy describes allocation,
  not a physical exit sensor. Resident-status mismatch is rejected.
- **Billing:** Approved started-hour tariffs in integer cents, caps per Amsterdam
  calendar day and whole-minute duration presentation without rounding time before
  billing. A 70-minute car visit costs 1000 cents; the conflicting 583-cent example
  awaits employer confirmation. Daily segmentation is an approved pilot interpretation.
- **Payment review and correction:** Approved HMAC-only authentication, including
  rejection of unsigned legacy calls. Early payment events receive uncached
  CHECKOUT_REQUIRED, relying on provider redelivery within its 24-hour window,
  rather than a pending-event mechanism. The user corrected Codex's proposed
  permanent 409 for new PAID events after completion: durably record an unexpected
  event requiring reconciliation before 204, preserve immutable identity/conflict
  handling, and never settle/release twice or assert a duplicate charge occurred.
  No refund workflow, queue or worker was added.
- **Integration limit:** How the exit gate learns payment success and interprets
  checkout 200 without opening an unpaid exit remains unresolved. No new endpoint
  or undocumented gate behavior is assumed; backend approval is not proof of
  end-to-end barrier integration. External legacy-support clarification remains open.
- **Verification:** Document links/anchors, whitespace/final newlines and Git diff
  checks passed. PB-03 is unchanged. Runtime/PostgreSQL tests are specified but
  not executed. Specifications must be committed before implementation.
- **Tools/time/cost:** Codex, Git and shell/Python documentation checks. Exact
  model identifier, elapsed time and cost are unknown.

## 2026-11-12 — Targeted technical-review corrections

- **Review attribution:** The user supplied findings from an independent AI
  technical review, requested targeted corrections, then explicitly accepted the
  corrections. Codex applied the documentation edits and ran local checks; Codex
  did not perform that independent review. The user subsequently reported no
  remaining blocking defects. This final editorial revision is being checked
  before the user-authorized commit; no additional independent review is claimed.
- **Accepted corrections:** Accept authenticated, structurally valid
  FAILED events after checkout despite amount/currency mismatch; only PAID
  settlement requires exact EUR matching. Preserve original event data and prevent
  any FAILED billing/settlement/allocation effects.
- **Ordering and time:** Checkout resolves existing keys before newly supplied
  session lookup, preserving conflict detection even for unknown IDs. Capture one
  Clock instant after locks/state validation; backwards time is a nonterminal
  error, not a frozen business outcome. Payment processing likewise resolves
  accepted bindings before new-event state evaluation and retains them for the pilot.
- **Read/integration clarity:** Public occupancy uses a consistent read snapshot
  without the allocation lock; added no-store and unknown-query tests. Updated
  outdated PB-03/architecture status without changing behavior. Gate payment-success
  notification remains open; checkout 200 alone does not establish barrier action.
- **Verification:** Documentation links, whitespace/final-newline and diff checks
  passed. New acceptance scenarios are planned, not executed; no application work.
- **Tools/time/cost:** Codex, Git and shell/Python checks. Exact model, elapsed
  time and cost unknown. No new infrastructure or endpoints introduced.

## 2026-11-12 — Checkpoint 1: runnable backend foundation

- **Authorization and completed scope:** The user approved Checkpoint 1 after the
  implementation plan. Verified approved specifications in commit `6aadeb2` and
  a clean checkout before coding. Added minimal NestJS/TypeScript startup, validated
  configuration, pg/Drizzle connection, Clock, Compose PostgreSQL 17, setup commands
  and configuration/connectivity tests. No business routes, tables or migrations;
  Billing/Payments modules and CI remain planned for later checkpoints.
- **Implementation choices:** Stable NestJS 12.4.2, Drizzle 0.45.4 and pg 8.23.1;
  TypeScript 6.0.3 fits typescript-eslint's supported range. Pinned dependencies and
  lockfile; Node 24/npm 11, ESM, direct tsc builds, tsx development and Node tests.
  Small pool (5), 250 ms connection/lock waits, 1000 ms statement/idle-transaction
  limits and 10000 ms pool idle timeout are configurable. They do not enforce the
  future 1.5-second end-to-end use-case budget by themselves.
- **Mistakes and corrections:** Initial CommonJS compilation exposed NestJS 12's
  ESM requirement; corrected module mode/imports. A smoke-test assertion assumed
  PostgreSQL reports 1000 ms as that literal string; it reports 1s, so the test now
  checks numeric pg_settings. A custom development build/watch approach looped on
  generated output; replaced it with tsx and verified an actual source restart.
- **Executed verification:** `npm ci --ignore-scripts --no-audit --cache
  /tmp/bridgefund-npm-cache`, `npm run build`, `npm run lint` and `npm test` passed
  (3 configuration tests). `TEST_DATABASE_URL=postgresql://parkingbusiness:local-development-only@127.0.0.1:5432/parkingbusiness
  npm run test:integration` passed (1 real PostgreSQL test through pg/Drizzle,
  including statement-timeout settings). Docker Compose config is valid and the
  service healthy; a read-only pg_tables query confirmed zero public tables.
  Compiled startup checks exercised absent DATABASE_URL, invalid PORT, unreachable
  PostgreSQL and redacted errors. Both compiled and development startup served
  expected HTTP 404; source-watch restart recovered and test app processes stopped.
- **Environment and dependency findings:** Docker Desktop was initially stopped;
  started the existing installation and used the authorized local Compose service.
  Dependencies installed with lifecycle scripts disabled. `npm audit --omit=dev`
  reported zero vulnerabilities. Full audit reported 10 moderate findings in the
  lint-only minimatch chain (GHSA-g3hv-75wg-m249), no high/critical findings. Deferred
  incompatible forced remediation: fixed local lint paths are used, not HTTP input.
  Reassess at Checkpoint 2 before configuring audit CI; do not suppress globally.
  PostgreSQL remains running locally; application test processes are stopped.
- **Planned, not executed:** Feature integration/concurrency tests, migrations,
  seed data, CI and all PB-03–PB-06 endpoints. No runtime business guarantees claimed.
- **Tools/time/cost:** Codex, Git, Node 24.22.0/npm 11.19.1, TypeScript/ESLint,
  Docker/PostgreSQL, shell/Python and official/package-registry documentation.
  Measured elapsed wall-clock interval through verification: 666 seconds,
  including installs, waits and corrections; excludes this journal/final response.
  Exact model identifier and tool/token cost are unavailable.

## 2026-11-12 — Checkpoint 2: persistence, isolated tests and CI

- **Scope and decisions:** The user authorized the five-table persistence model,
  migrations, safe seed and CI after Checkpoint 1 (`db41b52`). Codex implemented
  Drizzle schema and generated/reviewed SQL plus a custom history-guard migration;
  this implementation awaits user review. Sessions remain the allocation source
  of truth: partial unique indexes cover active plates and spaces per building;
  composite foreign keys prevent cross-building references. Integer cents are
  bounded to JavaScript-safe values. No endpoint, repository abstraction or worker.
- **Lifecycle protection:** Row checks enforce checkout timestamps/duration,
  resident zero charge and state shape. SQL guards preserve session identity,
  frozen checkout and forward-only transitions; request outcomes/payment bindings
  are append-only. Deferred checks permit settlement and completion in one
  transaction while rejecting inconsistent commits. FAILED accepts mismatched
  amount/currency after checkout; extra PAID records can require reconciliation.
  Tariff calculation and HTTP/idempotency orchestration remain future work.
- **Seed and safety:** Seed inserts the pilot and 150 correctly ranged/floored
  spaces without overwriting configuration or operational records. Tests verify
  preservation of existing sessions, gate outcomes and payment events. Added a
  separate tmpfs PostgreSQL test service/database/user. Tests validate URL and live
  identity before schema reset. A deliberate development-URL test run was refused;
  development still has zero public tables. Added .DS_Store to ignore rules.
- **Test-first evidence and corrections:** Initial database tests exposed absent
  append-only, lifecycle-history and settlement guards before their SQL was added.
  Added guards and corrected a resident test fixture to create resident identity
  initially rather than mutate immutable check-in facts. Linting the simulator
  exposed missing Node URL globals in ESLint configuration; corrected the config.
- **Executed verification:** Clean root and simulator installs with
  `npm ci --ignore-scripts --no-audit` (temporary npm cache); build, lint including
  simulator, and 5 unit tests passed. `npm run db:test:fresh` recreated only the
  disposable test server. With TEST_DATABASE_URL pointing to port 5433 and
  parkingbusiness_test, `npm run test:integration` passed all 27 checks on a fresh
  database. Separate backend connections demonstrated unique-index blocking and
  rejection. `npm test --prefix simulator` passed 10 tests, including signed HTTP
  transport/retries through Axios. Migration check/generation reported no schema
  drift; migration CLI and seed CLI reruns passed. Compose and CI YAML parsed;
  whitespace, JSON and document-link checks passed. GitHub-hosted CI has not run.
- **Audit triage:** Added native npm audit checks for both lockfiles. Upgraded the
  simulator's Axios from 0.21.1 to stable 1.21.1; simulator audit is clean and
  transport compatibility was tested. Application production audit is clean.
  Full application audit reports 14 moderate dev-tool findings rooted in two
  advisories: minimatch GHSA-g3hv-75wg-m249 and Drizzle Kit's transitive esbuild
  GHSA-67mh-4wv8-2f99. Proposed narrow dev-only exceptions expire for review on
  2026-11-19: fixed lint globs, no esbuild server/Studio exposure. New/runtime
  advisories, audit failures and expiry fail CI; unit tests cover that policy.
  No forced downgrades, major overrides or blanket severity suppression.
- **Limitations and next step:** Local equivalents passed; remote CI execution
  awaits a user push. Custom SQL triggers need manual review in future schema
  migrations and can be bypassed by privileged administrators. Seed preserves,
  rather than repairs, manually changed configuration. Both local PostgreSQL
  services remain running. Business endpoints, use-case locks, billing and
  gate/payment integration are not implemented or claimed verified.
- **Tools/time/cost:** Codex, Git, Node/npm, Drizzle Kit 0.31.11, PostgreSQL 17,
  Docker Compose, ESLint/TypeScript, shell/Python/Ruby and official documentation.
  Measured elapsed wall-clock time through verification: 1188 seconds, including
  installs, research, waits and corrections; excludes this journal/final response.
  Exact model identifier and tool/token cost are unavailable.

## 2026-11-12 — Checkpoint 2 targeted seed and concurrency corrections

- **Requested correction:** The user supplied review findings and authorized only
  seed validation, deferred-settlement concurrency tests and documentation. Codex
  applied these corrections; they await review. Existing SQL triggers, schema,
  architecture and specifications were not changed.
- **Seed:** Insert missing records, then validate timezone and exactly 150 pilot
  spaces against IDs, floors and category-encoded vehicle eligibility. Drift now
  raises a clear non-sensitive error and rolls back the seed transaction instead
  of silently accepting or overwriting configuration. Tests cover clean/repeated
  seed, operational-data preservation, wrong timezone/floor/eligibility/vehicle type
  and extra spaces. Whole-database snapshots prove failed validation also rolls
  back attempted insertion of a missing space without changing operational data.
- **Concurrency evidence:** Three distinct PostgreSQL connections, observed
  pg_blocking_pids and actual COMMIT operations establish controlled overlap and
  verify final state through the observer connection. Concurrent completion with
  another PAID attempt, late FAILED or reconciliation commits successfully without
  repeat settlement/release. A deliberately prohibited second applied settlement
  fails its unique index; a mismatched settlement fails deferred validation at
  COMMIT, while a valid settlement commits. No sleeps or Promise.all-only overlap.
  Larger transaction timeouts are test-local, not application configuration changes.
- **Executed checks:** Build, lint and all 5 unit tests passed. Fresh isolated
  PostgreSQL run passed 38 integration checks. Drizzle metadata check passed;
  SQL migration hashes are unchanged. Test pilot timezone is Europe/Amsterdam with
  150 spaces; development remains untouched with zero public tables. Documented
  that simultaneous local test runs must not share the disposable database.
- **Scope/time:** README, seed and persistence tests updated, with a dedicated
  settlement-concurrency test helper. Unrelated Archive.zip left untouched. Codex,
  Node/TypeScript, PostgreSQL/Docker and shell checks used. Measured elapsed
  wall-clock time through verification: 403 seconds; excludes this journal/final
  response. Exact model and tool/token cost unknown. No commit or push.

## 2026-11-12 — Integration boundary and request coordination review

- **Decisions and attribution:** The user supplied the design-review findings and
  approved these documentation corrections. Published started-hour tariffs and
  HMAC-only payment authentication are final developer-selected pilot decisions,
  not pending employer approvals or vendor-confirmed resolutions. The €5.83 source
  contradiction remains visible; unsigned legacy terminals remain unsupported
  because a legacy header does not authenticate the payment provider.
- **Scope:** Codex clarified that the backend scope includes checkout, settlement
  and durable session completion, but excludes payment-success delivery to exit
  controllers and physical barrier commands. Checkout 200 and webhook 204 are not
  barrier-open commands. The gate notification contract remains unspecified; no
  endpoint or end-to-end integration is invented or claimed implemented.
- **Coordination:** Documented transaction-scoped advisory identity locking before
  outcome lookup, then building/session locks and authoritative state revalidation
  before mutation. Preliminary session reads serve identification/access only.
  Deterministic cross-instance key derivation uses separate gate/payment namespaces.
  Gate outcomes are inserted complete exactly once, never as mutable placeholders;
  payment identity locking remains separate. These clarify the existing immutable
  persistence model without adding schema, infrastructure or abstractions.
- **Verification:** Codex inspected the documentation diff against the gate/provider
  notes and existing schema. Whitespace, local document links and final-newline
  checks passed; only the five approved documentation files changed. No runtime
  tests were run for this documentation-only change. Tools: Codex, Git, shell and
  Python. Elapsed time, exact model and tool/token cost unknown. No commit or push.

## 2026-11-12 — Checkpoint 3: PB-06 public occupancy

- **Authorization and scope:** The user approved the PB-06 plan and requested
  conservative transient-error classification and minimal dependency wiring.
  Codex verified the unchanged PB-06 specification was approved in conversation
  and committed in 6aadeb2 before implementation. Preserved the five preceding
  documentation changes; no other business endpoints, dependencies or migrations.
- **Implemented:** Public GET /occupancy inside Parking returns the four approved
  fields for all seeded pilot spaces in ID order, with no-store and unknown-query
  rejection. Reused DatabaseService and moved its existing provider registration
  into ParkingModule; no global module or repository abstraction. A single Drizzle
  SELECT with correlated EXISTS reads active PARKED/AWAITING_PAYMENT allocations
  using one committed MVCC snapshot, without building/session allocation locks or
  selecting plates/session IDs. Recognized PostgreSQL/network codes yield sanitized
  503; unexpected SQL, mapping and application errors yield sanitized 500. Errors
  without a recognized code remain 500 rather than guessing from message text.
- **Mistakes/corrections:** Initial test compilation exposed an overloaded pg
  connect return-type inference error; used explicit PoolClient. The first real
  query failed because Drizzle stripped column qualifiers inside a raw EXISTS
  projection, yielding SQL 42883; the HTTP response correctly hid it as 500.
  Replaced that expression with Drizzle's nested query builder and added a
  cross-building same-space-ID fixture. TypeScript then required an explicit
  boolean SQL projection type. No such failure remains in the passing suite.
- **Executed verification:** npm run build and npm run lint passed. npm test:
  8 passed, including HTTP contract/query/cache and sanitized failure cases.
  TEST_DATABASE_URL=postgresql://parkingbusiness_test:local-test-only@127.0.0.1:5433/parkingbusiness_test
  npm run test:integration: all 39 checks passed against real PostgreSQL, including
  existing persistence/concurrency checks. New HTTP reads use a different pool
  from the writer: uncommitted changes stay invisible, rollbacks preserve state,
  commit exposes completion and allocation together, and a held building row lock
  does not block reads. Fixtures exercise persisted lifecycle states, not deferred
  check-in/checkout/payment endpoints. npm test --prefix simulator: 10 passed.
  npm run audit:dependencies: 0 blocking findings; existing 14 reported dev-tool
  packages remain covered by exceptions due for review before 2026-11-19.
- **Environment and limits:** Initial HTTP/simulator runs failed to bind localhost
  under the sandbox; reruns with elevated local access passed. Docker access also
  needed escalation. No remote CI run or end-to-end gate integration is claimed.
  Database reset uses the existing guarded disposable test identity only; migration
  history and constraints are unchanged. Whitespace/final-newline checks passed.
- **Tools/time:** Codex, Git, TypeScript/ESLint, NestJS, Drizzle/pg, Node test/fetch,
  Python and PostgreSQL 17 via existing Docker containers. Measured elapsed time
  through verification: 252 seconds, excluding this journal/final review.
  Exact model and tool/token cost unknown. No commit or push.

## 2026-11-12 — PB-06 shared runtime wiring correction

- **Review and decision:** The user identified that Parking's private database
  registration would not be shared with future Payments providers and that a
  parent AppModule Clock is not visible inside imported feature modules. Codex
  proposed a small non-global RuntimeModule; the user approved the correction.
- **Applied:** AppModule configures RuntimeModule once and passes that same dynamic
  module definition into Parking's imports. Runtime exports APP_CONFIG,
  DatabaseService, SystemClock and Clock; Clock aliases SystemClock via useExisting.
  Parking no longer registers its own database/config providers. No transaction
  abstraction: coordinating application use cases still own and pass a transaction.
- **Evidence:** A test-only probe inside the actual Parking module and a sibling
  test module import the same configured runtime. Identity assertions prove shared
  config, Clock/SystemClock, DatabaseService and pool; Nest reports exactly one
  DatabaseService provider. A real PostgreSQL query succeeds and application
  shutdown closes that pool. No unused production test providers were added.
- **Verification/corrections:** npm run build and npm run lint passed; npm test
  passed all 8 unit/HTTP tests after rerunning with localhost sandbox access.
  TEST_DATABASE_URL=postgresql://parkingbusiness_test:local-test-only@127.0.0.1:5433/parkingbusiness_test
  npm run test:integration passed all 40 checks, including occupancy and the new
  wiring check. The first DI test incorrectly selected its dynamic sibling module
  by class; Codex corrected it to select the configured definition and ensured
  cleanup covers assertion failures. Whitespace and final-newline checks passed.
  Existing occupancy behavior, schema, migrations and prior documentation changes
  are preserved. Tools: Codex, Git, NestJS, Node/npm, TypeScript/ESLint, Python and
  PostgreSQL. Elapsed time and exact model/tool cost unknown. No commit or push.

## 2026-11-12 — PB-03 check-in implementation

- **Authorization:** The user explicitly deferred and manages the Git checkpoint
  sequence, authorizing implementation against the approved working-tree revision.
  Codex preserved the existing specification, architecture, PB-06 and runtime work;
  no staging, commits, pushes or stash operations. The earlier spec-commit gate was
  intentionally overridden by that instruction, not inferred from a status label.
- **Implemented decisions:** Minimal configuration-based per-gate bearer access,
  entrance authorization, strict JSON/header/plate validation and canonical payloads.
  Missing credentials disable gate access. Parking owns one READ COMMITTED
  transaction: deterministic gate-namespace advisory identity lock, existing outcome
  replay/conflict check, building row lock, fresh active-plate/capacity checks, then
  complete immutable outcome insertion with any new session. No placeholder rows,
  new dependencies, migrations or generic locking/transaction framework.
- **Concurrency and error policy:** Lowest eligible allocation is serialized across
  application instances. Only the active-plate partial index uses targeted ON CONFLICT
  handling; other integrity failures are not swallowed. A known space-index conflict
  rolls back and returns 503 rather than false fullness; unknown SQL failures return
  sanitized 500. Successful and both terminal business responses replay after commit.
  Existing pool/lock/query timeouts bound waits. Per the user's refinement, 1.5 seconds
  remains a response target, not a strict aggregate deadline or SLA.
- **Executed evidence:** npm run build and npm run lint passed; npm test passed all
  11 unit/HTTP tests. With the guarded local TEST_DATABASE_URL, npm run test:integration
  passed all 52 checks against real PostgreSQL, including existing persistence,
  occupancy and runtime DI checks. Two application instances and separate observer/
  holder connections establish actual lock waits before release (no sleeps). Covered
  duplicates/conflicts, equivalent plates/resident flags, last-space allocation,
  terminal full/plate replay, lost-response replay, narrow plate-conflict fallback,
  outcome-insertion rollback for success/full/duplicate rejection and 503 lock timeout
  followed by same-key recovery. Existing database constraint tests remain passing.
  npm test --prefix simulator passed all 10 tests. npm run audit:dependencies reported
  no blocking findings: 14 existing dev-tool packages remain covered by the existing
  advisory exceptions requiring review before 2026-11-19; simulator remains clean.
- **Corrections and limits:** Test compilation caught overly narrow inferred UUID
  typing; Codex annotated the helper. HTTP tests caught Nest-wrapped JSON parser
  errors bypassing the required envelope; corrected safe 400/413/415 translation.
  Local HTTP binding initially failed under the sandbox; elevated reruns passed.
  Tests were added alongside implementation rather than consistently failing-first,
  a process deviation from the preferred critical-invariant workflow. No remote CI,
  physical barrier integration or broad performance benchmark is claimed. Checkout,
  billing and payment endpoints remain unimplemented. Test-only triggers used for
  fault/overlap control were removed; production migrations/constraints are unchanged.
- **Checkpoint/tools:** Whitespace, final-newline and preservation checks passed.
  The implementation is ready for review; journal decisions are implementation
  choices pending that review, not claims of final user acceptance. Codex, Git,
  Node/npm, NestJS, Drizzle/pg, PostgreSQL, TypeScript/ESLint and Python were used.
  Measured elapsed time through verification: 505 seconds, excluding this entry
  and final review. Exact model and tool/token cost unknown.

## 2026-11-12 — PB-03 independent-review correction pass

- **Review and approved trade-off:** The user relayed independent-review findings
  and approved keeping bounded PostgreSQL pool/lock/query timeouts without an
  aggregate deadline or Promise.race cancellation. Codex inspected PB-03: it
  explicitly calls 1.5 seconds a target to test, not a network SLA. The nearby
  “server budget” wording is potentially stronger, but no guaranteed deadline is
  established; the approved specification was left unchanged.
- **New PostgreSQL evidence:** Exhausted the tested app's single-connection pool by
  checking out its sole connection. The HTTP request returns sanitized 503 with no
  session/outcome and no leftover queued waiter. Releasing the connection permits
  same-key check-in/replay; a direct query proves the same pool remains usable.
  A temporary BEFORE-outcome trigger verifies the new session already exists inside
  the transaction, then executes SQL until the test-local 150 ms statement timeout
  cancels it. HTTP returns sanitized 503; a separate observer sees neither session
  nor outcome. Removing the trigger permits same-key success/replay with exactly
  one session and outcome. No sleeps, new dependencies or production hooks.
- **Evidence correction:** Renamed the prior “lost response” test to committed
  canonical/historical replay. It receives and compares ordinary HTTP responses;
  earlier journal wording about lost-response coverage must not be read as network
  fault-injection evidence. No dropped-response or network-fault test was added.
- **Executed verification:** npm run build and npm run lint passed; npm test passed
  all 11 unit/HTTP tests. With the existing isolated local TEST_DATABASE_URL,
  npm run test:integration passed all 54 PostgreSQL checks. npm test --prefix
  simulator passed all 10 tests. npm run audit:dependencies reported 0 blocking
  findings: the same 14 dev-tool packages remain under existing advisory exceptions
  requiring review before 2026-11-19; simulator audit is clean. No failures occurred
  in this pass. Whitespace/final-newline and preservation checks passed; only this
  journal append and the check-in integration test changed. The temporary trigger
  and function were removed. No runtime timeout or business behavior changed.
- **Tools/time:** Codex, Git, Node/npm, TypeScript/ESLint, PostgreSQL, NestJS and
  Python. Measured elapsed time through verification: 103 seconds; excludes
  this journal/final review. Exact model/tool cost unknown. All prior work preserved;
  no staging, commits, pushes or stash modifications.

## 2026-11-12 — PB-04 check-out implementation

- **Authorization and scope:** The user authorized PB-04 after independent design
  review, with one explicit parser-precedence clarification. Codex verified clean
  HEAD 8257353 and the approved PB-04 specification history before editing. Updated
  only that spec paragraph: Nest transport-level malformed/oversized JSON can return
  400/413 before guards; valid requests require gate authentication/EXIT permission
  before business processing. No HTTP pipeline redesign or PB-03 parsing changes.
- **Billing:** Pure TypeScript calculation uses Date and Intl with explicit
  Europe/Amsterdam. A private helper brackets/bisects the next local date change;
  no localized-string parsing, hardcoded UTC offset or fixed-length calendar day.
  Each nonempty daily segment charges started elapsed hours capped independently,
  in integer cents. Residents/zero duration are free. Presentation floors whole
  minutes only after selecting the checkout instant; billing uses unrounded time.
- **Application decisions:** Minimal endpoint role metadata parameterizes the existing
  gate guard; check-in remains ENTRANCE and check-out requires EXIT, with explicit
  200. One READ COMMITTED transaction locks request identity, resolves immutable
  binding before session lookup, then locks building/session and revalidates state.
  First valid PARKED checkout samples Clock once, freezes billing, and completes
  only when free; positive charge retains allocation awaiting payment. Frozen repeats
  neither sample Clock nor mutate sessions, while every fresh key gets its own
  terminal outcome. Mismatch is durably replayed; unknown/inaccessible sessions and
  Clock inconsistency are nonterminal. No payment events or payment endpoint added.
- **Executed evidence:** Billing tests ran against a throwing stub first: 18 expected
  failures and one passing rejection test; all 19 then passed after implementation.
  They also passed independently under TZ=UTC and TZ=Pacific/Auckland, including
  both specified 2026 DST intervals, 23/25-hour local days, midnight boundaries and
  exact-hour-plus-1-ms behavior. Final npm run build and npm run lint passed.
  npm test passed all 32 unit/HTTP tests, including existing PB-03/PB-06 tests.
  With the guarded local TEST_DATABASE_URL, npm run test:integration passed all
  67 checks. Separate application/observer connections establish real lock overlap:
  same/different keys freeze one timestamp, Clock waits for building and session
  locks, request outcomes commit atomically, and injected outcome failures/statement
  timeouts roll back state before same-key recovery. Positive checkout retains plate/
  allocation; free completion enables PB-03 reuse and changes PB-06 occupancy.
  Critical regression passed: after A completes and B occupies A's former space,
  new-key checkout of A preserves both sessions and B's allocation. No actual
  checkout/payment-endpoint race or network-response-loss test is claimed.
- **Verification and limits:** npm test --prefix simulator passed all 10 tests.
  npm run audit:dependencies reported 0 blocking findings: 14 existing dev-tool
  packages remain under existing exceptions requiring review before 2026-11-19;
  simulator audit is clean. No unexpected test/build/lint failures occurred. Test
  trigger/functions were removed. Whitespace, final-newline, document-link and scope
  checks passed; schema, migrations, dependencies, runtime and other specs unchanged.
  Payment webhooks, exit notifications and physical barrier commands remain deferred.
  Remote CI was not run; implementation awaits independent review and user approval.
- **Tools/time:** Codex, Git, TypeScript/ESLint, Node/npm, NestJS, Drizzle/pg,
  PostgreSQL and Python. Measured elapsed time through verification: 471 seconds,
  excluding this journal/final review. Exact model and tool/token cost unknown.
  No staging, commits, pushes, reset/rebase or stash changes.

## 2026-11-12 — PB-04 approved closure and final verification

- **Review/authorization:** The user reported independent architecture review with
  APPROVE and no BLOCKER or IMPORTANT findings, then explicitly authorized one
  PB-04 commit after final checks. Optional suggestions were not implemented and
  approved architecture was not reopened.
- **Final polish:** Codex inspected the complete implementation/test diff against
  PB-04. No application or test changes were needed. Corrected README statements
  that still claimed no endpoints/routes existed, and PB-04's obsolete pending-
  implementation/test status. Checkout/payment limitations remain explicit; the
  only behavioral spec clarification remains the approved parser precedence.
  The prior 471-second implementation measurement is unchanged.
- **Fresh verification:** npm run build and npm run lint passed. npm test: 32 passed.
  TEST_DATABASE_URL=postgresql://parkingbusiness_test:local-test-only@127.0.0.1:5433/parkingbusiness_test
  npm run test:integration: 67 passed, including PB-03/PB-06 regressions and existing
  persistence checks. npm test --prefix simulator: 10 passed. npm run
  audit:dependencies: 0 blocking findings; existing exceptions still cover 14
  dev-tool packages and require review before 2026-11-19; simulator audit clean.
  git diff --check and document-link/final-newline checks passed. No failures or
  unrelated changes were found. Remote CI execution is not claimed.
- **Tools/time:** Codex, Git, Node/npm, TypeScript/ESLint, PostgreSQL and Python.
  Measured additional closure time through verification: 85 seconds, excluding
  this entry and staging/commit verification. Exact model/tool cost unknown.
  Authorized commit scope is PB-04 only; no push, amendment, reset, rebase or stash
  operation is authorized or performed.

## 2026-11-13 — PB-05 payment confirmation implementation

- **Approval/scope:** The user approved the plan and explicitly limited Parking's
  settlement provider to lookup, locking and completion in the caller's transaction.
  Codex verified clean HEAD e22fbe2, committed PB-05 history (69f7990/6aadeb2), and
  approval evidence before implementation. Specifications and database model remain
  unchanged. This implementation is pending independent review, not self-approved.
- **Security/integration:** Added Payments with Nest raw-body capture under the
  existing 4 KiB parser. HMAC-SHA256 compares exact retained Buffer bytes using
  constant-time comparison; one lowercase-hex signature is required. Missing/empty
  configured secret, missing raw-body capture and unsigned legacy requests fail
  closed. No signature reconstruction from JSON, credential fallback or logging of
  secrets/raw payment bodies. The trusted pilot provider identity is fixed server-
  side. Runtime and Parking are configured once and reused; tests prove one database
  provider/pool per Nest application. No dependencies or new infrastructure.
- **Transactions/policies:** Payment identity advisory locking uses namespace 2,
  separate from gate namespace 1. Accepted immutable bindings are resolved before
  session lookup. Parking identifies the building, then locks building/session and
  returns authoritative state in the payment use case's READ COMMITTED transaction.
  Exact EUR PAID settles and completes atomically; only this validated path samples
  Clock, after locking immediately before completion. Duplicate, FAILED, pre-checkout
  rejection and reconciliation paths do not sample Clock. FAILED records original
  mismatched amounts/currencies without settlement; distinct PAID after completion
  records reconciliation without modifying session/allocation or asserting a second
  charge. Early CHECKOUT_REQUIRED and infrastructure errors remain unbound. Existing
  deferred constraints validate the final settlement/completion together at COMMIT.
- **Executed verification:** Signature and validation tests first produced two expected
  failures against stubs, then passed. npm run build and npm run lint passed. Final
  npm test: 36 passed. With the existing guarded local TEST_DATABASE_URL,
  npm run test:integration: 85 passed, including PB-03/PB-04/PB-06 regressions, schema
  constraints and DI tests. Controlled separate connections/two application instances
  cover duplicate/conflicting IDs, concurrent PAIDs/late FAILED/reconciliation,
  checkout/payment overlap, session-lock Clock timing, rollback and bounded lock/
  statement-timeout recovery. No sleep-based overlap assertions. Later occupants are
  preserved when old sessions receive reconciliation. The actual simulator sender
  received signed 204 and unsigned legacy 401 against the backend. npm test --prefix
  simulator: 10 passed. npm run audit:dependencies: 0 blocking findings; the same
  14 dev-tool packages remain covered by existing exceptions requiring review before
  2026-11-19; simulator audit clean. Whitespace, links, newlines and scope checks pass.
- **Mistakes/corrections:** The duplicate-signature HTTP fixture initially returned
  transport 400 instead of expected 401 because its raw request lacked explicit Host/
  body-length framing. Corrected the fixture; signature rejection now reaches the
  guard. PostgreSQL then rejected a new fixture's state parameter (42P08: enum/text
  inference); an explicit session_state cast corrected it. Existing feature tests
  passed during those runs. No production policy was changed to accommodate tests.
- **Limits/next review:** Provider retries before checkout still have the approved
  24-hour recovery limitation; unsigned legacy terminals remain unsupported. No
  refund workflow, payment initiation, queue, exit notification or physical barrier
  integration is claimed. Temporary test fault-injection functions/triggers were
  removed. Remote CI and network-response-loss injection were not run. README/env
  examples document secret setup, 204 semantics and simulator prerequisites. PB-07
  was not started. Nothing staged, committed, pushed or stashed.
- **Tools/time:** Codex, Git, Node/npm, NestJS, Drizzle/pg, PostgreSQL, TypeScript/
  ESLint and Python. Measured elapsed time through verification: 677 seconds,
  excluding this journal/final review. Exact model and tool/token cost unknown.

## 2026-11-13 — PB-05 review: security, diagnostics and deterministic race coverage

- **Review/traceability:** The user supplied three IMPORTANT defects and two OPTIONAL
  improvements, authorizing targeted corrections without commits. Codex recorded
  compression and lossless-identifier security clarifications in PB-05 before code
  changes in this pass; existing settlement, retry/reconciliation policies and
  constraints were preserved. The reviewed baseline spec already predates initial
  implementation; no clarification commit was created against the no-commit instruction.
- **Compression FIXED:** Inspection of installed body-parser read.js and Nest's
  raw-body verify hook confirmed inflation precedes verification. Added only a
  webhook-mounted Content-Encoding check before the existing parser: non-identity
  encodings return safe 415 without decompression. HTTP tests cover gzip signed over
  compressed and decompressed bytes, malformed gzip and a compressed oversized body.
  Identity JSON keeps the 4 KiB limit; compressed check-in still follows its unchanged
  parser behavior. No parser replacement, dependencies or transport redesign.
- **Unicode FIXED:** Validation rejects NUL and either unpaired-surrogate direction
  before payment service invocation. A failing regression test first demonstrated
  the missing rejection, then passed. Valid supplementary characters and distinct
  composed/decomposed spellings are preserved without normalization/replacement.
  PostgreSQL tests observe zero application-pool acquisitions for invalid IDs and
  verify exact advisory identity, persisted UTF-8 bytes and replay for valid IDs,
  including the 128-code-point boundary.
- **Diagnostic FIXED:** Unexpected payment processing failures emit exactly one
  structured record: operation, newly generated UUID, safe classification and a
  validated PostgreSQL SQLSTATE when available. No raw message, stack, query/params,
  payment/session ID, body, signature or secret is logged. Tests spy on logger calls,
  enforce the exact field allowlist and single emission, unique generated IDs and
  sensitive-data exclusion. Expected business/validation and transient failures do
  not produce these unexpected-failure diagnostics; HTTP envelopes remain sanitized.
- **Test improvement FIXED:** Checkout/payment races now reserve identified backend
  connections and prove first/second tuple-lock queue order using pg_blocking_pids.
  Both checkout-first and payment-first results are asserted, with unchanged-event
  recovery after uncached CHECKOUT_REQUIRED. Payment concurrency helpers no longer
  rely on global waiter counts. A real PB-03 HTTP arrival reuses the paid space and
  plate; old-session payment replay/reconciliation and checkout preserve its new
  occupant and PB-06 occupancy. No sleeps or production transaction hooks added.
- **Coupling cleanup FIXED:** Moved genuinely shared HTTP error/header helpers, UUID
  parsing and the unchanged transient classifier into neutral utility files. Payments
  no longer imports Parking controllers/HTTP guards. Its deliberate Parking dependency
  is the narrow session-settlement provider operating in the caller's transaction;
  no generic lifecycle/repository framework or broad module restructuring.
- **Actual checks/correction:** Focused payment tests: 6 passed. npm run build and
  npm run lint passed. npm test: 38 passed. With the isolated TEST_DATABASE_URL,
  npm run test:integration: 88 passed, including PB-03/PB-04/PB-06, constraints and
  simulator/backend coverage. npm test --prefix simulator: 10 passed. npm run
  audit:dependencies: 0 blocking findings; unchanged 14 dev-tool packages remain
  covered by existing exceptions due for review before 2026-11-19; simulator clean.
  One test compile failed (TS7022 on an inferred diagnostic-count variable); adding
  its number annotation fixed it. Final suites have no failures. Whitespace, links,
  final newlines and scope checks passed. Transaction/settlement code, schema,
  migrations, dependencies and unrelated work are unchanged. No remote CI claimed.
- **Tools/time/limits:** Codex, Git, shell/Python, Node test/fetch, TypeScript/ESLint,
  NestJS, PostgreSQL and installed parser source inspection. Measured additional time
  through verification: 654 seconds; excludes this entry/final review. Model/tool
  cost unknown. Approved legacy-terminal, gate-notification and 24-hour redelivery
  limitations remain. Ready for independent review, not self-approved. No staging,
  commit, push, stash operation or PB-07 work.

## 2026-11-13 — PB-05 approval and commit preparation

- **Approval:** The user confirmed PB-05 approval and independent verification of
  all five review findings, then explicitly authorized one scoped implementation
  commit. Historical implementation/review entries and measured times are retained.
- **Preparation:** Codex inspected the full intended scope, README and journal.
  The approved baseline PB-05 specification in 69f7990 precedes implementation;
  subsequent security clarifications were explicitly authorized and reviewed with
  the fixes. No new business policy, schema or dependency change is included.
- **Evidence:** Latest completed verification remains 6 focused payment tests,
  38 unit/HTTP tests, 88 PostgreSQL checks and 10 simulator tests, plus passing
  build/lint and audit with 0 blocking findings under existing exceptions. Suites
  were not rerun for this commit-preparation pass. Fresh whitespace, document-link,
  file-scope, artifact and credential-hygiene checks passed. Only public local-only
  example database credentials and explicitly synthetic test secrets are present;
  the example webhook secret is empty. No real environment files or generated/
  temporary artifacts enter the commit. Remote CI execution is not claimed.
- **Tools/limits:** Codex, Git and Python; additional preparation time and exact
  model/tool cost not measured. No push, history rewrite or PB-07 work. Commit
  contents and final working-tree status are verified after creating the checkpoint.
