# TurnProof AI progress — source of durable session state

## Current state
**As of October 12, 2026 (host clock, timezone not confirmed on this host):** milestones M0 through M2 are implemented and verified, and most of M3 and M4 is done. The repository is **not yet a git repository**: no commit exists, so nothing is pushed and no public URL exists.

Implemented and verified: TypeScript monorepo, domain engine, deterministic candidate gate, 34 synthetic fixtures, Fastify API with SQLite persistence, React/Vite console, provider contracts with honest replay and live status, evaluation harness, proof-export script, and the documentation set. Not done: `npm run proof:export` has never been run, so `proof/manifest.json` and `proof/packets/*.json` do not exist yet; the demo video is not recorded; the repository is not published; no sponsor or live provider was verified.

**Exact next action:** run `npm install && npm test && npm run test:e2e && npm run evaluate && npm run proof:export`, then `git add -A && git commit` and publish the repository with `gh repo create yablokolabs/turnproof-ai --public --source=. --push`. The user authorized a public push on October 12, 2026.

## Milestone checklist
- [x] M0: inventory, source ledger, scaffold, documented version choices.
- [x] M1: schemas, 34 fixtures, scheduler, constraints, persistence, API tests.
- [x] M2: complete offline UI, review, export, browser proof.
- [~] M3: deterministic and replay providers implemented; live AI and both sponsors explicitly unavailable, nothing verified.
- [~] M4: evaluation harness run and documented; proof manifest and packets not yet generated; screenshots captured; no demo video.
- [ ] M5: evidence freeze, honest submission, pilot plan published.

## Integration ledger
Deterministic engine: **implemented and available**, rule-based, no network. Replay provider: **implemented**, reads stored decisions from local SQLite, always labelled replay. Live AI: **unimplemented and reported unavailable**; no stub, no simulated latency, no hard-coded response anywhere. Anakin: **unavailable**; no adapter, no call, no documentation retrieved. Jev: **unavailable**; same position. All sponsor use claims remain blocked. Detail in `docs/INTEGRATIONS.md`.

## Checkpoint template — append; do not erase history
```text
Checkpoint ID / timestamp with timezone:
Milestone / branch / commit:
Dirty files and preserved user changes:
Implemented behavior:
Checks: exact command, exit code, timestamp, concise actual output, log path:
Fixtures / policy / solver / provider versions:
Evidence captured and hashes:
Integration status: unavailable / deterministic / replay / verified-live:
Failures: location → cause → fix:
Unresolved assumptions / decisions:
Claim changes and supporting artifacts:
One exact next action:
```

## Evidence freeze template
```text
Freeze date/time/timezone:
Evidence-lock time confirmed by organizer? source:
Commit / lockfile hash / scenario revision:
Reproduction run and results:
Proof ZIP hash / manifest path:
Video / screenshot / app / repository links (actual only):
Remaining known failures and limitations:
Post-freeze changes and whether permitted:
```

## Initial checkpoint
Documentation kit only. Competition attachment retrieved from the referenced chat and preserved as docs/COMPETITION_SOURCE.txt. No implementation files were generated. Next: M0 inventory. Repository name `turnproof-ai` proposed; availability unchecked.

---

## C1 — M0 inventory and scaffold

Checkpoint ID / timestamp with timezone: C1, 2026-10-12, host clock (timezone not confirmed).
Milestone / branch / commit: M0. No git repository existed, so no branch or commit. Everything below is uncommitted working-tree state.
Implemented behavior: inspected the repository (13 documentation files, two PNG brand assets, no code). Confirmed Node v22.23.2, npm 10.9.8, Python 3.12.3, working npm registry access, and that `node:sqlite` loads and exposes `DatabaseSync`. Created the npm-workspaces monorepo: root `package.json`, `tsconfig.base.json`, `tsconfig.json`, `.gitignore`, and the four workspace manifests.
Checks: `node -v` → v22.23.2. `npm -v` → 10.9.8. `node -e "require('node:sqlite')"` → OK, with an ExperimentalWarning. `npm install` → added 192 packages, exit 0.
Failures: none.
One exact next action: implement the domain schemas and the deterministic scheduler.

## C2 — M1 domain engine verified against hand-derived oracles

Checkpoint ID / timestamp with timezone: C2, 2026-10-12.
Milestone / branch / commit: M1.
Implemented behavior: `packages/domain/src/` with `schemas.ts` (Zod contracts), `time.ts`, `hash.ts` (canonical hashing), `normalize.ts` (event application, conflict and staleness detection), `schedule.ts` (topological DAG scheduler), `candidates.ts`, `validate.ts` (hard-constraint gate), `explain.ts` (ranking and decision), `decide.ts` (orchestration). Four hero fixtures with hand-derived oracles: `case-a`, `case-b`, `case-b-wait`, `case-c`, plus `fixtures/policies/policy-default.json`.
Checks: `npx tsx scripts/build-fixtures.ts` → 4 files updated, exit 0. `npx vitest run tests/domain/engine.test.ts` → 16 tests passed, exit 0. `npx tsc -p tsconfig.json --noEmit` → exit 0.
Result: Case A reproduces the hand-derived oracle exactly, baseline ready 2026-10-12T10:10:00Z (20 minutes late), alternate `TANKER-2` at 09:55:00Z (5 minutes late), projected recovery 15 minutes. `TANKER-3` rejected with `RESOURCE_RESERVED` and `OUTSIDE_AVAILABILITY_WINDOW`. Case B reports no feasible option and asserts no readiness. Case C abstains with both conflicting sources shown.
Failures: location `fixtures/policies/default.json` → cause: the loader resolves policy files by `policy.id`, so a file named `default.json` could not be found → fix: renamed to `policy-default.json`.
Unresolved assumptions: the 5-minute availability freshness budget and every duration band are invented, not aviation standards.
One exact next action: build the API and its integration tests.

