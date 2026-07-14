# Personal Radar Stage 2: Content Quality And Reading Experience

Last updated: 2026-07-14

## Status

Stage 2 implementation is in progress.

On 2026-07-14, two consecutive Automation shadow tests showed that bounded
curated-source discovery and qualitative primary-source review were more stable
than the Quality v2.1 seven-dimension evidence workflow. Stage 2 is therefore
moving toward a simplified version 3 contract. A real Automation-generated v3
Sidecar and Markdown pair passed shadow validation on 2026-07-14. Worker v3
compatibility was deployed and the production prompt was switched the same
day. The first scheduled v3 production report is pending.

The v3 direction is:

- Awesome Claude Skills, Agent Plugins, and OpenAgentSkill provide an initial
  8-12 item discovery pool; when history filtering leaves fewer than five
  eligible artifacts, Automation may replenish the pool up to 20 candidates
  over at most three filter passes;
- code owns URL normalization, exact-artifact identity, 30-day history, and
  repository-frequency rules;
- Automation verifies every code-eligible primary source and records
  `recommend`, `defer`, or `reject` with explicit reasons;
- code stores `defer` for a 14-day cooldown and `reject` for a 90-day cooldown,
  preventing repeated review without permanently blocking material changes;
- no numeric model scoring, discovery-lane quotas, OSS Insight, RadarAI, or X
  requirement blocks the daily report;
- the existing outbox, forwarder, Worker, website, and PushPlus delivery chain
  remains unchanged.

History was migrated from version 1 repository records to version 2
exact-artifact records on 2026-07-14. The 122-entry v1 file is retained only as
`reports/state/skill-radar-history-v1-archive.json` for local audit. It is not
read by Automation or used for duplicate decisions. Active history was rebuilt
from structured Sidecars and contained 31 exact recommendation records at the
migration point.

The local quality layer, structured report contract, forwarder validation, KV
v2 compatibility, structured website rendering, and HTML PushPlus renderer are
implemented. Worker v2 is deployed, three shadow runs passed, and the
real-device HTML PushPlus comparison was accepted on 2026-07-09. Evidence-driven
quality schema v2 was deployed on 2026-07-11. The first production result
exposed evidence-binding and candidate-coverage weaknesses, so the comparable
14-day quality observation is paused until Quality v2.1 passes shadow replay.

This document is the single living record for the Stage 2 plan, rollout,
checkpoints, and final acceptance.

Quality v2.1 calibration started on 2026-07-12 after a three-star repository
received a score of 75 despite having only four evidence references. The item
may still be useful, but the score was not sufficiently supported. The
calibration therefore changes the scoring contract rather than adding a
popularity quota:

- every scored state or raw metric must be bound to an exact evidence field;
- low-community candidates need independent adoption, credible organization
  backing, or item-level adoption evidence to be publishable;
- multi-skill repositories use artifact-level identity for the 30-day history;
- only one artifact from a repository may appear per daily report, and a
  repository may appear at most twice in the preceding seven days without a
  material change;
- daily discovery must review at least 15 candidates and cover high-validation,
  recent-growth, and emerging lanes with at least four candidates each;
- OSS Insight and RadarAI searches are required discovery attempts, while
  GitHub and official files remain the source of verified facts.

The goal is not a predetermined mix of popular and obscure projects. It is a
defensible set of high-quality recommendations whose scores can be traced to
observable evidence.

Latest local verification completed on 2026-07-12:

- 31 Node tests passed, including deterministic GitHub discovery, SQLite
  snapshots, repository-diverse artifact export, field-level evidence binding, artifact-level
  identity, same-report repository diversity, seven-day repository frequency,
  raised star bands,
  repository-scope caps, missing-data handling, schema and semantic validation,
  same-day
  regeneration, `published` and `no_update`, 30-day repeat handling, v1/v2
  Worker compatibility, HTML escaping, and concise PushPlus rendering.
- The Windows forwarder validated a generated Markdown and Sidecar pair without
  reading a secret or sending a report.
