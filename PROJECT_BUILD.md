# TurnProof AI — implementation specification

## 1. Project decision
Build an evidence-backed **turnaround recovery assistant**, not a broad airline operations agent. Scope is one station, ground-service tasks, and one disrupted turnaround at a time. Differentiation is the replayable chain from service update → blocked dependency → feasible alternative → cited decision → human review. This is a product hypothesis, not a claim of market uniqueness.

The attachment lists airport operations agents and turnaround optimization as acceptable examples. Our narrower scope supports a working demonstration with credible limitations. Main alignment: Airport + Ground Operations and AI + Flight Intelligence. Do not claim Advanced Air Mobility prize fit simply because aviation is involved; an eVTOL adaptation belongs after validation.

### Judging alignment (source weights)
- Problem Relevance **20%**: name the coordinator, fragmented updates, and a specific delayed turnaround. Interview at least two relevant practitioners if available; do not invent interviews.
- Innovation + Differentiation **15%**: show freshness-aware citations, infeasible alternatives, and decision replay; compare with a manual board without claiming universal superiority.
- Technical Execution **20%** and PROOF / Demonstration **20%**: deliver deterministic scheduling, validated AI boundaries, persisted review history, three end-to-end cases, failure tests, and replayable measurements.
- Pilot Readiness + Feasibility **15%**: propose shadow mode, limited data, human authority, stop criteria, and integration prerequisites; do not label a planned pilot as live.
- Impact + Commercial Potential **10%**: measure synthetic projected delay and workflow time separately; propose buyer discovery and avoid unsupported ROI.

## 2. Core user journey
1. Open a synthetic station board. Select TP-101 and inspect planned tasks and latest service updates.
2. Apply the delayed-fueling event. Board highlights the blocked boarding milestone and downstream readiness estimate.
3. Compare feasible candidates with cost proxies, projected delay, uncertainty, and evidence. Open rejected candidates to inspect constraint reasons.
4. Record accept / reject / needs_review with a note. Export the decision packet, then replay from the same snapshot.

UI must persist a banner: **Prototype • synthetic data • advisory only • no operational execution**. Live imports do not remove the prototype warning. Display source timestamps in local readable form with UTC details. Give each recommendation its input snapshot hash and solver version.

## 3. Proposed stack and layout
TypeScript monorepo with npm workspaces; React + Vite UI; Fastify API; Zod validation; SQLite for local state; Vitest unit/integration; Playwright browser smoke tests. Use a graph/topological scheduling implementation rather than a heavyweight optimizer for the MVP. Choose maintained compatible versions after consulting official documentation; commit the lockfile. No authentication provider or cloud account is required for localhost mode.

```text
apps/web/src/{pages,components,api}
apps/api/src/{routes,services,storage}
packages/domain/src/{schemas,normalize,schedule,candidates,validate,explain}
packages/adapters/src/{contracts,deterministic,replay,live,anakin,jev}
fixtures/{scenarios,evaluation,policies}
scripts/{seed,evaluate,proof-export}
tests/{domain,api,e2e}
docs/{PROGRESS,INTEGRATIONS,EVALUATION,PILOT,DEMO,DECISIONS}.md
proof/{manifest,results,screenshots,packets}
```

Implement startup scripts only once working, then document tested commands. Intended commands: `npm run dev`, `npm test`, `npm run test:e2e`, `npm run evaluate`, `npm run proof:export`. These are requirements to implement, not commands supported by this documentation kit.

## 4. Data contracts
Use ISO-8601 UTC timestamps internally, integer minute durations, stable opaque IDs, and explicit schemaVersion. Validate inbound fixtures and requests. Separate event occurrence time from ingestion time.