## C3 — M1 API, M2 UI, and the first real integration bug

Checkpoint ID / timestamp with timezone: C3, 2026-10-12.
Milestone / branch / commit: M1 and M2.
Implemented behavior: `packages/adapters` (provider and sponsor descriptors, deterministic note extraction with strict id validation). `apps/api` (Fastify 5, SQLite through `node:sqlite`, seven tables, all eight documented routes, idempotency scoped to route plus scenario, revision preconditions, single-transaction decision writes, append-only reviews, export packets, static UI serving). `apps/web` (React 18 and Vite 5 console: banner, scenario picker, station board, timeline, alternatives with reason codes, evidence drawer with conflicts and stale claims, review form, packet export). `scripts/generate-scenarios.ts` produced 30 generated fixtures.
Checks: `npx tsx scripts/generate-scenarios.ts` → 30 scenarios written, exit 0. `npx vitest run tests/api/api.test.ts` → 15 tests passed, exit 0. `npx vite build --config apps/web/vite.config.ts` → built, exit 0. `npx playwright test` → 4 passed, 1 failed.
Failures: location `tests/api/api.test.ts` load → cause: `node:sqlite` is absent from the builtin list bundlers consult, so Vite rewrote the import into the bare specifier `sqlite` and the suite could not load → fix: load the module with `createRequire` in `apps/api/src/storage/db.ts`.
Failures: location `tests/e2e/smoke.spec.ts` review and export → cause: the UI reviewed the decision computed by `GET /api/scenarios/:id/snapshot`, which is never persisted, so `POST /api/decisions/:id/reviews` returned `not_found` → fix: `apps/web/src/App.tsx` now records the decision through `POST /api/decisions` with a stable idempotency key and reviews the stored id.
Failures: location `packages/domain/src/validate.ts` → cause: a specific hard-constraint code collapsed into `DEPENDENCY_INVALID` for structural faults → fix: preserve the specific code when the scheduler already produced one.
Failures: location `tests/domain/constraints.test.ts` → cause: the test asserted an impossible availability window on a resource whose value was then overwritten by the fixture's own update event, so the test was wrong rather than the code → fix: corrected the fixture under test and kept the assertion.
Failures: location `packages/domain/src/explain.ts` → cause: a conflict abstention still carried a chosen candidate id and a projected delay, which reads as a recommendation → fix: an abstention now leaves the candidate id and both delay fields unset.
One exact next action: run the full suite, then evaluate every fixture.

## C4 — M4 evaluation measured

Checkpoint ID / timestamp with timezone: C4, 2026-10-12.
Milestone / branch / commit: M4.
Implemented behavior: `scripts/evaluate.ts` decided every fixture and wrote `proof/results/evaluation.json` with the environment, sample counts, per-scenario rows and the method. `tests/e2e/screenshots.spec.ts` captured three screenshots from the running application into `proof/screenshots/`.
Checks: `npx vitest run` → 45 tests across 3 files, all passed, exit 0. `npx playwright test` → 5 tests passed, exit 0. `npx tsc -p tsconfig.json --noEmit` → exit 0. `npx tsx scripts/evaluate.ts` → 34 scenarios, exit 0.
Result: 27 recommended, 3 needs_review, 4 no_feasible_option; feasible-choice rate 0.8824; 20 hard-constraint rejections; abstention correct on 2 of 2 conflict scenarios and 4 of 4 no-feasible scenarios; 16 evidence ids cited with 0 unresolved; projected delay comparable in 27 scenarios with 10 strictly better, 17 equal, 0 worse, 150 minutes total; solver latency p50 0.269 ms, p95 1.887 ms, max 4.424 ms; reruns identical; all 4 hero oracles matched.
Failures: location `proof/results/evaluation.json` hero oracle for `case-c` → cause: the oracle expected no candidate delay while the decision still carried one during a conflict abstention → fix: the abstention change recorded in C3, after which all four oracles match.
Unresolved assumptions: no human workflow-time study, no live-provider comparison, no independent reproduction, and no statistical generalisation is claimed from 34 toy fixtures.
One exact next action: write the proof manifest and then commit and publish.

## C5 — Documentation set completed; publishing pending

