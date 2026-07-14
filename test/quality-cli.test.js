import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { curatedFixture } from "../test-support/curated-report.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
  assert.equal(filtered.excludedCandidates.length, 1);
  assert.equal(filtered.excludedCandidates[0].history.exclusionReason, "exact-artifact-within-30-days");
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
  for (let index = 0; index < 5; index += 1) {
    candidates.push({
      title: `Extra ${index}`,
      sourceUrl: `https://github.com/example/extra-${index}`,
      artifactScope: "individual_skill",
      artifactPath: null,
      discoveryType: ["awesomeClaudeSkills", "agentPlugins", "openAgentSkill"][index % 3],
      discoveryUrl: ["https://awesomeclaudeskills.com/", "https://github.com/dmgrok/agent-plugins", "https://www.openagentskill.com/skills"][index % 3],
    });
  }

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
  assert.equal(sidecar.stats.candidateCount, 10);
  assert.equal(sidecar.stats.reviewedCount, 5);
  assert.equal(sidecar.items.length, 1);
  assert.equal("baseScore" in sidecar.items[0].quality, false);

  await fs.rm(root, { recursive: true, force: true });
});
