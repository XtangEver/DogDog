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
for (let i = 0; i < 181; i++) {
  const p = join(root, "session-" + String(i).padStart(4, "0") + ".jsonl");
  const target = i === 0;
  await writeFile(
    p,
    row(
      "synthetic-scale-" + i,
      target ? "琥珀启动处理" : "普通合成任务" + i,
      target ? "琥珀启动：等待改为5秒。" : "普通无关记录" + i,
    ),
  );
  const t = new Date(Date.UTC(2025, 0, 1, 0, 0, i));
  await utimes(p, t, t);
}
console.log(
  JSON.stringify({
    root,
    count: 181,
    target: join(root, "session-0000.jsonl"),
  }),
);