- Wrangler completed a local Worker bundle dry run.
- Runtime reports, Sidecars, history, feedback, social candidates, summaries,
  and secrets were confirmed to remain outside Git.
- The 2026-07-12 `autospec` production Sidecar replayed from 75 to 8 points. It
  now fails publication because its positive claims lack exact evidence
  bindings, only 10 candidates were reviewed, discovery lanes and required
  external-source attempts were missing, its artifact path was absent, and its
  low community score had no qualifying external adoption evidence.
- Automated screenshot verification is still pending because the in-app browser
  blocked the local preview address. It must be completed before production
  rollout, together with the real-device PushPlus comparison.

## Goal

Upgrade `skill-radar` from a stable daily report into a recommendation system
that:

- remembers the previous 30 days;
- applies a consistent quality bar;
- learns from local user feedback;
- uses X as a bounded auxiliary discovery source;
- produces channel-specific reading experiences;
- distinguishes useful no-update days from system failures.

Stage 2 remains single-user, local-first, and limited to `skill-radar`.

## Baseline

Before Stage 2:

- 14 local reports existed from 2026-06-22 through 2026-07-06.
- Those reports contained 98 recommendations.
- The local history bootstrap found 91 unique GitHub repositories and no exact
  repository repeat across different report dates.
- Reports were written directly as bilingual Markdown.
- Daily reports normally contained six to eight items.
- The website and PushPlus reused nearly the same dense report structure.
- No structured Sidecar, scoring history, feedback file, or source-yield
  metrics existed.

The baseline shows that exact URL repetition was not the only quality problem.
Stage 2 also targets semantic overlap, inconsistent evaluation, content density,
and the lack of preference evidence.

## Production Data Flow

The production task now follows the curated-source v3 flow below. Quality v2.1
and the deterministic GitHub collector remain documented as completed
experiments but are no longer part of the daily production path.

```text
Three curated skill directories
  -> Codex Automation builds an initial 8-12 candidate pool
  -> code filters exact-artifact history and repository frequency
  -> bounded replenishment when fewer than five remain eligible
  -> Automation verifies every eligible primary source
  -> recommend, defer, or reject decisions
  -> deterministic v3 validation and rendering
  -> Markdown + quality Sidecar
  -> Windows forwarder validates the pair
  -> Worker /ingest-report
  -> KV v2 + website + PushPlus
```

Formal artifacts:

```text
reports/outbox/skill-radar-YYYY-MM-DD.quality.json
reports/outbox/skill-radar-YYYY-MM-DD.md
```

The Sidecar is the source of truth. Markdown is generated deterministically for
local review, portability, and legacy fallback.

## Stage 2.1 Discovery Infrastructure

Prompt-only web research proved insufficient for repeatable repository metrics
and broad candidate coverage. Stage 2.1 separates deterministic data collection
from semantic judgment:

- a local Node collector queries the read-only GitHub API before Automation;
- SQLite stores repositories, concrete skill/rule artifacts, discovery runs,
  and daily metric snapshots;
- the export limits each repository to five candidate artifacts so large skill
  collections cannot occupy the full context;
- the first snapshot records current facts; later snapshots calculate actual
  30-day star growth instead of asking the model to estimate it;
- Automation uses the evidence pack for discovery and numeric facts, then opens
  primary files to judge value, portability, implementation, and risk;
- GitHub authentication is optional, but a read-only token increases the API
  allowance and collection breadth.

This is intentionally not a general-purpose scraper. Site-specific connectors
and additional sources can be added after the GitHub collector is stable.

## Quality Contract

Every selected item must be:

- a real reusable skill, rule, or instruction pack;
- linked to a reachable HTTPS primary source;
- accompanied by native-platform usability, cross-platform portability,
  current-user adaptation, and security analysis;
- absent from the previous 30 days unless a material change is evidenced;
- scored at least 70 before preference adjustment.

The quality tool calculates an evidence-driven 100-point score. The model
collects bounded evidence states and raw metrics; it does not assign scores.

| Dimension | Maximum |
| --- | ---: |
| Practical value and problem clarity | 20 |
| Native usability and cross-platform portability | 20 |
| Implementation and content quality | 15 |
| Maintenance health | 10 |
| Community and external validation | 15 |
| Trust, safety, and license | 10 |
| Differentiation and information gain | 10 |

