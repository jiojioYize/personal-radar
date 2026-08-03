import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { buildPushMessage } from "../src/index.js";

const outboxDir = path.resolve("reports/outbox");
const reportPath = process.argv[2] || latestSidecar(outboxDir);
const port = Number(process.argv[3] || 8788);
const structured = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const message = buildPushMessage(
  { structured, category: "skill-radar-preview" },
  "https://radar.dailyingest.cn",
  "html",
);

http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(message.content);
}).listen(port, "127.0.0.1", () => {
  console.log(`Using ${path.relative(process.cwd(), reportPath)}`);
  console.log(`Push preview listening on http://127.0.0.1:${port}`);
});

function latestSidecar(directory) {
  const latest = fs.readdirSync(directory)
    .filter((name) => /^skill-radar-\d{4}-\d{2}-\d{2}\.quality\.json$/.test(name))
    .sort()
    .at(-1);
  if (!latest) throw new Error(`No Skill Radar quality Sidecar found in ${directory}`);
  return path.join(directory, latest);
}
