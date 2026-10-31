// Campaign state: atomic state.json + append-only timeline.jsonl.
// All paths anchor to evaluation/runs/auto-1031 (gitignored run root).
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  appendFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const controllerDir = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(controllerDir, "..", "..", "..");
export const runRoot = join(repo, "evaluation", "runs", "auto-1031");
export const statePath = join(runRoot, "state.json");
export const timelinePath = join(runRoot, "timeline.jsonl");
export const registryPath = join(runRoot, "registry.json");

export function nowIso() {
  return new Date().toISOString();
}

export function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  renameSync(tmp, path);
}

export function loadState() {
  if (!existsSync(statePath))
    throw new Error("No state.json — run `node campaign.mjs preflight` first");
  return loadJson(statePath, null);
}

export function saveState(state) {
  state.updatedAt = nowIso();
  atomicWriteJson(statePath, state);
}

export function timeline(ev) {
  mkdirSync(runRoot, { recursive: true });
  appendFileSync(
    timelinePath,
    JSON.stringify({ ts: nowIso(), ...ev }) + "\n",
    "utf8",
  );
}

export function initialState() {
  const startedAt = nowIso();
  return {
    campaignId: "auto-1031",
    startedAt,
    deadlineAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    phase: "preflight",
    round: null,
    runRoots: {},
    activeTrial: null,
    budget: {
      productRounds: 0,
      stagnantRounds: 0,
      trialCount: 0,
      claudeTurns: 0,
    },
    stagnation: {
      lastPassCount: null,
      lastHardGateFails: null,
      lastNotImplemented: null,
    },
    probes: {},
    stop: null,
    preflight: { checks: {} },
  };
}

export function ensureRunRoot() {
  mkdirSync(runRoot, { recursive: true });
  return runRoot;
}

// ---- stop-condition helpers -------------------------------------------------

export function budgetCheck(state) {
  if (state.stop) return state.stop.reason;
  if (Date.now() >= Date.parse(state.deadlineAt))
    return "deadline-72h";
  if (state.budget.productRounds >= 30) return "rounds-30";
  return null;
}

export function stopCampaign(state, reason, detail) {
  if (state.stop) return;
  state.stop = { reason, detail: detail ?? null, at: nowIso() };
  state.phase = "stopped";
  saveState(state);
  timeline({ kind: "stop", reason, detail: detail ?? null });
}