Objective quality is platform-neutral. A project is judged first in the AI
products it declares and supports. Codex, Claude Code, Cursor, Cline, Roo Code,
Hermes, GitHub Copilot, Gemini CLI, generic agents, and future platforms are
treated symmetrically. Compatibility with the current user's preferred agent
belongs to personalization and action guidance, not the objective quality gate.

Community validation uses repository shape, participation, adoption, growth,
and raised star bands: fewer than 50, 50-199, 200-999, 1,000-4,999,
5,000-9,999, and 10,000 or more. Curated-list stars never transfer to listed
projects. General collections and mixed toolkits receive capped repository-star
credit unless the recommended sub-skill has item-level adoption or attention
evidence.

Every positive scored state and every numeric or boolean repository metric must
be named by an exact `evidenceRef.field` or `evidenceRef.fields` entry. A value
without that binding is scored as unknown even if the draft labels it `met`.
Repository ownership is not external adoption: an example inside the same
repository cannot satisfy an independent usage claim.

History identity is artifact-level for repositories that contain multiple
skills. For example, `skills/pdf` and `skills/docx` are distinct reviewable
artifacts, while the canonical repository URL is retained for frequency
control. This permits discovery inside established collections without letting
one repository dominate consecutive reports.

GitHub and official files provide primary facts. OSS Insight may provide trend
history; OpenSSF and deps.dev may provide applicable security evidence. RadarAI,
X, and curated lists remain discovery sources. Missing data is recorded as
`unknown` or `null`, never guessed and never silently treated as failure.

Interest feedback changes ordering by at most five points. It cannot promote a
candidate that fails the base quality threshold or a hard safety gate.

## Daily Outcome Rules

- One to six qualified items produce a normal `published` report.
- More than six qualified items are ranked and capped at six.
- Zero qualified items produce a valid `no_update` outcome.
- `no_update` sends a short explanation and appears in the website archive.
- Network, research, validation, or scheduling failure produces no report and
  must not be represented as `no_update`.
- Late or missed reports follow the existing no-backfill incident policy.

## History, Interest Feedback, And Social Inbox

Local-only state:

```text
reports/state/skill-radar-history.json
reports/state/skill-radar-context.json
reports/feedback/skill-radar.json
reports/inbox/social-candidates.json
reports/quality/skill-radar-summary.md
```

Stage 2 feedback is intentionally coarse. It supports only two explicit
interest signals:

- `interested`: this item is worth remembering or seeing more of.
- `not_interested`: this item is not a good fit and similar items should be
  ranked lower.

The user can give feedback in natural language, such as "I am interested in
skill-sniffer" or "SkillForge is not interesting to me." Codex can translate
that into the local feedback file without requiring manual JSON edits.

Heavier outcomes such as opened, installed, adapted, or proven useful are not
daily Stage 2 feedback fields. Opening details and source links should become
automatic website events in a later product stage. Installation, adaptation,
and long-term usefulness are optional later evidence, not a daily validation
burden.

X is an auxiliary discovery source. The product rule is: dual-lane discovery,
single quality ranking. GitHub and official documentation remain the primary
verification lane. X only helps discover candidates that might otherwise be
missed; it never serves as quality proof.

- daily Automation should run at least one bounded X auxiliary search when
  network access allows it;
- public X results only enter the candidate pool when they link to a GitHub
  repository or official HTTPS source;
- GitHub/official candidates and X-discovered candidates are merged into one
  pool and ranked by the same hard gates, scoring rubric, 30-day history, and
  feedback adjustment;
- X engagement is not quality evidence and does not add ranking weight;
- X items are not forced into the final report when GitHub/official search
  already provides stronger candidates;
- user-submitted or Chrome-assisted posts enter the social inbox;
- only projects with a verifiable official source can be selected;
- no page scraper, logged-in Automation dependency, or X API is included.

The Sidecar or local quality summary should record lightweight source-yield
metrics for the X lane, even when no X-discovered item is selected:

