# Personal Radar Local Prompt: Skill Radar v3

Run the simplified curated-source production flow for true AI-agent skills and
rules. This task researches and writes local report artifacts. Do not POST to
the Worker; the Windows forwarder delivers a validated report later.

## 1. Prepare

Use the current date in `Asia/Shanghai`, then run:

```text
node tools/quality/report-quality.mjs prepare --date YYYY-MM-DD
```

The active history uses version 2 exact-artifact identity. Do not inspect or
reinterpret the archived version 1 repository history.

## 2. Bounded Discovery

Open and use all three sources:

1. `https://awesomeclaudeskills.com/`
2. `https://github.com/dmgrok/agent-plugins`
3. `https://www.openagentskill.com/skills`

Collect an initial 8-12 concrete candidates across all three sources. Keep only
a real `SKILL.md`, rule directory, focused skill pack, or reusable instruction
package. Reject generic MCP servers, ordinary tools, broad frameworks, and
directory-only repositories.

Directory scores, stars, compatibility claims, summaries, and safety labels
are discovery hints, not quality proof. Do not use RadarAI, OSS Insight, broad
GitHub search, X, or Xiaohongshu in this flow.

## 3. Code-Owned History Filter

Write the candidate pool as UTF-8 JSON:

```text
reports/state/skill-radar-curated-candidates.json
```

Shape:

```json
{
  "asOf": "YYYY-MM-DD",
  "candidates": [
    {
      "title": "Exact skill title",
      "sourceUrl": "https://github.com/owner/repo/tree/main/path/to/skill",
      "artifactScope": "individual_skill",
      "artifactPath": null,
      "discoveryType": "awesomeClaudeSkills",
      "discoveryUrl": "https://directory.example/item"
    }
  ]
}
```

Allowed `artifactScope` values are `individual_skill`, `focused_skill_pack`,
`general_skill_collection`, `official_catalog`, and `mixed_toolkit`. For a
specific child skill inside a collection, use the collection scope and provide
its repository-relative `artifactPath`. Do not guess a path.

Set `discoveryType` to exactly one of `awesomeClaudeSkills`, `agentPlugins`, or
`openAgentSkill`.

Run:

```text
node tools/quality/report-quality.mjs filter-candidates --date YYYY-MM-DD --input reports/state/skill-radar-curated-candidates.json
```

Read:

```text
reports/state/skill-radar-candidates-filtered.json
```

Only use `eligibleCandidates` after this point. Do not override an exclusion or
perform history matching yourself.

If `needsReplenishment` is `true`, collect additional new candidates from the
same three sources, merge them into the candidate file without duplicate
artifacts, and rerun `filter-candidates`. Use at most three filter passes and at
most 20 total candidates. Stop replenishing as soon as at least five candidates
are eligible.

If fewer than five candidates remain eligible after those bounded attempts,
end the run as a candidate-shortage failure. Do not write a curated draft, do
not generate `no_update`, and do not weaken or override the history filter.

## 4. Verify Every Eligible Primary Source

Open and verify every entry in `eligibleCandidates`. Do not perform another
prompt-only shortlist. Order the decisions by apparent task usefulness,
maintenance, adoption, and relevance to coding, documents, browser automation,
data, design, GitHub, productivity, or context management.

Open the canonical GitHub repository, exact skill directory, or official
documentation for every eligible candidate. Classify each as:

- `recommend`: real reusable instructions, clear use case, usable native path,
  reasonable portability, and no unresolved major trust concern;
- `defer`: useful but maintenance, portability, documentation, license,
  permissions, or evidence remains uncertain and should be reviewed later;
- `reject`: not truly skill-like, inaccessible, deprecated, misleading, or
  unsafe without disproportionate review.

Do not assign numeric scores. For every decision record what it solves, primary
evidence, native usability, portability, main trust caveat, and one concise
decision reason. Use `no_update` only when every eligible candidate was
verified and none was `recommend`. A network or research failure is a failed
run, not `no_update`.

## 5. Write Curated Draft

Write UTF-8 JSON:

```text
reports/state/skill-radar-curated-draft.json
```

Required top-level fields:

- `reportDate`;
- bilingual `summary` and `conclusion` with `zh` and `en`;
- `decisions` containing exactly one entry for every eligible candidate, in
  recommendation priority order.

Do not write candidate counts, duplicate counts, or source counts into the
draft. The finalizer calculates them from the filtered candidate file.

Every decision requires:

- `title`, `category`, `sourceUrl`, `artifactScope`, and `artifactPath`; copy
  candidate identity fields exactly so the finalizer can match the artifact;
- `decision`, `reason`, `officialSourceVerified: true`, `sourceCheckedAt`, and
  known license or `null`.

The finalizer replaces title, source, artifact identity, and discovery fields
with authoritative values from the filtered candidate file. It rejects drafts
that omit an eligible artifact or select the same artifact more than once.

For each `recommend` decision also provide bilingual `display.zh` and
`display.en`. In each language include:

- `oneLiner`, `whyNow`, `bestFor`, `action`,
  `primaryCaution`, `problem`, `usability`, `adaptation`, and `trust`.

Keep names, commands, URLs, and identifiers in English. Do not include raw
HTML. `defer` and `reject` decisions do not need display content. The finalizer
stores `defer` for a 14-day cooldown and `reject` for a 90-day cooldown; do not
calculate or write those dates yourself.

## 6. Finalize

Run:

```text
node tools/quality/report-quality.mjs finalize-curated --input reports/state/skill-radar-curated-draft.json --candidates reports/state/skill-radar-candidates-filtered.json
```

Fix draft errors and retry when validation reports a concrete field problem.
Do not hand-write final Markdown.

Successful output exists only at:

```text
reports/outbox/skill-radar-YYYY-MM-DD.quality.json
reports/outbox/skill-radar-YYYY-MM-DD.md
```

## 7. Boundaries

- Do not read, print, or reveal ingest keys.
- Do not invoke the forwarder or call `/ingest-report`.
- Do not change application code, public documentation, or Git-tracked files.
- Only write local runtime files under `reports/outbox` or `reports/state`.
- Do not add generated reports, history, drafts, or candidates to Git.

After success report the date, candidate count, code-excluded count, decision
counts, output paths, repository files changed (`no`), and forwarding
(`handled by the local forwarder`).