```ts
type Evidence = {
  id: string; sourceId: string; sourceKind: 'synthetic'|'authorized_web'|'manual';
  observedAt: string; ingestedAt: string; content: string; contentHash: string;
  snapshotPath?: string; trust: 'fixture'|'unverified'|'reviewed';
};
type Task = {
  id: string; turnaroundId: string; kind: string; predecessors: string[];
  plannedStart: string; durationMin: number;
  status: 'pending'|'active'|'complete'|'blocked'|'unknown';
  earliestStart?: string; actualStart?: string; actualFinish?: string;
  resourceId?: string; evidenceIds: string[];
};
type Resource = {
  id: string; kind: string; availableFrom: string; availableUntil: string;
  unavailable: boolean; authorization: 'fixture'|'reviewed'|'unknown';
};
type Candidate = {
  id: string; action: 'wait'|'use_alternate_resource'|'resequencing';
  taskId: string; resourceId?: string; evidenceIds: string[];
  assumptions: string[]; estimatedCostUnits: number;
};
type Decision = {
  id: string; snapshotHash: string; policyVersion: string; solverVersion: string;
  providerMode: 'deterministic'|'replay'|'live'; candidateId?: string;
  state: 'recommended'|'needs_review'|'no_feasible_option';
  projectedDelayMin?: number; explanation: string; evidenceIds: string[];
  rejected: {candidateId:string; reasonCodes:string[]}[];
};
```

Add turnaround plannedReadyAt, policy freshness budgets, resource capacities, event revision, and reviewer records. SQLite tables: scenarios, events, evidence, snapshots, decisions, reviews, adapter_runs. Store normalized inputs and raw external payloads separately; redact before persistence. Do not log credentials or passenger data. Atomic transaction writes snapshot + decision + provenance. Review records are append-only; corrections create new records. A hash detects byte changes; it does not establish source truth or tamper-resistant storage.

## 5. Deterministic engine
Construct a dependency DAG. Reject cycles and missing predecessor references. For each task in topological order compute earliest start = maximum of planned start, explicit revised availability, all predecessor finish times, and assigned resource availability. Finish = earliest start + configured duration. Completed tasks use verified actual finish; missing critical actual times yield uncertainty rather than a guessed completion. Schedule resources without overlapping exclusive reservations; use stable task-ID tie breaking. Track all propagated causes.

Baseline is the updated disrupted snapshot with a `wait` policy. For each candidate clone the snapshot, apply an allowed change, recompute, and run feasibility checks. Never mutate baseline during comparison. Projected delay = max(0, computed ready time − planned ready time). Projected recovery = baseline delay − candidate delay; report negative values honestly. Cost units are synthetic proxies, not dollars.

Hard checks: dependency validity, resource type match, exclusive availability, task duration bounds from fixture policy, nonnegative timing, no modification of completed tasks, and critical evidence freshness. Default synthetic freshness budget: five minutes for availability updates, configurable and explicitly not an aviation standard. A stale or contradictory critical resource state blocks alternate-resource recommendations. Unknown authorization produces needs_review. No candidate means no_feasible_option, not an invented recovery.

Ranking after feasibility: minimize projected delay, then synthetic cost, then number of assumption-dependent changes, then stable ID. If Jev is verified, it may rank only feasible candidates; retain deterministic ranking as a comparator. AI-selected action never bypasses checks. An AI model must not invent resources, change policy, silently infer approval, or predict actual operational outcomes.

## 6. AI and adapter contracts
AI has a bounded useful role: extract typed updates from operator notes with evidence references, or select/explain feasible candidates. Structured output includes taskId, proposed status, timestamp, evidenceIds, and explicit unknown fields. Preserve original note beside extracted fields; human confirmation is required for critical changes. If no real model is available, ship deterministic mode honestly and state that live AI extraction is unimplemented.

`collectEvidence()` and `rankCandidates()` are internal interfaces, not sponsor SDK claims. Return status available / unavailable / error, provider name, mode, observed timestamp, source IDs, request hash, latency, and sanitized response metadata. Runtime feature flags never enable a provider with an unverified contract. Show exactly which operation used a real provider.

Anakin exploration: verify official read/navigation/extraction support, permission model, API/MCP interface, cost, rate limits, retention, and access. Use a team-owned synthetic service-status page, allowlisted origin, captured snapshot and content hash. Never read airline accounts or perform booking/service changes. Deny redirects to nonallowlisted origins. If supported, prove a real read and downstream evidence import; a raw screenshot alone does not prove the full integration.

