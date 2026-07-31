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

Also read:

```text
reports/state/skill-radar-context.json
```

Use only `preferenceSummary.signals` as preference evidence. The policy is
positive-interest-primary: `interested` is the normal explicit signal,
`not_interested` is optional, and an unrated item always means unknown. Do not
infer disinterest from missing feedback.

The legacy confirmed-recheck queue is dormant. Do not create or add recheck
candidates. Confirmed errors still require a derived-state audit, but source
identity correction now belongs to the multi-agent verification stage.

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

Do not use the legacy `recheck` lane during the multi-agent verifier rollout.

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
- if an exact artifact URL returns 404 or points to a missing file, treat it as
  a correctable locator failure rather than evidence that the artifact does not
  exist. Search the same canonical repository for the exact skill slug, name,
  `SKILL.md`, install metadata, and alternate maintained directories such as
  hidden or curated folders. Do not search a different repository merely to
  preserve the candidate;
- when the artifact is found at a different maintained path, update
  `sourceUrl` and `artifactPath` in the candidate file from that primary
  evidence and rerun `filter-candidates` before making a decision;
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

## 4. Multi-Agent Source Verification

Create one fresh-context primary verifier subagent and give it every final
`eligibleCandidates` entry. Do not give it recommendation instructions or
preference signals.

For every candidate it must return the fields in `$defs.evidence` from:

```text
schemas/skill-radar-verification-v2.schema.json
```

It must use first-party evidence to verify exact artifact identity, current
source, the exact `SKILL.md` or equivalent instruction file, repository status,
license, capability, native usability, portability, maintenance, dependencies,
and the main trust caveat. File existence alone does not establish current
maintenance.

`repositoryStatus` describes the repository hosting `currentUrl` when one is
selected; otherwise it describes the original candidate repository. If
required fields are missing or use unsupported enum values, send one bounded
contract-repair message to the same subagent. The parent must not fill missing
evidence itself.

Specialist verification is mandatory when the primary result:

- is `migrated`;
- records `identityChanged: true`; or
- reports a repository status other than `current`.

Create one second fresh-context subagent for all such candidates. Give it the
original candidate records and verification goals, not the primary conclusions.
Allow one bounded contract repair.

Normalize URLs by removing trailing slashes and artifact paths by removing
leading/trailing slashes and trailing `/SKILL.md`. Cosmetic title differences
are not identity conflicts. Verdict, normalized URL, normalized artifact path,
repository status, source-repository-change, and identity-change fields are
material identity fields.

- Use `recovered_current` with `identityChanged: false` when the canonical
  repository, artifact slug or name, and material purpose remain the same and
  first-party path history supports continuity. A corrected category folder,
  directory, deep link, or `SKILL.md` locator is not a migration.
- Set `sourceRepositoryChanged: true` and use `migrated` when the maintained
  artifact moved to a different canonical repository. Repository migration
  does not by itself mean that the Skill identity changed.
- Use `identityChanged: true` only when the selected current artifact changes
  artifact identity or material capability/scope, such as an evidenced
  successor or replacement. A 404, guessed path, or repository move alone
  never proves identity change.
- `migrated` requires `sourceRepositoryChanged: true`;
  `verified_current` and `recovered_current` require it to be `false`.
- If both verifiers agree on material identity, use the agreed evidence.
- If they disagree, do not remove the candidate yet. Record exactly which
  material fields disagree and create the structured dispute packet below.
- Remove `ambiguous`, `invalid`, and `inconclusive` candidates.
- For `recovered_current` or agreed `migrated`, update title, `sourceUrl`, and
  `artifactPath` to the current artifact.

For every material disagreement, create `dispute` with:

- `fields` in this fixed order when present: `verdict`, `currentUrl`,
  `artifactPath`, `repositoryStatus`, `sourceRepositoryChanged`,
  `identityChanged`;
- exactly one focused question per field;
- `evidencePolicy: "first_party_only"`;
- `maxAdjudicationAttempts: 1`.

Create one third fresh-context adjudicator subagent only when at least one
dispute exists. Give it the original candidate, anonymized evidence A and B,
the disagreement fields, and field-specific questions. Do not identify which
evidence came from the primary or specialist, do not include recommendation
instructions or preference signals, and do not ask which verifier is more
convincing. Ask it to independently verify only the disputed identity facts
from first-party sources and return one complete `$defs.evidence` object.
Allow one bounded contract repair for malformed output.

- The adjudicator evidence becomes `reconciled`.
- A reconciled `verified_current`, `recovered_current`, or `migrated` artifact
  may continue only after its corrected identity reruns through the code-owned
  filter.
- A reconciled `ambiguous`, `invalid`, or `inconclusive` result is removed and
  must retain the complete primary, specialist, dispute, adjudication, and
  removal trajectory with `requiresFollowup: true`.
- Do not run open-ended debate or a second substantive adjudication attempt.

