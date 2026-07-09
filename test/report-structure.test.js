import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  calculateBaseScore,
  calculatePreferenceAdjustment,
  canonicalizeUrl,
  enrichStructuredReport,
  stableSourceId,
  validateStructuredSemantics,
} from "../src/report-structure.js";

test("canonicalizes GitHub repository URLs", () => {
  assert.equal(
    canonicalizeUrl("https://github.com/OpenAI/skills/tree/main/example?tab=readme#top"),
    "https://github.com/openai/skills",
  );
  assert.equal(
    canonicalizeUrl("https://github.com/OpenAI/skills.git"),
    "https://github.com/openai/skills",
  );
});

test("rejects non-HTTPS sources", () => {
  assert.throws(() => canonicalizeUrl("http://example.com/skill"), /Only HTTPS/);
});

test("calculates the weighted base score", () => {
  assert.equal(calculateBaseScore({
    relevance: 5,
    reusability: 4,
    maintenanceEvidence: 3,
    novelty: 4,
    adaptationFeasibility: 5,
    trustSafety: 4,
  }), 85);
});

test("preference adjustment is category-based and clamped", () => {
  const feedback = Array.from({ length: 10 }, (_, index) => ({
    category: "browser",
    rating: index < 8 ? "interested" : "not_interested",
  }));
  assert.equal(calculatePreferenceAdjustment({ category: "browser" }, feedback), 5);
  assert.equal(calculatePreferenceAdjustment({ category: "documents" }, feedback), 0);
});

test("enriches computed fields deterministically", () => {
  const report = enrichStructuredReport(reportFixture());
  const item = report.items[0];
  assert.equal(item.id, stableSourceId("https://github.com/openai/skills"));
  assert.equal(item.canonicalUrl, "https://github.com/openai/skills");
  assert.equal(item.rank, 1);
  assert.equal(report.stats.selectedCount, 1);
  assert.equal(report.stats.xDiscovery.searched, true);
  assert.equal(item.quality.finalRankScore, item.quality.baseScore);
});

test("accepts a valid published report", () => {
  const report = enrichStructuredReport(reportFixture());
  const errors = validateStructuredSemantics(report);
  assert.deepEqual(errors, []);
});

test("accepts a valid no-update report", () => {
  const report = enrichStructuredReport({
    ...reportFixture(),
    status: "no_update",
    items: [],
  });
  const errors = validateStructuredSemantics(report);
  assert.deepEqual(errors, []);
});

test("rejects a repeated source without material change", () => {
  const report = enrichStructuredReport(reportFixture());
  const errors = validateStructuredSemantics(report, {
    recentSources: [{
      canonicalUrl: "https://github.com/openai/skills",
      dates: ["2026-07-01"],
    }],
  });
  assert.match(errors.join("\n"), /appeared within 30 days/);
});

test("allows a repeated source with material-change evidence", () => {
  const fixture = reportFixture();
  fixture.items[0].quality.history = {
    seenWithin30Days: true,
    previousDates: ["2026-07-01"],
    materialChange: true,
    changeEvidence: "Release 2.0 added a new audited workflow.",
  };
  const report = enrichStructuredReport(fixture);
  const errors = validateStructuredSemantics(report, {
    recentSources: [{
      canonicalUrl: "https://github.com/openai/skills",
      dates: ["2026-07-01"],
    }],
  });
  assert.deepEqual(errors, []);
});

test("rejects reports below the quality threshold", () => {
  const fixture = reportFixture();
  fixture.items[0].quality.dimensions = {
    relevance: 2,
    reusability: 2,
    maintenanceEvidence: 2,
    novelty: 2,
    adaptationFeasibility: 2,
    trustSafety: 2,
  };
  const report = enrichStructuredReport(fixture);
  assert.match(validateStructuredSemantics(report).join("\n"), /base score is below 70/);
});

test("tracked example satisfies the JSON Schema and semantic rules", async () => {
  const schema = JSON.parse(await fs.readFile(new URL("../schemas/skill-radar-report.schema.json", import.meta.url), "utf8"));
  const example = JSON.parse(await fs.readFile(new URL("../schemas/examples/skill-radar-report.example.json", import.meta.url), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(example), true, JSON.stringify(validate.errors));
  assert.deepEqual(validateStructuredSemantics(example), []);
});

function reportFixture() {
  return {
    schemaVersion: 1,
    status: "published",
    channel: "skill-radar",
    reportDate: "2026-07-06",
    summary: {
      zh: "今日重点关注可验证的技能工作流。",
      en: "Today focuses on verifiable skill workflows.",
    },
    conclusion: {
      zh: "优先审计后再安装。",
      en: "Audit before installation.",
    },
    stats: {
      reviewedCount: 8,
      selectedCount: 1,
      duplicateCount: 1,
      rejectedCount: 6,
      sourceCounts: { github: 8 },
      xDiscovery: {
        searched: true,
        candidateCount: 0,
        verifiedCount: 0,
        selectedCount: 0,
        rejectedCount: 0,
        deferredCount: 0,
      },
    },
    items: [{
      id: "placeholder",
      rank: 1,
      title: "openai/skills",
      category: "coding workflow",
      sourceUrl: "https://github.com/OpenAI/skills/tree/main/example",
      canonicalUrl: "https://github.com/openai/skills",
      recommendation: "adapt",
      discovery: {
        type: "github",
        url: "https://github.com/OpenAI/skills",
        author: null,
        publishedAt: null,
      },
      display: {
        zh: displayFixture("中文"),
        en: displayFixture("English"),
      },
      quality: {
        dimensions: {
          relevance: 5,
          reusability: 5,
          maintenanceEvidence: 4,
          novelty: 4,
          adaptationFeasibility: 5,
          trustSafety: 4,
        },
        baseScore: 0,
        preferenceAdjustment: 0,
        finalRankScore: 0,
        skillLike: true,
        officialSourceVerified: true,
        sourceCheckedAt: "2026-07-06T00:00:00.000Z",
        license: "MIT",
        history: {
          seenWithin30Days: false,
          previousDates: [],
          materialChange: false,
          changeEvidence: null,
        },
      },
    }],
    socialDecisions: [],
  };
}

function displayFixture(prefix) {
  return {
    oneLiner: `${prefix} one-line value`,
    whyNow: `${prefix} why now`,
    bestFor: `${prefix} best for`,
    action: `${prefix} action`,
    primaryCaution: `${prefix} caution`,
    problem: `${prefix} problem`,
    usability: `${prefix} usability`,
    adaptation: `${prefix} adaptation`,
    trust: `${prefix} trust`,
  };
}
