# Skill Radar Curated-Source v3 Shadow Test

Run the simplified curated-source production candidate flow as an isolated
shadow test. Do not write to `reports/outbox/`, invoke the forwarder, call the
Worker, update the website, or send PushPlus.

## 1. Prepare

Use the current date in `Asia/Shanghai`, then run:

```text
node tools/quality/report-quality.mjs prepare --date YYYY-MM-DD --shadow
```

The active history uses version 2 exact-artifact identity. Do not inspect or
reinterpret the archived version 1 repository history.

## 2. Bounded Discovery

Open and use all three sources:

1. `https://awesomeclaudeskills.com/`
2. `https://github.com/dmgrok/agent-plugins`
3. `https://www.openagentskill.com/skills`

Collect an initial 8-12 concrete candidates across all three sources. Keep only a real
`SKILL.md`, rule directory, focused skill pack, or reusable instruction
package. Reject generic MCP servers, ordinary tools, broad frameworks, and
directory-only repositories.

Directory scores, stars, compatibility claims, summaries, and safety labels
are discovery hints, not quality proof. Do not use RadarAI, OSS Insight, broad
GitHub search, X, or Xiaohongshu in this flow.

## 3. Code-Owned History Filter

Write the candidate pool as UTF-8 JSON:

```text
reports/shadow/state/skill-radar-curated-candidates.json
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
node tools/quality/report-quality.mjs filter-candidates --shadow --date YYYY-MM-DD --input reports/shadow/state/skill-radar-curated-candidates.json
```

Read:

```text
reports/shadow/state/skill-radar-candidates-filtered.json
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

## 4. Verify Five Primary Sources

Choose exactly five eligible candidates based on apparent task usefulness,
maintenance, adoption, and relevance to coding, documents, browser automation,
data, design, GitHub, productivity, or context management.

Open the canonical GitHub repository, exact skill directory, or official
documentation for all five. Classify each as:

- `recommend`: real reusable instructions, clear use case, usable native path,
  reasonable portability, and no unresolved major trust concern;
- `watch`: useful but maintenance, portability, documentation, license,
  permissions, or evidence remains uncertain;
- `reject`: not truly skill-like, inaccessible, deprecated, misleading, or
  unsafe without disproportionate review.

Do not assign numeric scores. For every decision record what it solves, primary
evidence, native usability, portability, main trust caveat, and one concise
decision reason. A network or research failure is a failed run, not
`no_update`.

## 5. Write Curated Draft

Write UTF-8 JSON:

```text
reports/shadow/state/skill-radar-curated-draft.json
```

Required top-level fields:

- `reportDate`;
- bilingual `summary` and `conclusion` with `zh` and `en`;
- `decisions` containing exactly five entries.

Do not write candidate counts, duplicate counts, or source counts into the
draft. The finalizer calculates them from the filtered candidate file.

Every decision requires:

- `title`, `category`, `sourceUrl`, `artifactScope`, and `artifactPath`; copy
  candidate identity fields exactly so the finalizer can match the artifact;
- `decision`, `reason`, `officialSourceVerified: true`, `sourceCheckedAt`, and
  known license or `null`.

The finalizer replaces title, source, artifact identity, and discovery fields
with the authoritative values from the filtered candidate file. Do not select
the same artifact more than once.

For each `recommend` decision also provide:

- `recommendation`: `install` or `adapt`;
- bilingual `display.zh` and `display.en`;
- in each language: `oneLiner`, `whyNow`, `bestFor`, `action`,
  `primaryCaution`, `problem`, `usability`, `adaptation`, and `trust`.

Keep names, commands, URLs, and identifiers in English. Do not include raw
HTML. `watch` and `reject` decisions do not need display content.

## 6. Finalize

Run:

```text
node tools/quality/report-quality.mjs finalize-curated --shadow --input reports/shadow/state/skill-radar-curated-draft.json --candidates reports/shadow/state/skill-radar-candidates-filtered.json
```

Fix draft errors and retry when validation reports a concrete field problem.
Do not hand-write final Markdown.

Successful output exists only at:

```text
reports/shadow/outbox/skill-radar-YYYY-MM-DD.quality.json
reports/shadow/outbox/skill-radar-YYYY-MM-DD.md
```

After success report the date, candidate count, code-excluded count, five
decision counts, output paths, production files changed (`no`), and forwarding
(`disabled`).