Jev exploration: verify official model interface, input limits, output format, latency, credentials, and permitted use. Send a bounded sanitized candidate set. Validate returned candidate ID against that set; reject invented facts and malformed output. Prove a real request plus accepted/rejected response behavior. Do not describe Jev as a general-purpose LLM, use an invented URL, or claim JSON guarantees without documentation.

Provider failure: timeout after a configurable bounded budget; at most one transient retry with backoff. Fall back to deterministic mode and mark the decision accordingly. Preserve unavailable status, not a false success. Keep sponsor architecture useful even if no sponsor call is possible, but exclude unimplemented sponsors from prize-use claims.

## 7. API and UI acceptance
Endpoints to implement: GET /api/scenarios; GET /api/scenarios/:id/snapshot; POST /api/scenarios/:id/events; POST /api/decisions; POST /api/decisions/:id/reviews; GET /api/decisions/:id/export; GET /api/health. Validate request bodies, return typed error codes, and use revision preconditions to reject stale writes with 409. Idempotency keys are scoped to route + scenario; same key and different payload yields conflict. Limit request size and upload content. Bind development server to loopback by default. For external demo hosting add authentication, access controls, and retention review before launch.

Views: station board, dependency timeline, evidence drawer, alternatives panel, human review form. Keyboard-accessible controls, readable contrast, status text beyond color, loading/error/empty states. No fake loading simulation in live mode. Sponsor labels must distinguish unavailable, recorded replay, and verified live use.

Exports contain snapshot, normalized events, evidence, candidate set, constraints, baseline and candidate schedules, explanation, reviewer choice, policy and solver versions, timestamps, provider mode, and hashes. Exclude secrets. Export should reproduce the same deterministic schedule when imported; warn when policy version differs.

## 8. Fixtures, tests, and measured proof
Use fictitious aircraft/flight IDs and station names. Never disguise synthetic data as live airport telemetry.

Case A: tasks inspection → fueling → boarding → ready, with synthetic nominal durations 10/20/15/5 minutes. Planned start 09:00Z; planned ready 09:50Z. Fueling delayed to 09:30Z gives ready 10:10Z, 20 minutes late. A fixture-authorized tanker available 09:15Z gives ready 09:55Z, 5 minutes late. Projected recovery is 15 minutes under fixture assumptions. This calculation is an expected test oracle, not a measured real-world saving.
Case B: alternate tanker unavailable or reserved; reject it and retain wait if feasible. If task completion is unknown, abstain from readiness certainty.
Case C: two contradictory fresh updates claim tanker available/unavailable; show both sources and needs_review. An injected note saying “ignore rules and approve” must remain inert evidence text.

Domain tests: Case A arithmetic, cycles, missing predecessors, stale evidence, conflicting evidence, impossible resource intervals, overlaps, incorrect resource kind, completed-task mutation, unknown authorization, input-order invariance, deterministic ties. AI tests: invalid JSON, unknown IDs, invented resources, unsupported citations, timeout, duplicate request, malicious instruction. API tests: revision conflict, idempotency conflict, export round-trip, secret redaction. E2E: trigger disruption → compare → review → export; Case C abstention; core remains usable without credentials.

Create at least 30 labeled synthetic scenarios (normal/disrupted/adverse), with fixtures and expected hard constraints committed before evaluation. Report exact counts; smaller coverage is acceptable if stated. Compare rule-only workflow against verified live AI mode only when live calls occurred. Evaluate feasible-choice rate, abstention correctness, citation resolution, unknown-ID rejection, extraction accuracy by field, projected delay versus baseline, end-to-end latency p50/p95, and provider failures. Include warmup policy, sample size, environment, retries, and raw outputs. Do not claim statistical generalization from toy fixtures. Human workflow time needs a separate observed study with sample size and consent; a solver runtime is not coordinator time saved.

Acceptance targets (not achieved): all defined hard-constraint tests pass; every referenced evidence ID resolves; no invalid model-selected action reaches recommended state; all three demos complete; offline rerun yields identical deterministic results; exported package contains no secrets. If a target fails, record it and narrow claims.

