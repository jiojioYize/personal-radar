import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { curatedFixture } from "../test-support/curated-report.js";
import { enrichCuratedReport } from "../src/curated-report.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("feedback replay reorders recommendations without changing the selected set", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "personal-radar-replay-"));
  const report = curatedFixture();
  report.decisions[1].decision = "recommend";
  report.decisions[1].display = structuredClone(report.decisions[0].display);
  const sidecar = enrichCuratedReport(report);
  const reportPath = path.join(root, "source-report.json");
  const scenarioPath = path.join(root, "scenario.json");
  const outputPath = path.join(root, "experiment");
  await fs.writeFile(reportPath, JSON.stringify(sidecar), "utf8");
  await fs.writeFile(scenarioPath, JSON.stringify({
    name: "coding-interest",
    description: "An explicit interest should move a related item forward.",
    signals: [{
      id: "fb_example_interest",
      rating: "interested",
      title: "Earlier related workflow",
      category: "coding workflow",
    }],
    matches: [{
      artifactKey: sidecar.decisions[1].artifactKey,
      effect: "boosted",
      matchedFeedbackIds: ["fb_example_interest"],
      rationale: "This item directly matches the earlier coding-workflow interest.",
    }],
  }), "utf8");

  const run = await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "feedback-replay", "--report", reportPath, "--scenario", scenarioPath, "--output", outputPath,
    ],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  assert.match(run.stdout, /Completed feedback replay/);
  const result = JSON.parse(await fs.readFile(path.join(outputPath, "result.json"), "utf8"));
  assert.deepEqual(result.baselineOrder, ["Example Skill", "Defer One"]);
  assert.deepEqual(result.personalizedOrder, ["Defer One", "Example Skill"]);
  assert.equal(result.guardrails.selectedSetUnchanged, true);
  assert.equal(result.guardrails.unrelatedItemsRemainNeutral, true);
  assert.match(await fs.readFile(path.join(outputPath, "result.md"), "utf8"), /Order comparison/);

  const invalidScenario = JSON.parse(await fs.readFile(scenarioPath, "utf8"));
  invalidScenario.matches[0].matchedFeedbackIds = ["fb_invented"];
  await fs.writeFile(scenarioPath, JSON.stringify(invalidScenario), "utf8");
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
        "feedback-replay", "--report", reportPath, "--scenario", scenarioPath, "--output", outputPath,
      ],
      { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
    ),
    /unknown feedback/,
  );

  await fs.rm(root, { recursive: true, force: true });
});

