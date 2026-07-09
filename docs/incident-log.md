# Personal Radar Incident Log

This file records production exceptions that affect report generation, delivery,
the public site, or PushPlus. These entries are operational observations, not
automatically classified as product defects.

## Handling Policy

- Record the observed timeline, impact, likely cause, and resolution status.
- Do not manually publish or push a missed daily report after its intended
  delivery window unless explicitly requested.
- Do not change scripts in response to an isolated external incident without
  evidence of a repeatable product defect.
- Never include secrets, tokens, or private configuration values.

## Incidents

### 2026-07-09: Worker v2 Rejected Structured Report

- Codex Automation successfully generated
  `reports/outbox/skill-radar-2026-07-09.md` and its `.quality.json` Sidecar at
  08:07:34 Beijing time.
- Windows Task Scheduler started the forwarder at 08:15:03 and selected the
  correct outbox report.
- Worker returned HTTP `400`, so the report was not stored, the public site was
  not updated, and PushPlus was not sent.
- Diagnosis: Worker v2 raw-HTML protection treated the normal placeholder path
  ``skills/<name>/SKILL.md`` as an HTML tag. Local forwarder pair validation
  passed, but Worker ingest rejected `items[2] contains raw HTML`.
- Resolution: do not backfill or manually push the missed 2026-07-09 report.
  Clear the local pending entry and deploy a Worker validation fix that still
  rejects real HTML such as `<script>` while allowing angle-bracket placeholders
  in code-like text.
- Classification: Stage 2 Worker validation regression introduced during the
  structured ingest rollout.

### 2026-06-30: Report Generated After the Forwarder Window

- Codex Automation started on schedule but could not complete its internet
  research while the local proxy was unavailable.
- The proxy became available before the automation exited, and the report was
  eventually generated at 08:22:33 Beijing time.
- Windows Task Scheduler had already run the forwarder at 08:15:02. It found the
  already-sent 2026-06-29 report and correctly skipped it.
- The 2026-06-30 report was not sent to Worker, so neither the public site nor
  PushPlus was updated.
- Resolution: no retry or backfill, by design.
- Classification: external runtime/network timing incident, not an automation,
  parsing, or delivery regression.

### 2026-06-27: Delivery Delayed

- Codex Automation successfully generated the report at 08:03.
- Windows Task Scheduler started the forwarder at 08:15 with no missed run.
- The Worker connection closed during the POST, so the task exited with result
  code `1` and recorded the report in local `pending` state.
- The report was manually retried at 21:06 and Worker returned
  `stored=true`, `pushed=true`, `duplicate=false`.
- This manual backfill established the later policy that missed daily reports
  should normally be recorded rather than pushed outside their intended window.
- Classification: transient delivery network incident, not a scheduling or
  content-generation regression.

### 2026-06-26: Report Generation Missed

- Codex Automation could not complete its internet research because the local
  proxy was unavailable.
- No `skill-radar-2026-06-26.md` outbox file was generated.
- The forwarder ran at 08:15, found the already-sent 2026-06-25 report, and
  correctly skipped it.
- Resolution: no retry or backfill.
- Classification: external runtime/network incident, not a report parsing or
  delivery regression.
