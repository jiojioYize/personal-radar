# Personal Radar Agent Harness

## Purpose

This document defines how Personal Radar coordinates model roles, deterministic
validation, retries, disagreement resolution, and human escalation. The goal is
not to make every model answer agree. The goal is to make every accepted
recommendation traceable, every disagreement bounded, and every unresolved
case visible.

Harness v2 changes only source verification and its internal evidence
contract. It does not change discovery, recommendation judgment, the website,
or PushPlus.

## Implementation Status

As of 2026-08-01:

- the v2 Schema and deterministic validator are implemented;
- regression tests cover a resolved `Grill With Docs` identity disagreement,
  an unresolved adjudication, complete removal trajectories, and unnecessary
  agent-call rejection;
- the production-format shadow prompt uses Harness v2;
- the first live production-format shadow exercised all three roles and
  exposed a semantic contract gap between repository migration and artifact
  identity change;
- the contract now records `sourceRepositoryChanged` separately;
- a second production-format shadow passed the no-risk path, and a targeted
  live Remotion dispute passed the updated adjudication contract;
- Harness v2 was promoted into the formal production prompt on 2026-07-31
  after the baseline shadow and targeted Remotion adjudication passed;
- the first scheduled production run passed on 2026-08-01: primary verification
  covered every eligible artifact and one bounded replacement, two same-repository
  locator recoveries remained identity-continuous, one invalid exact artifact
  was retained in the removal audit, and specialist and adjudicator calls were
  correctly skipped because no trigger occurred. The validated report was then
  delivered through the normal forwarder, Worker, website, and PushPlus path.

## Verifier v1 Assessment

The earlier verifier v1 flow already had useful harness properties:

- the primary verifier receives no recommendation or preference instructions;
- migration, identity-change, and repository-status risks trigger an
  independent specialist;
- model output follows a Schema and is checked by deterministic code;
- unresolved evidence cannot enter recommendation judgment;
- reader-facing content is generated only after evidence validation.

Its main limitation was disagreement handling. Verifier disagreement was
detected but led to immediate candidate removal. The v1 removal audit
preserved a summary rather than the complete reasoning trajectory, and there
was no bounded adjudication role. This favored safety but could silently
increase false negatives.

## Harness v2 Roles

### Primary verifier

Checks every eligible artifact from first-party evidence. It establishes the
current artifact identity, source, repository status, capability, usability,
maintenance, dependencies, and trust boundary.

### Specialist verifier

Runs only when the primary reports migration, identity change, or a repository
status other than `current`. It receives the original candidate and verification
questions, not the primary conclusion.

### Adjudicator

Runs only when deterministic comparison finds a material disagreement between
the primary and specialist. It receives:

- the original candidate;
- anonymized evidence A and B;
- only the material fields that disagree;
- one field-specific question for each disagreement;
- a first-party-evidence-only policy.

It does not choose `recommend`, `defer`, or `reject`. It resolves source
identity or returns an unresolved verdict.

### Main quality editor

Receives only validated, reconciled evidence for retained candidates. It does
not repeat source browsing and cannot override source identity.

## Disagreement Protocol

Material identity fields are:

```text
verdict
currentUrl
artifactPath
repositoryStatus
sourceRepositoryChanged
identityChanged
```

`sourceRepositoryChanged` and `identityChanged` are intentionally separate.
A Skill can move to another canonical repository while retaining the same
artifact identity. `migrated` records the source move; `identityChanged`
records an evidenced successor, replacement, or material capability/scope
change.

The harness follows this bounded protocol:

1. Code normalizes and compares the primary and specialist outputs.
2. If no material field differs, specialist evidence becomes reconciled
   evidence.
3. If fields differ, code requires a structured dispute packet containing
   exactly those fields and one focused question per field.
4. One fresh-context adjudicator independently checks only the dispute.
5. The adjudicator result becomes reconciled evidence when it verifies a
   current artifact.
