# Personal Radar Local Prompt: Skill Radar

Run a deep-dive radar for true AI-agent skills and rules only.

This prompt is the recommended production path for local Codex Automation.

The automation shell may not have outbound network access. Do not POST to the Worker from this task. The local forwarder will read the completed report from Codex session output and send it to the Worker.

Before writing the report, determine the current Beijing date (`Asia/Shanghai`) and use that date consistently in:

- the report title
- `generatedAt`
- `sourceRunId`

Do not modify repository files.
Do not read, print, or reveal any ingest key.
Do not attempt to call `/ingest-report`.

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

Write a concise bilingual Markdown report using this exact structure. The final answer must include the complete report body, because the local forwarder extracts the report from Codex session output.

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

After the report, add a short status note:

- report generated: yes
- date used
- whether repository files changed
- forwarding: handled by local forwarder, not this automation
