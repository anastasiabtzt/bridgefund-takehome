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