Checkpoint ID / timestamp with timezone: C5, 2026-10-12.
Milestone / branch / commit: M4 documentation. Still no git repository, so still no commit.
Implemented behavior: rewrote `README.md` around the working prototype with `turnproof-logo.png` as the header image; wrote `docs/EVALUATION.md`, `docs/INTEGRATIONS.md`, `docs/PILOT.md`, `docs/DECISIONS.md`, `docs/DEMO.md`; rewrote `docs/DEVPOST_PROJECT_STORY.md` and `docs/BUILT_WITH.md` around what was actually built.
Checks: file writes only; no command run in this step.
Integration status: unavailable for live AI, Anakin and Jev; deterministic available; replay available and labelled.
Failures: location sponsor investigation → cause: no official documentation could be retrieved because no usable web-research tool was available in this session, and there is no account or credential for either sponsor → fix: recorded the non-investigation honestly in `docs/INTEGRATIONS.md` and left both adapters unavailable. No URL or API shape was invented.
Unresolved assumptions: the README and evaluation document reference `proof/manifest.json` and `proof/packets/*.json`, which `npm run proof:export` creates and which do not exist until that command runs.
Claim changes: `docs/BUILT_WITH.md` now lists ten verified tags and explicitly forbids claiming Anakin, Jev or any AI provider tag.
One exact next action: run `npm run proof:export`, then commit and publish the repository publicly.

## C6 — Proof manifest generated; first commit created

Checkpoint ID / timestamp with timezone: C6, 2026-10-12.
Milestone / branch / commit: M4 proof generation, on branch `master`, commit `e42e1e173b678f594a9ec760df7114e123b49581`.
Implemented behavior: re-ran the full verification set on the frozen working tree, then created the repository's first commit and generated the proof bundle with `npm run proof:export`.
Checks: `npm test` → 45 tests passed across 3 files, exit 0. `npm run typecheck` → exit 0. `npm run evaluate` → 34 scenarios decided, exit 0, rewritten `proof/results/evaluation.json`. `npm run test:e2e` → 6 tests passed, exit 0, screenshots refreshed. `npm run proof:export` → `proof/manifest.json` with 109 artefacts, 34 scenarios and 3 decision packets; bundle hash `faf546f1a42d7d7e886f55003402432c2feae598beb9303fa4d945f1cad173bf`, exit 0. The manifest records commit `e42e1e1` and `workingTreeDirty: true`, because the proof outputs it had just written were still uncommitted.
Result: `proof/packets/case-a-packet.json` state `recommended`, `case-b-packet.json` state `no_feasible_option`, `case-c-packet.json` state `needs_review`.
Correction to earlier checkpoints: C3 and C4 record "5 Playwright tests". The full `npm run test:e2e` run now includes the screenshot-capture spec in `tests/e2e/screenshots.spec.ts`, so the current count is 6: 5 behaviour flows plus 1 screenshot capture. `README.md`, `docs/EVALUATION.md` and `docs/DEVPOST_PROJECT_STORY.md` were corrected to match. The earlier entries are left as written because they were accurate for the runs they describe.
Dirty files at checkpoint time: `proof/manifest.json`, `proof/packets/*.json`, `proof/results/evaluation.json`, `proof/screenshots/*.png`.
Integration status: deterministic available; replay available and labelled; live AI, Anakin and Jev unavailable, none called.
Failures: none in this step.
One exact next action: commit the proof outputs, update the handoff, and publish the repository publicly with `gh repo create yablokolabs/turnproof-ai --public --source=. --push`.

## C7 — Repository published publicly

Checkpoint ID / timestamp with timezone: C7, 2026-10-12.
Milestone / branch / commit: M5 publication, branch `main`, commit `e2913dbe75ee485e39fc4508b8d18ba0b1d3448c`.
Implemented behavior: created the public GitHub repository and pushed the two commits, then pointed the documentation at the real URL.
Checks: `gh repo create yablokolabs/turnproof-ai --public --source=. --push` → exit 0, reported `https://github.com/yablokolabs/turnproof-ai` and `[new branch] HEAD -> main`. `git ls-remote --heads origin` → `refs/heads/main` at `e2913db`. `gh repo view yablokolabs/turnproof-ai --json ...` → `visibility: PUBLIC`, `defaultBranchRef: main`, `licenseInfo: null` (no license file is present, so the repository is public but not open-source licensed).
Result: `README.md` and `docs/DEVPOST_PROJECT_STORY.md` now name the public repository. `docs/DEMO.md` places the same URL on the video end card.
Integration status: unchanged. Deterministic available; replay available and labelled; live AI, Anakin and Jev unavailable, none called.
Failures: none. Note: the local branch was created as `master` and is now `main`, tracking `origin/main`.
Unresolved assumptions: no demo video exists, so no video link may be claimed. No sponsor documentation was retrieved, so no sponsor capability may be claimed. Push authorization was given explicitly by the user on October 12, 2026; no further publishing, deployment or submission has been authorized.
One exact next action: record the three-minute demo video from `docs/DEMO.md`, then add its real link to `README.md` and `docs/DEVPOST_PROJECT_STORY.md`.
