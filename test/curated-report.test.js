import test from "node:test";
import assert from "node:assert/strict";
import { enrichCuratedReport, validateCuratedReport } from "../src/curated-report.js";
import { curatedFixture } from "../test-support/curated-report.js";

test("enriches all curated decisions without numeric scoring or action labels", () => {
  const report = enrichCuratedReport(curatedFixture());
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.status, "published");
  assert.equal(report.items.length, 1);
  assert.equal(report.stats.reviewedCount, 8);
  assert.equal(report.stats.deferredCount, 2);
  assert.equal("recommendation" in report.items[0], false);
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

test("requires distinct artifacts in curated decisions", () => {
  const fixture = curatedFixture();
  fixture.decisions[7] = structuredClone(fixture.decisions[6]);
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

test("publishes every recommended decision", () => {
  const fixture = curatedFixture();
  fixture.decisions[1].decision = "recommend";
  fixture.decisions[1].display = structuredClone(fixture.decisions[0].display);
  const report = enrichCuratedReport(fixture);
  assert.equal(report.items.length, 2);
  assert.deepEqual(validateCuratedReport(report), []);
});

test("validates the isolated source portfolio lanes without changing legacy requirements", () => {
  const fixture = curatedFixture();
  fixture.sourceCounts = { registryPulse: 3, officialRotation: 3, communityTrend: 2 };
  const report = enrichCuratedReport(fixture);
  assert.match(validateCuratedReport(report, { sourceProfile: "portfolio-v1" }).join("\n"), /sourceContext is incomplete/);
  assert.match(validateCuratedReport(report, { sourceProfile: "legacy-v3" }).join("\n"), /sourceCounts\.awesomeClaudeSkills/);
});

test("rejects internal pipeline language in public report copy", () => {
  const fixture = curatedFixture();
  fixture.summary.zh = "本期从三个固定目录筛选并逐项核验候选。";
  fixture.summary.en = "This edition verifies candidates from three required directories.";
  fixture.conclusion.zh = "其余条目因证据不足暂缓。";
  fixture.decisions[0].display.zh.oneLiner = "读取 Sidecar 中的 sourceCounts。";
  const errors = validateCuratedReport(enrichCuratedReport(fixture)).join("\n");
  assert.match(errors, /summary\.zh must use reader-facing language/);
  assert.match(errors, /summary\.en must use reader-facing language/);
  assert.match(errors, /conclusion\.zh must use reader-facing language/);
  assert.match(errors, /display\.zh\.oneLiner must use reader-facing language/);
});
