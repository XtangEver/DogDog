import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { lstat, realpath } from "node:fs/promises";
import type { Conversation, Settings } from "../shared/types";

export function defaultTraceRoots() {
  const home = process.env.CODEX_HOME || join(homedir(), ".codex");
  return [join(home, "sessions"), join(home, "archived_sessions")];
}
export function within(root: string, path: string) {
  const rel = relative(resolve(root), resolve(path));
  return (
    !isAbsolute(rel) &&
    rel !== ".." &&
    !rel.startsWith("..\\") &&
    !rel.startsWith("../")
  );
}
// Check every component, including junctions and links above the configured root.
export async function checkedPath(root: string, path: string) {
  if (!isAbsolute(root) || !within(root, path))
    throw new Error("轨迹路径越出授权目录。");
  let current = resolve(path);
  for (;;) {
    if ((await lstat(current)).isSymbolicLink())
      throw new Error("轨迹路径包含符号链接或联接，禁止访问。");
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  const [canonicalRoot, canonicalPath] = await Promise.all([
    realpath(root),
    realpath(path),
  ]);
  if (!within(canonicalRoot, canonicalPath))
    throw new Error("轨迹路径越出授权目录。");
  return canonicalPath;
}
export function accessFingerprint(s: Settings) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 3,
        endpoint: s.baseUrl,
        protocol: s.protocol,
        roots: s.traceRoots,
        allowed: s.allowTraceSend,
      }),
    )
    .digest("hex");
}
export function applyAccessPolicy(c: Conversation, s: Settings) {
  if (!s.allowTraceSend)
    throw new Error("请在模型设置中确认轨迹目录与发送权限，再发送问题。");
  const fingerprint = accessFingerprint(s);
  if (c.accessFingerprint !== fingerprint) {
    // Conservative reset: even unquoted earlier answers may contain removed material.
    c.contextStart = c.messages.length;
    for (const run of c.runs.filter((r) => r.status === "waiting")) {
      run.status = "interrupted";
      run.error = "检索或发送范围已变化，请重新提问。";
    }
    c.accessFingerprint = fingerprint;
  }
  for (const source of c.sources) {
    if (
      source.libraryRoot &&
      !(s.traceRoots ?? []).some((root) => within(root, source.trace.path))
    )
      source.active = false;
  }
  return fingerprint;
}
