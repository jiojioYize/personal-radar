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
- Main automation role: run the intelligent search/deep-dive and write the bilingual report to `reports/outbox/`.
- Main forwarder role: validate the completed Markdown and quality Sidecar pair and POST both to `/ingest-report`.

Current recommended production flow:

```text
Local Codex Automation -> reports/outbox -> local forwarder -> Worker /ingest-report -> KV + public site + PushPlus
```

Local Codex Automation can read/write project files and run on schedule, but its shell network access may fail. Treat the local forwarder as the production delivery bridge.

## Schedule

- Desired Codex deep-dive schedule: daily at Beijing time 08:05.
- Worker cron publishing is disabled. If a Worker cron trigger fires, it should be ignored.
- The local forwarder should run after the Codex automation schedule, for example 08:20 Beijing time.

If Codex automations are tested again, create or update them from this `personal-radar` workspace rather than from the old coursework `submission` workspace.

## Prompts

- `prompts/skill-radar-local.md`: production prompt for local Codex Automation.

Formal daily automation should read and execute:

```text
prompts/skill-radar-local.md
```

That prompt should write:

```text
reports/outbox/skill-radar-YYYY-MM-DD.quality.json
reports/outbox/skill-radar-YYYY-MM-DD.md
```

## Secrets

Do not print, commit, or expose tokens.

Known local-only files:

- `.secrets.local`
- `.dev.vars`
- `.codex-forwarder-state.json`
- `.codex-forwarder-pending.json`
- `reports/outbox/*.md`
- `reports/outbox/*.quality.json`
- `reports/state/*`
- `reports/feedback/*`
- `reports/inbox/*`
- `reports/quality/*`

Cloudflare secrets are managed through Wrangler or the Cloudflare dashboard. PushPlus token, test key, and ingest keys should stay out of Git.

Local automation should not read ingest keys. The forwarder reads `DEEP_REPORT_INGEST_KEY` from `.secrets.local` and must never print the key.

## Existing Endpoints

- `/health`: health check.
- `/`: latest public report page.
- `/reports`: public report archive.
- `/reports/:category/:date`: dated public report page.
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

Long-term product positioning, user states, website evolution, and storage
decisions are maintained in `docs/product-strategy.md`.

Stage 2 implementation and acceptance are maintained in
`docs/stage-2-content-quality.md`.

Current Stage 2 production rules:

1. The quality Sidecar is the source of truth; Markdown is generated from it.
2. One to six qualified items produce `published`; zero produces `no_update`.
3. System failures must not be represented as `no_update`.
4. X is an auxiliary web-search and inbox source; no scraper or X API is used.
5. KV remains the production store and supports version 1 and version 2 reports.
6. PushPlus stays on Markdown until the real-device HTML comparison is accepted.

## Operational Notes

- Use Codex Automation for richer analysis, synthesis, and adaptation ideas.
- Use the forwarder for dependable local network delivery from outbox report files to the Worker.
- Use the Worker for dependable ingest, storage, website rendering, and PushPlus delivery.
- When testing delivery, avoid creating duplicate PushPlus messages unless intentionally checking push behavior.
- After changing Worker code or `wrangler.toml`, deploy with Wrangler and verify `/health`.
