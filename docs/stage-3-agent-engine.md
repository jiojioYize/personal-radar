# Personal Radar Stage 3A: Hosted Multi-Agent Content Engine

Last updated: 2026-08-03

## Status And Decision

Stage 3A architecture was approved to begin on 2026-08-03 but is not yet
implemented. This document is the architecture, migration boundary, rollout,
and acceptance contract for the first hosted engine.

The first release is a single-user, `skill-radar`-only, non-publishing cloud
shadow. It must not update the public website, write production KV, call
`/ingest-report`, or send PushPlus. Passing the shadow gate does not itself
authorize production cutover.

The current production path remains active until a separate explicit cutover
decision:

```text
Codex Automation -> reports/outbox -> Windows forwarder
-> production Worker -> KV / website / PushPlus
```

The Stage 3A target is:

```text
Cloudflare Workflow schedule
-> cloud source collectors and search
-> deterministic candidate and history filter
-> independently invoked model-API verification roles
-> deterministic Harness v2 reconciliation
-> model-API quality editor
-> deterministic v3 validation and rendering
-> shadow D1 + comparison records
```

No production publishing edge exists in the initial shadow deployment.

This document uses three distinct phases:

| Phase | Generator and destination | Boundary |
| --- | --- | --- |
| Current production | Codex Automation -> local outbox/forwarder -> Worker/KV/website/PushPlus | Remains live and unchanged during shadow. Current-chain defects and limits belong here. |
| Stage 3A shadow | Cloud Workflow/model APIs -> shadow D1 and shadow artifacts | No forwarder, production KV, website update, PushPlus, or forwarder-derived recommendation limit. |
| Future approved cutover | A separately reviewed cloud publisher -> production delivery | Exists only after Gate D approval. Publication count, delivery jobs, credentials, canary, rollback, and retirement of the old schedule are decided here. |

Rules from one row must not be applied to another merely because the systems
share report schemas or are being compared.

## Scope

Stage 3A includes:

- one daily Beijing-time `skill-radar` cloud run;
- Cloudflare Workflows for durable orchestration;
- OpenAI Responses API calls for bounded model roles;
- direct cloud collection from structured catalogs and first-party sources;
- OpenAI `web_search` for discovery and same-source locator recovery;
- D1 for durable operational, evidence, history, cost, and comparison state;
- deterministic retries, idempotency, failure classification, and incident
  records;
- retention of every verified `recommend` decision without a display limit
  inherited from the Windows forwarder;
- non-publishing comparison against the current production result;
- a cutover recommendation after the acceptance window, not an automatic
  cutover.

The initial non-publishing Stage 3A shadow does not include:

- accounts, subscriptions, billing, or multi-user personalization;
- a new public website or website redesign;
- PushPlus delivery from the shadow engine;
- production KV writes;
- a generic agent framework or an in-prompt multi-agent runtime;
- numeric Quality v2.1 scoring;
- restoring the obsolete daily GitHub collector, X requirement, OSS Insight,
  RadarAI, legacy three-equal-source flow, or confirmed-recheck intake;
- R2 unless later measurements show that bounded D1 evidence records are
  insufficient.

## Repository Audit

### Current Production Baseline

| Area | Current responsibility | Stage 3A interpretation |
| --- | --- | --- |
| `wrangler.toml` | Deploys `src/index.js`, binds only `RADAR_STATE`, and configures the site/PushPlus presentation defaults. It has no D1 or Workflow binding. | Production-only baseline. Do not add the shadow schedule or engine bindings to this configuration during initial development. |
| `src/index.js` | Implements health, report pages, authenticated ingest, v2/v3 normalization, KV persistence and duplicate control, a PushPlus delivery-attempt ledger, website rendering, and an intentionally ignored cron handler. | Freeze after the pre-Stage-3A production hardening. It remains the production publication and reading service, not the hosted research engine. |
| `src/curated-report.js` | Enriches and validates schema v3 qualitative reports, reader contract v2, artifact identity, preference ordering, source context, and reader-copy boundaries. | Port its domain behavior into shared runtime-neutral modules and run the same fixtures in both environments. Do not fork the contract. |
| `src/report-structure.js` | Preserves schema v2 compatibility and the historical Quality v2.1 numeric implementation used by older reports and tests. | Keep for compatibility. Do not use its numeric scoring or historical discovery requirements as Stage 3A selection policy. |
| `src/discovery/*` | Implements the Stage 2.1 GitHub collector and local SQLite snapshots. | Historical experiment only. Reuse tested URL/artifact ideas where useful, but do not make this collector the hosted daily source strategy. |
| `tools/quality/report-quality.mjs` | Owns file-backed prepare, portfolio rotation, artifact/history/review filtering, preference binding, v3 finalization, Markdown rendering, and separate production/shadow paths. Portfolio finalization now invokes Harness v2 validation in-process before any output or lifecycle-state write. | Extract its pure rules; replace filesystem state and CLI orchestration with D1 repositories and Workflow steps. Keep the local CLI operational for production until cutover. |
| `tools/quality/validate-verification-harness-v2.mjs` | Exposes an importable Harness v2 validation core and retains its CLI wrapper. It enforces schema, risk routing, material disagreement fields, adjudication, complete removal trajectories, retained-candidate coverage, and evidence-to-draft links. | Reuse the same core contract in the hosted runtime and retain the CLI regression fixtures; do not create a divergent Workflow-only validator. |
| Other verification validators | Preserve verifier v1, adversarial, and targeted regression behavior. | Keep as regression history. Harness v2 is the hosted production target; v1 is not. |
| `prompts/skill-radar-local.md` | Tells Codex Automation how to prepare local state, browse, create subagents, repair contracts, decide quality, and write outbox files. | Treat as a validated domain specification to decompose. Do not call this prompt wholesale from a hosted model and do not use API multi-agent beta as the orchestrator. |
| Windows forwarder | Validates the Markdown/Sidecar pair, applies schema-aware item limits (v2: one to six; v3: one to twenty), hashes it into `sourceRunId`, reads the local ingest secret, and posts to `/ingest-report` with local sent/pending state. | Remains production-only during shadow. It has no role in Stage 3A generation or comparison. A future cloud publisher is a separate cutover step. |

