import { mkdir, writeFile, utimes, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const runDir = process.argv[2];
if (!runDir) throw new Error("usage: node generate.mjs ABSOLUTE_NEW_RUN_DIR");
await readFile(resolve(runDir, "launch-env.json"), "utf8");
const root = resolve(runDir, "codex/sessions");
await mkdir(root, { recursive: true });
const row = (id, title, text) =>
  [
    JSON.stringify({
      type: "session_meta",
      timestamp: "2025-01-01T00:00:00Z",
      payload: { id, cwd: "D:\\synthetic-work", cli_version: "fixture" },
    }),
    JSON.stringify({
      type: "response_item",
      timestamp: "2025-01-01T00:00:01Z",
      payload: { type: "message", role: "user", content: [{ text: title }] },
    }),
    JSON.stringify({
      type: "response_item",
      timestamp: "2025-01-01T00:00:02Z",
      payload: { type: "message", role: "assistant", content: [{ text }] },
    }),
  ].join("\n") + "\n";
const deep = join(
  root,
  ...Array.from({ length: 13 }, (_, i) => "level-" + (i + 1)),
);
await mkdir(deep, { recursive: true });
await writeFile(
  join(deep, "session.jsonl"),
  row("synthetic-depth", "深层启动验收", "深层启动复测成功。"),
);
console.log(JSON.stringify({ root, deep, depth: 13 }));
await writeFile(
  join(root, "ordinary.jsonl"),
  row("synthetic-ordinary", "普通无关记录", "文档调整完成。"),
);
