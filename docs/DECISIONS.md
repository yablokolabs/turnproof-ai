# Architecture decisions

One section per decision, recorded as context, decision, alternatives considered, and consequences. Only decisions that are actually visible in this repository are listed.

## 1. TypeScript monorepo with npm workspaces

**Context.** The deliverable spans a browser UI, an HTTP API, a domain engine, adapters, fixtures, scripts and tests. They share data contracts that must not drift.

**Decision.** A single repository with npm workspaces: `packages/domain`, `packages/adapters`, `apps/api`, `apps/web`, plus `fixtures/`, `scripts/` and `tests/` at the root. Workspace packages export TypeScript source directly (`"main": "./src/index.ts"`), so there is no intermediate build step to go stale between packages.

**Alternatives considered.** Separate repositories per app; a single flat package; a build-per-package layout with emitted JavaScript.

**Consequences.** One `npm install` and one lockfile give a reproducible tree, and a type error in a shared contract surfaces immediately. The cost is that tooling must transpile TypeScript on the fly: `tsx` runs the API and scripts, Vite builds the UI, and Vitest runs the tests. There is no compiled artefact to hand to a runtime that only consumes JavaScript.

## 2. SQLite through the built-in `node:sqlite` module

**Context.** The specification calls for SQLite persistence for scenarios, events, evidence, snapshots, decisions, reviews and adapter runs. The obvious choice, `better-sqlite3`, is a native addon.

**Decision.** Use the built-in `node:sqlite` module (`DatabaseSync`). It needs no compilation, so `npm install` is reproducible on a judge's machine and in a container without a toolchain.

**Alternatives considered.** `better-sqlite3` for a stable API and typed bindings; `sqlite3`; an in-memory store with JSON files.

**Consequences.** No native build step, and no version skew between the driver and the runtime. The trade-off is that Node marks the module experimental and prints an `ExperimentalWarning` on startup; that is expected output, is recorded in the README, and is treated as a limitation rather than hidden. Because the module is missing from the builtin list bundlers consult, it is loaded through `createRequire` — see decision 12.

## 3. Zod at every boundary

**Context.** Fixtures, request bodies, stored payloads and export packets all cross a trust boundary. A malformed or stale payload must fail closed.

**Decision.** Define every contract once in `packages/domain/src/schemas.ts` as a Zod schema, infer the TypeScript types from the schemas, and validate inbound fixtures, every HTTP request body, and every fixture loaded from disk.

**Alternatives considered.** TypeScript types alone with ad-hoc runtime guards; JSON Schema plus a separate generator; trusting fixtures because they are checked in.

**Consequences.** One definition drives both compile-time and runtime checking, and a bad fixture fails loudly at load with a field path. Zod validation costs a small amount of runtime per request, and the schemas are the single place a contract change must be made.

## 4. A graph/topological scheduler instead of an optimiser

**Context.** Readiness has to be computed from task dependencies, revised availability, predecessor finishes and resource availability, and it has to be explainable to a coordinator.

**Decision.** Build a dependency DAG, reject cycles and missing predecessor references, then compute each task's earliest start in topological order with a stable task-id tie break. Resource reservations are handled by shifting a task to the next free slot rather than by a search.

**Alternatives considered.** A linear-programming or constraint-solver optimiser; a discrete-event simulation; a hand-rolled search over orderings.

**Consequences.** The result is deterministic and can name the causes that produced each start time, which is what the evidence chain needs. The cost is that the engine explores no alternatives beyond the candidates it is given: it does not find an optimum, it evaluates a candidate set.

## 5. Hard constraints gate candidates before any ranking

**Context.** A recovery suggestion that violates a dependency, a resource kind, an exclusive commitment, a duration band, completed-task immutability or critical evidence freshness must never be presented as a viable option.

**Decision.** Every candidate is checked against the hard constraints in `packages/domain/src/validate.ts` and is rejected with explicit reason codes when it fails. Failure reason codes include `RESOURCE_UNAVAILABLE`, `RESOURCE_RESERVED`, `OUTSIDE_AVAILABILITY_WINDOW`, `RESOURCE_KIND_MISMATCH`, `DURATION_OUT_OF_BOUNDS`, `COMPLETED_TASK_MUTATION`, `NEGATIVE_TIMING`, `STALE_CRITICAL_EVIDENCE`, `CONFLICTING_EVIDENCE` and `READINESS_UNCERTAIN`. Ranking only ever sees the survivors.

**Alternatives considered.** Ranking everything and scoring feasibility as a penalty; letting a model decide which constraints matter.

**Consequences.** An infeasible option can never be recommended, and its rejection is inspectable in the UI and the export. The cost is that a marginal candidate that violates a constraint by seconds is rejected outright rather than surfaced with a caveat.

## 6. Deterministic rule-based mode as the default, with no model in the loop

**Context.** The prototype must work with no credentials, and a model must not be able to waive a constraint.

**Decision.** `deterministic` is the default provider mode and is rule-based: a dependency engine plus a constraint gate. No model runs in it. The provider record stored with every decision names the mode and its status.

**Alternatives considered.** Calling a hosted model by default; making live AI the primary path with a deterministic fallback.

**Consequences.** The whole system runs offline, every result is reproducible, and a rerun produces the same decision id. The cost is that the engine cannot interpret unstructured text beyond the rule-based extractor in `packages/adapters/src/extract.ts`, which is deliberately narrow.

## 7. Replay implemented from stored decisions and always labelled

**Context.** The specification requires a `replay` mode that is visibly distinguishable from live use.

