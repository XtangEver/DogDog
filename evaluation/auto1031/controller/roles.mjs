// claude.exe role-session factory. Mirrors the proven invocation from
// D:\work_record\Windows-MCP\verification\run_claude.py:
//   claude.exe -p <prompt> --output-format stream-json --verbose
//   --no-session-persistence [--model <id>] [--tools ...]
//   [--strict-mcp-config --mcp-config <json>] [--allowedTools ...]
//   --settings '{"alwaysThinkingEnabled":false}'
// GLM routing is inherited from the user-level settings env; we never edit it.
import { spawn } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  createWriteStream,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { runRoot, nowIso, timeline } from "./state.mjs";
import { spawnTracked } from "./procs.mjs";

export const CLAUDE_EXE =
  "C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe";

export const WINDOWS_MCP_CMD = [
  "D:\\work_record\\Windows-MCP\\.venv\\Scripts\\windows-mcp.exe",
  "serve",
  "--tools",
  "Screenshot,Snapshot,Click,Type,Scroll,Move,Shortcut,Wait,WaitFor,App,ControlStatus,DisplayInventory",
];

export function mcpConfigPath() {
  const cfg = {
    mcpServers: {
      "windows-mcp": {
        command: WINDOWS_MCP_CMD[0],
        args: WINDOWS_MCP_CMD.slice(1),
        env: {
          ANONYMIZED_TELEMETRY: "false",
          WINDOWS_MCP_EXCLUDE_PROCESSES:
            "Code.exe,Cursor.exe,ZCode.exe,Codex.exe,ChatGPT.exe",
          WINDOWS_MCP_MAX_TREE_ELEMENTS: "500",
          WINDOWS_MCP_UIA_CONNECTION_TIMEOUT_MS: "1500",
          WINDOWS_MCP_UIA_TRANSACTION_TIMEOUT_MS: "2000",
        },
      },
    },
  };
  const path = join(runRoot, "mcp-windows.json");
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(path, JSON.stringify(cfg, null, 2), "utf8");
  return path;
}

export function emptyMcpConfigPath() {
  const path = join(runRoot, "mcp-empty.json");
  writeFileSync(path, JSON.stringify({ mcpServers: {} }), "utf8");
  return path;
}

// Role presets (see DESIGN.md matrix). All get stream-json + no persistence.
export const ROLE_PRESETS = {
  setup: {
    model: "glm-5.3",
    tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"],
    mcp: "windows",
    effort: "medium",
  },
  runner: {
    model: "glm-5.3-flash",
    tools: [], // '' — no built-in tools at all
    mcp: "windows",
    allowedTools: ["mcp__windows-mcp__*"],
    effort: "low",
  },
  visual: {
    model: "glm-5.3-flash",
    tools: ["Read", "Glob", "Grep"],
    mcp: "none",
    effort: "low",
  },
  reviewer: {
    model: "glm-5.3",
    tools: ["Read", "Glob", "Grep", "Write"],
    mcp: "none",
    effort: "medium",
  },
  coder: {
    model: "glm-5.3",
    tools: null, // omit --tools entirely (full built-in set)
    mcp: "none",
    effort: "medium",
  },
  coordinator: {
    model: "glm-5.3",
    tools: ["Read", "Glob", "Grep"],
    mcp: "none",
    effort: "medium",
  },
};

export async function runRole({
  role,
  promptText,
  cwd,
  outDir,
  label,
  timeoutMs = 30 * 60 * 1000,
  env = {},
  extraArgs = [],
  roleKey, // override preset key
}) {
  const preset = ROLE_PRESETS[roleKey ?? role];
  if (!preset) throw new Error("Unknown role " + role);
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `${role}`);
  const stdoutPath = `${base}.jsonl`;
  const stderrPath = `${base}.stderr.log`;
  const processPath = `${base}.process.json`;

  const settings = { alwaysThinkingEnabled: false };
  const args = [
    "-p",
    promptText,
    "--model",
    preset.model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--settings",
    JSON.stringify(settings),
  ];
  if (preset.tools) args.push("--tools", preset.tools.join(",")); // [] → '--tools ""'
  if (preset.mcp === "windows") {
    args.push("--strict-mcp-config", "--mcp-config", mcpConfigPath());
  } else if (preset.mcp === "none") {
    args.push("--strict-mcp-config", "--mcp-config", emptyMcpConfigPath());
  }
  if (preset.allowedTools) args.push("--allowedTools", preset.allowedTools.join(","));
  if (preset.effort) args.push("--effort", preset.effort);
  args.push(...extraArgs);

  // Prompt file kept for auditability (the text is also passed via argv).
  writeFileSync(`${base}.prompt.md`, promptText, "utf8");

  const startedAt = Date.now();
  timeline({ kind: "role-start", role, label, cwd, timeoutMs });

  if (cwd) mkdirSync(cwd, { recursive: true }); // spawn() needs an existing cwd
  const { child } = spawnTracked("claude", {
    cmd: CLAUDE_EXE,
    args,
    cwd,
    env: { ...process.env, ...env },
    label: `${role}:${label ?? ""}`,
    trialId: label ?? null,
  });

  const out = createWriteStream(stdoutPath, { flags: "w" });
  const err = createWriteStream(stderrPath, { flags: "w" });
  child.stdout.pipe(out);
  child.stderr.pipe(err);

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      timeline({ kind: "role-timeout", role, label });
      try {
        child.kill();
      } catch {}
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 10000);
    }, timeoutMs);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      out.end();
      err.end();
      resolve({ code, signal });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      out.end();
      err.end();
      resolve({ code: -1, signal: null, error: String(e.message ?? e) });
    });
  });

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const summary = {
    role,
    label,
    exitCode: result.code,
    signal: result.signal ?? null,
    error: result.error ?? null,
    seconds,
    endedAt: nowIso(),
  };
  writeFileSync(processPath, JSON.stringify(summary, null, 2), "utf8");
  timeline({ kind: "role-end", ...summary });
  return summary;
}

// Read the final assistant text + minimal facts from a stream-json transcript.
export function readTranscript(path) {
  if (!existsSync(path)) return { lines: [], finalText: "", subtype: null };
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  let finalText = "";
  let subtype = null;
  for (const line of lines) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.type === "result") {
      subtype = msg.subtype ?? null;
      if (typeof msg.result === "string") finalText = msg.result;
    }
  }
  return { lines, finalText, subtype };
}
