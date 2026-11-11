---
name: feature-workflow
description: Guide BridgeFund ParkingBusiness feature work and behavioral fixes through specification, implementation, verification, review and commit preparation. Apply automatically when beginning or resuming a feature or meaningful behavior change, rather than routine documentation edits.
---

# Feature workflow

Read root `AGENTS.md` and follow the user's current scope. Use this procedure without creating extra planning documents or invoking additional agents by default.

## Start or resume
- Apply automatically; no explicit skill invocation is needed. Identify the feature ID (PB-03–PB-06 where relevant), inspect the relevant spec and its Git history, and review available human approval evidence.
- State the current phase before substantial changes: discovery, specification, review, implementation, verification or commit preparation. Resume at the applicable phase, not automatically at implementation.
- Before application code, verify that the relevant spec exists, its current behavioral contract has explicit human approval, and its commit precedes implementation. Use an explicit review message or attributable approval record tied to the revision; a commit or an agent-written status label is not approval evidence. If evidence is unavailable, ask for confirmation rather than infer it.
- If any mandatory prerequisite is missing or uncertain, STOP before writing application code, name the gap and propose the next action (draft, review, commit approval or verification of history). Politely challenge requests that skip the gate. Continue permitted discussion, investigation and read-only design review without demanding implementation prerequisites.

## Journal checkpoint
At each meaningful phase boundary, including specification review and commit preparation:
- Read existing journal entries and assess whether the phase produced significant decisions, alternatives, corrections, tool use or verification evidence. Propose a concise dated entry or an update before seeking a feature-related commit approval when such work occurred; do not wait for a reminder.
- Distinguish agent proposals from human decisions and planned tests from commands actually executed and their results. Include rationale, rejected alternatives, real mistakes/corrections and tools/models used. Use measured time/cost when available; otherwise unknown. Link specs/decisions rather than duplicate them.
- Combine related events; avoid transcripts or entries for every edit. If evidence is already recorded, identify that coverage. If intentionally deferred or outside the authorized editing scope, flag the deferral and propose text without silently changing JOURNAL.md.

## 1. Discuss
- Identify the story, intended outcome, dependencies and exclusions. Inspect relevant brief sections, integration notes, existing code, specs and Git history.
- Surface ambiguity, unsafe requests and significant assumptions. Resolve material questions with the user; make routine implementation choices within the agreed scope.

## 2. Specify
- For PB-03–PB-06, write or update the relevant `specs/` document when authorized: acceptance examples, API contract, error cases, assumptions and open questions. Include important retry, concurrency and abuse cases.
- Keep technical choices separate from requirements. Propose a short architecture decision only when a lasting trade-off warrants it.
- Present the spec and open questions for human review. Perform the journal checkpoint before requesting a separate specification commit. After approval and commit, verify the start/resume gate before implementation; approval of a spec does not authorize committing it.
- For fixes, check the existing spec first. Update changed requirements before implementation; do not require a new document for behavior already specified.

## 3. Implement
- State a short plan in the conversation and implement one coherent slice at a time.
- Use failing tests first for critical invariants, concurrency, payment behavior and regressions. Confirm they fail for the intended reason, then implement and refactor. Apply other verification proportionately; strict TDD is not universal.
- Prefer tests of observable behavior. Exercise real database/API boundaries when mocks would hide transaction or concurrency failures.
- If PB-03–PB-06 behavior or acceptance criteria materially change, update the spec and obtain user review and a new specification commit before implementing the changed behavior. Routine implementation details that preserve the agreed behavior and acceptance criteria do not require a new specification commit.

## 4. Verify
- Use actual repository commands. Run focused checks during development and applicable lint, tests, build/type checks and dependency audit at the completed change boundary.
- Report commands and outcomes, including failures, unavailable tooling and checks not run. Do not install dependencies or expand infrastructure outside the authorized task.

## 5. Review
- Review the entire intended diff against acceptance criteria, security boundaries, error handling, simplicity and regression coverage.
- Separate blocking defects from optional improvements. Correct meaningful issues within scope and rerun affected checks.
- Check semantic scope: if the diff contains independent changes, propose separate commits before adding more work. Avoid line-count quotas.
- Perform the journal checkpoint, including corrections and verification outcomes from review.

## 6. Prepare a commit
- Remind the user when a logical change is ready. Before requesting commit approval, show the proposed diff/scope, verification results and remaining limitations, perform the journal checkpoint, and suggest an atomic Conventional Commit message such as `feat(check-in): allocate spaces safely under concurrent requests`. Include journal changes in the proposed scope only when authorized.
- Keep related tests with implementation and unrelated changes out of the proposed commit. Spec commits precede implementation commits.
- Never commit without explicit human authorization for the scoped files. Inspect the index before staging; stop if unrelated staged changes would enter the commit, and do not unstage user work without permission. Verify the final staged diff and commit only approved files. After committing, verify contents and working tree. Never push; the human handles pushing.
