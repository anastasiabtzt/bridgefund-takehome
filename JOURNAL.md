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
  proposed alternatives and authored revisions; the human reviewer challenged
  edge cases, chose the policies and explicitly approved the specification and
  its separate commit. No application implementation was performed.
- **Concurrency and invariants:** The proposed strategy uses PostgreSQL request-key
  coordination and a short transaction-scoped building allocation lock, with one
  application transaction owning binding, allocation, session and result changes.
  Database constraints protect space exclusivity and one active normalized plate
  per building, including races under different IDs/resident flags. The reviewer
  directed lowest eligible-space allocation. Temporary contention returns 503,
  not PARKING_FULL; SKIP LOCKED was rejected as evidence of fullness because it
  can hide locked capacity. In-memory coordination, Redis and independently
  committed processing claims were unnecessary for this pilot.
- **Idempotency evolution:** Codex initially recommended replaying terminal full
  outcomes. The reviewer chose same-key recovery when capacity becomes available.
  Review favored retaining canonical payload bindings separately from mutable
  session state: rolling back the binding on full would lose payload-conflict
  protection. Successful check-ins replay their original 201 without reallocating;
  conflicting payloads return 409. Full responses leave the attempt unfinished.
- **Mistake and correction:** The draft proposed reevaluating
  VEHICLE_ALREADY_CHECKED_IN later. Critical review exposed how a delayed retry
  could create an unintended session after the earlier session ended. The reviewer
  approved persisting and replaying that terminal rejection instead; a legitimate
  later arrival requires a fresh ID. Successful replay precedes the active-plate check.
- **Stale retries and trade-offs:** Indefinite full-attempt reevaluation could also
  admit an abandoned event. Codex proposed a fixed 30-second window; the reviewer
  selected a configurable default of 60 seconds from first durable binding as an
  explicit pilot assumption. Retention lasts throughout the pilot, but allocation
  permission expires: retries do not extend a durable binding's deadline, and
  expiry produces terminal CHECK_IN_ATTEMPT_EXPIRED. Check time after coordination
  locks; committed success still replays after expiry. Final review clarified
  that complete rollback leaves no durable binding/timestamp, so a later retry
  may establish a new window. The window cannot establish the physical event's age.
- **Assumptions and open questions:** The reviewer approved provisional resident
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
