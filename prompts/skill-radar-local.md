# Personal Radar Local Prompt: Skill Radar Stage 2

Run a deep-dive radar for true AI-agent skills and rules only.

This task performs research and writes local report artifacts. Do not POST to
the Worker. The Windows forwarder handles delivery after the report has passed
local validation.

## 1. Prepare Local Context

Determine the current Beijing date in `Asia/Shanghai`, then run:

```text
node tools/quality/report-quality.mjs prepare --date YYYY-MM-DD
```

Read:

```text
reports/state/skill-radar-context.json
schemas/skill-radar-report.schema.json
```

The context contains:

- sources recommended in the last 30 days;
- coarse interest feedback (`interested` and `not_interested`);
- pending or deferred X candidates.

Do not recommend a recent source again unless an important release, structural
change, or security change is verified from a primary source. A material change
must include evidence.

## 2. Research Scope

Focus on:

- Codex-native skills and plugins with reusable `SKILL.md` workflows;
- Claude or Claude Code skills and reusable `CLAUDE.md` instructions;
- Cursor rules and `.cursorrules`;
- Cline, Roo, and Roo Code rules;
- portable coding-agent rule packs.

Do not recommend:

- generic MCP servers without concrete skill or rule packages;
- broad agent frameworks without portable instructions;
- ordinary automation tools without reusable agent rules;
- sources that require unverifiable claims or unsafe installation steps.

Prioritize document processing, coding workflows, browser automation, data
analysis, design, GitHub, PDF/Word handling, productivity, and context
management.

Review at least 8 candidates. Use GitHub repositories and official project
documentation as primary evidence.

Run two discovery lanes:

1. GitHub and official documentation search as the primary verification lane.
2. A bounded X auxiliary search as a discovery lane.

When network access allows research, perform at least one public,
search-engine-indexed X search that targets posts containing GitHub or official
links. Useful query patterns include:

```text
site:x.com ("agent skills" OR "Claude Code skills" OR "Codex skills") (github.com OR "open source")
site:x.com ("SKILL.md" OR "Cursor rules" OR "Roo rules") github.com
```

Merge GitHub/official candidates and X-discovered candidates into one candidate
pool. Rank them with the same hard gates, scoring rubric, 30-day history, and
feedback adjustment. Do not force X-discovered items into the final report when
GitHub or official search provides stronger candidates.

Do not scrape X, use an X API, depend on logged-in Chrome, or search
Xiaohongshu. Social popularity is not quality evidence and does not add ranking
weight.

For pending social candidates, either:

- select the verified official project;
- reject it with a reason;
- defer it for later review;
- mark it verified when the official source is valid but it is not yet ranked.

## 3. Quality Rules

Select zero to six items.

Every selected item must:

- be a real reusable skill, rule, or instruction pack;
- have a reachable HTTPS primary source;
- explain the problem, usability, Codex adaptation, and security boundary;
- have a calculated base score of at least 70;
- not be an unjustified 30-day repeat.

Score every selected item from 0 to 5 on:

- `relevance`
- `reusability`
- `maintenanceEvidence`
- `novelty`
- `adaptationFeasibility`
- `trustSafety`

The local quality tool calculates the weighted score and preference adjustment.
Do not invent or optimize the final numeric score.

Use:

- `published` when one to six items qualify;
- `no_update` when zero items qualify after reviewing at least eight candidates.

A research, network, or tooling failure is not `no_update`. If the task cannot
complete valid research, do not finalize a report.

## 4. Write The Structured Draft

Write UTF-8 JSON to:

```text
reports/state/skill-radar-draft.json
```

Use `schemaVersion: 1`, `channel: "skill-radar"`, and the Beijing date.

For every selected item provide:

- `title`, `category`, `sourceUrl`, and `recommendation`;
- `discovery` with `type`, `url`, optional author, and optional publish time;
- bilingual `display.zh` and `display.en`;
- all display fields required by the JSON Schema;
- all six quality dimensions;
- `skillLike: true`;
- `officialSourceVerified: true`;
- `sourceCheckedAt` as an ISO timestamp;
- license when known;
- material-change status and evidence when applicable.

Computed fields such as `id`, `rank`, `canonicalUrl`, `baseScore`,
`preferenceAdjustment`, and `finalRankScore` may be omitted from the draft. The
quality tool adds them deterministically.

Keep product names, repository names, commands, URLs, and identifiers in
English. Write concise natural Chinese and equivalent English explanations.
Do not include raw HTML.

For every social inbox candidate reviewed, add a `socialDecisions` entry with:

- `postUrl`;
- `status`: `verified`, `selected`, `rejected`, or `deferred`;
- verified `officialUrl`, or `null`;
- a short reason.

Always include `stats.xDiscovery`:

- `searched`: `true` when the bounded X auxiliary search was attempted;
- `candidateCount`: X-discovered posts or inbox entries with GitHub or official
  links;
- `verifiedCount`: candidates whose official source was reachable and relevant;
- `selectedCount`: selected items whose `discovery.type` is `x` or `inbox`;
- `rejectedCount`: X or inbox candidates rejected today;
- `deferredCount`: X or inbox candidates kept for later review.

If the X search returns no useful public results, set `searched: true` and all
counts to zero. If research cannot be performed reliably, do not finalize a
report.

## 5. Validate And Render

Run:

```text
node tools/quality/report-quality.mjs finalize --input reports/state/skill-radar-draft.json
```

If validation fails, read the error, correct the draft, and run finalize again.
Do not hand-write the final Markdown.

Successful finalize creates:

```text
reports/outbox/skill-radar-YYYY-MM-DD.quality.json
reports/outbox/skill-radar-YYYY-MM-DD.md
```

The forwarder will only send a matching validated pair.

## 6. Boundaries

- Do not read, print, or reveal ingest keys.
- Do not call `/ingest-report`.
- Do not change application code, public documentation, or Git-tracked files.
- Only write local runtime files under `reports/outbox`, `reports/state`,
  `reports/feedback`, `reports/inbox`, or `reports/quality`.
- Do not add generated reports, feedback, history, or candidates to Git.

After successful finalize, report:

- report generated: yes;
- status: `published` or `no_update`;
- selected item count;
- Sidecar and Markdown paths;
- date used;
- repository files changed: no;
- forwarding: handled by the local forwarder.
