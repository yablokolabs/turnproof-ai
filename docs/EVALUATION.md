# Evaluation — measured results

Everything in this document was produced by running commands in this repository on the committed synthetic fixtures. Raw rows are in `proof/results/evaluation.json`. No number below is a plan, a target, or an estimate.

## Headline

The deterministic engine decided 34 committed synthetic fixtures without a model in the loop: 27 recommended, 3 abstained on contradictory evidence, 4 reported no feasible option. Every cited evidence id resolved. Projected recovery across the fixture set totalled 150 minutes under invented fixture assumptions.

## How to reproduce

Run in this order from the repository root:

1. `npm install` — installs the locked workspace dependency tree.
2. `npm test` — 45 Vitest tests across domain and API. All pass.
3. `npm run test:e2e` — builds the UI, serves it from the API on loopback, runs 6 Playwright browser tests: 5 behaviour flows plus 1 screenshot capture written to `proof/screenshots/`. All pass.
4. `npm run evaluate` — writes `proof/results/evaluation.json`.
5. `npm run proof:export` — writes `proof/manifest.json` and the three decision packets under `proof/packets/`.
6. `npm run proof:zip` — packages the bundle into `proof/turnproof-proof.zip` and records the archive hash in `proof/zip-manifest.json`. Verified independently with Python's `zipfile`: 146 entries, clean CRC check, and a sha256 matching the recorded value.

`npm run typecheck` exits 0 across domain, adapters, API, UI, scripts and tests.

## Environment

| Item | Value |
| --- | --- |
| Node | v22.23.2 |
| npm | 10.9.8 |
| Platform | linux x64 |
| Persistence | SQLite through the built-in `node:sqlite` module |
| Provider mode used | `deterministic` |
| Solver version | `tp-solver-0.1.0+tp-0.1.0` |
| Wall clock passed to decision records | `2026-10-12T09:20:00Z`, fixed so records are reproducible |

Scheduling never reads the clock: only the decision record's `createdAt` uses the fixed value above. A rerun of `npm run evaluate` therefore produces the same decision ids and the same snapshot hashes.

## Sample

| Group | Scenarios | What they cover |
| --- | --- | --- |
| normal | 10 | No disruption, or a non-critical revision that stays inside the plan |
| disrupted | 12 | A delayed fuel unit, with a feasible alternate, an unavailable alternate, or a trapped alternate |
| adverse | 12 | Stale claims, contradictory claims, unavailable assigned units, trapped alternates, completed tasks with and without a verified finish, a blocked task, an unrecorded authorization, an out-of-band duration, and an injected instruction-like note |
| **Total** | **34** | 4 of these are hero fixtures with hand-derived oracles |

## Outcomes

| Result | Count |
| --- | --- |
| `recommended` | 27 |
| `needs_review` | 3 |
| `no_feasible_option` | 4 |
| Feasible-choice rate (scenarios with at least one feasible candidate) | 0.8824 |
| Candidate hard-constraint rejections | 20 |

## Abstention

| Check | Result |
| --- | --- |
| Scenarios with contradictory fresh evidence | 2 |
| Of those, decisions that abstained (`needs_review`) | 2 of 2 |
| Scenarios with zero feasible candidates | 4 |
| Of those, decisions that reported `no_feasible_option` | 4 of 4 |

An abstention is never a guess. When two fresh claims disagree about the same critical field, neither value is applied, both sources are shown, and no candidate is proposed.

## Citations

| Metric | Value |
| --- | --- |
| Evidence ids cited across all decisions | 16 |
| Cited ids that do not resolve to a scenario evidence item | 0 |
| Citation resolution rate | 1.0 |

## Projected delay

| Metric | Value |
| --- | --- |
| Scenarios with a comparable baseline delay | 27 |
| Recommended option strictly better than waiting | 10 |
| Recommended option equal to waiting | 17 |
| Recommended option worse than waiting | 0 |
| Total projected recovery across those scenarios | 150 minutes |

These are projections under fixture durations, fixture cost units and a 5-minute synthetic freshness budget. They are not operational savings, and no coordinator time was measured. Latency below is solver runtime, not time saved.

## Solver latency

| Metric | Value |
| --- | --- |
| p50 | 0.201 ms |
| p95 | 1.112 ms |

Measured on 2026-10-12 at commit `5fb5a0a` over the 34 committed fixtures. Solver runtime varies run to run, so read this as an order of magnitude rather than a benchmark; the earlier run of the same tree reported p50 0.269 ms and p95 1.887 ms.
| max | 4.424 ms |