- whether X was searched;
- number of X-discovered candidates with official links;
- number verified, selected, rejected, or deferred;
- later interest in selected X-discovered items when feedback exists.

Xiaohongshu is outside the Stage 2 automated source set.

## Storage And Compatibility

Cloudflare KV remains the Stage 2 production store.

New reports use:

```text
version: 2
meta
content
structured
```

Existing KV keys and public URLs remain unchanged. Historical version 1 reports
continue to render from Markdown.

Stable source IDs and schema versions keep future D1 migration possible. Stage 2
does not create D1 or R2 resources.

## Reading Experience

### PushPlus

- HTML cards contain no generated images.
- All selected items appear in concise form.
- Each card shows the action, core value, best-fit audience, and main caution.
- The full report link points to the dated public website page.
- `PUSHPLUS_TEMPLATE=html` is the production default as of 2026-07-09.
- HTML messages use a fixed light reading shell and summary card so mobile dark
  backgrounds do not hide the introductory text.

### Website

Structured reports show:

1. report theme and screening statistics;
2. scannable summaries for every recommendation;
3. expandable evidence, usability, adaptation, and security details.

Old Markdown reports, archive browsing, direct links, and Chinese/English
switching remain supported.

## Local Commands

Prepare history and feedback context:

```powershell
npm run quality:prepare
```

Filter a curated candidate pool with code-owned artifact history:

```powershell
node tools/quality/report-quality.mjs filter-candidates `
  --input reports/state/skill-radar-curated-candidates.json
```

Finalize a simplified curated-source draft:

```powershell
node tools/quality/report-quality.mjs finalize-curated `
  --input reports/state/skill-radar-curated-draft.json `
  --candidates reports/state/skill-radar-candidates-filtered.json
```

Finalize an Automation draft:

```powershell
node tools/quality/report-quality.mjs finalize `
  --input reports/state/skill-radar-draft.json
```

Record feedback:

```powershell
node tools/quality/report-quality.mjs feedback `
  --url "https://github.com/example/project" `
  --rating interested `
  --category "browser automation" `
  --note "I want to track more security-scanning skill packs."
```

Add an X candidate:

```powershell
node tools/quality/report-quality.mjs social-add `
  --url "https://x.com/example/status/123"
```

Validate a report pair without sending:

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1 `
  -ReportPath "reports\outbox\skill-radar-YYYY-MM-DD.md" `
  -ValidateOnly
```

Run an isolated shadow generation:

```powershell
node tools/quality/report-quality.mjs prepare --date YYYY-MM-DD --shadow
node tools/quality/report-quality.mjs finalize --shadow `
  --input reports/shadow/state/skill-radar-draft.json
