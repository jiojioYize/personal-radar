import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import worker from "../src/index.js";
import { enrichCuratedReport } from "../src/curated-report.js";
import { curatedFixture } from "../test-support/curated-report.js";

test("ingests and renders a structured v2 report", async () => {
  const kv = new MemoryKv();
  const structured = await exampleReport();
  const response = await ingest(kv, structured, {
    generatedAt: "2026-07-06T00:00:00.000Z",
    sourceRunId: "structured-v2",
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.stored, true);
  assert.equal(result.pushed, false);
  assert.equal(result.report.schemaVersion, 2);
  assert.equal(result.report.selectedCount, 1);

  const page = await worker.fetch(
    new Request("https://radar.example/reports/skill-radar/2026-07-06?lang=zh"),
    env(kv),
  );
  const html = await page.text();
  assert.match(html, /structured-report/);
  assert.match(html, /展开证据与适配分析/);
  assert.match(html, /example\/agent-skill/);
  assert.doesNotMatch(html, /baseScore/);
});

test("ingests and renders a simplified structured v3 report", async () => {
  const kv = new MemoryKv();
  const structured = enrichCuratedReport(curatedFixture());
  const response = await ingest(kv, structured, {
    generatedAt: "2026-07-14T01:00:00.000Z",
    sourceRunId: "structured-v3",
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.report.schemaVersion, 3);
  assert.equal(result.report.selectedCount, 1);

  const page = await worker.fetch(
    new Request("https://radar.example/reports/skill-radar/2026-07-14?lang=en"),
    env(kv),
  );
  const html = await page.text();
  assert.match(html, /Example Skill/);
  assert.match(html, /structured-report/);
  assert.match(html, /Skill Radar Daily Picks/);
  assert.match(html, /Today's brief/);
  assert.doesNotMatch(html, /Priority suggestion/);
  assert.match(html, /What it helps you do/);
  assert.match(html, /When it helps/);
  assert.match(html, /Before you start/);
  assert.match(html, /Setup, limits, and deeper analysis/);
  assert.match(html, /Install and get started/);
  assert.match(html, /Limits and risks/);
  assert.match(html, /Hand off to AI/);
  assert.match(html, /Copy task/);
  assert.match(html, /Do not modify files or install anything until I approve the plan/);
  assert.match(html, /class="recommendation"/);
  assert.match(html, /class="topic-label">[\s\S]*Coding workflow/);
  assert.match(html, /class="recommendation-icon"/);
  assert.match(html, /class="disclosure-icon"/);
  assert.match(html, /class="date-navigation"/);
  assert.match(html, /class="language-switch"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /\.source-link \{[\s\S]*padding-right: 348px;/);
  assert.match(html, /\.evidence-details > summary \{[\s\S]*position: absolute;/);
  assert.match(html, /Personal Radar/);
  assert.match(html, /<html lang="en">/);
  assert.doesNotMatch(html, /action-tag action-/);
  assert.doesNotMatch(html, /Featured|Top pick|recommendation-index/);
  assert.doesNotMatch(html, /<details class="recommendation"[^>]* open/);
  assert.doesNotMatch(html, /baseScore/);
  assert.doesNotMatch(html, /Source checked/);
  assert.doesNotMatch(html, /report-stats|Reviewed|Recent duplicates/);
  assert.doesNotMatch(html, /What it does|Start here|Watch for|Best for/);
});

test("presents a structured Chinese report as a reader-facing daily brief", async () => {
  const kv = new MemoryKv();
  const structured = enrichCuratedReport(curatedFixture());
  const response = await ingest(kv, structured, {
    generatedAt: "2026-07-14T01:00:00.000Z",
    sourceRunId: "structured-v3-zh-presentation",
  });
  assert.equal(response.status, 200);

  const page = await worker.fetch(
    new Request("https://radar.example/reports/skill-radar/2026-07-14?lang=zh"),
    env(kv),
  );
  const html = await page.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /Skill Radar 今日精选/);
  assert.match(html, /今日导读/);
  assert.doesNotMatch(html, /优先建议/);
  assert.match(html, /它能帮你做什么/);
  assert.match(html, /什么时候值得用/);
  assert.match(html, /开始前需要/);
  assert.match(html, /安装、限制与深入分析/);
  assert.match(html, /安装与开始/);
  assert.match(html, /限制与风险/);
  assert.match(html, /交给 AI 处理/);
  assert.match(html, /复制任务/);
  assert.match(html, /在我确认前，不要修改文件或执行安装/);
  assert.match(html, /编码工作流/);
  assert.doesNotMatch(html, /来源核验/);
  assert.doesNotMatch(html, /适合你吗|先这样用|需要注意/);
  assert.match(html, /2026-07-14 · 09:00 北京时间/);
  assert.match(html, /aria-current="page" href="\/reports\/skill-radar\/2026-07-14\?lang=zh"/);
  assert.doesNotMatch(html, /首选推荐|recommendation-index/);
});

test("keeps legacy v3 display semantics for already generated reports", async () => {
  const kv = new MemoryKv();
  const structured = enrichCuratedReport(curatedFixture());
  delete structured.readerContractVersion;
  const response = await ingest(kv, structured, {
    generatedAt: "2026-07-15T01:00:00.000Z",
    sourceRunId: "legacy-v3-reader-contract",
  });
  assert.equal(response.status, 200);

  const page = await worker.fetch(
    new Request("https://radar.example/reports/skill-radar/2026-07-15?lang=zh"),
    env(kv),
  );
  const html = await page.text();
  assert.match(html, /适合你吗/);
  assert.match(html, /先这样用/);
  assert.match(html, /需要注意/);
  assert.match(html, /展开证据与适配分析/);
  assert.doesNotMatch(html, /交给 AI 处理|复制任务/);
});

test("navigates only between public report dates that exist", async () => {
  const kv = new MemoryKv();
  const structured = enrichCuratedReport(curatedFixture());
  await ingest(kv, structured, {
    generatedAt: "2026-07-13T01:00:00.000Z",
    sourceRunId: "date-navigation-older",
  });
  await ingest(kv, structured, {
    generatedAt: "2026-07-14T01:00:00.000Z",
    sourceRunId: "date-navigation-current",
  });

  const page = await worker.fetch(
    new Request("https://radar.example/reports/skill-radar/2026-07-14?lang=en"),
    env(kv),
  );
  const html = await page.text();
  assert.match(html, /aria-label="Previous report"[^>]*href="\/reports\/skill-radar\/2026-07-13\?lang=en"|href="\/reports\/skill-radar\/2026-07-13\?lang=en"[^>]*aria-label="Previous report"/);
  assert.match(html, /class="date-menu"[\s\S]*2026-07-13/);
  assert.match(html, /class="active" aria-current="page" href="\/reports\/skill-radar\/2026-07-14\?lang=en"/);
  assert.match(html, /class="date-step disabled" aria-disabled="true" title="Next report"/);
});

test("localizes the structured report archive", async () => {
  const kv = new MemoryKv();
  const structured = enrichCuratedReport(curatedFixture());
  const response = await ingest(kv, structured, {
    generatedAt: "2026-07-14T01:00:00.000Z",
    sourceRunId: "structured-v3-localized-archive",
  });
  assert.equal(response.status, 200);

  const page = await worker.fetch(new Request("https://radar.example/reports?lang=zh"), env(kv));
  const html = await page.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /Skill Radar 历史报告/);
  assert.match(html, /最新报告/);
  assert.match(html, /Skill Radar 今日精选/);
  assert.match(html, /class="site-action" href="\/\?lang=zh"/);
  assert.match(html, /class="language-switch"/);
  assert.doesNotMatch(html, /Skill Radar Deep Dive/);
});

test("renders v3 PushPlus cards around understanding and usage", async () => {
  const kv = new MemoryKv();
  const structured = enrichCuratedReport(curatedFixture());
  const originalFetch = globalThis.fetch;
  let pushPayload;
  globalThis.fetch = async (_url, options) => {
    pushPayload = JSON.parse(options.body);
    return new Response('{"code":200}', { status: 200 });
  };

  try {
    const response = await ingest(kv, structured, {
      generatedAt: "2026-07-14T02:00:00.000Z",
      sourceRunId: "structured-v3-push",
      envOverrides: {
        PUSHPLUS_TOKEN: "test-token",
        PUSHPLUS_TEMPLATE: "html",
      },
    });
    assert.equal(response.status, 200);
    assert.match(pushPayload.content, /什么时候值得用：/);
    assert.match(pushPayload.content, /开始前需要：/);
    assert.match(pushPayload.content, /Requires a skill-capable agent/);
    assert.doesNotMatch(pushPayload.content, /限制与风险|注意：/);
    assert.doesNotMatch(pushPayload.content, />install<|>adapt<|>watch</i);
    assert.doesNotMatch(pushPayload.content, /检查 .*排除重复/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("keeps v1 Markdown reports readable", async () => {
  const kv = new MemoryKv();
  const response = await worker.fetch(
    new Request("https://radar.example/ingest-report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-radar-ingest-key": "test-key",
      },
      body: JSON.stringify({
        title: "Legacy Radar",
        contentZh: "# Legacy Radar\n\n## 项目\n\n旧版内容",
        contentEn: "# Legacy Radar\n\n## Item\n\nLegacy content",
        category: "skill-radar",
        visibility: "public",
        generatedAt: "2026-07-05T00:00:00.000Z",
        sourceRunId: "legacy-v1",
      }),
    }),
    env(kv),
  );
  assert.equal(response.status, 200);

  const page = await worker.fetch(
    new Request("https://radar.example/reports/skill-radar/2026-07-05?lang=zh"),
    env(kv),
  );
  const html = await page.text();
  assert.match(html, /class="markdown"/);
  assert.match(html, /旧版内容/);
});

test("stores and renders a no-update outcome", async () => {
  const kv = new MemoryKv();
  const structured = await exampleReport();
  structured.status = "no_update";
  structured.items = [];
  structured.stats.selectedCount = 0;
  structured.summary.zh = "检查完成，没有项目达到推荐标准。";
  structured.summary.en = "Review complete; no item met the recommendation bar.";

  const response = await ingest(kv, structured, {
    generatedAt: "2026-07-07T00:00:00.000Z",
    sourceRunId: "no-update",
  });
  const result = await response.json();
  assert.equal(result.report.status, "no_update");

  const page = await worker.fetch(
    new Request("https://radar.example/reports/skill-radar/2026-07-07?lang=zh"),
    env(kv),
  );
  assert.match(await page.text(), /今日无重要更新/);
});

test("rejects raw HTML in structured content", async () => {
  const kv = new MemoryKv();
  const structured = await exampleReport();
  structured.items[0].display.zh.oneLiner = "<script>alert(1)</script>";
  const response = await ingest(kv, structured, {
    generatedAt: "2026-07-08T00:00:00.000Z",
    sourceRunId: "invalid-html",
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /raw HTML/);
});

test("allows angle-bracket placeholders in structured text", async () => {
  const kv = new MemoryKv();
  const structured = await exampleReport();
  structured.items[0].display.zh.usability = "路径遵循 `skills/<name>/SKILL.md` 约定。";
  structured.items[0].display.en.usability = "The layout follows `skills/<name>/SKILL.md` conventions.";

  const response = await ingest(kv, structured, {
    generatedAt: "2026-07-08T00:00:00.000Z",
    sourceRunId: "placeholder-angle-brackets",
  });
  assert.equal(response.status, 200);
});

test("returns duplicate for the same category and date", async () => {
  const kv = new MemoryKv();
  const structured = await exampleReport();
  const first = await ingest(kv, structured, {
    generatedAt: "2026-07-09T00:00:00.000Z",
    sourceRunId: "duplicate-one",
  });
  assert.equal(first.status, 200);

  const second = await ingest(kv, structured, {
    generatedAt: "2026-07-09T01:00:00.000Z",
    sourceRunId: "duplicate-two",
  });
  const result = await second.json();
  assert.equal(result.duplicate, true);
  assert.equal(result.reason, "category-date");
});

test("builds a concise HTML PushPlus message", async () => {
  const kv = new MemoryKv();
  const structured = await exampleReport();
  const originalFetch = globalThis.fetch;
  let pushPayload;
  globalThis.fetch = async (_url, options) => {
    pushPayload = JSON.parse(options.body);
    return new Response('{"code":200}', { status: 200 });
  };

  try {
    const response = await ingest(kv, structured, {
      generatedAt: "2026-07-10T00:00:00.000Z",
      sourceRunId: "html-push",
      envOverrides: {
        PUSHPLUS_TOKEN: "test-token",
        PUSHPLUS_TEMPLATE: "html",
      },
    });
    const result = await response.json();
    assert.equal(result.pushed, true);
    assert.equal(pushPayload.template, "html");
    assert.match(pushPayload.title, /今日精选/);
    assert.match(pushPayload.content, /background:#f1f3ee/);
    assert.match(pushPayload.content, /Skill Radar 今日精选/);
    assert.match(pushPayload.content, /查看完整分析与来源/);
    assert.match(pushPayload.content, /example\/agent-skill/);
    assert.match(pushPayload.content, /适合：/);
    assert.match(pushPayload.content, /怎么用：/);
    assert.match(pushPayload.content, /<strong>注意：/);
    assert.ok(pushPayload.content.length < 6000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps HTML card fields untruncated", async () => {
  const kv = new MemoryKv();
  const structured = await exampleReport();
  structured.items[0].display.zh.oneLiner = "这是用于确认 HTML 卡片完整显示的长价值说明，末尾包含唯一标记 VALUE_TAIL。";
  structured.items[0].display.zh.bestFor = "当需要在微信里直接判断是否值得深入了解时使用，末尾包含唯一标记 WHEN_USEFUL_TAIL。";
  structured.items[0].display.zh.action = "开始前需要准备兼容的 Agent，末尾包含唯一标记 PREREQUISITE_TAIL。";
  const originalFetch = globalThis.fetch;
  let pushPayload;
  globalThis.fetch = async (_url, options) => {
    pushPayload = JSON.parse(options.body);
    return new Response('{"code":200}', { status: 200 });
  };

  try {
    const response = await ingest(kv, structured, {
      generatedAt: "2026-07-11T00:00:00.000Z",
      sourceRunId: "html-untruncated-card-fields",
      envOverrides: {
        PUSHPLUS_TOKEN: "test-token",
        PUSHPLUS_TEMPLATE: "html",
      },
    });
    assert.equal(response.status, 200);
    assert.match(pushPayload.content, /VALUE_TAIL/);
    assert.match(pushPayload.content, /WHEN_USEFUL_TAIL/);
    assert.match(pushPayload.content, /PREREQUISITE_TAIL/);
    assert.doesNotMatch(pushPayload.content, /VALUE_TAIL。…|WHEN_USEFUL_TAIL。…|PREREQUISITE_TAIL。…/);
    assert.ok(pushPayload.content.length < 7000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function ingest(kv, structuredReport, options) {
  const payload = {
    title: `Skill Radar Deep Dive - ${structuredReport.reportDate}`,
    contentZh: `# Skill Radar Deep Dive - ${structuredReport.reportDate}\n\n中文报告`,
    contentEn: `# Skill Radar Deep Dive - ${structuredReport.reportDate}\n\nEnglish report`,
    category: "skill-radar",
    visibility: "public",
    generatedAt: options.generatedAt,
    sourceRunId: options.sourceRunId,
    structuredReport,
  };
  return worker.fetch(
    new Request("https://radar.example/ingest-report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-radar-ingest-key": "test-key",
      },
      body: JSON.stringify(payload),
    }),
    env(kv, options.envOverrides),
  );
}

function env(kv, overrides = {}) {
  return {
    DEEP_REPORT_INGEST_KEY: "test-key",
    RADAR_STATE: kv,
    RADAR_TIME_ZONE: "Asia/Shanghai",
    ...overrides,
  };
}

async function exampleReport() {
  return JSON.parse(await fs.readFile(
    new URL("../schemas/examples/skill-radar-report.example.json", import.meta.url),
    "utf8",
  ));
}

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async delete(key) {
    this.values.delete(key);
  }
}
