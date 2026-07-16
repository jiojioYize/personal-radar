# Skill Radar Source Portfolio Shadow Test

Test the proposed cross-platform source portfolio in complete isolation. This
is a source-quality experiment, not a production report. Never write to
`reports/outbox/`, invoke the forwarder, call the Worker, update the website,
or send PushPlus.

## 1. Prepare

Use the current date in `Asia/Shanghai`, then run:

```text
node tools/quality/report-quality.mjs prepare --date YYYY-MM-DD --shadow --source-portfolio
```

Use only shadow history and review state. Do not inspect or modify production
outbox, history, or review-state files.

Read the code-generated plan before discovery:

```text
reports/shadow/state/skill-radar-source-plan.json
```

The plan is authoritative. Use its exact `registryFocus`, `registryUrl`, and
`officialSources`. Do not substitute a different skills.sh view or official
catalog because it appears easier or has more candidates. Re-running on the
same date reuses the same plan; a later date advances the rotation.

## 2. Discover by Lane

Collect 8-12 concrete candidates. Search all three daily lanes independently;
do not stop because one lane already provides enough candidates.

### Registry pulse: 3-4

- Open the plan's exact `registryUrl` and use only its `registryFocus` view.
- The code rotates `all_time`, `trending`, `hot`, and `official` across
  successful test dates.
- Install counts, trend labels, and audits are hints, not quality proof.

### Official rotation: 3-4

Open at least two of the three sources assigned in the plan. The complete
rotation catalog is:

- `https://github.com/anthropics/skills`
- `https://github.com/openai/plugins`
- `https://github.com/github/awesome-copilot`
- `https://cursor.com/marketplace`
- `https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/index.md`
- `https://github.com/NVIDIA/skills`
- `https://github.com/huggingface/skills`
- `https://github.com/MicrosoftDocs/agent-skills`

### Community trend: 2-4

- `https://awesomeclaudeskills.com/`
- `https://www.openagentskill.com/skills`

The optional `rulesModes` lane is for a separate weekly test using GitHub
Awesome Copilot instructions or Roo Code Modes. It is not required daily.

The recommendation unit must be one exact skill, rule, mode, or focused
instruction pack. A directory, plugin, extension, marketplace entry, MCP
server, framework, or ordinary tool is only a discovery container. Inspect the
container until an exact reusable artifact is identified.

## 3. Write and Filter Candidates

Write UTF-8 JSON to:

```text
reports/shadow/state/skill-radar-source-portfolio-candidates.json
```

Each candidate requires the existing identity fields plus:

```json
{
  "title": "Exact artifact title",
  "sourceUrl": "https://github.com/owner/repo/tree/main/path/to/artifact",
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
```

Allowed values:

- `discoveryType`: `registryPulse`, `officialRotation`, `communityTrend`, or
  optional `rulesModes`;
- `sourceId`: `skillsSh` for `registryPulse`; `anthropicSkills`,
  `openAiPlugins`, `githubAwesomeCopilot`, `cursorMarketplace`,
  `geminiExtensions`, `nvidiaSkills`, `huggingFaceSkills`, or
  `microsoftAgentSkills` for `officialRotation`; `awesomeClaudeSkills` or
  `openAgentSkill` for `communityTrend`; `githubAwesomeCopilot` or `rooModes`
  for `rulesModes`. The lane and source must match;
- `containerType`: `registry_entry`, `repository`, `plugin`, `extension`, or
  `marketplace_entry`;
- `artifactType`: `skill`, `rule`, `mode`, or `instruction_pack`;
- `provenance`: `first_party`, `officially_governed_community`, or
  `independent`;
- `dependencies`: one or more of `mcp`, `cli`, `api`, `hooks`,
  `authentication`, `runtime`, `platform`, or only `none`.
- `registryView`: for `registryPulse`, copy the plan's exact `registryFocus`;
  use `null` for other lanes.

Use a collection scope and exact repository-relative `artifactPath` whenever a
repository or package contains multiple artifacts. Plugin, extension, and
marketplace containers always require `artifactPath`. Do not guess a path,
provenance, dependency, or discovery signal.

Run:

