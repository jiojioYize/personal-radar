# Personal Radar Local Prompt: Skill Radar Portfolio v3

Run the production source-portfolio flow for concrete, reusable AI-agent
skills, rules, modes, and focused instruction packs. Plugins, extensions,
marketplaces, repositories, and MCP servers are discovery containers rather
than automatic recommendations. This task researches and writes local report
artifacts. Do not POST to the Worker; the Windows forwarder delivers a
validated report later.

## 1. Prepare

Use the current date in `Asia/Shanghai`, then run:

```text
node tools/quality/report-quality.mjs prepare --date YYYY-MM-DD --source-portfolio
```

The active history uses version 2 exact-artifact identity. Do not inspect or
reinterpret the archived version 1 repository history.

Read the code-generated plan before discovery:

```text
reports/state/skill-radar-source-plan.json
```

The plan is authoritative. Use its exact `registryFocus`, `registryUrl`, and
`officialSources`. Do not choose or remember the rotation yourself. Re-running
on the same date reuses the same plan; the next completed production date
advances it.

## 2. Discover by Lane

Collect 8-12 concrete candidates. Search all three daily lanes independently;
do not stop because one lane already provides enough candidates.

### Registry pulse: 3-4

- Open the plan's exact `registryUrl` and use only its `registryFocus` view.
- The code rotates `all_time`, `trending`, `hot`, and `official` across
  completed production dates.
- Install counts, trend labels, and audits are discovery hints, not quality
  proof.

### Official rotation: 3-4

Open at least two of the three official sources assigned in the plan. Do not
substitute an unassigned source because it appears easier or has more items.

### Community trend: 2-4

- `https://awesomeclaudeskills.com/`
- `https://www.openagentskill.com/skills`

The optional `rulesModes` lane is reserved for a separate weekly review and is
not required in the daily production report.

The recommendation unit must be one exact skill, rule, mode, or focused
instruction pack. Inspect any plugin, extension, marketplace entry, catalog,
or repository until the exact reusable artifact and its dependency boundary
are identified. Reject generic MCP servers, ordinary tools, and broad
frameworks. Do not use RadarAI, OSS Insight, broad GitHub search, X, or
Xiaohongshu in this daily flow.

## 3. Code-Owned History Filter

Write the candidate pool as UTF-8 JSON:

```text
reports/state/skill-radar-source-portfolio-candidates.json
```

Shape:

```json
{
  "asOf": "YYYY-MM-DD",
  "candidates": [
    {
      "title": "Exact skill title",
      "sourceUrl": "https://github.com/owner/repo/tree/main/path/to/skill",
      "artifactScope": "general_skill_collection",
      "artifactPath": "path/to/artifact",
      "discoveryType": "officialRotation",
      "sourceId": "openAiPlugins",
      "discoveryUrl": "https://github.com/openai/plugins",
      "containerType": "plugin",
      "containerUrl": "https://github.com/owner/repo",
      "artifactType": "skill",
      "provenance": "first_party",
      "discoverySignals": ["official-catalog"],
      "dependencies": ["mcp", "authentication"],
      "registryView": null
    }
  ]
}
```

Allowed `artifactScope` values are `individual_skill`, `focused_skill_pack`,
`general_skill_collection`, `official_catalog`, and `mixed_toolkit`. For a
specific child skill inside a collection, use the collection scope and provide
its repository-relative `artifactPath`. Do not guess a path.

Allowed portfolio values and boundaries:

- `discoveryType`: `registryPulse`, `officialRotation`, `communityTrend`, or
  optional `rulesModes`;
- `sourceId`: `skillsSh` for the registry; one of the plan's assigned IDs for
  official rotation; `awesomeClaudeSkills` or `openAgentSkill` for community;
- `containerType`: `registry_entry`, `repository`, `plugin`, `extension`, or
  `marketplace_entry`;
- `artifactType`: `skill`, `rule`, `mode`, or `instruction_pack`;
- `provenance`: `first_party`, `officially_governed_community`, or
  `independent`;
- `dependencies`: one or more of `mcp`, `cli`, `api`, `hooks`,
  `authentication`, `runtime`, `platform`, or only `none`;
- `registryView`: copy the plan's exact focus for registry candidates and use
  `null` otherwise.

Plugin, extension, marketplace, and multi-artifact containers require an
evidence-backed repository-relative `artifactPath`. Do not guess identity,
provenance, dependencies, or discovery signals.

Run:

```text
node tools/quality/report-quality.mjs filter-candidates --source-portfolio --date YYYY-MM-DD --input reports/state/skill-radar-source-portfolio-candidates.json
```

Read:

```text
reports/state/skill-radar-candidates-filtered.json
```

Only use `eligibleCandidates` after this point. Do not override an exclusion or
perform history matching yourself.

### Recover from filter rejection

A correctable filter rejection should trigger an evidence-backed correction,
not immediate task failure. Allow up to three correction attempts in addition
to normal replenishment passes:

- reread the plan and correct malformed metadata from source evidence;
- if official coverage is insufficient, use another assigned official source;
- replace history-blocked or duplicate artifacts from the same planned lane;
- retry an inaccessible discovery page, then use an equivalent canonical page
  from the same assigned source;
- remove an unverifiable candidate and replace it from the same planned lane.

Never edit the plan, history, review state, artifact identity, or a
material-change claim to force acceptance. Stop when correction limits are
exhausted, fewer than two assigned official sources can be used, or broad
network failure prevents verification.

If `needsReplenishment` is `true`, collect additional new candidates from the
same three lanes, merge them without duplicate artifacts, and rerun the
filter. Use at most three filter passes and 20 total candidates. Stop as soon
as at least five candidates are eligible.

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

### Public copy contract

`summary`, `conclusion`, and every bilingual `display` field are shown directly
to readers on the website or in WeChat. Write them entirely from the reader's
perspective:

- `summary` should state today's useful themes and what the reader can gain in
  one or two concise sentences;
- `conclusion` should help the reader decide what to inspect or try first and
  mention only user-relevant tradeoffs;
- display fields should explain what the artifact does, who it suits, how to
  start, and the practical caution.

Never expose pipeline narration in public copy, including fixed or required
directories, candidate pools, source quotas, filter passes, reviewed or
excluded candidates, code-owned rules, internal decision labels, Sidecar,
Schema, or why other items were deferred or rejected. Put research evidence
and internal evaluation details only in `reason`, `stats`, history, and source
metadata. Names, commands, and necessary product terms may remain in English.

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
