# Personal Radar

Personal Radar is a lightweight Cloudflare Workers project for scheduled information radar reports, public daily briefings, and personal push delivery.

The project intentionally separates four jobs:

- Codex Automation does the high-intelligence deep dive and recommendation writing.
- Cloudflare Worker receives reports, stores them in KV, renders public pages, and sends push messages.
- A local Codex forwarder bridges Codex Automation results into the Worker when the automation shell cannot reach remote endpoints.
- GitHub stores only code, docs, and example configuration, not private reports, tokens, or personal preferences.

Current primary channel:

- `skill-radar`: finds practical AI-agent skills and rules, including Codex-native skills, Claude or Claude Code skills, Cursor rules, Cline/Roo rules, and reusable agent rule packs.

## Public Daily Radar

The Worker can serve public reports directly:

- `GET /`: latest public report.
- `GET /reports`: public report archive.
- `GET /reports/:category/:date`: one stored public report.

Only reports ingested with `visibility: "public"` are shown on the website. Private reports can still be pushed but are not rendered publicly.

## Personal Self-Hosted Push

Use this path when you want your own private radar and push channel.

1. Deploy the Worker.
2. Set Worker secrets for PushPlus and report ingest.
3. Configure Codex Automation to generate the deep-dive report.
4. Run the local forwarder after the Codex automation completes.

This keeps your personal content out of GitHub while still allowing the Worker to store and push reports.

## What Works Now

- `GET /health`: JSON health check.
- `GET /run`: generates a Markdown dry-run from the Worker GitHub search channel.
- `POST /ingest-report`: accepts a protected report, stores it in KV, deduplicates it, and sends PushPlus/Telegram if configured.
- `GET /`: renders the latest public report from KV.
- `GET /reports`: renders public report history.
- Cloudflare Cron can run the Worker-native radar job.
- PushPlus adapter sends Markdown reports to WeChat through PushPlus.
- Local Codex forwarder can POST Codex Automation reports to the Worker from the user's machine.

## Local Development

```powershell
npm install
npm run dev
```

Then open:

```text
http://localhost:8787/run
```

## Deployment

```powershell
npm run deploy
```

Cloudflare cron schedules use UTC. The current config runs daily at 00:00 UTC, which is 08:00 Beijing time.

## Worker Secrets

Set the PushPlus token:

```powershell
npx wrangler secret put PUSHPLUS_TOKEN
```

Optional channel override:

```powershell
npx wrangler secret put PUSHPLUS_CHANNEL
```

If `PUSHPLUS_CHANNEL` is not set, the Worker uses `wechat`.

Create a separate ingest key for Codex Automation or another trusted producer:

```powershell
npx wrangler secret put DEEP_REPORT_INGEST_KEY
```

Optional test key for `/test-push`:

```powershell
npx wrangler secret put RADAR_TEST_KEY
```

## Deep Report Ingest

Send JSON to the Worker:

```powershell
Invoke-RestMethod `
  -Uri "https://personal-radar.jiojioyizeradar.workers.dev/ingest-report" `
  -Method Post `
  -Headers @{ "x-radar-ingest-key" = "<your-ingest-key>" } `
  -ContentType "application/json" `
  -Body (@{
    title = "Skill Radar Deep Dive"
    content = "# Report body"
    category = "skill-radar"
    visibility = "public"
    generatedAt = "2026-06-19T00:00:00.000Z"
    sourceRunId = "skill-radar-unique-run-id"
  } | ConvertTo-Json)
```

Payload fields:

- `title`: display and push title.
- `content`: Markdown report body.
- `category`: report namespace, defaults to `skill-radar`.
- `visibility`: `public` or `private`; defaults to `private` for safety.
- `generatedAt`: ISO timestamp; defaults to ingest time.
- `sourceRunId`: unique producer run id used for duplicate protection.

Deduplication rules:

- The same `sourceRunId` is accepted once.
- The same `category` and report date is accepted once.

KV keys used by the Worker:

- `report:<category>:<YYYY-MM-DD>`
- `latest:<category>:public`
- `latest:<category>:private`
- `reports:index:<category>`
- `source-run:<sourceRunId>`

## Codex Local Forwarder

Codex Automation may be able to generate the best report but fail to POST to the Worker because its shell runs in a restricted network sandbox. The local forwarder is the current bridge.

Run from the repository root:

```powershell
.\tools\codex-forwarder\forward-codex-report.ps1
```

The forwarder:

- reads `DEEP_REPORT_INGEST_KEY` from `.secrets.local`;
- scans recent Codex session JSONL files for the latest `skill-radar` report;
- POSTs it to `/ingest-report`;
- writes `.codex-forwarder-state.json` so the same report is not sent twice;
- records failed attempts for retry/debugging.

See [`tools/codex-forwarder/README.md`](tools/codex-forwarder/README.md) for Task Scheduler setup.

## Repository Hygiene

Do not commit:

- `.secrets.local`
- `.dev.vars`
- `.codex-forwarder-state.json`
- generated private reports
- PushPlus, Telegram, Worker, or Codex tokens

Use `.secrets.local.example` as the template for local secrets.

## Future Extension Points

- Replace the local forwarder with Codex Cloud or another remote Codex runtime if it can reliably POST to the Worker.
- Add D1 when multi-user preferences, feedback, and search need relational queries.
- Add R2 when long-term Markdown/HTML archives outgrow KV.
- Add protected history endpoints so Codex deep dives can avoid repeating recently recommended items.
- Add preference memory so useful/not useful feedback adjusts future ranking.