```text
node tools/quality/report-quality.mjs filter-candidates --shadow --source-portfolio --date YYYY-MM-DD --input reports/shadow/state/skill-radar-source-portfolio-candidates.json
```

The filter rejects registry candidates from the wrong view, official
candidates outside the assigned rotation, and candidate pools that use fewer
than two assigned official sources. Do not edit the plan to bypass a source
access or candidate-quality problem; report it as a failed source test.

### Recover from filter rejection

A filter rejection is not automatically the end of the run. Read the complete
error, classify it, and make an evidence-backed correction. Allow up to three
filter correction attempts in addition to the normal candidate replenishment
passes.

- For a wrong `registryView`, unassigned `sourceId`, malformed URL, invalid
  enum, missing dependency, or lane/source mismatch, reread the daily plan and
  correct the candidate record from source evidence. Do not guess a value.
- For insufficient official-source coverage, collect replacement candidates
  from the other assigned official sources. The plan assigns three sources but
  requires only two, so one inaccessible or unproductive source is acceptable.
- For history, cooldown, or duplicate exclusions, add a different exact
  artifact from the same planned lane. Never edit history, review state, an
  artifact identity, or a material-change claim merely to pass filtering.
- If a planned discovery page fails to load, retry the same page, then try an
  equivalent canonical page from the same source, such as its official
  repository, catalog, exact directory, or raw `SKILL.md`. Do not substitute a
  different unassigned source.
- If a candidate remains unverifiable, remove it and replace it from the same
  planned lane. Inaccessibility is not evidence for `reject` and must not be
  represented as `no_update`.

Stop only when the correction and replenishment limits are exhausted, fewer
than two assigned official sources can be used, or a broad network failure
prevents primary-source verification. Report the concrete failure and the
attempts made. Do not weaken quality criteria or alter the generated plan.

Only use `eligibleCandidates`. Replenish with new candidates from the same
three lanes when fewer than five remain eligible, up to three filter passes and
20 total candidates. Fewer than five after those attempts is a failed test,
not `no_update`.

## 4. Verify and Decide

Verify every eligible artifact against its exact primary source. Record one
of:

- `recommend`: clearly reusable, well-scoped, natively usable, reasonably
  portable, and without an unresolved major trust concern;
- `defer`: promising but evidence, maintenance, portability, licensing,
  permissions, or dependencies remain uncertain;
- `reject`: not a true reusable artifact, inaccessible, deprecated,
  misleading, or unsafe without disproportionate review.

Do not use numeric scores or preserve lane quotas in final recommendations.
Popularity and official ownership do not override artifact quality. Explicitly
inspect scripts, hooks, authentication, secrets, network access, and external
dependencies. A research or network failure is a failed test.

## 5. Draft and Finalize

Write the same curated v3 draft shape documented in
`prompts/skill-radar-curated-source-test.md` to:

```text
reports/shadow/state/skill-radar-source-portfolio-draft.json
```

Include exactly one decision for every eligible candidate. Provide complete
bilingual display fields for every `recommend`. Do not write counts; code owns
them.

`summary`, `conclusion`, and every bilingual `display` field are reader-facing
website or WeChat copy. Describe useful themes, user value, suitable users,
how to start, and practical cautions. Never mention source lanes, assigned
catalogs, candidate pools, quotas, retries, filter passes, reviewed or excluded
candidates, internal decision labels, Sidecar, Schema, or why other items were
deferred or rejected. Keep source-experiment and evaluation details in
`reason`, `sourceContext`, `stats`, and the final run summary only.

Run:

```text
node tools/quality/report-quality.mjs finalize-curated --shadow --input reports/shadow/state/skill-radar-source-portfolio-draft.json --candidates reports/shadow/state/skill-radar-candidates-filtered.json
```

If finalization reports a concrete field error, correct only the affected
draft fields from verified evidence and retry up to three times. Identity and
discovery fields are code-owned and must not be changed to force a match. A
repeated validation failure is a failed shadow run, not `no_update`.

Successful output exists only under `reports/shadow/outbox/`. Report the date,
lane and source counts, code exclusions, recommend/defer/reject counts, unique
candidates not seen in the old three-source flow when determinable, exact
output paths, production files changed (`no`), and forwarding (`disabled`).
