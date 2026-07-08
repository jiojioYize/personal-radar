# Personal Radar Stage 2: Content Quality And Reading Experience

Last updated: 2026-07-07

## Status

Stage 2 implementation is in progress.

The local quality layer, structured report contract, forwarder validation, KV
v2 compatibility, structured website rendering, and HTML PushPlus renderer are
implemented locally. Production deployment, three-run shadow validation, the
real-device PushPlus comparison, and the 14/30-day observation windows have not
started.

This document is the single living record for the Stage 2 plan, rollout,
checkpoints, and final acceptance.

Local verification completed on 2026-07-06:

- 18 Node tests passed, including schema and semantic validation, same-day
  regeneration, `published` and `no_update`, 30-day repeat handling, v1/v2
  Worker compatibility, HTML escaping, and concise PushPlus rendering.
- The Windows forwarder validated a generated Markdown and Sidecar pair without
  reading a secret or sending a report.
- Wrangler completed a local Worker bundle dry run.
- Runtime reports, Sidecars, history, feedback, social candidates, summaries,
  and secrets were confirmed to remain outside Git.
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

```text
Codex Automation
  -> prepare local history and feedback context
  -> research at least 8 candidates
  -> write structured draft
  -> validate, score, and render
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

## Quality Contract

Every selected item must be:

- a real reusable skill, rule, or instruction pack;
- linked to a reachable HTTPS primary source;
- accompanied by usability, adaptation, and security analysis;
- absent from the previous 30 days unless a material change is evidenced;
- scored at least 70 before preference adjustment.

Weights:

| Dimension | Weight |
| --- | ---: |
| Relevance | 25 |
| Reusability | 20 |
| Maintenance and evidence | 15 |
| Novelty | 15 |
| Adaptation feasibility | 15 |
| Trust and safety | 10 |

Preference feedback changes ordering by at most five points. It cannot promote a
candidate that fails the base quality threshold or a hard safety gate.

## Daily Outcome Rules

- One to six qualified items produce a normal `published` report.
- More than six qualified items are ranked and capped at six.
- Zero qualified items produce a valid `no_update` outcome.
- `no_update` sends a short explanation and appears in the website archive.
- Network, research, validation, or scheduling failure produces no report and
  must not be represented as `no_update`.
- Late or missed reports follow the existing no-backfill incident policy.

## History, Feedback, And Social Inbox

Local-only state:

```text
reports/state/skill-radar-history.json
reports/state/skill-radar-context.json
reports/feedback/skill-radar.json
reports/inbox/social-candidates.json
reports/quality/skill-radar-summary.md
```

Feedback supports `useful`, `not_useful`, `opened`, `installed`, and `adapted`.
The user can ask Codex to record feedback without editing JSON.

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
- later usefulness of selected X-discovered items when feedback exists.

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
- `PUSHPLUS_TEMPLATE=markdown` remains the production default until the
  real-device HTML comparison is accepted.

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

Finalize an Automation draft:

```powershell
node tools/quality/report-quality.mjs finalize `
  --input reports/state/skill-radar-draft.json
```

Record feedback:

```powershell
node tools/quality/report-quality.mjs feedback `
  --url "https://github.com/example/project" `
  --rating useful `
  --category "browser automation" `
  --outcome adapted
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
| Stage 2 Automation prompt | Implemented locally |
| Sidecar-aware forwarder | Implemented locally |
| Worker KV v2 and structured website | Implemented locally |
| HTML and concise Markdown PushPlus renderers | Implemented locally |
| Automated tests and Worker bundle dry run | Passed |
| Desktop and 390px visual verification | Pending local preview access |
| Three successful shadow reports | 3 of 3 passed |
| Worker production deployment | Not started |
| Real-device HTML comparison | Not started |
| 14-day observation | Not started |
| 30-day acceptance | Not started |

The observation clock starts on the day after the structured website and the
accepted PushPlus format are enabled in production.

## Shadow Run Log

| Date | Result | Items | Validation | Production impact | Notes |
| --- | --- | ---: | --- | --- | --- |
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
- At least eight reports with recommendations receive two feedback entries.
- Mobile push is scannable and website details remain complete.
- No mojibake, structure mismatch, low-quality padding, or content injection.

## 30-Day Acceptance

- At least 26 valid daily outcomes.
- Zero unexplained 30-day repository repeats.
- All selected sources were reachable and verified at generation time.
- At least 60% of rated items are marked `useful`.
- History or feedback demonstrably changes later filtering or ranking.
- X candidate volume, selection rate, and usefulness are measured.
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
