# Integration ledger

**Nothing is integrated. No sponsor endpoint was called, from this repository or by hand.**

Every claim below is either evidence from this repository or an explicit statement that something was not verified. There are no source URLs in this file, because none were consulted: no official documentation for either sponsor could be retrieved in this session, so quoting a URL or an API shape would be invention.

## Status summary

| Integration | Status | Adapter exists | Call attempted | Where the status is visible |
| --- | --- | --- | --- | --- |
| Deterministic rules | available | yes, `packages/domain` | n/a, no network | `/api/health`, every decision record |
| Replay | available, always labelled replay | yes, in `apps/api/src/services/decisions.ts` | n/a, reads local SQLite | `/api/health`, decision record `providerMode` |
| Live AI provider | unavailable, unimplemented | descriptor only | no | `/api/health`, UI sponsor/provider row |
| Anakin | unavailable | descriptor only | no | `/api/health`, UI sponsor row |
| Jev (TypeSafe AI) | unavailable | descriptor only | no | `/api/health`, UI sponsor row |

## What was actually established about Anakin

**Source: the competition attachment only, preserved as `docs/COMPETITION_SOURCE.txt`.** The attachment describes Anakin as a web-interaction API/MCP and offers a prize for its use. Nothing in the attachment establishes an endpoint, an SDK, a tool name, a structured-output guarantee, an authentication scheme, a price, a rate limit, a retention policy, or deployment compatibility.

**What was not done, and why.** No official documentation was retrieved, and no account or credential exists in this environment. The web-research tool available to the coding session was not usable, so a documentation check could not be performed at all. The 90-minute investigation budget from the build specification was therefore not spent, and no clock was started or claimed.

**What a defensible adapter would need to prove before implementation.** Official read, navigation and extraction support with a stated permission model; the actual API or MCP interface; cost; rate limits; retention; and account access. A first integration should read a team-owned synthetic service-status page on an allowlisted origin, capture a snapshot with a timestamp and a content hash, deny redirects to non-allowlisted origins, and write nothing anywhere. A raw screenshot alone would not prove the integration.

**Decision.** Keep the adapter unavailable. Do not name Anakin in `docs/BUILT_WITH.md`, and do not claim prize fit on architecture alone. The reason string lives in `packages/adapters/src/contracts.ts` as `ANAKIN_DESCRIPTOR`, so it appears in `/api/health` and in the UI without anyone having to remember it.

## What was actually established about Jev

**Source: the competition attachment only.** The attachment describes Jev as TypeSafe AI's System One decision model for fast structured decisions, and offers a prize for its use in aviation. It establishes no model interface, input limits, output format, latency, credentials, or permitted use.

**What was not done, and why.** As with Anakin: no documentation retrieved, no account, no credential, and no usable web-research tool in this session. Nothing was called.

**What a defensible adapter would need to prove.** The verified supported interface, input and output limits, latency, credentials, and permitted use. A first integration should send a bounded, sanitized candidate set drawn only from deterministically feasible candidates; validate any returned id against that exact set; reject invented ids and malformed output; and never let a returned action bypass the hard-constraint gate. Jev must not be described as a general-purpose LLM, and no JSON-output guarantee may be claimed without documentation.

**Decision.** Keep the adapter unavailable. Do not name Jev in `docs/BUILT_WITH.md`. The reason string lives in `packages/adapters/src/contracts.ts` as `JEV_DESCRIPTOR`.

## Exactly one provider can be pointed at real work

`deterministic` is the only provider with an implemented compute path. It is rule-based: a dependency DAG plus a hard-constraint gate, with no model and no network access. `replay` is a second implemented path, but it returns a previously stored decision from local SQLite and is labelled `replay` everywhere it appears, so it demonstrates the adapter architecture rather than a live integration.

`live` is deliberately unimplemented. There is no stub client, no simulated latency and no hard-coded response anywhere in the repository, because a fake provider in a live slot is the one failure mode this project cannot afford.

## Revalidation checklist, for whenever access exists

1. Retrieve official documentation and record the URL, the retrieval date, the supported capability, the restrictions, and the retention terms.
2. Confirm account access exists and note whether any credit is included. Assume nothing about free credits.
3. Make one real, read-only call against a team-owned synthetic target and record a redacted request and response, with the timestamp and the request hash.
4. Add the adapter only if step 3 succeeded. A recorded replay must never be presented as the result of that call.
5. Update this ledger, `docs/BUILT_WITH.md` and `docs/DEVPOST_PROJECT_STORY.md` together, so the three cannot disagree.

## Security boundaries held by the current code

1. No credential, token or secret exists in the repository, because no external service is used. `proof:export` scans its own packet output for secret-shaped strings and asserts none are present.
2. The API binds to loopback by default; there is no authentication, so it must not be exposed publicly without access control and a retention review first.
3. Imported text is treated as untrusted data. A `note`-field event is preserved as evidence content and is never applied to a task or resource; Case C proves an instruction-like note changes nothing.
4. No write path exists to any airline, handler or sponsor system. The prototype's only writes are to its own local SQLite file.