The current Worker already has useful final-delivery idempotency through
`sourceRunId` and category/date checks, but those controls apply after ingest.
Stage 3A needs its own run, step, model-call, and artifact idempotency before
publication is ever considered.

### Audit Findings And Ownership

Not every finding belongs to Stage 3A. The owner and decision point are:

| Finding | Correct owner and treatment |
| --- | --- |
| The v3 finalizer can retain up to twenty recommended items, while the Windows forwarder formerly accepted only one to six. | **Resolved in the current production chain before Stage 3A.** Forwarder validation is now schema-aware: v3 accepts one to twenty and v2 preserves one to six. Stage 3A shadow retains every verified `recommend` under the same v3 contract; a future hosted display limit remains a separate cutover decision. |
| Harness v2 evidence-to-draft validation was a separate prompt command and production `finalize-curated` did not require the evidence artifact. | **Resolved in the current production chain before Stage 3A.** Production `portfolio-v1` finalization now loads and validates Harness v2 in-process before final report output and decision-state updates. Failures expose machine-readable repairability, stage, candidate, and action fields; local Automation may perform at most two recorded attempts, using deterministic repair first when possible and otherwise rerunning only the affected fresh-context role. A multi-agent shadow that supplies Harness evidence gets the same gate; historical portfolio shadows that predate Harness v2 remain isolated regression fixtures. Stage 3A must reuse the fail-closed ordering and error taxonomy, then replace the local recovery file with transactional D1 attempt state. |
| Production history, source rotation, review cooldowns, feedback, and verification trajectories are split across local files; Worker KV is not their complete source of truth. | **Stage 3A migration requirement.** Use an explicit validated seed/import and then maintain independent D1 shadow state. Do not treat production KV as complete and do not make the hosted runtime depend on the local computer after bootstrap. |
| The ingest path stores a report before sending PushPlus, and formerly a post-storage push failure was not repaired by a duplicate report retry. | **Resolved for the current KV publisher before Stage 3A.** Worker records delivery attempts separately and retries only an explicit failure presented with the identical `sourceRunId`; API-accepted attempts, different same-day payloads, and pre-ledger unknown reports are not re-pushed. HTTP success is insufficient unless the PushPlus body also reports `code: 200`, and that state is named `accepted` because it is not proof of terminal delivery. A future hosted publisher should still use a transactional D1 outbox because KV cannot provide exactly-once delivery. |
| The local finalizer advances Sidecar, Markdown, review state, rotation, and history through separate filesystem writes. | **Stage 3A shadow implementation requirement.** Use immutable artifacts and transactional D1 state transitions. The accepted local production flow remains unchanged during shadow. |

The hardened chain remains the accepted Stage 2 baseline. These fixes do not
move generation, scheduling, or delivery into Stage 3A and do not change the
shadow's non-publishing boundary. The hosted engine must port the corrected
contracts rather than the superseded defects.

### Authoritative Current Contracts

The following behavior must survive the runtime migration:

1. The quality Sidecar is the source of truth; Markdown is deterministic.
2. Schema v3 and `readerContractVersion: 2` remain the new-report contract.
3. Decisions are `recommend`, `defer`, or `reject`; there is no model-generated
   score.
4. Every final eligible artifact is verified before quality judgment.
5. One or more recommendations produce `published`; zero recommendations after
   complete verification produce `no_update`.
   In schema v3 this is a content outcome, not proof that an external channel
   was updated. A shadow report may retain `status: "published"` for contract
   compatibility while its separate publication state is always
   `blocked_shadow`.
6. Source, model, validation, budget, and orchestration failures are failures,
   never `no_update`.
7. Exact-artifact 30-day history, one repository per report, two repository
   appearances in the preceding seven days, and 14/90-day defer/reject
   cooldowns remain code-owned.
8. The `portfolio-v1` registry, rotating official catalogs, and bounded
   community lanes remain the starting source model. Source counts shape
   discovery effort, not recommendation quotas.
9. A stale deep link is a locator failure. Same-repository, identity-continuous
   path correction is recovery, not migration.
