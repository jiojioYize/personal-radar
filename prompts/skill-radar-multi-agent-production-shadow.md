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
schemas/skill-radar-verification-v1.schema.json
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

## 3. Specialist Verification And Candidate Repair

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
repository status, and identity-change fields are material identity fields.

- If both verifiers agree on material identity, use the agreed evidence.
- If they disagree, mark the candidate unresolved and remove it.
- `ambiguous`, `invalid`, and `inconclusive` candidates must also be removed.
- For `recovered_current` or agreed `migrated`, update title, `sourceUrl`, and
  `artifactPath` to the current artifact.

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

using `schemas/skill-radar-verification-v1.schema.json`. Include exactly one
result for every final eligible candidate. `originalSourceUrl` records the URL
first given to the verifier; `artifactKey` and `candidateId` must match the
final filtered candidate. Set `specialistRequired` from the rules above.

Run:

```text
node tools/quality/validate-verification-evidence.mjs --evidence reports/shadow/state/skill-radar-verification-evidence.json --candidates reports/shadow/state/skill-radar-candidates-filtered.json
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
node tools/quality/validate-verification-evidence.mjs --evidence reports/shadow/state/skill-radar-verification-evidence.json --candidates reports/shadow/state/skill-radar-candidates-filtered.json --draft reports/shadow/state/skill-radar-source-portfolio-draft.json
```

Then finalize with the existing shadow command. Do not hand-write Markdown.

## 6. Finish

Report:

- candidate, eligible, and decision counts;
- primary and specialist completion and retry counts;
- number of recovered, migrated, and specialist-reviewed candidates;
- recommend/defer/reject counts;
- evidence, Sidecar, and Markdown paths;
- production files changed: no;
- forwarding: disabled.