test("quality CLI finalizes a draft into a validated Sidecar and Markdown pair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "personal-radar-quality-"));
  await fs.mkdir(path.join(root, "schemas"), { recursive: true });
  await fs.mkdir(path.join(root, "reports", "state"), { recursive: true });
  await fs.copyFile(
    path.join(projectRoot, "schemas", "skill-radar-report.schema.json"),
    path.join(root, "schemas", "skill-radar-report.schema.json"),
  );

  const example = JSON.parse(await fs.readFile(
    path.join(projectRoot, "schemas", "examples", "skill-radar-report.example.json"),
    "utf8",
  ));
  example.reportDate = "2099-01-02";
  example.items[0].sourceUrl = "https://github.com/example/stage-two-test";
  example.items[0].canonicalUrl = example.items[0].sourceUrl;
  example.items[0].title = "Stage Two First";
  const secondItem = structuredClone(example.items[0]);
  secondItem.title = "Stage Two Second";
  secondItem.sourceUrl = "https://github.com/example/stage-two-second";
  secondItem.canonicalUrl = secondItem.sourceUrl;
  example.items.push(secondItem);
  example.summary.zh = "摘要先提到 Stage Two Second，再介绍 Stage Two First。";
  example.summary.en = "The summary mentions Stage Two Second before Stage Two First.";
  const draftPath = path.join(root, "reports", "state", "skill-radar-draft.json");
  await fs.writeFile(draftPath, `${JSON.stringify(example, null, 2)}\n`, "utf8");

  const result = await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "finalize",
      "--input",
      "reports/state/skill-radar-draft.json",
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, PERSONAL_RADAR_ROOT: root },
    },
  );

  assert.match(result.stdout, /Finalized structured report/);

  const retry = await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "finalize",
      "--input",
      "reports/state/skill-radar-draft.json",
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, PERSONAL_RADAR_ROOT: root },
    },
  );
  assert.match(retry.stdout, /Finalized structured report/);

  const sidecarPath = path.join(root, "reports", "outbox", "skill-radar-2099-01-02.quality.json");
  const markdownPath = path.join(root, "reports", "outbox", "skill-radar-2099-01-02.md");
  const sidecar = JSON.parse(await fs.readFile(sidecarPath, "utf8"));
  const markdown = await fs.readFile(markdownPath, "utf8");
  assert.equal(sidecar.items[0].canonicalUrl, "https://github.com/example/stage-two-test");
  assert.match(markdown, /<!-- zh -->/);
  assert.match(markdown, /<!-- en -->/);
  assert.match(markdown, /https:\/\/github.com\/example\/stage-two-test/);

  const summary = await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "summary",
      "--date",
      "2099-01-02",
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, PERSONAL_RADAR_ROOT: root },
    },
  );
  assert.match(summary.stdout, /Wrote quality summary/);
  const summaryText = await fs.readFile(
    path.join(root, "reports", "quality", "skill-radar-summary.md"),
    "utf8",
  );
  assert.match(summaryText, /Candidate source mix:/);
  assert.match(summaryText, /X discovery:/);
  assert.match(summaryText, /Preference effects:/);
  assert.match(summaryText, /Feedback signals referenced by later decisions:/);

  const feedbackResult = await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "feedback",
      "--url",
      "https://github.com/example/stage-two-test",
      "--rating",
      "interested",
      "--category",
      "browser automation",
      "--title",
      "Stage Two First",
      "--note",
      "Track more items like this.",
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, PERSONAL_RADAR_ROOT: root },
    },
  );
  assert.match(feedbackResult.stdout, /Recorded feedback/);
  const feedback = JSON.parse(await fs.readFile(
    path.join(root, "reports", "feedback", "skill-radar.json"),
    "utf8",
  ));
  assert.equal(feedback.entries[0].rating, "interested");
  assert.equal(feedback.version, 2);
  assert.equal(feedback.entries[0].title, "Stage Two First");
  assert.equal(feedback.entries[0].artifactKey, "https://github.com/example/stage-two-test");
  assert.equal("outcome" in feedback.entries[0], false);

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
        "feedback",
        "--url",
        "https://github.com/example/stage-two-test",
        "--rating",
        "useful",
      ],
      {
        cwd: projectRoot,
        env: { ...process.env, PERSONAL_RADAR_ROOT: root },
      },
    ),
    /rating must be interested or not_interested/,
  );

  example.reportDate = "2099-01-03";
  example.items[0].sourceUrl = "https://github.com/example/stage-two-shadow";
  example.items[0].canonicalUrl = example.items[0].sourceUrl;
  example.items[1].sourceUrl = "https://github.com/example/stage-two-shadow-second";
  example.items[1].canonicalUrl = example.items[1].sourceUrl;
  const shadowDraftPath = path.join(root, "reports", "shadow", "state", "skill-radar-draft.json");
  await fs.mkdir(path.dirname(shadowDraftPath), { recursive: true });
  await fs.writeFile(shadowDraftPath, `${JSON.stringify(example, null, 2)}\n`, "utf8");

  const shadowPrepare = await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "prepare",
      "--date",
      "2099-01-03",
      "--shadow",
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, PERSONAL_RADAR_ROOT: root },
    },
  );
  assert.match(shadowPrepare.stdout, /Prepared shadow quality context/);
  const shadowContext = JSON.parse(await fs.readFile(
    path.join(root, "reports", "shadow", "state", "skill-radar-context.json"),
    "utf8",
  ));
  assert.equal(shadowContext.preferenceSummary.policy, "positive-interest-primary");
  assert.equal(shadowContext.preferenceSummary.interestedCount, 1);
  assert.equal(shadowContext.preferenceSummary.notInterestedCount, 0);
  assert.equal(shadowContext.preferenceSummary.unratedMeans, "unknown");
  assert.equal(shadowContext.preferenceSummary.signals[0].title, "Stage Two First");

  const shadowFinalize = await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "finalize",
      "--shadow",
      "--input",
      "reports/shadow/state/skill-radar-draft.json",
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, PERSONAL_RADAR_ROOT: root },
    },
  );
  assert.match(shadowFinalize.stdout, /Finalized shadow structured report/);
  await fs.access(path.join(
    root,
    "reports",
    "shadow",
    "outbox",
    "skill-radar-2099-01-03.quality.json",
  ));
  await assert.rejects(
    fs.access(path.join(root, "reports", "outbox", "skill-radar-2099-01-03.md")),
  );

  if (process.platform === "win32") {
    const forwarder = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(projectRoot, "tools", "codex-forwarder", "forward-codex-report.ps1"),
        "-ReportPath",
        markdownPath,
        "-LogPath",
        path.join(root, "forwarder.log"),
        "-StatePath",
        path.join(root, "forwarder-state.json"),
        "-ValidateOnly",
      ],
      { cwd: projectRoot },
    );
    assert.match(forwarder.stdout, /Validated Stage 2 report pair/);

    const v3Sidecar = structuredClone(sidecar);
    v3Sidecar.schemaVersion = 3;
    while (v3Sidecar.items.length < 7) {
      const item = structuredClone(v3Sidecar.items[0]);
      const ordinal = v3Sidecar.items.length + 1;
      item.title = `Stage Two V3 Item ${ordinal}`;
      item.sourceUrl = `https://github.com/example/stage-two-v3-${ordinal}`;
      item.canonicalUrl = item.sourceUrl;
      v3Sidecar.items.push(item);
    }
    v3Sidecar.stats.selectedCount = v3Sidecar.items.length;
    const extraMarkdown = v3Sidecar.items.slice(2).map((item, index) =>
      `\n## ${index + 3}. ${item.title}\n\nSource: ${item.sourceUrl}\n`
    ).join("");
    await fs.writeFile(sidecarPath, JSON.stringify(v3Sidecar), "utf8");
    await fs.writeFile(markdownPath, `${markdown}${extraMarkdown}`, "utf8");
    const v3Forwarder = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(projectRoot, "tools", "codex-forwarder", "forward-codex-report.ps1"),
        "-ReportPath",
        markdownPath,
        "-LogPath",
        path.join(root, "forwarder-v3.log"),
        "-StatePath",
        path.join(root, "forwarder-v3-state.json"),
        "-ValidateOnly",
      ],
      { cwd: projectRoot },
    );
    assert.match(v3Forwarder.stdout, /Items=7/);

    v3Sidecar.schemaVersion = 2;
    await fs.writeFile(sidecarPath, JSON.stringify(v3Sidecar), "utf8");
    await assert.rejects(
      execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(projectRoot, "tools", "codex-forwarder", "forward-codex-report.ps1"),
          "-ReportPath",
          markdownPath,
          "-LogPath",
          path.join(root, "forwarder-v2-limit.log"),
          "-StatePath",
          path.join(root, "forwarder-v2-limit-state.json"),
          "-ValidateOnly",
        ],
        { cwd: projectRoot },
      ),
      /schema v2 reports must contain 1-6 items/,
    );
  }

  await fs.rm(root, { recursive: true, force: true });
});

