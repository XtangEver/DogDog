// Diagnostic sub-step for the 7 diagnostic-track cases (system 02): run the
// repo parser over the staged fixture and record structured outputs as trial
// evidence. Bundles src/core/trace.ts with esbuild (already a devDependency)
// so the runner session stays UI-only.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { runRoot, repo } from "./state.mjs";

const GEN = join(runRoot, "_generated");
const ENTRY = join(GEN, "diag-entry.ts");
const BUNDLE = join(GEN, "diag-parse.cjs");

async function ensureBundle() {
  if (existsSync(BUNDLE)) return;
  mkdirSync(GEN, { recursive: true });
  writeFileSync(
    ENTRY,
    `
import { parseTraceText, TraceParser } from "${join(repo, "src", "core", "trace.ts").replaceAll("\\", "\\\\")}";
import { readFileSync } from "node:fs";
const [,, fileArg] = process.argv;
const text = readFileSync(fileArg, "utf8");
try {
  const trace = parseTraceText(text, fileArg);
  process.stdout.write(JSON.stringify({ ok: true, file: fileArg, trace }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, file: fileArg, error: String((e as Error).message ?? e) }));
}
`,
    "utf8",
  );
  await build({
    entryPoints: [ENTRY],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: BUNDLE,
    external: ["electron"],
    logLevel: "silent",
  });
}

function jsonlFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

export async function runDiag({ caseId, stagingDir, evidenceDir }) {
  await ensureBundle();
  mkdirSync(evidenceDir, { recursive: true });
  const files = [
    ...jsonlFiles(join(stagingDir, "codex", "sessions")),
    ...jsonlFiles(join(stagingDir, "codex", "archived_sessions")),
  ];
  const results = [];
  for (const f of files.slice(0, 5)) {
    let out;
    try {
      out = execFileSync(process.execPath, [BUNDLE, f], {
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 32 * 1024 * 1024,
      });
    } catch (e) {
      results.push({ file: relative(stagingDir, f), ok: false, error: String(e.message ?? e).slice(0, 200) });
      continue;
    }
    try {
      const parsed = JSON.parse(out);
      results.push({
        file: relative(stagingDir, f),
        ok: parsed.ok,
        turns: parsed.trace?.turns?.length ?? null,
        eventCount: parsed.trace?.events?.length ?? null,
        error: parsed.error ?? null,
      });
    } catch {
      results.push({ file: relative(stagingDir, f), ok: false, error: "unparseable parser output" });
    }
  }
  const report = { caseId, at: new Date().toISOString(), results };
  writeFileSync(join(evidenceDir, "diag-parse.json"), JSON.stringify(report, null, 2), "utf8");
  return report;
}
