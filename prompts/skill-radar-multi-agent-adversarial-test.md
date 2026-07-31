# Personal Radar Multi-Agent Adversarial Verification Test

Run a deliberately adversarial shadow test of the proposed verifier/main-agent
division. This is not a production report run.

## Safety Boundary

- Use the current date in `Asia/Shanghai`.
- Do not run any production or report-generation prompt.
- Do not call the forwarder, Worker, PushPlus, or any ingest endpoint.
- Do not read automation memory, prior reports, incident history, feedback,
  review state, recheck state, or previous test output.
- Do not modify any Git-tracked file.
- The only allowed write is:

```text
reports/shadow/multi-agent-adversarial-test-YYYY-MM-DD.json
```

Record the Git working-tree status before and after the test. Existing changes
are allowed but must remain unchanged.

Read only these local test-contract files:

```text
test-support/multi-agent-verifier-cases.json
schemas/multi-agent-verifier-test-v1.schema.json
tools/quality/validate-multi-agent-shadow.mjs
```

## Roles

### Primary verifier subagent

Inspect the callable tools and create one fresh-context subagent. Give it every
fixture case, including its URL and verification goal, but do not give it the
expected verdict fields.

The primary verifier must:

- use first-party repository evidence;
- check the exact artifact rather than only the repository root;
- distinguish file existence from current maintenance;
- follow explicit deprecation or migration guidance;
- avoid inventing a successor based only on similar names;
- return one evidence object per case using the schema's `evidenceResult`
  fields.

`repositoryStatus` has one fixed meaning:

- when `currentUrl` is non-null, it describes the repository that hosts
  `currentUrl`;
- when no current artifact is selected, it describes the original canonical
  repository from the fixture;
- deprecation of an old repository during a successful migration belongs in
  `evidence`, while `repositoryStatus` is `current` for the maintained
  successor repository.

The primary verifier does not choose `recommend`, `defer`, or `reject`.

Artifact continuity has a strict meaning:

- use `recovered_current` with `identityChanged: false` when the canonical
  repository, slug or name, and material purpose remain the same and
  first-party path history supports continuity;
- a category-folder, directory, deep-link, or `SKILL.md` locator correction is
  not a migration;
- use `identityChanged: true` only for an evidenced successor, replacement, or
  material identity/scope change. A 404 or guessed path alone is insufficient.

If its response is missing a case or required field, send one bounded repair
message to the same subagent listing only the contract errors. Do not research
or fill missing evidence in the parent context. Record `retryCount` as `0` or
`1`. If the repaired response is still incomplete, write a structurally valid
failed result where possible, report the failure, and stop without pretending
the test passed.

### Specialist verifier subagent

Create a second independent fresh-context subagent for only the fixture cases
where `requiresSpecialist` is true. Give it the original case packet, not the
primary verifier's conclusions and not the expected verdicts.

It must independently investigate migration, replacement identity, scope
changes, and ambiguity. Allow one bounded contract-repair message under the
same rule. It also does not make recommendation decisions.

### Parent

The parent must not independently browse or repair source evidence. It may only:

- check that returned URLs use HTTPS;
- reconcile the two verifier outputs;
- route the reconciled result.

For specialist cases:

- compare verdict, normalized current URL, normalized artifact path, repository
  status, and identity-change fields;
- normalize URLs by removing trailing slashes and normalize artifact paths by
  removing leading/trailing slashes and a trailing `/SKILL.md`;
- do not treat cosmetic title wording as a material identity disagreement when
  both verifiers agree on the normalized current URL and artifact path;
- set `disagreement: true` when any normalized identity field differs;
- unresolved disagreement must become `ambiguous`;
- otherwise preserve the independently agreed evidence.

For other cases, copy the primary evidence into `reconciled` and set
`disagreement: false`.

Route each reconciled result:

- `verified_current`, `recovered_current`, or `migrated`:
  `evaluate_current`, using the reconciled current URL;
- `ambiguous`: `defer_ambiguous`, with no decision source URL;
- `invalid` or `inconclusive`: `reject_invalid`, with no decision source URL.

For `ambiguous`, `invalid`, and `inconclusive`, the reconciled `currentTitle`,
`currentUrl`, and `artifactPath` must be `null`. URLs that prove why a container
is invalid belong in `evidence`, not in the current-artifact fields.

This test stops at routing. Do not turn the eligible cases into a report.

## Output And Validation

Write the result using the version 1 schema. The top-level shape is:

```json
{
  "version": 1,
  "testDate": "YYYY-MM-DD",
  "testType": "multi-agent-adversarial-verification",
  "primaryVerifier": {
    "attempted": true,
    "available": true,
    "completed": true,
    "freshContextRequested": true,
    "retryCount": 0,
    "notes": []
  },
  "specialistVerifier": {
    "attempted": true,
    "available": true,
    "completed": true,
    "freshContextRequested": true,
    "retryCount": 0,
    "notes": []
  },
  "cases": [],
  "safety": {
    "productionFilesChanged": false,
    "trackedFilesChangedByTest": false,
    "workerCalled": false,
    "forwarderCalled": false
  }
}
```

Each case must contain:

```text
id, title, primary, specialist, reconciled, parent
```

Use `specialist: null` when the fixture does not require a specialist. Every
evidence object must follow `$defs.evidenceResult` in the schema. The
`reconciled` object also includes `disagreement`.

Run:

```text
node tools/quality/validate-multi-agent-shadow.mjs --result <output-path>
```

The validator intentionally checks the expected adversarial outcomes, use of
the maintained source, mandatory specialist coverage, disagreement handling,
parent routing, and safety fields. Do not edit the fixture, schema, or validator
to make a failing run pass.

If validation fails because a subagent omitted contract fields and that
subagent has not used its one repair attempt, request the bounded repair,
rewrite the result, and validate once more. Evidence disagreement, changed
external facts, or an unexpected substantive verdict is not a formatting
error: preserve it and report the failed assertion rather than forcing the
expected answer.

Finish by reporting only:

- whether both subagents were available and completed;
- whether either required a repair attempt;
- the reconciled verdict for every fixture case;
- whether the validator passed;
- the output file path;
- whether any protected or tracked file changed.