test("history v2 archives legacy repository records and filters exact artifacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "personal-radar-history-v2-"));
  const stateDir = path.join(root, "reports", "state");
  const outboxDir = path.join(root, "reports", "outbox");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(outboxDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "skill-radar-history.json"), JSON.stringify({
    version: 1,
    channel: "skill-radar",
    asOf: "2099-01-02",
    windowDays: 30,
    sources: [{
      canonicalUrl: "https://github.com/example/collection",
      artifactKey: "https://github.com/example/collection",
      dates: ["2099-01-01"],
    }],
  }), "utf8");
  await fs.writeFile(path.join(outboxDir, "skill-radar-2099-01-02.quality.json"), JSON.stringify({
    reportDate: "2099-01-02",
    items: [{
      title: "PDF Skill",
      category: "documents",
      sourceUrl: "https://github.com/example/collection/tree/main/skills/pdf",
      canonicalUrl: "https://github.com/example/collection",
      artifactKey: "https://github.com/example/collection#artifact=skills/pdf",
    }],
  }), "utf8");

  const prepare = await execFileAsync(
    process.execPath,
    [path.join(projectRoot, "tools", "quality", "report-quality.mjs"), "prepare", "--date", "2099-01-03"],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  assert.match(prepare.stdout, /Archived legacy repository history/);
  const history = JSON.parse(await fs.readFile(path.join(stateDir, "skill-radar-history.json"), "utf8"));
  assert.equal(history.version, 2);
  assert.equal(history.identity, "exact-artifact");
  assert.equal(history.sources.length, 1);
  assert.equal(history.sources[0].artifactKey, "https://github.com/example/collection#artifact=skills/pdf");
  await fs.access(path.join(stateDir, "skill-radar-history-v1-archive.json"));

  const candidatesPath = path.join(stateDir, "candidate-test.json");
  await fs.writeFile(candidatesPath, JSON.stringify({
    asOf: "2099-01-03",
    candidates: [
      {
        title: "PDF Skill",
        sourceUrl: "https://github.com/example/collection/tree/main/skills/pdf",
        artifactScope: "general_skill_collection",
        artifactPath: "skills/pdf",
        discoveryType: "agentPlugins",
        discoveryUrl: "https://github.com/dmgrok/agent-plugins",
      },
      {
        title: "DOCX Skill",
        sourceUrl: "https://github.com/example/collection/tree/main/skills/docx",
        artifactScope: "general_skill_collection",
        artifactPath: "skills/docx",
        discoveryType: "awesomeClaudeSkills",
        discoveryUrl: "https://awesomeclaudeskills.com/example",
      },
      {
        title: "DOCX Skill duplicate listing",
        sourceUrl: "https://github.com/example/collection/tree/main/skills/docx",
        artifactScope: "general_skill_collection",
        artifactPath: "skills/docx",
        discoveryType: "openAgentSkill",
        discoveryUrl: "https://www.openagentskill.com/skills/example-docx",
      },
    ],
  }), "utf8");
  await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "filter-candidates",
      "--input",
      "reports/state/candidate-test.json",
      "--date",
      "2099-01-03",
    ],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  const filtered = JSON.parse(await fs.readFile(
    path.join(stateDir, "skill-radar-candidates-filtered.json"),
    "utf8",
  ));
  assert.equal(filtered.version, 2);
  assert.equal(filtered.minimumEligibleCandidates, 5);
  assert.equal(filtered.needsReplenishment, true);
  assert.equal(filtered.excludedCandidates.length, 2);
  assert.equal(filtered.excludedCandidates[0].history.exclusionReason, "exact-artifact-within-30-days");
  assert.equal(filtered.excludedCandidates[1].history.exclusionReason, "duplicate-in-candidate-pool");
  assert.equal(filtered.eligibleCandidates.length, 1);
  assert.match(filtered.eligibleCandidates[0].artifactKey, /#artifact=skills\/docx$/);
  assert.equal(filtered.eligibleCandidates[0].discoveryUrl, "https://awesomeclaudeskills.com/example");

  await fs.rm(root, { recursive: true, force: true });
});

