import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
