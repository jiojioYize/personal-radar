import test from "node:test";
import assert from "node:assert/strict";
import { enrichCuratedReport, validateCuratedReport } from "../src/curated-report.js";
import { curatedFixture } from "../test-support/curated-report.js";

test("enriches a five-decision curated report without numeric scoring", () => {
  const report = enrichCuratedReport(curatedFixture());
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.status, "published");
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0].recommendation, "adapt");
  assert.match(report.items[0].artifactKey, /#artifact=skills\/example$/);
  assert.equal("baseScore" in report.items[0].quality, false);
  assert.deepEqual(validateCuratedReport(report), []);
});

test("rejects exact artifact repeats in curated reports", () => {
  const report = enrichCuratedReport(curatedFixture(), {
    recentSources: [{
      artifactKey: "https://github.com/example/skills#artifact=skills/example",
      canonicalUrl: "https://github.com/example/skills",
      dates: ["2026-07-10"],
    }],
  });
  assert.match(validateCuratedReport(report).join("\n"), /repeats an exact artifact/);
});

test("requires five distinct artifacts in curated decisions", () => {
  const fixture = curatedFixture();
  fixture.decisions[4] = structuredClone(fixture.decisions[3]);
  const report = enrichCuratedReport(fixture);
  assert.match(validateCuratedReport(report).join("\n"), /repeats another verified artifact/);
});

test("accepts a replenished candidate pool up to twenty items", () => {
  const fixture = curatedFixture();
  fixture.candidateCount = 20;
  fixture.sourceCounts = { awesomeClaudeSkills: 7, agentPlugins: 7, openAgentSkill: 6 };
  const report = enrichCuratedReport(fixture);
  assert.deepEqual(validateCuratedReport(report), []);
});