test("quality CLI finalizes a code-filtered curated v3 report", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "personal-radar-curated-v3-"));
  const stateDir = path.join(root, "reports", "state");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(path.join(root, "schemas"), { recursive: true });
  await fs.copyFile(
    path.join(projectRoot, "schemas", "skill-radar-report-v3.schema.json"),
    path.join(root, "schemas", "skill-radar-report-v3.schema.json"),
  );

  const draft = curatedFixture();
  draft.reportDate = "2099-02-01";
  delete draft.candidateCount;
  delete draft.duplicateCount;
  delete draft.sourceCounts;
  const typeMap = {
    "awesome-claude-skills": "awesomeClaudeSkills",
    "agent-plugins": "agentPlugins",
    "open-agent-skill": "openAgentSkill",
  };
  const candidates = draft.decisions.map((decision) => ({
    title: decision.title,
    sourceUrl: decision.sourceUrl,
    artifactScope: decision.artifactScope,
    artifactPath: decision.artifactPath,
    discoveryType: typeMap[decision.discovery.type],
    discoveryUrl: decision.discovery.url,
  }));
  await fs.writeFile(path.join(stateDir, "curated-candidates.json"), JSON.stringify({
    asOf: draft.reportDate,
    candidates,
  }), "utf8");
  await fs.writeFile(path.join(stateDir, "curated-draft.json"), JSON.stringify(draft), "utf8");
  await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "filter-candidates", "--input", "reports/state/curated-candidates.json", "--date", draft.reportDate,
    ],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  const incompleteDraft = { ...draft, decisions: draft.decisions.slice(0, -1) };
  await fs.writeFile(path.join(stateDir, "curated-incomplete.json"), JSON.stringify(incompleteDraft), "utf8");
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
        "finalize-curated", "--input", "reports/state/curated-incomplete.json",
        "--candidates", "reports/state/skill-radar-candidates-filtered.json",
      ],
      { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
    ),
    /curated decisions must cover every eligible candidate/,
  );
  const result = await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "finalize-curated", "--input", "reports/state/curated-draft.json",
      "--candidates", "reports/state/skill-radar-candidates-filtered.json",
    ],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  assert.match(result.stdout, /Finalized curated report/);
  const sidecar = JSON.parse(await fs.readFile(
    path.join(root, "reports", "outbox", `skill-radar-${draft.reportDate}.quality.json`),
    "utf8",
  ));
  assert.equal(sidecar.schemaVersion, 3);
  assert.equal(sidecar.stats.candidateCount, 8);
  assert.equal(sidecar.stats.reviewedCount, 8);
  assert.equal(sidecar.items.length, 1);
  assert.equal("recommendation" in sidecar.items[0], false);
  assert.equal("baseScore" in sidecar.items[0].quality, false);
  const reviewState = JSON.parse(await fs.readFile(
    path.join(stateDir, "skill-radar-review-state.json"),
    "utf8",
  ));
  assert.equal(reviewState.entries.filter((entry) => entry.outcome === "defer").length, 2);
  assert.equal(reviewState.entries.filter((entry) => entry.outcome === "reject").length, 5);

  await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "filter-candidates", "--input", "reports/state/curated-candidates.json", "--date", "2099-02-02",
    ],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  const cooled = JSON.parse(await fs.readFile(
    path.join(stateDir, "skill-radar-candidates-filtered.json"),
    "utf8",
  ));
  assert.equal(cooled.eligibleCandidates.length, 0);
  assert.equal(cooled.excludedCandidates.filter((candidate) => candidate.history.exclusionReason.startsWith("defer-until-")).length, 2);
  assert.equal(cooled.excludedCandidates.filter((candidate) => candidate.history.exclusionReason.startsWith("reject-until-")).length, 5);

  await fs.rm(root, { recursive: true, force: true });
});

