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

### 2026-07-27: Valid Skill Rejected After Stale Deep Link Returned 404

- The production run discovered `Figma Implement Design` through
  OpenAgentSkill and evaluated the guessed path
  `openai/skills/skills/figma-implement-design`.
- That path returned 404, so Automation rejected the candidate as lacking an
  accessible primary source while also writing
  `officialSourceVerified: true`.
- Manual verification found the maintained first-party artifact at
  `skills/.curated/figma-implement-design`. The Skill existed; the locator was
  wrong.
- Root cause: recovery covered discovery-page and filter failures but did not
  explicitly require same-repository artifact relocation after an exact deep
  link failed during final verification. Production wording also incorrectly
  allowed `inaccessible` as direct rejection evidence.
- Resolution: a 404 deep link is now treated as a correctable locator failure.
  Automation must search the same canonical repository, correct the candidate
  path, and rerun filtering. Deterministic validation now rejects a decision
  that claims primary-source verification while its reason describes an
  unresolved 404 or unverifiable source. A targeted shadow replay then passed
  with the corrected `.curated` path, primary-source verification, and the
  related positive-interest signal moving the qualified Skill to rank 1. A
  separate fresh-context blind agent, given only the stale URL and the updated
  recovery rule, independently followed the repository README to `.curated`,
  matched the exact slug, and confirmed the recovered `SKILL.md`.
- The incorrect production `reject` had also been persisted in local review
  state with a 90-day exclusion. That invalid derived entry was removed after
  the incident audit; the published report and delivery record were left
  unchanged.
- Removing the exclusion restored eligibility but did not guarantee
  rediscovery in the bounded daily candidate pool. A one-time recheck queue was
  therefore added: corrected false classifications must be included in the
  next production candidate pool and remain pending until finalization records
  a new evidence-based decision.
- Delivery policy: no historical report edit or PushPlus backfill. The
  correction applies to future runs.
- Classification: content-quality false negative and recovery-contract defect,
  not a network incident.

### 2026-07-18: Automation Interrupted During Unstable Travel Network

- Codex Automation triggered and generated the production context and
  authoritative `portfolio-v1` source plan at 08:16 Beijing time.
- The run did not progress to a dated candidate pool, filtered candidates,
  draft, or final outbox report. The source rotation therefore remained
  `planned` rather than `completed`.
- The Codex process continued for more than 40 minutes while the user's travel
  network was intermittent, then appeared interrupted and was ended after no
  additional production state had been written.
- No `skill-radar-2026-07-18.md` or Sidecar was generated, so the public site
  and PushPlus were not updated.
- Resolution: no manual rerun and no backfill because the intended daily
  delivery window had passed. The same source rotation may be reused by the
  next valid production attempt according to the code-owned plan.
- Classification: external runtime/network incident, not `no_update` and not
  currently evidence of a source-portfolio, report-generation, or delivery
  regression.

### 2026-07-09: Worker v2 Rejected Structured Report

- Codex Automation successfully generated
  `reports/outbox/skill-radar-2026-07-09.md` and its `.quality.json` Sidecar at
  08:07:34 Beijing time.
- Windows Task Scheduler started the forwarder at 08:15:03 and selected the
  correct outbox report.
- Worker returned HTTP `400` during the scheduled run, so the report was not
  stored, the public site was not updated, and PushPlus was not sent at the
  intended 08:15 delivery window.
- Diagnosis: Worker v2 raw-HTML protection treated the normal placeholder path
  ``skills/<name>/SKILL.md`` as an HTML tag. Local forwarder pair validation
  passed, but Worker ingest rejected `items[2] contains raw HTML`.
- Resolution: deploy a Worker validation fix that still rejects real HTML such
  as `<script>` while allowing angle-bracket placeholders in code-like text.
  After the fix, the user manually ran the Windows scheduled task and confirmed
  the report was pushed successfully and the website page looked correct.
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