**Decision.** Replay reads the most recent deterministically computed decision for a scenario from local SQLite and returns it, labelled `providerMode: "replay"`, `providerStatus: "available"` and `providerName: "replay"`, with a `replayOfDecisionId` pointing at the recorded decision. If nothing has been recorded, replay reports `unavailable` rather than pretending a replay happened. A replay can never replay a replay: the lookup filters to deterministically computed rows.

**Alternatives considered.** Recomputing the decision and calling it a replay; replaying a recorded raw model response; treating replay as equivalent to live for demonstration purposes.

**Consequences.** A replay is honest about what it is: the same stored answer, shown again. The cost is that replay demonstrates the architecture and the labelling, and must never be read as evidence that a live provider works.

## 8. Live AI left unimplemented rather than stubbed

**Context.** No live model provider contract was verified: no documented endpoint, no structured-output guarantee, no authentication model, no rate limits, no account access, and no credentials in this environment.

**Decision.** Report live mode as `unavailable` with an explicit reason. Do not add a fake client, a simulated latency, or a hard-coded response. Additive behaviour that a live provider would need is specified as a contract instead: `collectEvidence()` and `rankCandidates()` shapes, returned status of `available` / `unavailable` / `error`, observed timestamp, source ids, request hash, latency, and sanitized response metadata.

**Alternatives considered.** A stub that returns plausible output so the UI has something to show; a mock server with recorded payloads presented as live.

**Consequences.** The UI has a real, honest live state, and the gap is a stated limitation instead of a hidden one. The cost is that the live path is untested against any real provider.

## 9. Sponsor adapters left unavailable

**Context.** Anakin is described in the competition attachment as a web-interaction API or MCP, and Jev as a "System One" decision model. Those descriptions establish nothing about endpoints, SDKs, authentication, price, retention, rate limits or account access.

**Decision.** Keep both adapters unavailable, implement no call, and state the reason in `packages/adapters/src/contracts.ts` so it appears in `/api/health` and in the UI's sponsor row. Exclude both names from any use claim.

**Alternatives considered.** Writing a speculative client against a guessed interface; integrating against a third-party page that describes them; booking the prize on architecture alone.

**Consequences.** No prize-use claim is made on a fabricated integration, and the adapters remain useful as architecture once a contract is verified. The cost is that neither sponsor can be claimed as used.

## 10. Fixtures as the only source of truth, with evidence content hashes

**Context.** There is no upstream system of record, and clearly synthetic data must never be mistaken for telemetry.

**Decision.** The committed JSON fixtures under `fixtures/scenarios/` are the source of truth. Each evidence item carries a `contentHash` of its own content, and `fixtures/loader.ts` refuses a fixture whose hash does not match, so text cannot be edited without the hash being regenerated. Every scenario carries a `dataProvenance` string and is labelled synthetic in the export packet's provenance block.

**Alternatives considered.** A live feed with no fixtures; generating random scenarios at runtime; storing scenarios only in the database.

**Consequences.** Runs are reproducible and a judge can read exactly what the engine consumed. The cost is that the fixture set is fixed and small: 34 scenarios, which is not a sample of anything.

## 11. Review records are append-only

**Context.** Review is the point where a human records a preference, and the specification requires that corrections create new records.

**Decision.** `POST /api/decisions/:id/reviews` inserts a new row and never updates or deletes one. A correction is a new row with an optional `supersedes` pointer, and `GET /api/decisions/:id` returns the full ordered list. The export attaches the latest review as the reviewer choice while leaving the recorded decision untouched.

**Alternatives considered.** Updating a single review row per decision; a mutable "current status" column.

**Consequences.** The decision history is auditable and a correction is visible as a correction. The cost is an unbounded number of rows per decision, which is acceptable at this scale.

## 12. Loading `node:sqlite` through `createRequire`

**Context.** `node:sqlite` is still experimental in Node 22, so it is absent from the builtin module list that bundlers consult. A static `import { DatabaseSync } from 'node:sqlite'` was rewritten by Vite into the bare specifier `sqlite`, which failed to resolve, so the API test suite could not load at all.

**Decision.** Load the module with `createRequire(import.meta.url)('node:sqlite')` and keep the type through `typeof import('node:sqlite')`. Node still loads its own built-in module; nothing is replaced or shimmed.

**Alternatives considered.** Adding a bundler alias for `sqlite`; marking the module external in the Vitest configuration, which did not resolve it; switching to `better-sqlite3` to avoid the problem.

**Consequences.** The same module is used at runtime and under test, and the failure is fixed at its cause rather than by a test-only alias. The cost is one less conventional import and a comment explaining why.

## 13. Persist a decision before it can be reviewed or exported

**Context.** `GET /api/scenarios/:id/snapshot` computes a decision on the fly; it does not store one. The first version of the UI pointed the review form at that computed decision, so recording a review returned `not_found`, and an export would have had no stored record to attach a reviewer choice to.

**Decision.** After loading a snapshot, the UI records the decision through `POST /api/decisions` with a stable idempotency key derived from the scenario, its revision and the provider mode, then reviews and exports against the returned stored id. Reloading a scenario returns the already-recorded decision instead of writing another row.

**Alternatives considered.** Making the snapshot endpoint persist implicitly, which would turn a read into a write; letting the review endpoint invent a decision row; hiding the failure in the UI.

**Consequences.** A review or an export always refers to a record that exists, and the browser test proves the round trip. The cost is one extra request per snapshot load, and the UI must handle persistence failing separately from loading failing.
