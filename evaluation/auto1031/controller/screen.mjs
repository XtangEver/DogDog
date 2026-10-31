// Periodic + on-demand screen capture via PowerShell (no vision model).
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { controllerDir } from "./state.mjs";

export function captureScreen(outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(controllerDir, "screen-capture.ps1"),
      "-OutPath",
      outPath,
    ],
    { timeout: 20000 },
  );
  return outPath;
}

// Interval capture for the duration of a runner turn; returns a stop() handle.
export function startIntervalCapture({ dir, prefix, intervalMs = 45000 }) {
  mkdirSync(dir, { recursive: true });
  let n = 0;
  let timer = null;
  const tick = () => {
    try {
      n += 1;
      const name = `${prefix}-${String(n).padStart(3, "0")}.png`;
      captureScreen(join(dir, name));
    } catch {
      /* capture is best-effort */
    }
  };
  tick();
  timer = setInterval(tick, intervalMs);
  return {
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