10. `sourceRepositoryChanged` and `identityChanged` remain separate.
11. Primary verification is fresh-context for every eligible artifact;
    specialist and adjudicator calls are risk-triggered and bounded.
12. Every removed candidate retains its complete verification trajectory.
13. The main quality editor receives reconciled evidence and does not rebrowse.
14. Preference can only reorder qualified recommendations and must remain
    linked to a real signal; missing feedback is unknown.
15. Reader-facing copy excludes internal pipeline narration and preserves the
    current progressive-disclosure fields and guarded AI handoff.
16. Missed days follow the no-backfill incident policy.
17. The Stage 3A shadow retains all verified `recommend` decisions. Candidate
    limits continue to bound research cost, but no reader-item limit is derived
    from the Windows forwarder. Channel-specific publication limits are outside
    the shadow contract.
18. Five eligible candidates is a replenishment target, not a Stage 3A validity
    minimum. Stop replenishing immediately when five are available. If three
    passes and twenty cumulative candidates are exhausted with 0-4 eligible
    candidates after complete required-source collection, verify and decide
    all remaining candidates and record `coverageStatus` as
    `exhausted_below_target`. Required-source, API, or orchestration failure is
    still a failed run and cannot use this status.

This item is an intentional Stage 3A shadow divergence from the current
production minimum. During 3A.0, parameterize the shared candidate/evidence
validators so the production adapter keeps its default minimum of five while
the hosted shadow accepts zero to twenty. Do not weaken the tracked public v3
or Harness v2 schemas merely to encode the experiment. A separate internal
`engine-shadow-result-v1` envelope carries `coverageStatus`, the complete
decision set, and a would-be content outcome when fewer than five decisions
cannot form a current public v3 Sidecar. Promotion must propose an explicit
schema migration if this policy is later adopted for publication.

## Migration Boundary

| Treatment | Components |
| --- | --- |
| Preserve semantically | Source portfolio lanes, exact artifact identity, canonicalization, history and cooldown rules, feedback policy, Harness v2, v3 Sidecar, reader contract, bilingual display fields, no-update/failure distinction, no-backfill policy |
| Reimplement as shared deterministic code | Candidate validation, source-plan rotation, URL/path normalization, filter and replenishment limits, evidence reconciliation, decision coverage, report validation, Markdown rendering, hashes, cost calculation |
| Replace operationally inside the hosted shadow | Codex Automation with explicit Responses API calls; prompt subagents with Workflow role invocations; file-backed shadow state with D1; local browsing with collectors/search; local shadow scheduling with Workflow schedules. The production Automation, files, and Windows schedule continue unchanged during comparison. |
| Keep untouched during shadow | Production Automation schedule, `prompts/skill-radar-local.md`, `reports/outbox`, Windows forwarder and task, `src/index.js`, `wrangler.toml`, production KV, public website, PushPlus |
| Do not port | Quality v2.1 score, old v2 discovery quotas, daily broad GitHub collector, legacy three-source equality, X/OSS Insight/RadarAI requirements, active recheck queue |

The implementation should first extract runtime-neutral domain modules with
fixture parity. It must not make the production CLI depend on D1 or Workflows.
Both runtimes should call the same pure validators where practical, while
storage adapters remain separate.

## Deployment Isolation

The shadow engine should be a separate Cloudflare Worker project, for example
`personal-radar-engine-shadow`, deployed from a separate Wrangler
configuration. It should have:

- one Workflow binding and a direct schedule;
- one shadow-only D1 database;
- `OPENAI_API_KEY` and a least-privilege read-only `GITHUB_TOKEN` as Cloudflare
  secrets;
- non-secret model, budget, source-policy, and contract-version configuration;
- no `RADAR_STATE` binding;
- no `PUSHPLUS_TOKEN`;
- no `DEEP_REPORT_INGEST_KEY`;
- no code path that calls `/ingest-report`;
- no public mutation endpoint.