test("source portfolio mode supports production while keeping shadow state isolated", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "personal-radar-source-portfolio-"));
  const shadowStateDir = path.join(root, "reports", "shadow", "state");
  await fs.mkdir(shadowStateDir, { recursive: true });
  await fs.mkdir(path.join(root, "schemas"), { recursive: true });
  await fs.copyFile(
    path.join(projectRoot, "schemas", "skill-radar-report-v3.schema.json"),
    path.join(root, "schemas", "skill-radar-report-v3.schema.json"),
  );

  const draft = curatedFixture();
  draft.reportDate = "2099-03-01";
  delete draft.candidateCount;
  delete draft.duplicateCount;
  delete draft.sourceCounts;
  const lanes = [
    ["registryPulse", "skillsSh"],
    ["officialRotation", "anthropicSkills"],
    ["communityTrend", "awesomeClaudeSkills"],
    ["registryPulse", "skillsSh"],
    ["officialRotation", "openAiPlugins"],
    ["communityTrend", "openAgentSkill"],
    ["registryPulse", "skillsSh"],
    ["officialRotation", "githubAwesomeCopilot"],
  ];
  const candidates = draft.decisions.map((decision, index) => ({
    title: decision.title,
    sourceUrl: decision.sourceUrl,
    artifactScope: decision.artifactScope,
    artifactPath: decision.artifactPath,
    discoveryType: lanes[index][0],
    sourceId: lanes[index][1],
    discoveryUrl: `https://example.com/discovery/${index}`,
    containerType: "repository",
    containerUrl: decision.sourceUrl,
    artifactType: "skill",
    provenance: index === 1 ? "first_party" : "independent",
    discoverySignals: ["catalog-listing"],
    dependencies: ["none"],
    registryView: lanes[index][0] === "registryPulse" ? "all_time" : null,
  }));
  const candidatesPath = path.join(shadowStateDir, "portfolio-candidates.json");
  await fs.writeFile(candidatesPath, JSON.stringify({ asOf: draft.reportDate, candidates }), "utf8");
  await fs.writeFile(path.join(shadowStateDir, "portfolio-draft.json"), JSON.stringify(draft), "utf8");

  await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "prepare", "--shadow", "--source-portfolio", "--date", draft.reportDate,
    ],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  const plan = JSON.parse(await fs.readFile(path.join(shadowStateDir, "skill-radar-source-plan.json"), "utf8"));
  assert.equal(plan.registryFocus, "all_time");
  assert.deepEqual(plan.officialSources.map((source) => source.id), [
    "anthropicSkills", "openAiPlugins", "githubAwesomeCopilot",
  ]);

  const invalidCandidatesPath = path.join(shadowStateDir, "portfolio-candidates-invalid.json");
  const invalidCandidates = structuredClone(candidates);
  invalidCandidates[0].sourceId = "anthropicSkills";
  await fs.writeFile(invalidCandidatesPath, JSON.stringify({ asOf: draft.reportDate, candidates: invalidCandidates }), "utf8");
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
        "filter-candidates", "--shadow", "--source-portfolio", "--input", invalidCandidatesPath,
      ],
      { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
    ),
    /sourceId is invalid for registryPulse/,
  );

  await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "filter-candidates", "--shadow", "--source-portfolio", "--date", draft.reportDate,
      "--input", candidatesPath,
    ],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  const filteredPath = path.join(shadowStateDir, "skill-radar-candidates-filtered.json");
  const filtered = JSON.parse(await fs.readFile(filteredPath, "utf8"));
  assert.equal(filtered.sourceProfile, "portfolio-v1");
  assert.equal(filtered.eligibleCandidates.length, 8);
  assert.equal(filtered.eligibleCandidates[1].sourceId, "anthropicSkills");

  const shadowEvidence = attachHarnessEvidence(draft, filtered);
  await Promise.all([
    fs.writeFile(path.join(shadowStateDir, "portfolio-draft.json"), JSON.stringify(draft), "utf8"),
    fs.writeFile(
      path.join(shadowStateDir, "skill-radar-verification-evidence.json"),
      JSON.stringify(shadowEvidence),
      "utf8",
    ),
  ]);

  await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "finalize-curated", "--shadow", "--input", path.join(shadowStateDir, "portfolio-draft.json"),
      "--candidates", filteredPath,
    ],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  const sidecar = JSON.parse(await fs.readFile(
    path.join(root, "reports", "shadow", "outbox", `skill-radar-${draft.reportDate}.quality.json`),
    "utf8",
  ));
  assert.deepEqual(sidecar.stats.sourceCounts, {
    registryPulse: 3,
    officialRotation: 3,
    communityTrend: 2,
  });
  assert.equal(sidecar.items[0].discovery.type, "skills-sh");
  assert.deepEqual(sidecar.decisions[0].sourceContext.dependencies, ["none"]);
  assert.equal(sidecar.decisions[0].sourceContext.registryView, "all_time");
  assert.equal(sidecar.decisions[1].sourceContext.provenance, "first_party");
  const rotation = JSON.parse(await fs.readFile(path.join(shadowStateDir, "skill-radar-source-rotation.json"), "utf8"));
  assert.equal(rotation.entries[0].status, "completed");
  await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "prepare", "--shadow", "--source-portfolio", "--date", "2099-03-02",
    ],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  const nextPlan = JSON.parse(await fs.readFile(path.join(shadowStateDir, "skill-radar-source-plan.json"), "utf8"));
  assert.equal(nextPlan.registryFocus, "trending");
  assert.deepEqual(nextPlan.officialSources.map((source) => source.id), [
    "cursorMarketplace", "geminiExtensions", "nvidiaSkills",
  ]);
  assert.deepEqual(await fs.readdir(path.join(root, "reports", "outbox")), []);

  await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "feedback", "--url", draft.decisions[1].sourceUrl,
      "--artifact-key", draft.decisions[1].sourceUrl,
      "--title", draft.decisions[1].title,
      "--category", draft.decisions[1].category,
      "--rating", "interested", "--date", draft.reportDate,
    ],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  const productionFeedback = JSON.parse(await fs.readFile(
    path.join(root, "reports", "feedback", "skill-radar.json"),
    "utf8",
  ));
  const feedbackId = productionFeedback.entries[0].id;

  await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "prepare", "--source-portfolio", "--date", draft.reportDate,
    ],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  const productionStateDir = path.join(root, "reports", "state");
  const productionPlan = JSON.parse(await fs.readFile(
    path.join(productionStateDir, "skill-radar-source-plan.json"),
    "utf8",
  ));
  assert.equal(productionPlan.registryFocus, "all_time");
  assert.deepEqual(productionPlan.officialSources.map((source) => source.id), [
    "anthropicSkills", "openAiPlugins", "githubAwesomeCopilot",
  ]);

  await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "filter-candidates", "--source-portfolio", "--date", draft.reportDate,
      "--input", candidatesPath,
    ],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  const productionFilteredPath = path.join(productionStateDir, "skill-radar-candidates-filtered.json");
  const productionFiltered = JSON.parse(await fs.readFile(productionFilteredPath, "utf8"));
  assert.equal(productionFiltered.sourceProfile, "portfolio-v1");
  assert.equal(productionFiltered.eligibleCandidates.length, 8);

  const productionDraft = structuredClone(draft);
  productionDraft.decisions[1].decision = "recommend";
  productionDraft.decisions[1].display = structuredClone(productionDraft.decisions[0].display);
  for (const decision of productionDraft.decisions) {
    decision.preference = { effect: "neutral", matchedFeedbackIds: [], rationale: null };
  }
  productionDraft.decisions[1].preference = {
    effect: "boosted",
    matchedFeedbackIds: [feedbackId],
    rationale: "Matches the explicit coding-workflow interest.",
  };
  const missingEvidenceDraftPath = path.join(productionStateDir, "portfolio-missing-evidence-draft.json");
  await fs.writeFile(missingEvidenceDraftPath, JSON.stringify(productionDraft), "utf8");
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
        "finalize-curated", "--input", missingEvidenceDraftPath,
        "--candidates", productionFilteredPath,
      ],
      { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
    ),
    /skill-radar-verification-evidence\.json/,
  );
  const initialRecovery = JSON.parse(await fs.readFile(
    path.join(productionStateDir, "skill-radar-finalization-recovery.json"),
    "utf8",
  ));
  assert.equal(initialRecovery.status, "open");
  assert.equal(initialRecovery.maxRepairRounds, 2);
  assert.equal(initialRecovery.initialFailure.code, "HARNESS_EVIDENCE_UNAVAILABLE");
  assert.equal(initialRecovery.initialFailure.retryStage, "deterministic");
  const productionEvidence = attachHarnessEvidence(productionDraft, productionFiltered);
  const productionDraftPath = path.join(productionStateDir, "portfolio-draft.json");
  await Promise.all([
    fs.writeFile(productionDraftPath, JSON.stringify(productionDraft), "utf8"),
    fs.writeFile(
      path.join(productionStateDir, "skill-radar-verification-evidence.json"),
      JSON.stringify(productionEvidence),
      "utf8",
    ),
  ]);
  const invalidPreferenceDraft = structuredClone(productionDraft);
  invalidPreferenceDraft.decisions[1].preference.matchedFeedbackIds = ["fb_invented"];
  const invalidPreferenceDraftPath = path.join(productionStateDir, "portfolio-draft-invalid-preference.json");
  await fs.writeFile(invalidPreferenceDraftPath, JSON.stringify(invalidPreferenceDraft), "utf8");
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
        "finalize-curated", "--input", invalidPreferenceDraftPath,
        "--candidates", productionFilteredPath,
        "--recovery-round", "1", "--recovery-stage", "deterministic",
      ],
      { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
    ),
    /references unknown feedback/,
  );

  await execFileAsync(
    process.execPath,
    [
      path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
      "finalize-curated", "--input", productionDraftPath,
      "--candidates", productionFilteredPath,
      "--recovery-round", "2", "--recovery-stage", "deterministic",
    ],
    { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
  );
  const productionSidecar = JSON.parse(await fs.readFile(
    path.join(root, "reports", "outbox", `skill-radar-${draft.reportDate}.quality.json`),
    "utf8",
  ));
  assert.equal(productionSidecar.items.length, 2);
  assert.deepEqual(productionSidecar.items.map((item) => item.title), ["Defer One", "Example Skill"]);
  assert.equal(productionSidecar.decisions[1].preference.effect, "boosted");
  assert.deepEqual(productionSidecar.decisions[1].preference.matchedFeedbackIds, [feedbackId]);
  assert.equal(productionSidecar.decisions[0].sourceContext.lane, "registryPulse");
  const resolvedRecovery = JSON.parse(await fs.readFile(
    path.join(productionStateDir, "skill-radar-finalization-recovery.json"),
    "utf8",
  ));
  assert.equal(resolvedRecovery.status, "resolved");
  assert.equal(resolvedRecovery.attempts[0].round, 1);
  assert.equal(resolvedRecovery.attempts[0].stage, "deterministic");
  assert.equal(resolvedRecovery.attempts[0].outcome, "failed");
  assert.equal(resolvedRecovery.attempts[0].error.code, "PREFERENCE_BINDING_INVALID");
  assert.equal(resolvedRecovery.attempts[1].round, 2);
  assert.equal(resolvedRecovery.attempts[1].stage, "deterministic");
  assert.equal(resolvedRecovery.attempts[1].outcome, "succeeded");
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        path.join(projectRoot, "tools", "quality", "report-quality.mjs"),
        "finalize-curated", "--input", productionDraftPath,
        "--candidates", productionFilteredPath,
        "--recovery-round", "2", "--recovery-stage", "deterministic",
      ],
      { cwd: projectRoot, env: { ...process.env, PERSONAL_RADAR_ROOT: root } },
    ),
    /already resolved/,
  );
  const productionRotation = JSON.parse(await fs.readFile(
    path.join(productionStateDir, "skill-radar-source-rotation.json"),
    "utf8",
  ));
  assert.equal(productionRotation.entries[0].status, "completed");
  const unchangedShadowNextPlan = JSON.parse(await fs.readFile(
    path.join(shadowStateDir, "skill-radar-source-plan.json"),
    "utf8",
  ));
  assert.equal(unchangedShadowNextPlan.reportDate, "2099-03-02");
  assert.equal(unchangedShadowNextPlan.registryFocus, "trending");

  await fs.rm(root, { recursive: true, force: true });
});

