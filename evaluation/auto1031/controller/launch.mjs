// DogDog launcher. ONLY this module starts the product. Env comes from the
// trial's launch-env.json (null entries deleted, never string "null").
// GLM_API_KEY / DOGDOG_REAL_CHECK are never passed to the product: the real
// key enters DogDog only through the settings UI typed by the setup role.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnTracked, confirmExited, isAlive } from "./procs.mjs";
import { nowIso, timeline } from "./state.mjs";

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function buildDogdogEnv(launchEnvPath) {
  const env = { ...process.env };
  const spec = JSON.parse(readFileSync(launchEnvPath, "utf8"));
  for (const [k, v] of Object.entries(spec)) {
    if (v === null) delete env[k];
    else env[k] = String(v);
  }
  // Safety rails regardless of spec:
  delete env.DOGDOG_REAL_CHECK;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.GLM_API_KEY; // never handed to the product process
  return env;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForMainWindow(pid, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const out = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle`,
        ],
        { encoding: "utf8", timeout: 15000 },
      ).trim();
      if (out) return out;
    } catch {
      /* keep polling */
    }
    if (!isAlive(pid)) throw new Error("DogDog exited during launch wait");
    await sleep(1500);
  }
  throw new Error("DogDog window did not appear within " + timeoutMs + "ms");
}

export async function launchDogDog({
  exePath,
  launchEnvPath,
  trialDir,
  attemptDir,
  label,
}) {
  if (!existsSync(exePath)) throw new Error("Missing exe " + exePath);
  const env = buildDogdogEnv(launchEnvPath);
  mkdirSync(attemptDir, { recursive: true });
  const { child } = spawnTracked("dogdog", {
    cmd: exePath,
    args: [],
    cwd: undefined,
    env,
    label: label ?? "DogDog",
    trialId: label ?? null,
    stdio: ["ignore", "ignore", "ignore"], // no pipes: parent must not hold handles
    visible: true, // GUI app: must show its window
  });
  const pid = child.pid;
  let title = null;
  let titleError = null;
  try {
    title = await waitForMainWindow(pid);
  } catch (e) {
    titleError = String(e.message ?? e);
  }
  const record = {
    pid,
    exe: exePath,
    exeSha256: sha256File(exePath),
    asarSha256: (() => {
      try {
        return sha256File(join(exePath, "..", "resources", "app.asar"));
      } catch {
        return null;
      }
    })(),
    windowTitle: title,
    titleError,
    startedAt: nowIso(),
    launchEnv: launchEnvPath,
  };
  writeFileSync(
    join(attemptDir, "process.json"),
    JSON.stringify(record, null, 2),
    "utf8",
  );
  timeline({ kind: "dogdog-launch", ...record, trialDir });
  if (titleError) throw new Error("DogDog launch failed: " + titleError);
  return record;
}

export async function stopDogDog(pid, label) {
  if (!isAlive(pid)) return { pid, alreadyGone: true };
  const { killTree } = await import("./procs.mjs");
  killTree(pid);
  await confirmExited(pid, 45000);
  timeline({ kind: "dogdog-stopped", pid, label });
  return { pid, alreadyGone: false };
}
