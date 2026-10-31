// Process registry + PID discipline. Only PIDs spawned through this module
// may be killed by it. DogDog instances, mock services and claude role
// sessions are all tracked here.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  atomicWriteJson,
  loadJson,
  registryPath,
  timeline,
  nowIso,
} from "./state.mjs";

// registry shape: { dogdog: [...], mocks: [...], claude: [...] }
// entry: { pid, kind, trialId, label, exeOrCmd, startedAt }

function loadRegistry() {
  return loadJson(registryPath, { dogdog: [], mocks: [], claude: [] });
}

function saveRegistry(reg) {
  atomicWriteJson(registryPath, reg);
}

export function isAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // Windows: EPERM means the process exists but is owned by another user.
    return e.code === "EPERM";
  }
}

function tasklistHasPid(pid) {
  try {
    const out = execFileSync(
      "tasklist",
      ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"],
      { encoding: "utf8", timeout: 15000 },
    );
    return out.includes(`"${pid}"`);
  } catch {
    return false;
  }
}

// Poll until the OS reports the PID gone. Never launch a replacement for a
// DogDog instance before this resolves (duplicate-instance rule).
export async function confirmExited(pid, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive = isAlive(pid) || tasklistHasPid(pid);
    if (!alive) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const stillAlive = isAlive(pid) || tasklistHasPid(pid);
  if (stillAlive) throw new Error(`PID ${pid} still alive after ${timeoutMs}ms`);
  return true;
}

export function killTree(pid) {
  const reg = loadRegistry();
  const all = [...reg.dogdog, ...reg.mocks, ...reg.claude];
  const entry = all.find((e) => e.pid === pid);
  if (!entry)
    throw new Error(
      `Refusing to kill PID ${pid}: not spawned by this controller`,
    );
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      timeout: 20000,
    });
    timeline({ kind: "kill", pid, label: entry.label });
  } catch (e) {
    // Process may already be gone; confirm below.
    timeline({
      kind: "kill-error",
      pid,
      label: entry.label,
      error: String(e.message ?? e).slice(0, 200),
    });
  }
  removeFromRegistry(pid);
}

function removeFromRegistry(pid) {
  const reg = loadRegistry();
  for (const key of ["dogdog", "mocks", "claude"]) {
    const before = reg[key].length;
    reg[key] = reg[key].filter((e) => e.pid !== pid);
    if (reg[key].length !== before) timeline({ kind: "registry-remove", pid });
  }
  saveRegistry(reg);
}

export function spawnTracked(kind, { cmd, args, cwd, env, label, trialId }) {
  const child = spawn(cmd, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const reg = loadRegistry();
  const entry = {
    pid: child.pid,
    kind,
    trialId: trialId ?? null,
    label: label ?? cmd,
    startedAt: nowIso(),
  };
  reg[kind].push(entry);
  saveRegistry(reg);
  timeline({ kind: "spawn", ...entry });
  const reap = () => removeFromRegistry(child.pid);
  child.on("exit", reap);
  child.on("error", (e) => {
    timeline({
      kind: "spawn-error",
      pid: child.pid,
      label,
      error: String(e.message ?? e).slice(0, 200),
    });
    reap();
  });
  return { child, entry };
}

export async function cleanupAll({ onlyTrialId } = {}) {
  const reg = loadRegistry();
  const targets = [
    ...reg.dogdog,
    ...reg.mocks,
    ...reg.claude,
  ].filter(
    (e) =>
      !onlyTrialId ||
      e.trialId === onlyTrialId ||
      (e.trialId ?? "").startsWith(onlyTrialId + ":"),
  );
  for (const e of targets) {
    if (!isAlive(e.pid)) {
      removeFromRegistry(e.pid);
      continue;
    }
    try {
      execFileSync("taskkill", ["/PID", String(e.pid), "/T", "/F"], {
        timeout: 20000,
      });
      timeline({ kind: "cleanup-kill", pid: e.pid, label: e.label });
    } catch {
      /* already gone */
    }
    removeFromRegistry(e.pid);
    try {
      await confirmExited(e.pid, 15000);
    } catch {
      timeline({ kind: "cleanup-confirm-failed", pid: e.pid });
    }
  }
}

export function registerExisting(kind, entry) {
  const reg = loadRegistry();
  reg[kind].push(entry);
  saveRegistry(reg);
}

// Best-effort final cleanup hooks (never throws).
export function installExitHooks() {
  const run = () => {
    try {
      const reg = loadRegistry();
      const count =
        reg.dogdog.length + reg.mocks.length + reg.claude.length;
      if (count > 0) {
        // synchronous best-effort: kill each tracked PID
        for (const key of ["dogdog", "mocks", "claude"])
          for (const e of reg[key]) {
            try {
              execFileSync(
                "taskkill",
                ["/PID", String(e.pid), "/T", "/F"],
                { timeout: 10000 },
              );
            } catch {}
          }
        saveRegistry({ dogdog: [], mocks: [], claude: [] });
      }
    } catch {}
  };
  process.on("exit", run);
  for (const sig of ["SIGINT", "SIGBREAK", "SIGTERM"])
    process.on(sig, () => {
      run();
      process.exit(0);
    });
  process.on("uncaughtException", (err) => {
    timeline({
      kind: "uncaught",
      error: String(err?.message ?? err).slice(0, 400),
    });
    run();
    process.exit(1);
  });
}
