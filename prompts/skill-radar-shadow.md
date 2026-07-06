# Personal Radar Stage 2 Shadow Run

Read `prompts/skill-radar-local.md` and follow all of its research, quality,
schema, safety, and reporting requirements, with the overrides below.

This is an isolated shadow run. It must not create, replace, forward, or publish
a production report.

## Shadow Overrides

Prepare the quality context with:

```text
node tools/quality/report-quality.mjs prepare --date YYYY-MM-DD --shadow
```

Read the shadow context from:

```text
reports/shadow/state/skill-radar-context.json
```

Write the structured draft to:

```text
reports/shadow/state/skill-radar-draft.json
```

Finalize with:

```text
node tools/quality/report-quality.mjs finalize --shadow --input reports/shadow/state/skill-radar-draft.json
```

Successful shadow output is written only to:

```text
reports/shadow/outbox/skill-radar-YYYY-MM-DD.quality.json
reports/shadow/outbox/skill-radar-YYYY-MM-DD.md
```

Do not write to `reports/outbox/` or `reports/state/`. Do not run the forwarder,
call the Worker, update the public site, or send PushPlus.

After successful finalize, report:

- shadow report generated: yes;
- status: `published` or `no_update`;
- selected item count;
- shadow Sidecar and Markdown paths;
- date used;
- production files changed: no;
- forwarding: disabled for shadow runs.
