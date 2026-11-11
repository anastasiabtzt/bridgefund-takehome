---
name: feature-workflow
description: Guide BridgeFund ParkingBusiness feature work and behavioral fixes through specification, implementation, verification, review and commit preparation. Use for a new story or meaningful behavior change, rather than routine documentation edits.
---

# Feature workflow

Read root `AGENTS.md` and follow the user's current scope. Use this procedure without creating extra planning documents or invoking additional agents by default.

## 1. Discuss
- Identify the story, intended outcome, dependencies and exclusions. Inspect relevant brief sections, integration notes, existing code, specs and Git history.
- Surface ambiguity, unsafe requests and significant assumptions. Resolve material questions with the user; make routine implementation choices within the agreed scope.

## 2. Specify
- For PB-03–PB-06, write or update the relevant `specs/` document when authorized: acceptance examples, API contract, error cases, assumptions and open questions. Include important retry, concurrency and abuse cases.
- Keep technical choices separate from requirements. Propose a short architecture decision only when a lasting trade-off warrants it.
- Present the spec for user review and recommend a separate specification commit. Confirm that the reviewed spec is committed before implementation begins. If review, commit approval or the commit itself is missing, stop before coding; do not commit on the user's behalf without explicit approval.
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
- Propose a journal entry when significant decisions, AI mistakes/corrections or verification evidence warrant one. Link durable decisions and specs instead of repeating them; do not create deferred documents without authorization.

## 6. Prepare a commit
- Remind the user that the logical change is ready. Summarize behavior, files, verification and remaining limitations; suggest an atomic Conventional Commit message such as `feat(check-in): allocate spaces safely under concurrent requests`.
- Keep related tests with implementation and unrelated changes out of the proposed commit. Spec commits precede implementation commits.
- Do not create a commit or push without explicit approval. After an approved commit, verify its contents and working tree before starting the next independent change.
