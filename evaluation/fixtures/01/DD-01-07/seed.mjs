import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const runDir = resolve(process.argv[2] || "");
if (!process.argv[2])
  throw new Error("usage: node seed.mjs PREPARED_ABSOLUTE_RUN_DIR [ENDPOINT]");
await readFile(join(runDir, "launch-env.json"), "utf8");
const target = join(runDir, "codex/sessions", "项目 甲");
await mkdir(target, { recursive: true });
await copyFile(
  new URL("./input.jsonl", import.meta.url),
  join(target, "复盘 输入.jsonl"),
);
await writeFile(join(target, "说明.txt"), "合成普通说明，不是轨迹。");