Replace removed candidates from the same planned lane and rerun the code-owned
filter. Every corrected identity must also rerun through the filter. Use the
existing maximum of three filter passes and twenty total candidates. Verify
newly eligible replacements through the same process. Stop with failure if
fewer than five fully verified candidates remain.

Write:

```text
reports/state/skill-radar-verification-evidence.json
```

using `schemas/skill-radar-verification-v2.schema.json`. Include one `retained`
result for every final eligible candidate and preserve every verification-stage
removal as a `removed` result. The evidence artifact is the complete trajectory,
not only the successful final set.

For a retained result, `artifactKey` and `candidateId` must match the final
filtered candidate. `originalSourceUrl` and `originalArtifactPath` retain the
identity first given to the primary verifier. Set all specialist, dispute,
adjudication, disposition, removal, and follow-up fields from the protocol
above. Mark unused specialist or adjudicator run metadata as entirely
unattempted. This internal evidence must not appear in reader-facing report
content.

Run:

```text
node tools/quality/validate-verification-harness-v2.mjs --evidence reports/state/skill-radar-verification-evidence.json --candidates reports/state/skill-radar-candidates-filtered.json
```

Do not proceed unless validation passes.

## 5. Main-Model Quality Decisions

The parent now acts as the quality editor. Do not browse sources again. Use
only the validated evidence artifact, the final filtered candidate file, and
prepared preference signals.

Order decisions by apparent task usefulness, maintenance, adoption, and
relevance to coding, documents, browser automation, data, design, GitHub,
productivity, or context management. Classify every verified candidate as:

- `recommend`: concrete reusable instructions, clear value, practical native
  use or adaptation, and no unresolved major trust concern;
- `defer`: the source is valid but product value, portability, maintenance,
  license, permissions, or dependencies remain uncertain;
- `reject`: the source is valid but the artifact is not sufficiently
  skill-like, is misleading, or has disproportionate trust cost.

Source identity ambiguity is not a `defer` or `reject`; it must already have
been removed before this stage. Do not assign numeric scores. Use `no_update`
only when every verified candidate received a decision and none was
`recommend`. A network, verification, or validation failure is a failed run.

Make the quality decision before considering preference. Preference cannot
turn a `defer` or `reject` into `recommend`, bypass trust boundaries, or change
history eligibility. After the quality decision, identify only direct semantic
matches between the candidate's task/category and prepared feedback signals.
Code uses these matches only to order otherwise qualified recommendations.

Complete all decisions before writing public copy. `summary` and `conclusion`
may describe only capabilities, themes, and cautions represented by final
`recommend` decisions. Never preview or imply an item that appears only in
`defer` or `reject`, because readers cannot see those internal decisions.

## 6. Write Curated Draft

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
- internal `preference` with `effect`, `matchedFeedbackIds`, and `rationale`:
  - use `boosted` only with one or more matching `interested` signal IDs;
  - use `deprioritized` only with one or more matching `not_interested` signal
    IDs;
  - otherwise use `{ "effect": "neutral", "matchedFeedbackIds": [],
    "rationale": null }`;
  - non-neutral rationale must briefly explain the direct task/category match;
    never place this internal explanation in public display copy.
- internal `verification` copied from matching reconciled evidence:

```json
{
  "candidateId": "src_00000000",
  "verdict": "verified_current",
  "currentUrl": "https://..."
}
```

The finalizer replaces title, source, artifact identity, and discovery fields
with authoritative values from the filtered candidate file. It rejects drafts
that omit an eligible artifact, select the same artifact more than once, invent
a feedback ID, or use positive and negative feedback with the wrong effect.

For each `recommend` decision also provide bilingual `display.zh` and
`display.en`. In each language include:

- `oneLiner`, `whyNow`, `bestFor`, `action`,
  `primaryCaution`, `problem`, `usability`, `adaptation`, and `trust`.

Keep names, commands, URLs, and identifiers in English. Do not include raw
HTML. `defer` and `reject` decisions do not need display content. The finalizer
stores `defer` for a 14-day cooldown and `reject` for a 90-day cooldown; do not
calculate or write those dates yourself.

Before finalization, validate the evidence-to-decision link:

```text
node tools/quality/validate-verification-harness-v2.mjs --evidence reports/state/skill-radar-verification-evidence.json --candidates reports/state/skill-radar-candidates-filtered.json --draft reports/state/skill-radar-curated-draft.json
```

Do not finalize unless it passes.

## 7. Finalize

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

## 8. Boundaries

- Do not read, print, or reveal ingest keys.
- Do not invoke the forwarder or call `/ingest-report`.
- Do not change application code, public documentation, or Git-tracked files.
- Only write local runtime files under `reports/outbox` or `reports/state`.
- Do not add generated reports, history, drafts, or candidates to Git.

After success report the date, candidate count, code-excluded count, primary
verification count, specialist and adjudicator counts with trigger reasons,
bounded contract-repair count, decision counts, dispute and adjudication
counts, unresolved removal count and each removal's exact reason or
disagreement fields, verification evidence path, output paths, repository
files changed (`no`), and forwarding
(`handled by the local forwarder`).