test("confirmed recheck candidates are mandatory and leave the queue after finalization", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "personal-radar-recheck-"));
  await fs.mkdir(path.join(root, "schemas"), { recursive: true });
  await fs.copyFile(
    path.join(projectRoot, "schemas", "skill-radar-report-v3.schema.json"),
    path.join(root, "schemas", "skill-radar-report-v3.schema.json"),
  );
  const date = "2099-04-01";
  const env = { ...process.env, PERSONAL_RADAR_ROOT: root };
  const tool = path.join(projectRoot, "tools", "quality", "report-quality.mjs");

  await execFileAsync(process.execPath, [
    tool, "recheck-add",
    "--title", "Figma Implement Design",
    "--source-url", "https://github.com/openai/skills/tree/main/skills/.curated/figma-implement-design",
    "--artifact-scope", "general_skill_collection",
    "--artifact-path", "skills/.curated/figma-implement-design",
    "--discovery-url", "https://www.openagentskill.com/skills/figma-implement-design",
    "--container-url", "https://github.com/openai/skills",
    "--reason", "Corrected after a stale discovery deep link caused a false rejection.",
  ], { cwd: projectRoot, env });
  await execFileAsync(process.execPath, [
    tool, "prepare", "--source-portfolio", "--date", date,
  ], { cwd: projectRoot, env });

  const stateDir = path.join(root, "reports", "state");
  const context = JSON.parse(await fs.readFile(
    path.join(stateDir, "skill-radar-context.json"),
    "utf8",
  ));
  assert.equal(context.pendingRecheckCandidates.length, 1);
  assert.equal(context.pendingRecheckCandidates[0].discoveryType, "recheck");

  const draft = curatedFixture();
  draft.reportDate = date;
  delete draft.candidateCount;
  delete draft.duplicateCount;
  delete draft.sourceCounts;
  const lanes = [
    ["registryPulse", "skillsSh"],
    ["officialRotation", "anthropicSkills"],
    ["communityTrend", "awesomeClaudeSkills"],
    ["registryPulse", "skillsSh"],
    ["officialRotation", "openAiPlugins"],
    ["communityTrend", "openAgentSkill"],
    ["registryPulse", "skillsSh"],
    ["officialRotation", "githubAwesomeCopilot"],
  ];
  const regularCandidates = draft.decisions.map((decision, index) => ({
    title: decision.title,
    sourceUrl: decision.sourceUrl,
    artifactScope: decision.artifactScope,
    artifactPath: decision.artifactPath,
    discoveryType: lanes[index][0],
    sourceId: lanes[index][1],
    discoveryUrl: `https://example.com/discovery/${index}`,
    containerType: "repository",
    containerUrl: decision.sourceUrl,
    artifactType: "skill",
    provenance: "independent",
    discoverySignals: ["catalog-listing"],
    dependencies: ["none"],
    registryView: lanes[index][0] === "registryPulse" ? "all_time" : null,
  }));
  const missingPath = path.join(stateDir, "missing-recheck.json");
  await fs.writeFile(missingPath, JSON.stringify({ asOf: date, candidates: regularCandidates }), "utf8");
  await assert.rejects(
    execFileAsync(process.execPath, [
      tool, "filter-candidates", "--source-portfolio", "--date", date, "--input", missingPath,
    ], { cwd: projectRoot, env }),
    /candidate pool must include pending recheck/,
  );

  const recheckCandidate = context.pendingRecheckCandidates[0];
  const candidatesPath = path.join(stateDir, "with-recheck.json");
  await fs.writeFile(candidatesPath, JSON.stringify({
    asOf: date,
    candidates: [...regularCandidates, recheckCandidate],
  }), "utf8");
  await execFileAsync(process.execPath, [
    tool, "filter-candidates", "--source-portfolio", "--date", date, "--input", candidatesPath,
  ], { cwd: projectRoot, env });
  const filteredPath = path.join(stateDir, "skill-radar-candidates-filtered.json");
  const filtered = JSON.parse(await fs.readFile(filteredPath, "utf8"));
  assert.equal(filtered.eligibleCandidates.length, 9);
  assert.equal(filtered.eligibleCandidates.at(-1).discoveryType, "recheck");

  draft.decisions.push({
    title: recheckCandidate.title,
    category: "frontend-design",
    sourceUrl: recheckCandidate.sourceUrl,
    artifactScope: recheckCandidate.artifactScope,
    artifactPath: recheckCandidate.artifactPath,
    decision: "defer",
    reason: "The corrected first-party artifact is real, but this fixture defers it for lifecycle testing.",
    officialSourceVerified: true,
    sourceCheckedAt: "2099-04-01T01:00:00.000Z",
    license: "MIT",
    preference: { effect: "neutral", matchedFeedbackIds: [], rationale: null },
  });
  const evidence = attachHarnessEvidence(draft, filtered);
  const draftPath = path.join(stateDir, "recheck-draft.json");
  await Promise.all([
    fs.writeFile(draftPath, JSON.stringify(draft), "utf8"),
    fs.writeFile(
      path.join(stateDir, "skill-radar-verification-evidence.json"),
      JSON.stringify(evidence),
      "utf8",
    ),
  ]);
  await execFileAsync(process.execPath, [
    tool, "finalize-curated", "--input", draftPath, "--candidates", filteredPath,
  ], { cwd: projectRoot, env });

  const queue = JSON.parse(await fs.readFile(
    path.join(root, "reports", "inbox", "recheck-candidates.json"),
    "utf8",
  ));
  assert.equal(queue.candidates[0].status, "completed");
  assert.equal(queue.candidates[0].outcome, "defer");
  assert.equal(queue.candidates[0].completedAt, date);

  await fs.rm(root, { recursive: true, force: true });
});

