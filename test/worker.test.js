import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import worker from "../src/index.js";

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
  assert.equal(result.report.schemaVersion, 1);
  assert.equal(result.report.selectedCount, 1);

  const page = await worker.fetch(
    new Request("https://radar.example/reports/skill-radar/2026-07-06?lang=zh"),
    env(kv),
  );
  const html = await page.text();
  assert.match(html, /structured-report/);
  assert.match(html, /查看详细分析/);
  assert.match(html, /example\/agent-skill/);
  assert.doesNotMatch(html, /baseScore/);
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
    assert.match(pushPayload.content, /查看完整分析与来源/);
    assert.match(pushPayload.content, /example\/agent-skill/);
    assert.ok(pushPayload.content.length < 6000);
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
