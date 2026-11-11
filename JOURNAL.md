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
