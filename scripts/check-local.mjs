// Read-only local format check. No trace text or credentials are written to the report.
import { build } from "esbuild";
import {
  readdir,
  stat,
  readFile,
  mkdir,
  writeFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createRequire } from "node:module";
import { createHash, randomInt } from "node:crypto";
const temporary = await mkdtemp(join(tmpdir(), "dogdog-parser-"));
try {
  const modulePath = join(temporary, "trace.cjs");
  await build({
    entryPoints: ["src/core/trace.ts"],
    outfile: modulePath,
    bundle: true,
    platform: "node",
    format: "cjs",
  });
  const { parseTraceFile } = createRequire(import.meta.url)(modulePath);
  const root = join(
    process.env.CODEX_HOME || join(homedir(), ".codex"),
    "sessions",
  );
  const files = [];
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await scan(p);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const s = await stat(p);
        files.push({ path: p, size: s.size, mtime: s.mtimeMs });
      }
    }
  }
  await scan(root);
  files.sort((a, b) => b.mtime - a.mtime);
  const candidates = files.filter((f) => f.size < 5 * 1024 * 1024).slice(0, 30);
  const chosen = candidates[randomInt(candidates.length)];
  const selected = [
    chosen,
    ...candidates.filter((f) => f !== chosen).slice(0, 2),
  ];
  const results = [];
  for (const f of selected) {
    const before = await readFile(f.path);
    const t = await parseTraceFile(f.path);
    const after = await readFile(f.path);
    results.push({
      path: f.path,
      turns: t.turns,
      events: t.events.length,
      toolCalls: t.stats.toolCalls,
      warningCount: t.warnings.length,
      sourceUnchanged:
        createHash("sha256").update(before).digest("hex") ===
        createHash("sha256").update(after).digest("hex"),
      ongoing: f === candidates[0],
    });
  }
  const report = {
    checkedAt: new Date().toISOString(),
    discovered: files.length,
    selectedForReview: chosen.path,
    results,
    note: "仅验证本地读取与格式兼容；未调用模型。正在写入的会话可能在检查期间自然追加。",
  };
  await mkdir("verification", { recursive: true });
  await writeFile(
    "verification/local-format-check.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (!resolve(temporary).startsWith(resolve(tmpdir(), "dogdog-parser-")))
    throw new Error("Unsafe cleanup path");
  await rm(temporary, { recursive: true, force: true });
}