Method: `process.hrtime` around one `decide()` call per fixture, single run, no warmup beyond module load, no repetition and no statistics beyond the three figures above. Treat these as a smoke-scale indication on toy fixtures, not a benchmark.

## Determinism and oracles

| Check | Result |
| --- | --- |
| `case-a`, `case-b`, `case-c` decided twice; decision id and snapshot hash compared | identical |
| Hero fixtures matching their hand-derived oracle | 4 of 4 |

Case A's oracle, hand-derived from the synthetic durations 10/20/15/5 minutes with planned start 09:00Z and planned ready 09:50Z:

1. Baseline with the delayed fuel unit: ready 10:10Z, 20 minutes late.
2. Alternate `TANKER-2`: ready 09:55Z, 5 minutes late.
3. Projected recovery: 15 minutes.

This is an expected test oracle. It is not a measured real-world saving.

## Provider status

| Provider | Status | Evidence |
| --- | --- | --- |
| `deterministic` | available | `packages/domain`, exercised by every test above |
| `replay` | available, labelled replay | reads the most recent stored decision from local SQLite; asserted in `tests/api/api.test.ts` |
| `live` | unavailable, unimplemented | reported as unavailable by the API and asserted in `tests/api/api.test.ts` and `tests/e2e/smoke.spec.ts` |
| Anakin | unavailable | no adapter implemented, no call made |
| Jev | unavailable | no adapter implemented, no call made |
| Provider failures | 0 | no external provider is called in this run |

## Provenance of the artefacts

| Artefact | Produced by |
| --- | --- |
| `proof/results/evaluation.json` | `npm run evaluate` |
| `proof/manifest.json` | `npm run proof:export`, hashing every tracked source artefact |
| `proof/packets/case-a-packet.json`, `case-b-packet.json`, `case-c-packet.json` | the same command, driving the real HTTP API in-process and exporting through `GET /api/decisions/:id/export` |
| `proof/screenshots/case-a-board.png`, `case-b-no-feasible.png`, `case-c-abstain.png` | `npm run test:e2e`, captured from the running application |
| `proof/demo/turnproof-demo.mp4`, `proof/demo/narration/*.mp3` | `npm run demo:narrate` then `npm run demo:video`. The narration step is the only one that contacts a third party; `proof/demo/demo-manifest.json` and `proof/demo/narration-manifest.json` carry its hashes and the voice actually used. |
| `docs/diagrams/*.svg` and `*.png` | `npm run diagrams:build`, and re-measured by `npm run diagrams:check`. |
| `proof/turnproof-proof.zip` and `proof/zip-manifest.json` | `npm run proof:zip`. The first run on 2026-10-12 produced 121 entries; the run that includes the demo video and the diagrams produced 146. The archive hash and byte count are recorded in `proof/zip-manifest.json`, deliberately outside the archive: the archive contains the documentation, so a hash pinned inside it could never stay valid. Verified independently with Python's `zipfile` for entry count and CRC, and with Python's sha256 against the recorded value. |

The manifest and the packets are produced by running `npm run proof:export`; that command is the last step of the list above and is re-run whenever the source changes, so the manifest always describes the tree it was captured from.

The manifest records a SHA-256 per file and a combined bundle hash. A hash detects byte changes; it does not establish source truth and is not tamper-resistant storage.

## What these numbers do NOT show

1. Nothing about a real airport. Every fixture is synthetic, with fictitious stations, flights, aircraft and ground units.
2. Nothing about live AI. No model provider was called, so there is no rule-only versus live-AI comparison to report.
3. Nothing about coordinator time. Solver milliseconds are not workflow time saved.
4. Nothing about real recovery. The Case A oracle is arithmetic on invented durations.
5. Nothing about aviation validity. The durations, cost units and the 5-minute availability freshness budget are invented for the demo and are not aviation standards.
6. Nothing generalisable. 34 toy fixtures are not a statistical sample of anything.

## Open evaluation gaps

1. No human workflow-time study. This needs a separate observed study with sample size and consent.
2. No live-provider comparison. Blocked until a provider contract is verified and credentials exist.
3. No open adversarial text corpus. The only hostile text exercised is the injected instruction-like note in `case-c` and the generator's adverse scenario `gen-adverse-30`.
4. No independent reproduction. Every number here was produced on one machine by this repository's own harness.
5. No per-field extraction accuracy figure, because the rule-based extractor is a contract demonstration rather than a measured model.
6. No test that a sponsor adapter fails closed under a real network fault, because no sponsor adapter is implemented.
7. No pilot data. See `docs/PILOT.md`.
