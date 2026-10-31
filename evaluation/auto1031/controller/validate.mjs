// Reviewer-output contract enforcement: mechanical constants are corrected
// from controller clocks/registries (every fixup logged); judgments (checks,
// scores, observations, evidence) are never altered by this module.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resultSchema } from "../../tools/schemas.mjs";
import { loadTasks, validateRun } from "../../tools/cli.mjs";
import { timeline, nowIso } from "./state.mjs";

export async function finalizeResult({
  draftPath, // reviewer-written result JSON (judgments + evidence)
  runRootDir,
  caseId,
  attempt,
  group, // "real" | "mock" -> mockService
  track, // "desktop" | "diagnostic"
  startedAt,
  endedAt,
  modelRequests, // number | null (from mock requests.jsonl or null for real)
  outPath,
}) {
  const tasks = (await loadTasks()).map((x) => x.task);
  const task = tasks.find((t) => t.id === caseId);
  if (!task) throw new Error("Unknown case " + caseId);
  const draft = JSON.parse(readFileSync(draftPath, "utf8"));
  const manifest = JSON.parse(
    readFileSync(join(runRootDir, "manifest.json"), "utf8"),
  );
  const fix = (field, value, why) => {
    if (JSON.stringify(draft[field]) !== JSON.stringify(value)) {
      timeline({ kind: "result-fixup", caseId, attempt, field, why });
      draft[field] = value;
    }
  };
  fix("schemaVersion", "1.0", "constant");
  fix("runId", manifest.runId, "manifest runId");
  fix("caseId", caseId, "case id");
  fix("attempt", attempt, "attempt number");
  fix("executionTrack", track === "diagnostic" ? "diagnostic" : "desktop_proxy", "track from case");
  fix("mockService", group === "mock", "group from case-plan");
  fix("blinded", false, "no OS sandbox — never blind");
  if (!draft.startedAt) fix("startedAt", startedAt, "controller clock");
  if (!draft.endedAt) fix("endedAt", endedAt, "controller clock");
  fix("reviewer", draft.reviewer ?? {
    kind: "agent_proxy",
    identity: "claude.exe glm-5.3 independent context",
    independentContext: true,
  }, "reviewer identity");
  if (draft.reviewer && typeof draft.reviewer.independentContext !== "boolean") {
    timeline({ kind: "result-fixup", caseId, attempt, field: "reviewer.independentContext", why: "schema boolean" });
    draft.reviewer.independentContext = true;
  }
  if (modelRequests == null) {
    // Real-service runs have no request audit; 0 means "not counted", per pilot
    // precedent. The limitation makes that explicit so 0 is never read as a
    // zero-request claim.
    draft.limitations = [
      ...(draft.limitations ?? []),
      "metrics.modelRequests=0 表示未计量（真实服务无请求审计），不代表零请求。",
    ];
  }
  draft.metrics = {
    elapsedMs: Date.parse(endedAt) - Date.parse(startedAt),
    modelRequests: modelRequests ?? 0,
    cost: null,
    ...(draft.metrics ?? {}),
  };
  if (draft.metrics.modelRequests == null) draft.metrics.modelRequests = 0;
  // Strict parse BEFORE writing: schema violations must fail loudly here.
  const parsed = resultSchema.parse(draft);
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, JSON.stringify(parsed, null, 2), "utf8");
  timeline({ kind: "result-finalized", caseId, attempt, status: parsed.status, at: nowIso() });
  return parsed;
}

export async function validateRunRoot(runRootDir) {
  try {
    const out = await validateRun(runRootDir);
    return out;
  } catch (e) {
    return { valid: false, error: String(e.message ?? e) };
  }
}
