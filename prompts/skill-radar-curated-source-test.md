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

Read `reports/shadow/state/skill-radar-context.json` and use only its
`preferenceSummary.signals` as preference evidence. Missing feedback means
unknown, never negative.

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

## 4. Verify Every Eligible Primary Source

Open and verify every entry in `eligibleCandidates`. Do not perform another
prompt-only shortlist. Order the decisions by apparent task usefulness,
maintenance, adoption, and relevance to coding, documents, browser automation,
data, design, GitHub, productivity, or context management.

Open the canonical GitHub repository, exact skill directory, or official
documentation for every eligible candidate. Classify each as:

If an exact artifact URL returns 404 or points to a missing file, do not reject
it immediately. Search the same canonical repository for the exact slug, name,
`SKILL.md`, install metadata, and alternate maintained directories such as
hidden or curated folders. If found, correct `sourceUrl` and `artifactPath` in
the candidate input and rerun filtering before deciding. If it remains
unverifiable after bounded attempts, replace it from the same source lane or
fail the run. A single 404 is not primary evidence that an artifact was removed
or deprecated.

- `recommend`: real reusable instructions, clear use case, usable native path,
  reasonable portability, and no unresolved major trust concern;
- `defer`: useful but maintenance, portability, documentation, license,
  permissions, or evidence remains uncertain and should be reviewed later;
- `reject`: not truly skill-like, confirmed removed or deprecated by primary
  evidence, misleading, or unsafe without disproportionate review.

Do not assign numeric scores. For every decision record what it solves, primary
evidence, native usability, portability, main trust caveat, and one concise
decision reason. Use `no_update` only when every eligible candidate was
verified and none was `recommend`. A network or research failure is a failed
run, not `no_update`.

Never finalize `officialSourceVerified: true` when the reason says the primary
source is inaccessible, returned 404, or could not be verified.

Make quality decisions independently of preference. Then add internal
`preference` to every decision: `boosted` may cite only matching `interested`
signal IDs, `deprioritized` may cite only matching `not_interested` IDs, and a
non-match must use `neutral` with no IDs and a null rationale. Preference may
only change the ordering of qualified recommendations.

## 5. Write Curated Draft

Write UTF-8 JSON:

```text
reports/shadow/state/skill-radar-curated-draft.json
```

Required top-level fields:

- `reportDate`;
- bilingual `summary` and `conclusion` with `zh` and `en`;
- `decisions` containing exactly one entry for every eligible candidate, in
  recommendation priority order.

Do not write candidate counts, duplicate counts, or source counts into the
draft. The finalizer calculates them from the filtered candidate file.

### Public copy contract

`summary`, `conclusion`, and every bilingual `display` field are reader-facing
website or WeChat copy. Describe today's useful themes, what each artifact
does, who it suits, how to start, and practical cautions. Never mention fixed
directories, candidate pools, source quotas, filter passes, reviewed or
excluded candidates, internal decision labels, Sidecar, Schema, or why other
items were deferred or rejected. Keep that process evidence in `reason`,
`stats`, history, and source metadata only.

Every decision requires:

- `title`, `category`, `sourceUrl`, `artifactScope`, and `artifactPath`; copy
  candidate identity fields exactly so the finalizer can match the artifact;
- `decision`, `reason`, `officialSourceVerified: true`, `sourceCheckedAt`, and
  known license or `null`.

The finalizer replaces title, source, artifact identity, and discovery fields
with the authoritative values from the filtered candidate file. It rejects
drafts that omit an eligible artifact or select the same artifact more than
once.

For each `recommend` decision also provide bilingual `display.zh` and
`display.en`. In each language include:

- `oneLiner`, `whyNow`, `bestFor`, `action`,
  `primaryCaution`, `problem`, `usability`, `adaptation`, and `trust`.

Use the production reader-facing semantics: `oneLiner` states the plain user
outcome with at most one optional accurate analogy; `bestFor` describes a task
or trigger rather than a user identity; `action` lists prerequisites before
use; `primaryCaution` explains one important limitation and its consequence;
`usability` gives only primary-source-backed installation, first-use, and
success-check guidance; `adaptation` covers native platforms and realistic
cross-agent adaptation; and `trust` explains permissions, data, credentials,
scripts, and rollback in user language. Never invent undocumented setup steps.

Keep names, commands, URLs, and identifiers in English. Do not include raw
HTML. `defer` and `reject` decisions do not need display content. The finalizer
stores `defer` for a 14-day cooldown and `reject` for a 90-day cooldown; do not
calculate or write those dates yourself.

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

After success report the date, candidate count, code-excluded count, decision
counts, output paths, production files changed (`no`), and forwarding
(`disabled`).
