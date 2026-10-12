# Pilot proposal — read-only four-week shadow pilot

**Status: PROPOSAL ONLY. No partner, ground handler, station, pilot, customer, contract, investment or procurement exists. No interview has been conducted. Nothing in this document has been agreed with anyone.**

The pilot below is a hypothesis about how TurnProof AI could be evaluated safely. It is not a plan that has started, and it must not be described as a live or agreed pilot.

## Purpose

Test one narrow question with one consenting ground handler at one station: when a ground-service task slips, does an evidence-linked view of feasible recovery options help a coordinator more than the manual board they use today, without introducing a new class of error?

## Scope boundary

In scope: one station, ground-service tasks, one disrupted turnaround at a time, read-only.

Out of scope, and excluded from the prototype as well: flight release, dispatch, crew assignment and legality, passenger rebooking, real maintenance actions, aircraft control, weather forecasting, ATC instructions, and any write into an airline or handler system.

## Prerequisites before week 1

All of these must be in place first. None of them exists today.

1. A named operations sponsor who owns the pilot and can stop it.
2. A domain reviewer who validates the real SOP dependencies, fuel procedures and escalation paths. The prototype does not understand airport rules and claims no such understanding.
3. Information-security review, plus a data-processing agreement and an agreed retention period for the deidentified event data.
4. Confirmed access authorization for whatever source the events come from, and a local safety-management review.
5. A written incident and stop process, with a pilot owner who reviews each incident before work resumes.

## Weekly plan

**Week 1 — understand.** Two coordinator interviews, mapping the real SOP dependencies with the domain reviewer, and agreeing exactly which data fields are read and for how long they are kept.

**Week 2 — import.** Import one deidentified historical event CSV under written permission. Compare the engine's recomputed schedules against what the operator actually saw.

**Week 3 — shadow.** Run read-only shadow decisions alongside the existing process. Coordinators keep their normal systems and SOPs throughout; TurnProof output is never used operationally and never writes anywhere.

**Week 4 — compare and decide.** Compare shadow decisions against operator-reviewed outcomes, and decide explicitly whether to proceed, change scope, or stop.

## Proposed evaluation gates

Agree the thresholds and the sample size with the partner before collecting any results. These are proposals, not achieved results.

1. Zero unresolved hard-constraint breaches in the reviewed pilot sample.
2. Complete decision provenance for every reviewed decision: snapshot hash, policy version, solver version, cited evidence, and the reviewer record.
3. Operator-rated usefulness, recorded per decision with the reviewer's own words.
4. Observed workflow time, measured by the study, not inferred from solver latency.
5. Documented disagreement reasons, so a human overriding the engine is captured rather than smoothed over.

## Stop and investigate triggers

Stop the pilot activity and investigate before resuming on any of the following:

1. Any infeasible recommendation that reached a coordinator.
2. Any recommendation made without the critical evidence that supports it.
3. Any unauthorized access, or any access outside the agreed fields and retention period.
4. Any data exposure, including credentials or personal data appearing in an export, log or screenshot.
5. Any confusion about who has authority, or any attempt to treat a recorded review as an operational authorization.

## What a review record means

A review recorded in the prototype captures a reviewer's preference inside the tool. It is never an operational authorization, never a dispatch instruction, and never a maintenance sign-off. That boundary holds in the pilot too.

## Explicit non-claims

1. No partner, pilot, customer, interview, letter of intent or procurement exists.
2. No operator has evaluated this prototype.
3. No ROI, cost saving or commercial figure is claimed. Pricing, procurement and willingness to pay are unvalidated.
4. The four-week shape, the gates and the trigger list are our proposal, not an organizer or partner mandate.

## What to ask for

From the challenge organisers, the useful help is a domain mentor, an introduction to one ground handler willing to consider a read-only shadow pilot, and authorized deidentified historical data. Not investment, not procurement, and not a guarantee of any of the above.
