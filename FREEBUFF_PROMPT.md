# Paste this entire prompt into Freebuff

Build **TurnProof AI — Recover the turnaround. Show the evidence.** in this repository. Deliver a functioning advisory prototype and a reproducible proof package for HTCJ × PROOF Aviation Futures Challenge. Use `PROJECT_BUILD.md` as the implementation specification and `AGENTS.md` as persistent instructions. This request authorizes local implementation and verification; it does not authorize paid services, external communications, public deployment, operational actions, or submission.

## First actions
1. Inspect repository files, git status, runtime versions, package manager, existing code, and available credentials by presence only. Preserve existing work.
2. Read docs/PROGRESS.md and the supplied competition source. Separate confirmed requirements from assumptions. Verify current official library documentation before adopting APIs or package versions.
3. Create an executable milestone plan M0–M5 and record it in docs/PROGRESS.md. Start with an offline vertical slice; never block the core on sponsor access.

## Product to implement
Build a single-station turnaround board with timestamped updates, dependency-based predicted readiness, evidence cards, feasible recovery alternatives, a human review panel, and downloadable decision packets. The hero demonstration is a fueling delay that blocks boarding; the coordinator compares waiting against a synthetic alternate tanker, sees a shorter projected delay with assumptions exposed, and records approval. A second scenario has no feasible recovery. A third contains conflicting service updates and must abstain.

Keep dispatch, crew assignment, passenger rebooking, real maintenance, aircraft control, weather forecasting, and airline system integration out of the MVP. Do not invent aviation operating limits. Use clearly labeled synthetic task durations and policies.

## Implementation requirements
1. Use TypeScript end-to-end: React/Vite frontend, Fastify server, Zod runtime validation, SQLite persistence, Vitest and Playwright tests. Confirm installed runtime compatibility and lock dependency versions. If an existing maintained stack already fits, document a justified adaptation before changing it.
2. Implement domain engine, fixtures, API, and a plain working UI before visual polish. Compute baseline and candidate schedules with the same dependency engine. Hard constraints gate candidates before any model ranking.
3. Provide provider modes `deterministic`, `replay`, and `live`. Deterministic mode is rule-based, not AI inference. Replay must be visibly labeled. Live AI is optional and requires a documented, tested provider contract. Do not assume OpenAI compatibility or any credentials. If API access is unavailable, finish offline functionality and report the AI feature as unimplemented.
4. Validate structured model outputs; resolve cited evidence IDs; discard invalid actions; fail closed on unknown critical facts. Use bounded timeouts, retry limits, idempotency keys, input hashes, and explicit freshness checks.
5. Build proof scripts and tests from the specification. Store measured results with fixture revision, environment, seed, commit, sample counts, and raw outputs. Never present planned acceptance targets as achieved results.

## Sponsors: investigate, then decide
Anakin is described in the supplied attachment as a web-interaction API/MCP. Jev is described as TypeSafe AI’s System One decision model for fast structured decisions. These descriptions do not establish endpoints, SDKs, tool names, structured-output guarantees, authentication, price, or deployment compatibility.

Verify official documentation and actual account access. Record source URLs, date, supported capability, restrictions, and a redacted real response in docs/INTEGRATIONS.md. Spend at most 90 minutes investigating each optional sponsor before returning to core work. Do not assume free credits.

For Anakin, a defensible integration would read an authorized team-owned status page and capture timestamped provenance without writing anything. For Jev, a defensible integration would choose among deterministically feasible recovery candidates using its verified supported interface. Revalidate its returned ID and facts. If either is infeasible or unavailable, keep the adapter unavailable and exclude its name from Built With and prize-use claims. Replay fixtures can demonstrate adapter architecture but do not demonstrate live integration.

## Execution loop
At each milestone: implement → run relevant checks → inspect actual UI → update docs/PROGRESS.md → record evidence → continue. Ask only for genuinely blocking information; continue independent local work. Do not stop with a plan when implementation remains possible.

At context limits or interruption, update the checkpoint and SESSION_CONTINUATION.md with one precise next action, current branch/commit, failing checks, and unresolved assumptions. Never store secrets.

## Completion report
Report what actually works, how to run it using tested commands, what was measured, what remains blocked, integration status, and where the evidence is stored. Update Devpost story and Built With only to reflect executed work. Deliver a locally runnable prototype, proof ZIP, video script, pilot plan, and honest limitations. Evidence lock is October 23, 2026 (time unspecified); internal evidence completion target is October 22. Final submission is October 28 at 00:00 UTC / 05:30 IST. Do not claim these dates are equivalent milestones.