```

Shadow artifacts stay under `reports/shadow/`. The production forwarder does
not scan this directory, so a manual shadow run cannot replace or delay a
scheduled report.

Generate the local quality summary:

```powershell
npm run quality:summary
```

## Rollout

| Milestone | Status |
| --- | --- |
| Product strategy and Stage 2 record | Implemented locally |
| Schema, scoring, history, feedback, inbox, and Markdown renderer | Implemented locally |
| Stage 2.1 GitHub collector, SQLite snapshots, and candidate export | Implemented; authenticated Task Scheduler run succeeded on 2026-07-12 with 22 public repositories and 7,783 artifacts |
| Stage 2 Automation prompt | Implemented locally |
| Sidecar-aware forwarder | Implemented locally |
| Worker KV v2 and structured website | Implemented locally |
| HTML and concise Markdown PushPlus renderers | Implemented locally |
| Automated tests and Worker bundle dry run | Passed |
| Desktop and 390px visual verification | Pending local preview access |
| Three successful shadow reports | 3 of 3 passed |
| Worker production deployment | Full eligible-candidate lifecycle and user-focused v3 cards deployed 2026-07-14 as Worker version `4acc0df2-7eca-4c09-95d7-4ae0fadfa714`; `/health` and `/` returned 200 |
| Real-device HTML comparison | Accepted 2026-07-09 |
| Quality v2.1 calibration | Accepted after `no_update` and evidence-backed `published` shadow runs on 2026-07-12 |
| Curated-source v3 simplification | Initial Automation shadow passed with 11 candidates, 5 verified decisions, and 3 recommendations; contract then expanded to verify every eligible candidate, persist 14/90-day review outcomes, and replace visible action labels with direct usage guidance before the first scheduled production run |
| 14-day observation | Restarts on the first successful scheduled v3 production day |
| 30-day acceptance | Not started |

The observation clock starts on the day after the structured website and the
accepted PushPlus format are enabled in production.

Worker v2 deployment on 2026-07-08 upgraded ingest, KV compatibility, and
structured website rendering while initially keeping PushPlus on the
conservative Markdown template. Reports already stored before the deployment
remain version 1 Markdown pages. After real-device HTML testing on 2026-07-09,
PushPlus was switched to the HTML card format.

## Shadow Run Log

| Date | Result | Items | Validation | Production impact | Notes |
| --- | --- | ---: | --- | --- | --- |
| 2026-07-14 curated-source v3 | `published` | 3 | Schema v3, exact-artifact history, five unique decisions, UTF-8, and deterministic Markdown validation passed | None | Initial pool contained 11 candidates from all three curated sources; all 11 remained eligible, so replenishment was not needed; decisions were 3 `recommend`, 2 `watch`, and 0 `reject` |
| 2026-07-13 Quality v2.1 | `published` | 1 | Schema, semantic, UTF-8, and forwarder pair validation passed; base score 74 | None | Used the deterministic GitHub evidence pack to select the previously unreviewed `anthropics/skills` `doc-coauthoring` artifact; retained unknown directory-level licensing and platform adaptation caveats instead of inheriting repository popularity as complete proof |
| 2026-07-12 Quality v2.1 | `no_update` | 0 | Schema and semantic validation passed | None | Reviewed 15 candidates across high-validation, growth, emerging, and multi-skill lanes; OSS Insight, RadarAI, and bounded X searches were attempted; no candidate had enough exact field-level evidence to pass the revised gate |
| 2026-07-08 | `published` | 5 | Schema, semantic, and forwarder pair validation passed | None | Verified the new `xDiscovery` requirement: X auxiliary search attempted, 0 verifiable X candidates found, and production outbox files were not overwritten |
| 2026-07-07 | `published` | 5 | Schema, semantic, and forwarder pair validation passed | None | Reviewed 10 candidates, selected 5 non-recent sources, and confirmed production outbox files were not overwritten |
| 2026-07-06 | `published` | 6 | Schema, semantic, and forwarder pair validation passed | None | Found and fixed a forwarder false positive when a summary mentioned a later item title before its heading |

Shadow runs use `prompts/skill-radar-shadow.md` and write only to
`reports/shadow/`. Three successful runs are required before Worker v2
deployment.

## 14-Day Checkpoint

- At least 12 valid daily outcomes, including `published` or valid `no_update`.
- Every outcome has a schema-valid Sidecar.
- No unexplained repository-level repeat.
- Every selected item has a base score of at least 70.
- At least eight reports with recommendations receive two lightweight interest
  feedback entries, recorded as `interested` or `not_interested`.
- Mobile push is scannable and website details remain complete.
- No mojibake, structure mismatch, low-quality padding, or content injection.

## 30-Day Acceptance

- At least 26 valid daily outcomes.
- Zero unexplained 30-day repository repeats.
- All selected sources were reachable and verified at generation time.
- At least 60% of rated items are marked `interested`.
- History or feedback demonstrably changes later filtering or ranking.
- X candidate volume, selection rate, and interest rate are measured.
- `published`, `no_update`, and production incidents remain correctly
  distinguished.
- Push supports discovery and judgment; the website supports evidence,
  comparison, and archive review.

## Out Of Scope

- Accounts, payment, subscriptions, and multi-user hosting.
- D1 and R2 migration.
- Additional radar channels.
- Image cards.
- X API or X page scraping.
- Marketing homepage and hosted entitlement rules.
- Clean-clone simulation as a formal acceptance requirement.
