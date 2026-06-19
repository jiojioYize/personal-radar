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
- Worker URL: `https://personal-radar.jiojioyizeradar.workers.dev`
- Stable push channel: PushPlus
- KV binding: `RADAR_STATE`
- Main Worker role: stable scheduled radar delivery
- Codex automation role: smarter GitHub/public-source deep dives and higher-quality narrative recommendations

The Cloudflare Worker is the reliable production path. Codex automations are useful for higher-intelligence exploration, but should be treated as less proven until scheduling is verified in this project workspace.

## Schedule

- Worker push schedule: daily at Beijing time 08:00.
- Desired Codex deep-dive schedule: daily at Beijing time 08:05.

If Codex automations are tested again, create or update them from this `personal-radar` workspace rather than from the old coursework `submission` workspace.

## Secrets

Do not print, commit, or expose tokens.

Known local-only files:

- `.secrets.local`
- `.secrets.local.example`

Cloudflare secrets are managed through Wrangler or the Cloudflare dashboard. PushPlus token, test key, and ingest key should stay out of Git.

## Existing Endpoints

- `/health`: health check.
- `/run`: generate a Markdown preview without pushing.
- `/test-push?key=...`: send a PushPlus test message.
- `/ingest-report`: receive a Codex-generated report and forward it through PushPlus. Requires the ingest key in the `x-radar-ingest-key` header.

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

- Use the Worker for dependable scheduled delivery.
- Use Codex for richer analysis, synthesis, and adaptation ideas.
- When testing delivery, avoid creating duplicate PushPlus messages unless intentionally checking push behavior.
- After changing Worker code or `wrangler.toml`, deploy with Wrangler and verify `/health` and `/run`.