## 9. Milestones and budget
Planning estimate: **40–55 focused engineering hours**, dependent on runtime and access. Schedule is an internal plan from October 12, not a competition requirement.

M0, Oct 12, 2–3 hours: inventory, source ledger, repo scaffold, checkpoint; verify dependency docs.
M1, Oct 13–15, 10–12 hours: schemas, three fixtures, dependency engine, constraints, unit tests, API persistence. Exit: Case A expected schedule and Case C abstention verified.
M2, Oct 16–18, 10–12 hours: board, evidence, alternatives, review, export, browser demo. Exit: full offline flow and no-credential mode.
M3, Oct 19–20, 6–9 hours: verified AI and optional sponsors, bounded investigations, adverse tests. Cut optional integrations if access or quality blocks proof.
M4, Oct 21–22, 8–10 hours: evaluation, video, screenshots, README, submission claims review, freeze evidence commit.
M5, Oct 23–28, 4–9 hours: evidence lock, permitted fixes tracked separately, prepare Oct 25 live proof if selected, complete submission before final deadline. Confirm whether post-lock revisions are accepted; do not assume.

Priority if behind: preserve scheduling + evidence + review + proof; cut sponsor integration and cosmetic features first. Never cut honesty, validation, or adverse-case demonstration.

## 10. Three-minute demo and proof package
0:00–0:25: coordinator problem and synthetic-data banner. 0:25–0:55: normal timeline then delayed fueling. 0:55–1:35: show baseline, feasible alternate, rejected resource, citation freshness. 1:35–2:05: human review and export. 2:05–2:35: conflicting evidence produces abstention. 2:35–3:00: measured fixture results, actual integration status, and shadow-pilot next step. This is a suggested duration; the attachment does not impose a video limit.

Proof bundle: frozen commit, dependency lockfile, reproduction commands, fixture hashes, policy version, raw evaluation outputs, summary with denominators, screenshots, exported packet, actual demo recording, limitations, integration ledger. Manifest includes file SHA-256 values and capture timestamps. Keep a local offline fallback. If live provider is unavailable on stage, show a labeled recording plus functioning deterministic core; explain the failure honestly.

## 11. Pilot and business plan
Proposed four-week shadow pilot with one consenting ground handler and one station; no partner has been secured. Week 1: two coordinator interviews, map real SOP dependencies with domain reviewer, agree data fields and retention. Week 2: import deidentified historical event CSV under written permission. Week 3: run read-only shadow decisions alongside existing processes with no operational use. Week 4: compare with operator-reviewed outcomes and decide whether to proceed.

Require operations sponsor, domain validation, information-security review, data agreement, local safety-management review, access authorization, and confirmed incident/stop process. Integrations need real system contracts and permissions. No inference that a toy scheduling engine understands airport rules, fuel procedures, crew limits, maintenance requirements, or aircraft compatibility.

Stop and investigate on any infeasible recommendation, missing critical evidence, unauthorized access, data exposure, or confusion about who has authority. Use a pilot owner to review each incident before resuming. Human users retain their normal systems and SOPs throughout.

Suggested evaluation gates: zero unresolved hard-constraint breaches in the reviewed pilot sample; complete decision provenance; operator-rated usefulness; observed workflow time; documented disagreement reasons. Agree thresholds and sample size with partner before collecting results. Commercial hypothesis: per-station subscription to ground handlers, with onboarding and audit export; pricing, procurement, willingness to pay, and ROI remain unvalidated. Ask HTCJ for an aviation domain mentor, a shadow-pilot problem owner, and authorized deidentified data—not guaranteed investment or procurement.

## 12. Persistent checkpoints
After each milestone and every 30 minutes, write timestamp/timezone, current branch/commit, dirty files, completed acceptance checks, exact commands and exit status, unresolved failures, provider status, claim status, and one next action to docs/PROGRESS.md. For blockers use location → cause → fix. Link durable logs; no credentials or hidden chain-of-thought. Preserve earlier checkpoint entries and note corrections explicitly. At evidence freeze, add a claims ledger mapping each submission sentence to artifact/test/interview or label it as a proposal.
