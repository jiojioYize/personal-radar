# Personal Radar MVP Stage 1 Record

Last updated: 2026-06-28

## Status

Stage 1 MVP is complete and formally accepted as of 2026-06-28.

Personal Radar can now run as a daily personal radar system:

```text
Codex Automation -> reports/outbox -> local forwarder -> Worker /ingest-report -> KV + public site + PushPlus
```

The first stable public report date is 2026-06-22. Earlier 2026-06-19 to 2026-06-21 test and malformed reports were removed from the public archive.

## Final Acceptance

The MVP was observed in daily use from 2026-06-22 through 2026-06-28.

On 2026-06-28, the complete production flow ran normally:

- Codex Automation created `skill-radar-2026-06-28.md` at 08:04 Beijing time.
- Windows Task Scheduler started the forwarder at 08:15.
- Worker returned `stored=true`, `pushed=true`, and `duplicate=false` at 08:15.
- The public website updated successfully.
- The Chinese PushPlus message arrived successfully.

The 2026-06-26 generation miss and 2026-06-27 delivery failure remain recorded
as isolated external runtime incidents. They do not change the acceptance result
and did not reveal a report-format, storage, or product-logic regression.

## What Works

- Codex Automation runs the intelligent deep-dive prompt.
- The automation writes a bilingual Markdown report to `reports/outbox/`.
- The report file is ignored by Git and stays local.
- Windows Task Scheduler runs the local forwarder after the Codex Automation window.
- The forwarder reads the outbox report, validates it, and sends it to Worker `/ingest-report`.
- Worker stores the report in Cloudflare KV.
- Worker updates the public website at `https://radar.dailyingest.cn/`.
- Worker sends the Chinese report through PushPlus to WeChat.
- The public website supports Chinese and English report views when both are available.

## Current Production Flow

Daily schedule:

- Codex Automation: around 08:05 Beijing time.
- Local forwarder: around 08:20 Beijing time.

Core files:

- `prompts/skill-radar-local.md`: production automation prompt.
- `reports/outbox/skill-radar-YYYY-MM-DD.md`: daily generated report file.
- `tools/codex-forwarder/forward-codex-report.ps1`: local delivery bridge.
- `src/index.js`: Worker ingest, storage, rendering, and PushPlus delivery.
- `.secrets.local`: local-only ingest key source for the forwarder.

Public endpoints:

- `/`: latest public report.
- `/reports`: public report archive.
- `/reports/:category/:date`: dated public report page.
- `/health`: health check.
- `/ingest-report`: protected report ingest endpoint.

Debug or maintenance endpoints:

- `/run`: legacy dry-run/debug preview. Not part of the daily production flow.
- `/admin/prune-reports`: protected date-based cleanup endpoint.

## Design Decisions

### Codex Generates, Worker Publishes

Codex Automation is best at intelligent search, evaluation, and synthesis. Worker is best at stable storage, web serving, and push delivery.

Keeping those responsibilities separate made the system more reliable:

- Codex does not need to know ingest secrets.
- Worker does not need to perform expensive or complex AI search.
- The report file becomes a visible handoff point that can be inspected when something fails.

### Outbox Over Session Scraping

The first implementation tried to recover reports from Codex session output. That was fragile because status lines, UI text, or encoding issues could be mistaken for report content.

The production path now writes a dedicated UTF-8 Markdown file under `reports/outbox/`. The forwarder reads that file first. Session fallback remains temporarily, but should be removed after several more stable days.

### Local Forwarder Over Direct Automation POST

Codex Automation shell networking was unreliable in the local automation sandbox. The stable bridge is:

1. Codex Automation writes the report file.
2. A normal Windows scheduled PowerShell task runs later.
3. The PowerShell forwarder performs the network POST to Worker.

This keeps Codex's research quality while avoiding automation-shell network failures.

### Beijing Time At The Page Level

The website displays report time above the title, for example:

