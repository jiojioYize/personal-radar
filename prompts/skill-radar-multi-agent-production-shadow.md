# Skill Radar Multi-Agent Production-Format Shadow Run

Run the current source-portfolio workflow in complete shadow isolation, adding
independent source verification before the main-model quality decisions.

## Safety

- Use the current date in `Asia/Shanghai`.
- Use `--shadow --source-portfolio` for every quality command.
- Write only under `reports/shadow/`.
- Do not read or modify production outbox, history, review state, feedback,
  recheck state, or previous reports.
- Do not invoke the forwarder, Worker, PushPlus, or ingest endpoint.
- Do not modify Git-tracked files.

## 1. Prepare, Discover, And Filter

Follow sections 1-3 of:

```text
prompts/skill-radar-source-portfolio-test.md
```

Use the generated shadow plan, collect all three lanes, write 8-12 concrete
candidates, and run the existing code-owned filter. Apply its bounded
correction and replenishment rules. Stop with failure if fewer than five
eligible candidates remain.

The legacy recheck queue is dormant. Do not create or add recheck candidates.

## 2. Primary Verifier

Create one fresh-context subagent and give it every final
`eligibleCandidates` entry. Do not give it recommendation instructions or
preference signals.

For every candidate it must use first-party evidence to return the fields in
`$defs.evidence` from:

```text
schemas/skill-radar-verification-v2.schema.json
```

It must verify exact artifact identity, current source, exact `SKILL.md` or
equivalent instruction file, repository status, license, capability,
usability, portability, maintenance evidence, dependencies, and the main trust
caveat. File existence alone does not establish current maintenance.

`repositoryStatus` describes the repository hosting `currentUrl` when one is
selected; otherwise it describes the original candidate repository.

If required fields are missing or use unsupported enum values, send one
bounded contract-repair message to the same subagent. Do not fill evidence in
the parent context.

## 3. Specialist Verification, Adjudication, And Candidate Repair

Specialist verification is mandatory when the primary result:

- is `migrated`;
- records `identityChanged: true`; or
- reports a repository status other than `current`.

Create one second fresh-context subagent for all such candidates. Give it only
the original candidate records and verification goals, not the primary
conclusions. Allow one bounded contract repair.

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
- `ambiguous`, `invalid`, and `inconclusive` candidates must also be removed.
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
filter. Any corrected identity must also be rerun through the filter. Use the
existing maximum of three filter passes and twenty total candidates. Verify
newly eligible replacements through the same process. Stop with failure if
fewer than five fully verified candidates remain.

## 4. Evidence Artifact

Write:

```text
reports/shadow/state/skill-radar-verification-evidence.json
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
unattempted.

Run:

```text
node tools/quality/validate-verification-harness-v2.mjs --evidence reports/shadow/state/skill-radar-verification-evidence.json --candidates reports/shadow/state/skill-radar-candidates-filtered.json
```

Do not proceed unless validation passes.

## 5. Main-Model Decisions

The parent now acts as the quality editor. Do not browse sources again. Use
only the validated evidence artifact, the final filtered candidate file, and
shadow preference signals.

For every eligible candidate choose:

- `recommend`: evidence shows a concrete reusable artifact, clear value,
  practical usability or adaptation, and no unresolved major trust concern;
- `defer`: the source is valid but product value, portability, maintenance,
  license, permissions, or dependencies remain uncertain;
- `reject`: the source is valid but the artifact is not sufficiently
  skill-like, is misleading, or has disproportionate trust cost.

Source identity ambiguity is not a `defer` or `reject`; it must already have
been removed before this stage.

Complete all `recommend`, `defer`, and `reject` decisions before writing public
copy. The bilingual `summary` and `conclusion` may describe only capabilities,
themes, and cautions represented by final `recommend` decisions. Do not mention
or imply an item or capability that appears only in `defer` or `reject`,
because readers cannot see those decisions in the report. When there are no
recommendations, write a concise `no_update` message without previewing
deferred candidates.

Write the normal curated v3 shadow draft described in sections 4-5 of
`prompts/skill-radar-source-portfolio-test.md`. Add this internal field to
every decision:

```json
{
  "verification": {
    "candidateId": "src_00000000",
    "verdict": "verified_current",
    "currentUrl": "https://..."
  }
}
```

The values must come from the matching reconciled evidence.

Validate the link from evidence to decisions:

```text
node tools/quality/validate-verification-harness-v2.mjs --evidence reports/shadow/state/skill-radar-verification-evidence.json --candidates reports/shadow/state/skill-radar-candidates-filtered.json --draft reports/shadow/state/skill-radar-source-portfolio-draft.json
```

Then finalize with:

```text
node tools/quality/report-quality.mjs finalize-curated --shadow --input reports/shadow/state/skill-radar-source-portfolio-draft.json --candidates reports/shadow/state/skill-radar-candidates-filtered.json --verification-evidence reports/shadow/state/skill-radar-verification-evidence.json
```

If this Harness-aware finalizer fails, it writes
`reports/shadow/state/skill-radar-finalization-recovery.json` and a
`QUALITY_ERROR_JSON` line. Follow the bounded recovery protocol in section 7
of `prompts/skill-radar-local.md`, substituting the shadow paths above. Use at
most two repair rounds and include `--shadow`, `--recovery-round`, and
`--recovery-stage` on each retry. This overrides the older source-portfolio
prompt's generic three-retry finalization instruction. Do not hand-write
Markdown.

## 6. Finish

Report:

- candidate, eligible, and decision counts;
- primary, specialist, and adjudicator completion and retry counts;
- number of recovered, migrated, and specialist-reviewed candidates;
- number of disputes, adjudicator resolutions, unresolved removals, and each
  removal's reason or disagreement fields;
- recommend/defer/reject counts;
- evidence, Sidecar, and Markdown paths;
- production files changed: no;
- forwarding: disabled.