6. `ambiguous`, `invalid`, or `inconclusive` adjudication removes the candidate
   while preserving the complete trajectory.
7. There is no open-ended debate and no model retry for substantive
   disagreement. Each model receives at most one contract-repair attempt for
   malformed output.

The initial v2 experiment deliberately omits multi-round battle. Additional
argument rounds will be considered only if shadow evidence shows that a single
adjudicator cannot resolve a meaningful share of valid disputes.

## Exit And Escalation Rules

- Deterministic URL, path, Schema, and coverage failures are handled by code.
- A malformed model response receives one bounded contract repair.
- A resolved adjudication may re-enter the code-owned history filter before
  quality judgment.
- An unresolved adjudication is removed from the daily candidate set.
- The daily report may continue when enough verified candidates remain.
- Every removed trajectory records its reason and follow-up requirement.
- Repeated unresolved patterns become regression fixtures or a future human
  review queue; they are not converted into prompt exceptions.
- Broad network or verifier availability failures stop the run and cannot be
  represented as `no_update`.

## Evaluation

Harness v2 is evaluated against v1 rather than promoted by intuition.

| Metric | Purpose |
| --- | --- |
| Correct source-identity rate | Detect wrong current artifacts |
| False-negative rate | Detect valid artifacts removed by the harness |
| False-positive rate | Detect invalid artifacts admitted to quality review |
| Unresolved rate | Measure how often the harness safely abstains |
| Specialist trigger rate | Measure risk-routing precision |
| Adjudicator trigger and resolution rate | Measure whether adjudication adds value |
| Contract-repair rate | Detect fragile model interfaces |
| Latency and model calls | Keep the daily workflow operationally bounded |

Promotion requires the fixed adversarial suite and at least one
production-format shadow run to pass. A reduction in false negatives must not
increase false positives or allow unresolved identity into recommendation
judgment.

## Harness Validation Log

| Date | Result | Harness behavior | Finding |
| --- | --- | --- | --- |
| 2026-08-01 first scheduled production run | Pass | Ten final eligible artifacts received primary verification; Prisma Database Setup and Better Auth Best Practices used same-repository locator recovery; invalid Git Guardrails evidence remained in the removal trajectory; no migration, repository-status, identity, or disagreement trigger occurred, so specialist and adjudicator runs remained unused; five recommendations and five deferrals finalized and delivered | Confirms the promoted Harness v2 no-risk production path, bounded replacement handling, complete removal audit, evidence-to-draft validation, preference-based ordering, and end-to-end delivery without unnecessary agent calls |
| 2026-07-31 | Semantic retry required | Five retained candidates; one Remotion repository-migration risk triggered a specialist; URL and path disagreement triggered one adjudicator; the adjudicator selected the exact current `remotion-best-practices` artifact; two recommendations and three deferrals finalized without production impact | The run used `migrated` with `identityChanged: false`. That can be correct for an identity-continuous repository move, but v2 had no separate field proving the repository change and its prompt previously conflated the concepts. `sourceRepositoryChanged` is now required and code-enforced. The retained output is valid test evidence, not a promotion pass |
| 2026-07-31 second production-format shadow | Baseline pass | Six retained current-source candidates; no migration or repository-status risk; specialist and adjudicator correctly remained unused; all six results recorded `sourceRepositoryChanged: false`; three recommendations and three deferrals finalized without production impact | Confirms the no-risk path and prevention of unnecessary agent calls, but does not retest repository-migration adjudication. A fixed Remotion dispute test was added instead of waiting for random daily discovery |
| 2026-07-31 targeted Remotion adjudication | Pass | One fresh-context adjudicator received the fixed anonymized URL/path dispute, required no contract repair, verified the exact `remotion-best-practices` directory and `SKILL.md`, and routed the current artifact to evaluation without production impact | Correctly returned `migrated`, `sourceRepositoryChanged: true`, and `identityChanged: false`. This closes the semantic gap found in the first shadow and completes the v2 adjudication promotion evidence |