```text
skill-radar · 2026-06-22 08:06 Beijing Time
```

The report body should not include a separate generated-time line. This avoids duplicated timestamps and keeps all archive entries visually consistent.

## Encoding Lessons

UTF-8 handling became a real production issue.

Rules now used by the project:

- Report files are UTF-8 Markdown.
- The forwarder reads report files with explicit UTF-8.
- The forwarder sends JSON as UTF-8 bytes with `application/json; charset=utf-8`.
- The forwarder rejects likely mojibake before sending.
- Worker responses and pages use `charset=utf-8`.
- The automation prompt forbids raw metadata lines, status output, and wrapper text inside the report file.

See also: `docs/encoding-playbook.md`.

## Cleanup Already Done

Removed obsolete Cloud or direct-test paths:

- `prompts/skill-radar-cloud.md`
- `prompts/cloud-test-radar.md`
- `tools/automation/send-e2e-test-report.ps1`
- `CLOUD_REPORT_INGEST_KEY`
- `RADAR_TEST_KEY`
- `/test-push`
- `cloud-test-radar`

Kept temporarily:

- `/run` dry-run/debug logic.
- forwarder session fallback.

These should be removed only after the outbox path remains stable for several days.

## Operational Checklist

After each morning run, the expected signs are:

- `reports/outbox/skill-radar-YYYY-MM-DD.md` exists.
- `.codex-forwarder.log` contains `Using outbox report: ...`.
- `.codex-forwarder.log` contains `stored=True pushed=True duplicate=false`.
- The public site latest report is today's report.
- PushPlus delivers the Chinese report.
- `/reports` archive contains the expected daily entry.

If the report was already sent that day, `duplicate=true` can be normal.

## Known Risks

- Codex Automation scheduling UI and runtime behavior may change.
- Codex research still depends on internet access through the user's local proxy.
- Local Windows Task Scheduler must remain enabled.
- A single daily forwarder trigger can delay delivery when the network fails at that exact time.
- Worker KV is simple and sufficient for MVP, but not ideal for richer search, feedback, or analytics.
- `/run` still exists as legacy debug logic.
- The forwarder still has session fallback, which is no longer the desired primary path.

## Incident Record

### 2026-06-26: Report Generation Missed

- The Codex Automation could not complete its internet research because the local
  proxy was unavailable.
- No `skill-radar-2026-06-26.md` outbox file was generated.
- The forwarder ran at 08:15, found the already-sent 2026-06-25 report, and
  correctly skipped it.
- Classification: external runtime/network incident, not a report parsing or
  delivery regression.

### 2026-06-27: Delivery Delayed

- Codex Automation successfully generated the report at 08:03.
- Windows Task Scheduler started the forwarder at 08:15 with no missed run.
- The Worker connection closed during the POST, so the task exited with result
  code `1` and recorded the report in local `pending` state.
- The report was manually retried at 21:06 and Worker returned
  `stored=true`, `pushed=true`, `duplicate=false`.
- Classification: transient delivery network incident, not a scheduling or
  content-generation regression.

## Stage 2 Candidates

Recommended next work:

1. Add 30-day cross-run deduplication for recommended links.
2. Add protected history endpoints so Codex can avoid recently recommended items.
3. Add preference memory for useful/not useful feedback.
4. Improve public archive browsing and category presentation.
5. Add a small operational status page for last ingest, last push, and last report date.
6. Remove session fallback and `/run` after the outbox path stays stable.

## Completion Definition

Stage 1 is formally accepted because:

- Daily report generation works.
- Delivery to Worker works.
- KV persistence works.
- Public website updates correctly.
- PushPlus delivery works.
- The current stable report archive starts at 2026-06-22.
- Encoding and duplicated timestamp issues have been fixed.
- Obsolete Cloud test paths have been cleaned up.
- The full production flow was observed completing normally again on 2026-06-28.