function attachHarnessEvidence(draft, filtered) {
  const unusedRun = {
    attempted: false,
    available: false,
    completed: false,
    freshContextRequested: false,
    retryCount: 0,
    notes: [],
  };
  const results = filtered.eligibleCandidates.map((candidate) => {
    const verified = {
      verdict: "verified_current",
      originalUrlStatus: 200,
      currentTitle: candidate.title,
      currentUrl: candidate.sourceUrl,
      artifactPath: candidate.artifactPath,
      skillMdVerified: true,
      repositoryStatus: "current",
      sourceRepositoryChanged: false,
      identityChanged: false,
      license: "MIT",
      capability: "Provides a concrete reusable workflow.",
      usability: "Can be used directly from its instruction file.",
      portability: "Can be adapted across compatible agent products.",
      maintenance: "Current first-party maintenance evidence was inspected.",
      trustCaveat: "Review dependencies and instructions before enabling it.",
      evidence: [
        "The exact artifact directory was inspected at its primary source.",
        "The current instruction file and repository status were verified.",
        "Identity, maintenance, dependencies, and trust boundaries were checked.",
      ],
    };
    const decision = draft.decisions.find((entry) =>
      entry.sourceUrl === candidate.sourceUrl
      && (entry.artifactPath ?? null) === (candidate.artifactPath ?? null)
    );
    assert.ok(decision, `fixture decision missing for ${candidate.id}`);
    decision.verification = {
      candidateId: candidate.id,
      verdict: verified.verdict,
      currentUrl: verified.currentUrl,
    };
    return {
      candidateId: candidate.id,
      artifactKey: candidate.artifactKey,
      title: candidate.title,
      originalSourceUrl: candidate.sourceUrl,
      originalArtifactPath: candidate.artifactPath,
      primary: verified,
      specialistRequired: false,
      specialist: null,
      disagreementFields: [],
      dispute: null,
      adjudicationRequired: false,
      adjudication: null,
      reconciled: verified,
      disposition: "retained",
      removalReason: null,
      requiresFollowup: false,
    };
  });
  return {
    version: 2,
    reportDate: filtered.asOf,
    profile: "multi-agent-harness-v2",
    runs: {
      primary: {
        attempted: true,
        available: true,
        completed: true,
        freshContextRequested: true,
        retryCount: 0,
        notes: [],
      },
      specialist: structuredClone(unusedRun),
      adjudicator: structuredClone(unusedRun),
    },
    results,
  };
}
