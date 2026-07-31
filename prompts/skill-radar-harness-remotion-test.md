# Skill Radar Targeted Harness Adjudication Test

Run one isolated test of the Harness v2 adjudicator. This is not a report run.

## Safety

- Use the current date in `Asia/Shanghai`.
- Do not read or modify production outbox, history, review state, feedback, or
  delivery state.
- Do not invoke the forwarder, Worker, PushPlus, or ingest endpoint.
- Do not modify Git-tracked files.
- Write only the result below under `reports/shadow/`.

## Input

Read:

```text
test-support/remotion-harness-dispute.json
schemas/harness-adjudication-test-v1.schema.json
```

The input contains one original candidate and two anonymized, conflicting
evidence packets. Do not decide which packet sounds more persuasive.

## Adjudication

Create one fresh-context adjudicator subagent. Give it:

- the original candidate;
- evidence A and evidence B without identifying their roles;
- the two dispute fields and focused questions;
- the requirement to use only current first-party Remotion repository
  evidence.

Ask it to independently determine:

- the exact current canonical directory URL;
- the exact repository-relative artifact path;
- whether the source repository changed;
- whether the Skill identity or material purpose changed;
- whether the exact current `SKILL.md` was verified.

It must return the `adjudication` fields from
`schemas/harness-adjudication-test-v1.schema.json`. Allow one bounded repair
message only for missing or malformed contract fields. Do not run another
substantive adjudication and do not research or fill evidence in the parent
context.

The parent routes an eligible current result to `evaluate_current` using the
adjudicated URL. An unresolved result uses `remove_unresolved` and a null URL.

## Output

Write UTF-8 JSON:

```text
reports/shadow/harness-remotion-adjudication-YYYY-MM-DD.json
```

using this top-level shape:

```json
{
  "version": 1,
  "testDate": "YYYY-MM-DD",
  "testType": "targeted-harness-adjudication",
  "adjudicator": {},
  "case": {
    "id": "remotion-repository-migration-path",
    "title": "Remotion Best Practices",
    "adjudication": {},
    "parent": {
      "disposition": "evaluate_current",
      "decisionSourceUrl": "https://...",
      "reason": "..."
    }
  },
  "safety": {
    "productionFilesChanged": false,
    "workerCalled": false,
    "forwarderCalled": false
  }
}
```

Run:

```text
node tools/quality/validate-harness-adjudication.mjs --result reports/shadow/harness-remotion-adjudication-YYYY-MM-DD.json
```

Finish by reporting the adjudicator availability, repair count, verdict,
current URL, source-repository-change value, identity-change value, validator
result, output path, and production impact.
