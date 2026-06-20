# Personal Radar - Codex Project Notes

## Project Purpose

Personal Radar is a small long-running recommendation system for discovering useful AI-agent skills and rules. The current focus is true skill-like material, not generic AI frameworks:

- Codex-native skills and plugins with reusable `SKILL.md` workflows.
- Claude or Claude Code skills and reusable `CLAUDE.md`-style instructions.
- Cursor rules, `.cursorrules`, and Cursor agent workflow rules.
- Cline, Roo, and Roo Code rules or portable rule packs.
- Reusable coding-agent rule packs that can be adapted into Codex skills.

The user wants practical recommendations that are worth installing, adapting, watching, or skipping.

## Current Architecture

- Cloudflare Worker project path: `C:\Users\Zander Sun\personal-radar`
- Worker URL: `https://radar.dailyingest.cn/`
- Stable push channel: PushPlus
- KV binding: `RADAR_STATE`
- Main Worker role: ingest reports, store them in KV, render the public site, and send PushPlus notifications.
- Main automation role: run the intelligent search/deep-dive, write the bilingual report, and POST it to `/ingest-report`.

Current recommended production flow:

```text
Local Codex Automation -> Worker /ingest-report -> KV + public site + PushPlus
```

Cloud execution has been verified manually, but Cloud Automation creation and scheduling are not the stable primary path for this project yet. Keep Cloud-related prompts and `CLOUD_REPORT_INGEST_KEY` as optional backup/test tooling.

## Schedule

- Desired Codex deep-dive schedule: daily at Beijing time 08:05.
- Worker cron publishing is disabled. If a Worker cron trigger fires, it should be ignored.
- The local forwarder, if used as a fallback, should run after the Codex automation schedule, for example 08:20 Beijing time.

If Codex automations are tested again, create or update them from this `personal-radar` workspace rather than from the old coursework `submission` workspace.

## Prompts

- `prompts/skill-radar-local.md`: recommended production prompt for local Codex Automation.
- `prompts/skill-radar-cloud.md`: backup prompt for Cloud or remote environments.
- `prompts/cloud-test-radar.md`: end-to-end test prompt that publishes under the `cloud-test-radar` test category.

Formal daily automation should read and execute:

```text
prompts/skill-radar-local.md
```

## Secrets

Do not print, commit, or expose tokens.

Known local-only files:

- `.secrets.local`
- `.dev.vars`
- `.codex-forwarder-state.json`
- `.codex-forwarder-pending.json`

Cloudflare secrets are managed through Wrangler or the Cloudflare dashboard. PushPlus token, test key, and ingest keys should stay out of Git.

Local automation should prefer `DEEP_REPORT_INGEST_KEY`. It may read that value from the environment or from the repository root `.secrets.local`, but it must never print the key.

## Existing Endpoints

- `/health`: health check.
- `/`: latest public report page.
- `/reports`: public report archive.
- `/reports/:category/:date`: dated public report page.
- `/run`: generate a Markdown preview without pushing.
- `/test-push?key=...`: send a PushPlus test message.
- `/ingest-report`: receive a Codex-generated report, store it, and forward it through PushPlus. Requires the ingest key in the `x-radar-ingest-key` header.

## Recommendation Quality Rules

Prioritize:

- Directly reusable skills, rules, prompts, or instruction packs.
- Repositories with clear installation or adaptation paths.
- Recently active or maintained sources.
- Items relevant to coding workflows, document processing, browser automation, data analysis, design, GitHub, PDF/Word handling, productivity, and agent context management.

Avoid recommending:

- Generic MCP servers unless they include concrete skill/rule packs.
- Broad agent frameworks with no portable skill-like instructions.
- Tools that demand secrets or broad permissions without clear benefit.
- Repeated items already recommended recently.

## Roadmap

1. Add 30-day cross-run deduplication in Cloudflare Worker using KV to record pushed URLs and skip or down-rank recently seen items.
2. Let Codex Deep Dive share the same history, either by letting Worker parse ingested report links or exposing protected history endpoints.
3. Add preference memory so useful/not useful feedback adjusts future ranking.

## Operational Notes

- Use Codex Automation for richer analysis, synthesis, and adaptation ideas.
- Use the Worker for dependable ingest, storage, website rendering, and PushPlus delivery.
- When testing delivery, avoid creating duplicate PushPlus messages unless intentionally checking push behavior.
- After changing Worker code or `wrangler.toml`, deploy with Wrangler and verify `/health`.