Cloudflare recommends secrets rather than plaintext variables for API keys and
can validate required secret names during deployment. Secrets are not visible
after definition in Wrangler or the dashboard. See the
[Cloudflare Workers secrets documentation](https://developers.cloudflare.com/workers/configuration/secrets/).

The first shadow can bootstrap sanitized history, review state, and preference
signals through a one-time administrative import. Runtime success must not
depend on a local computer after bootstrap. Continuous comparison may initially
use public report pages. If internal production decisions are later required,
add a narrowly scoped authenticated read-only baseline export only after a
separate review; it is not required to start the engine shadow.

## API Decisions

### Model API

Use the OpenAI Responses API through explicit, independently observable calls.
Do not use Codex subscription sessions, desktop Automation, a hosted shell, or
the Responses multi-agent beta as the durable orchestrator. Cloudflare
Workflows owns role routing, retries, limits, state, and reconciliation.

Initial model policy:

| Work | Model | Initial reasoning | Rationale |
| --- | --- | --- | --- |
| Candidate extraction and bounded metadata repair | `gpt-5.6-luna` | low | High-volume, constrained transformation with deterministic validation |
| Primary verifier | `gpt-5.6-terra` | low | Quality/cost balance for every eligible artifact |
| Specialist verifier | `gpt-5.6-terra` | medium | Rare, higher-risk identity and repository-status review |
| Adjudicator | `gpt-5.6-sol` | medium | Rare, material field dispute where false admission is costly |
| Main quality editor and bilingual report draft | `gpt-5.6-terra` | medium | Strong synthesis while remaining below flagship cost |

OpenAI currently recommends the Responses API for reasoning and tool workflows
and positions Sol, Terra, and Luna as capability, balanced, and cost-sensitive
tiers. Current model and token prices must be read from configuration rather
than embedded in business logic. See the
[OpenAI model catalog](https://developers.openai.com/api/docs/models),
[model guidance](https://developers.openai.com/api/docs/guides/latest-model),
and [API pricing](https://developers.openai.com/api/docs/pricing).

Every role request must:

- start without `previous_response_id` or conversation state;
- set `store: false`;
- identify `prompt_template_version`, `contract_version`, model, and reasoning
  policy in D1;
- request strict JSON Schema output;
- accept at most one contract-repair attempt for malformed output;
- record provider request ID, resolved model name, tokens, latency, tool calls,
  response hash, and validation result;
- never expose secrets, unrelated candidates, preference signals to verifiers,
  or verifier identities to the adjudicator.

Strict Structured Outputs are a transport aid, not a replacement for the
existing semantic validator. The API can enforce JSON Schema shape, while
domain code must still verify URLs, identities, routing triggers, coverage,
and cross-record links. See the
[OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

Model aliases and prices change. The deployed policy belongs in a versioned
database/config record, not source constants. Shadow evaluation should pin a
dated snapshot when the provider exposes a suitable snapshot and record the
actual returned model on every invocation. Any model or reasoning-policy
change resets the paired comparison window unless it is an emergency rollback.

### Search And Source APIs

Use a two-layer collection policy:

1. **Deterministic source collectors** fetch structured registry/catalog data,
   GitHub repository metadata and exact files, official documentation, and
   canonical artifact pages directly over HTTPS. These records establish
   first-party evidence.
2. **OpenAI Responses `web_search`** performs bounded discovery and same-source
   locator recovery. It does not by itself establish official verification.

The Responses web-search tool supports allowed/blocked domain filters and a
complete `sources` list. Store that source list, then fetch the claimed
first-party page directly before a candidate becomes verified. See the
[OpenAI web search guide](https://developers.openai.com/api/docs/guides/tools-web-search).

Search policy:

- registry and official lanes use allowlisted domains from the frozen daily
  plan;
- community discovery may use its assigned directory plus canonical links;
- locator recovery is limited to the original canonical repository or its
  first-party documented successor;
- first-party verification never relies on search snippets;
- robots, rate limits, `Retry-After`, ETags, content type, maximum body size,
  redirects, and fetch timeouts are enforced by collectors;
- retrieved text is untrusted data, never instructions to the orchestrator;
- scripts, hooks, packages, and repositories are inspected as text only and
  never executed or installed;
- source bodies are reduced to bounded evidence excerpts before model input.

As of 2026-08-03, standard web search is priced per call plus search-content
tokens at the selected model rate. The price ledger must therefore track both
tool calls and tokens. See the
[OpenAI API pricing table](https://developers.openai.com/api/docs/pricing).

No separate general search vendor is required for the first shadow. Add one
only if measured source yield, coverage, or provider-correlation risk justifies
the extra contract and secret boundary.

## Workflow Architecture

Cloudflare Workflows is the durable orchestrator. A completed `step.do` result
is persisted so later recovery resumes from the last successful step, and
steps have configurable retry and timeout policies. See the
[Workflows getting-started guide](https://developers.cloudflare.com/workflows/get-started/guide/)
and [retry documentation](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/).

Use a direct Workflow schedule at `23:30 UTC`, which corresponds to 07:30 in
Beijing. Cloudflare cron expressions execute in UTC. See the
[Cron Triggers documentation](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
and [Workflow schedule documentation](https://developers.cloudflare.com/workflows/build/trigger-workflows/).

One logical daily run uses these phases:

```text
1. claim logical run and freeze configuration
2. create/reuse the authoritative source plan
3. collect registry, official, and community lanes
4. normalize an initial 8-12 candidate pool
5. apply code-owned history/review/repository filtering
6. replenish until five are eligible or 3 passes / 20 cumulative candidates
   are exhausted; record `target_met` or `exhausted_below_target`
7. fetch bounded first-party evidence bundles
8. invoke one fresh primary verifier per eligible candidate
9. route risk cases to fresh specialist calls
10. build exact material-field disputes in code
11. invoke one fresh adjudicator per disputed candidate
12. reconcile, remove, correct identity, re-filter, and replace as required
13. invoke the quality editor on reconciled retained evidence only
14. validate evidence links, the internal shadow envelope, v3-compatible
    fields, semantics, public copy, and UTF-8
15. render the complete shadow artifact and Markdown; emit a current v3
    Sidecar only when its existing minimums are satisfied
16. record cost, metrics, incidents, and comparison-ready status
17. compare with the production baseline when it becomes available
```

Each external system call belongs in its own granular Workflow step. Cloudflare
recommends granular, idempotent steps because a step may be retried. See
[Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/).

Workflow instance state is a recovery aid, not the system of record. D1 stores
the durable cross-run truth. Step outputs should contain IDs and bounded
records, not complete page bodies. Cloudflare currently limits a non-stream
step result to 1 MiB and retains completed Workflow state for a limited period;
see [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/).

## D1 Data Model

D1 is the operational source of truth for the hosted engine. KV remains the
production report store during shadow and is not bound to the shadow Worker.

The minimum schema is:

| Table | Purpose and required uniqueness |
| --- | --- |
| `engine_runs` | One logical run per `(channel, report_date, mode, contract_version)`. Stores frozen config/model/source-policy hashes, run status, content outcome, `coverage_status` (`target_met`, `exhausted_below_target`, or `source_incomplete`), separate `publication_state` (`blocked_shadow` in the first release), timestamps, budget, totals, and failure class. |
| `workflow_attempts` | Maps unique Workflow instance IDs to a logical run and attempt number. Stores lease/heartbeat and terminal status. |
| `source_plans` | Authoritative same-date plan, registry focus, assigned official/community sources, and plan hash. Unique by run. |
| `source_rotation_entries` | Completed plan history. Advances only after a valid shadow report or valid `no_update`, never after a failed run. |
| `source_fetches` | Normalized URL, purpose, request headers policy, status, redirect target, ETag/last-modified, fetch time, content hash, bounded excerpt, provenance class, and error. |
| `artifacts` | Canonical repository URL, artifact path/key, type, container, provenance, first/last seen, and identity lineage. Unique by canonical artifact key. |
| `run_candidates` | Candidate snapshot, lane/source metadata, filter pass, eligibility, exclusion reason, material-change evidence, and final disposition. Unique by `(run_id, candidate_id)`. |
| `verification_cases` | Original identity, current identity, routing flags, disagreement fields, disposition, removal reason, and follow-up state. |
| `verification_outputs` | One immutable structured output per `(case_id, role, attempt_no)`, including prompt version, model policy, response hash, evidence JSON, and semantic-validation result. |
| `quality_decisions` | One decision per final eligible candidate, reason, preference evidence, editor response link, and deterministic validation result. |
| `report_artifacts` | Internal `engine-shadow-result-v1`, optional current-v3 Sidecar, Markdown, content hashes, schema/reader versions, coverage/content status, explicit non-publication state, and validation timestamps. Stores the complete recommendation set without a forwarder-derived item cap. Unique by run and format. |
| `artifact_history` | Recommendation dates and current 30-day identity history, including imported production seed origin. |
| `review_state` | Latest defer/reject outcome and review-after date per artifact. |
| `preference_signals` | Single-user sanitized interested/not-interested signals and import provenance. Missing rows mean unknown. |
| `model_invocations` | Request hash, role, candidate/case, provider ID, model, tokens, search calls, latency, attempt state, estimated cost, and ambiguous-delivery flag. |
| `production_baselines` | Date/status/selected items and source hash captured from the current production surface or approved import. |
| `shadow_comparisons` | Paired metrics, item-level review findings, contract differences, and reviewer conclusion. |
| `incidents` | Failure class, scope, retryability, affected step/candidate, first/last occurrence, resolution, and no-backfill decision. |

Store prompts as versioned repository templates and record template hashes in
D1. Store bounded evidence JSON and excerpts in D1; do not store full arbitrary
web pages. A D1 row is currently limited to 2 MB, so validators should enforce
much smaller application limits. D1 batches are transactional and roll back the
sequence if a statement fails, which is suitable for atomic run-state
transitions. See the [D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Required indexes include run/date/status, artifact key, repository/date,
review-after date, candidate/run/disposition, case/run, invocation/run/role,
and incident/status. Avoid unindexed daily scans because D1 pricing counts rows
read and written. See [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Run And Outcome States

Recommended run states:

```text
scheduled -> claimed -> collecting -> filtering -> verifying
-> editing -> validating -> shadow_ready -> comparing -> compared
```

Terminal alternatives:

```text
valid_no_update
failed_retry_exhausted
failed_contract
failed_source_system
failed_model_provider
failed_budget
cancelled_operator
```

Only `shadow_ready`, `compared`, and `valid_no_update` are successful content
outcomes. A comparison delay does not invalidate an already valid shadow
artifact; it leaves the run `shadow_ready` with a pending comparison. A missed
or failed date is recorded as an incident and is not automatically backfilled.
Candidate shortage after complete bounded collection is represented by
`coverageStatus: exhausted_below_target` on a successful content outcome, not
by a failed run state.

## Idempotency

Idempotency is enforced at several layers:

1. **Logical run:** a D1 unique constraint permits one shadow run record per
   channel/date/contract. Duplicate schedules attach a new attempt only when
   recovery policy allows it; otherwise they exit without work.
2. **Workflow attempt:** every Cloudflare instance ID is unique and maps to one
   logical run. A short D1 lease prevents concurrent attempts from advancing
   the same run.
3. **Plan:** the same date reuses the same source-plan hash. Rotation advances
   only after a valid completed outcome.
4. **Fetch:** normalized URL, purpose, content hash, and freshness policy avoid
   duplicate collection while preserving changed content.
5. **Model request:** role, candidate/case, prompt version, model policy,
   evidence hash, and attempt number form a deterministic request hash. A
   completed valid output is never called again.
6. **State application:** accepted model outputs and final report artifacts are
   immutable inserts followed by transactional state transitions, not mutable
   partial overwrites.
7. **Comparison:** `(shadow_run_id, production_baseline_hash,
   comparison_version)` is unique.
8. **Future publish:** publication requires a separate idempotency key derived
   from validated report content and an explicit publish-enabled deployment.
   It does not exist in the first shadow.

An ambiguous model-network timeout can mean the provider processed a request
without returning a usable response. System state remains exactly-once, but
provider billing cannot be assumed exactly-once without a documented provider
idempotency guarantee. Record `ambiguous_delivery`, stop automatic retries for
that invocation by default, and allow one budgeted operator-approved retry or
run-level recovery. Never silently spend through repeated ambiguous calls.

## Retry And Failure Recovery

| Failure | Recovery | Final meaning |
| --- | --- | --- |
| Network timeout before a request is sent, 429, or retryable 5xx | Bounded exponential backoff with jitter; honor `Retry-After`; maximum attempts configured per connector | Failure if required evidence remains unavailable |
| Authentication, schema/config error, blocked domain, unsupported content, or hard budget limit | Non-retryable Workflow error after incident write | Failed run |
| One malformed model output | One repair using the same role and only validation errors | Failed candidate/run if still invalid; never parent-filled evidence |
| Candidate locator failure | Same-repository bounded recovery, correction, re-filter, or same-lane replacement | Candidate removal unless resolved |
| Candidate invalid/ambiguous | Preserve complete trajectory, remove, and replace only while pool/pass budget remains | Continue with all remaining candidates; mark `exhausted_below_target` if the target can no longer be reached |
| Material verifier disagreement | One field-scoped fresh adjudication | Remove with follow-up if unresolved |
| Broad source or model outage | Stop after connector/provider retry budget | Failed run, not `no_update` |
| Fewer than five verified candidates after complete bounded discovery | Verify and decide all remaining candidates; do not invent replacements or lower filters | Valid `exhausted_below_target`; content outcome follows actual decisions |
| Fewer than five because a required source lane did not complete | Preserve incident and stop | Failed run with `coverageStatus: source_incomplete`, never `no_update` |
| Editor returns zero recommends after all verified decisions | Validate complete coverage | `valid_no_update` |
| Workflow interruption | Resume from persisted successful step and D1 state | No repeated accepted work |
| Production baseline not yet available | Delay/retry comparison only | Shadow content remains valid; comparison pending |
| Missed schedule | Record incident; next date uses normal plan rules | No automatic backfill |

The initial retry defaults should be lower than Cloudflare's maximums: three
connector attempts, one contract repair, one specialist, and one adjudication
per dispute. Provider 429 backoff may sleep beyond the initial run window, but
the cost and date policy still determine whether the run should continue.

## Cost Controls

### Initial Budget

Start with these per-logical-run caps:

- 8-12 initial candidates and 20 cumulative distinct candidates only when
  bounded replenishment is needed;
- three candidate filter passes;
- 30 web-search tool calls;
- one primary verifier plus at most one contract repair per eligible artifact;
- one specialist plus at most one repair per risk-triggered artifact;
- one adjudicator plus at most one repair per disputed artifact;
- one editor plus at most one repair;
- USD 3 soft alert and USD 5 hard stop;
- no automatic retry after ambiguous provider delivery.

Using a typical ten-candidate day, 10-15 search calls, mostly primary Terra
verification, rare specialist/adjudicator routing, and one Terra editor call,
the planning estimate is roughly USD 0.50-1.00 per day at the 2026-08-03 price
table. This is a budget hypothesis, not an acceptance fact. The shadow must
record actual input, cached input, output, tool calls, reasoning policy, and
estimated cost per invocation before changing the thresholds.

Cost allocation order is:

1. required primary verification;
2. contractually triggered specialist/adjudication;
3. complete quality editing;
4. replenishment search;
5. optional discovery breadth.

Never skip required verification or disagreement handling to stay under
budget. Stop with `failed_budget` instead.

Cloudflare Workflows currently bills Workers requests/CPU plus Workflow steps
and stored state, with step/storage billing scheduled to begin on 2026-08-10.
D1 scales to zero and bills rows read/written and storage. At one daily
single-user run, model/search cost should dominate, but both Cloudflare meters
must still be included in the monthly review. See
[Workflow pricing](https://developers.cloudflare.com/workflows/reference/pricing/)
and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

### Cost Acceptance

During the paired shadow window:

- p50 model/search cost should be at or below USD 1.00 per valid run;
- p95 should be at or below USD 3.00;
- no run may cross the USD 5.00 hard cap;
- duplicate or unnecessary specialist/adjudicator calls must be zero;
- contract-repair and ambiguous-delivery rates must be reported, not hidden in
  aggregate spend.

These targets may be revised only with an explicit documented tradeoff and a
new comparison window.

## Security And Trust Controls

### Secret And Privilege Boundaries

- Use a dedicated OpenAI project/API key with provider-side spend and rate
  limits.
- Use a fine-grained read-only GitHub token limited to public metadata/content
  needs where possible.
- Store keys only as Cloudflare secrets and declare required secret names.
- Never copy the production ingest key or PushPlus token into the shadow
  project.
- Do not bind production KV to the shadow Worker.
- Keep D1 shadow data private; expose status through Cloudflare-authenticated
  operator access only if an endpoint is later needed.
- Rotate a key immediately after suspected exposure and record the incident
  without storing the key value.

### Untrusted Content

- Treat fetched pages, README files, `SKILL.md`, rules, model outputs, and
  search snippets as untrusted data.
- Delimit evidence and instruct models never to follow embedded commands.
- Do not execute install commands, scripts, hooks, package managers, browser
  actions, or repository code.
- Allowlist protocols and source domains by lane; block localhost, private IP,
  link-local, and metadata endpoints after every redirect to prevent SSRF.
- Cap redirect count, body bytes, decompressed bytes, parse depth, excerpt
  length, and model input tokens.
- Escape public text and preserve the existing raw-HTML rejection.
- Store evidence hashes and exact source URLs so every accepted claim is
  traceable.

### Provider Data

Set `store: false` and avoid sending local secrets, private feedback notes, or
unnecessary full pages. OpenAI states that API data is not used for training,
but default abuse-monitoring and Responses retention can be up to 30 days;
Zero Data Retention requires approval and changes endpoint behavior. See the
[OpenAI data controls guide](https://developers.openai.com/api/docs/guides/your-data).

The initial single-user content is public-source research, but preference notes
and any future private sources should be minimized and separated before model
use. Web-search queries also leave the application boundary and must not
contain secrets.

## Shadow Comparison

### Comparison Units

Compare the hosted shadow and current production at four levels:

1. **Run:** scheduled time, duration, final status, failure class, candidate
   count, verified count, role calls, retries, and cost.
2. **Artifact identity:** canonical repository, artifact path/key, locator
   recovery, repository migration, identity change, and current-source proof.
3. **Decision:** recommend/defer/reject, reason, trust boundary, and whether
   unresolved evidence was correctly excluded.
4. **Reader artifact:** schema/reader versions, selected items, bilingual field
   completeness, internal-language leakage, UTF-8, and deterministic rendering.

Production and shadow may discover different valid artifacts. Exact item
overlap and Jaccard similarity are diagnostics, not standalone pass/fail gates.
The important question is whether each engine obeys the same contracts and
whether a human reviewer agrees with the shadow's admitted identities and
recommendation judgments.

Production and Stage 3A shadow now share the same v3 content-count contract:
retain every verified `recommend` decision up to the schema maximum of twenty.
Count differences are comparison diagnostics, not a reason to truncate either
set. The historical schema v2 one-to-six compatibility rule has no role in
Stage 3A parity.

### Baseline Capture

The first implementation may use:

- a one-time sanitized import of recent production Sidecars, review state, and
  preference signals for bootstrap;
- the public production report/archive pages for automatic final-item and
  status comparison;
- a manual approved Sidecar import for deeper paired decision review.

Do not make shadow generation wait for the local forwarder. Comparison can
remain pending until the production result appears. If automated access to
internal production decisions becomes necessary, design a separate
authenticated read-only export and review its production impact before
implementation.

### Required Metrics

- scheduled-run completion and p95 duration;
- source access and exact-artifact yield by lane;
- filter/replenishment counts and candidate shortage;
- primary coverage, specialist trigger precision, adjudicator trigger and
  resolution, unresolved and false-negative rates;
- correct source-identity and false-positive rates;
- contract repair, retry, ambiguous delivery, and provider failure rates;
- recommendation/defer/reject distribution;
- valid `no_update` versus system failure;
- item overlap, unique useful discoveries, and human decision agreement;
- schema, reader-copy, UTF-8, and evidence-link defects;
- model/search/Cloudflare cost and latency by step.

## Acceptance Plan

### Gate A: Contract And Recovery

Before scheduled cloud shadow runs:

- all existing repository tests pass unchanged;
- runtime-neutral v3 and Harness v2 modules produce byte-equivalent or
  semantically equivalent results on existing fixtures;
- fixed current, recovered, migrated, identity-change, invalid, missing,
  ambiguous, resolved-dispute, unresolved-dispute, and complete-removal cases
  pass;
- duplicate schedule, Workflow restart, retryable provider failure, malformed
  output repair, budget stop, valid below-target exhaustion, required-source
  shortage, and missed-baseline tests pass;
- no test can create a production KV write, ingest request, or PushPlus call.

### Gate B: Isolated Cloud Runs

Run at least three manual cloud shadows with different source plans:

- one normal no-risk run;
- one fixture or controlled run that exercises specialist and adjudicator
  routing;
- one interruption/restart run proving completed steps and accepted model
  outputs are not repeated.

Every run must produce a complete auditable D1 trajectory and a valid internal
shadow artifact/Markdown pair, or an explicit failed-run record. A current-v3
Sidecar is additionally required when the existing v3 minimums are satisfied.
No failure may become `no_update`; a completely collected
`exhausted_below_target` run is not a failure.

### Gate C: Scheduled Paired Shadow

Observe at least 14 consecutive scheduled opportunities and obtain at least 10
paired valid production/shadow dates. Reset the paired window after a material
model, prompt, contract, source-policy, or orchestration change.

Promotion criteria:

- 100% of final eligible shadow candidates have valid primary evidence;
- 100% of risk triggers receive required specialist/adjudicator handling;
- zero unresolved identities enter quality judgment;
- zero confirmed source-identity false positives;
- zero public-copy, raw-HTML, UTF-8, decision-coverage, or evidence-link
  defects;
- zero forwarder-derived truncation of valid shadow `recommend` decisions;
- zero production writes or PushPlus sends from the shadow project;
- every failed run is correctly classified and no failure is labeled
  `no_update`;
- at least 10 paired runs finish without manual intervention after schedule;
- p95 valid-run completion is within 60 minutes;
- cost meets the p50/p95/hard-cap targets;
- human review finds the shadow recommendation set at least as defensible as
  production on identity, practical value, and trust boundaries, with every
  material difference recorded.

Source yield, exact item overlap, recommendation count, and unresolved rate are
reported and investigated but do not receive arbitrary parity thresholds that
would reward copying production mistakes or lowering quality.

### Gate D: Cutover Review

Passing Gate C produces a cutover proposal containing:

- full comparison report and unresolved incidents;
- measured daily/monthly cost;
- model and source policy versions;
- security review and secret inventory;
- rollback and observability runbook;
- final history/review/preference migration procedure;
- a one-day publication canary plan;
- the exact Automation/forwarder schedule changes proposed.

Cutover requires explicit user approval. Only then may a publish-capable cloud
adapter be designed and tested. The existing Automation and forwarder are not
disabled, edited, or rescheduled as a consequence of shadow acceptance alone.

## Rollout Sequence

### 3A.0: Documentation And Contract Extraction

Implementation checkpoint (2026-08-04): the internal
`engine-shadow-result-v1` contract, parameterized Harness v2 minimum, initial
D1 migration, D1 run repository, and fail-closed Workflow bootstrap are now
implemented on `codex/stage-3a-shadow`. `wrangler.stage3a.jsonc` is an isolated
dry-run configuration with a placeholder D1 ID, no routes, no schedule,
`STAGE3A_EXECUTION_ENABLED=false`, and `PUBLICATION_ENABLED=false`. No cloud
resource has been created and the production `wrangler.toml` remains unchanged.
The hosted source-plan module now reproduces the validated `portfolio-v1`
rotation without changing the production CLI, persists one immutable plan hash
per logical run, advances the explicit run state to `collecting`, and separates
the global 8-12/20/three-pass candidate budget from per-source candidate
signals. The first HTTP connector is now implemented but remains untriggered. It records
fresh success, origin-validated `304` cache success, retryable failure, terminal
failure, and `degraded_cached` fallback separately. All six assigned sources
remain attempt targets; `complete` means 1/3/2 success, `degraded` means the
1/2/1 quorum was met with partial failure, and `source_incomplete` means the
quorum was missed. Stale cache never counts as a fresh source success.

- Approve this plan.
- Extract pure v3, identity, history, source-plan, and Harness v2 modules.
- Add an internal `engine-shadow-result-v1` envelope and parameterized
  candidate/evidence minimums; keep production defaults and public schemas
  unchanged.
- Keep all production commands and behavior intact.
- Add D1 migrations and cloud-only fixtures.

### 3A.1: Isolated Cloud Shadow

- Deploy a separate shadow Worker/Workflow/D1 project.
- Configure only shadow secrets and the 23:30 UTC schedule after manual runs
  pass.
- Bootstrap sanitized state once.
- Store shadow results in D1 only.

### 3A.2: Paired Observation

- Continue the current production Automation and forwarder unchanged.
- Capture production baselines after normal delivery.
- Run the 14-opportunity/10-pair acceptance window.
- Tune models, prompts, collectors, budgets, and retry policies only through
  versioned changes that reset the relevant comparison window.

### 3A.3: Explicit Promotion Decision

- Produce the Gate D cutover proposal.
- If rejected, keep the shadow or stop only its own schedule.
- If approved, build a cloud publisher with separate credentials,
  idempotency, canary, and rollback; then explicitly transition production.

## Implementation Deliverables After Approval

1. Separate shadow Wrangler configuration and Workflow entrypoint.
2. D1 migrations, repositories, indexes, and seed/import command.
3. Runtime-neutral domain modules with parity tests.
4. Source collector interfaces and the initial portfolio connectors.
5. OpenAI Responses client with strict outputs, role isolation, usage ledger,
   and bounded repairs.
6. Harness v2 orchestration and reconciliation.
7. Shadow report generator and deterministic renderer.
8. Incident, cost, and comparison queries/report.
9. Manual-run, recovery, and scheduled-shadow runbooks.
10. Security checklist and cutover checklist.

None of these deliverables authorizes changes to the current production
schedule or delivery path before the plan is approved and the applicable
rollout phase begins.
