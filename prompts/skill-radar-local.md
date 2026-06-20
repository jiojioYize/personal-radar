# Personal Radar Local Prompt: Skill Radar

Run a deep-dive radar for true AI-agent skills and rules only.

This prompt is the recommended production path for local Codex Automation.

Before writing the report, determine the current Beijing date (`Asia/Shanghai`) and use that date consistently in:

- the report title
- `generatedAt`
- `sourceRunId`

Do not modify repository files.
Do not print or reveal any ingest key.

## Secret Lookup

Use the first available key in this order:

1. `DEEP_REPORT_INGEST_KEY` from the environment.
2. `DEEP_REPORT_INGEST_KEY` parsed from the repository root `.secrets.local`.
3. `CLOUD_REPORT_INGEST_KEY` parsed from the repository root `.secrets.local`.

Only report whether a key was found and its length. Never print the key value.

## Scope

Focus on:

- Codex-native skills and plugins with reusable `SKILL.md` workflows.
- Claude or Claude Code skills and reusable `CLAUDE.md`-style instructions.
- Cursor rules, `.cursorrules`, and Cursor agent workflow rules.
- Cline, Roo, and Roo Code rules or portable rule packs.
- Reusable coding-agent rule packs that can be adapted into Codex skills.

Do not recommend:

- generic MCP servers unless they include concrete skill/rule packages.
- broad agent frameworks with no portable skill-like instructions.
- ordinary automation tools with no reusable agent rules.

Prefer practical, reusable, recently active or clearly maintained items relevant to:

- document processing
- coding workflows
- browser automation
- data analysis
- design
- GitHub
- PDF/Word handling
- personal productivity
- agent context management

Find 5-8 high-signal items. Deduplicate obvious repeats and favor quality over popularity.

## Required Fields Per Item

For each item, include:

- title/name
- category
- source link
- why it is worth attention
- what problem it solves
- whether it is directly usable or needs adaptation
- suggested Codex-skill adaptation approach
- trust/security caveats
- one short recommendation: install, adapt, watch, or skip

## Output Format

Write a concise bilingual Markdown report using this exact structure:

```markdown
<!-- zh -->
# Skill Radar Deep Dive - YYYY-MM-DD

Chinese report body here. Write natural, concise Chinese. Keep product names, repository names, skill names, file names, commands, URLs, and technical identifiers in English. Translate explanations, caveats, recommendations, and summaries into Chinese.
<!-- /zh -->

<!-- en -->
# Skill Radar Deep Dive - YYYY-MM-DD

English report body here.
<!-- /en -->
```

## Ingest

After the report is complete, POST it to:

```text
https://radar.dailyingest.cn/ingest-report
```

Use:

- the selected ingest key as the `x-radar-ingest-key` header.
- a normal `User-Agent`, for example `personal-radar-local-skill-radar/1.0`.

POST JSON with:

- `title`: `Skill Radar Deep Dive - YYYY-MM-DD`
- `contentZh`: the Chinese report body, including heading
- `contentEn`: the English report body, including heading
- `category`: `skill-radar`
- `visibility`: `public`
- `pushLanguage`: `zh`
- `generatedAt`: current ISO timestamp
- `sourceRunId`: `local-skill-radar-YYYY-MM-DD`

If the Worker returns `duplicate=true`, do not retry with a different date.

Report only:

- key source: `env`, `.secrets.local`, or `missing`
- key length
- HTTP status
- response is JSON
- ok
- stored
- pushed
- duplicate
- reason, if any
- public URL: `https://radar.dailyingest.cn/`
- whether repository files changed
