# Development journal

Use dated entries for meaningful session or feature checkpoints, not every edit.
Record decisions and trade-offs, significant AI mistakes and corrections,
verification evidence, tools/models, and time/cost when available. Link specs,
decisions and commits rather than duplicating them. Distinguish observed facts,
user reports and assumptions; mark unavailable measurements as unknown.

## 2026-11-11 — Retrospective: repository and agent workflow setup

Written after the work, using local Git history and the development conversation.

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
- **AI contribution and corrections:** ChatGPT supported private requirements
  discussion, workflow design trade-offs and review. Codex inspected the repository,
  authored the workflow files and performed local Git verification. The user made
  the decisions, approved changes and performed the push. User review prompted explicit DDD guidance,
  an explicit relative skill link and a narrower rule for specification updates:
  material behavior/acceptance changes require a new reviewed spec commit;
  routine implementation details do not. An early audit command in the supplied
  bundle directory resolved to an unrelated home-directory repository. The agent
  identified this risk; subsequent Git mutations were confined to the verified
  assignment checkout.
- **Verification:** The bundle was verified as complete during setup. Workflow
  commit `af75ff180b90f541c204b7a36b2ea74e054f316c` contains only `AGENTS.md`
  and `.agents/skills/feature-workflow/SKILL.md` (74 added lines); its parent is
  the original commit. Full staged contents were reviewed and the staged
  whitespace check passed. The skill validator could not run because Python's
  `yaml` module was unavailable; no dependency was installed. No application tests
  were run for these instruction files.
- **Current evidence and limits:** Local history confirms both commits; `main`
  matches the locally cached `origin/main`, and the tree was clean before this
  journal was added. The user reports the workflow commit has been pushed.
  The user reports that after the push, ChatGPT independently retrieved and
  reviewed both workflow files through the connected GitHub integration. That
  content review did not independently verify repository privacy or the exact
  remote commit SHA; Codex did not repeat that integration check here.
  The procedure has been created; actual use on a feature remains to be recorded.
- **Tools/models:** ChatGPT, Codex, WebStorm, Git, shell/Python tools, the bundled `skill-creator`
  guidance and web review of Addy Osmani's four proposed engineering skills.
  Exact model identifiers are unknown from the available evidence.
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
