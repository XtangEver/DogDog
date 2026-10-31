import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { checkedPath } from "./access-policy";
import { parseTraceFile } from "./trace";
import { traceSchema } from "./store";
import type { Trace } from "../shared/types";

export interface LibraryEntry {
  sessionId: string;
  path: string;
  root: string;
  modified: string;
  size: number;
}
export interface LibraryFilter {
  query?: string;
  cwd?: string;
  fromDate?: string;
  toDate?: string;
  sessionId?: string;
  offset?: number;
}
export const checkCancelled = (signal: AbortSignal) => {
  if (signal.aborted) throw new Error("已停止分析。");
};
export class TraceLibrary {
  constructor(
    public roots: string[],
    private cacheDir: string,
  ) {}
  private async atomic(path: string, value: unknown) {
    await mkdir(this.cacheDir, { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
  }
  async scan(signal: AbortSignal) {
    const entries: LibraryEntry[] = [],
      warnings: string[] = [];
    let visited = 0;
    const walk = async (root: string, dir: string, depth: number) => {
      checkCancelled(signal);
      if (depth > 12 || visited >= 30000) {
        if (!warnings.includes("目录扫描达到深度或 30000 项上限，结果不完整。"))
          warnings.push("目录扫描达到深度或 30000 项上限，结果不完整。");
        return;
      }
      try {
        await checkedPath(root, dir);
        for (const item of await readdir(dir, { withFileTypes: true })) {
          checkCancelled(signal);
          if (++visited > 30000) {
            warnings.push("目录扫描达到 30000 项上限，结果不完整。");
            break;
          }
          const path = join(dir, item.name);
          if (item.isSymbolicLink()) {
            warnings.push(`跳过链接：${item.name}`);
            continue;
          }
          if (item.isDirectory()) await walk(root, path, depth + 1);
          else if (
            item.isFile() &&
            item.name.toLowerCase().endsWith(".jsonl")
          ) {
            try {
              await checkedPath(root, path);
              const info = await stat(path);
              entries.push({
                sessionId: createHash("sha256").update(path).digest("hex"),
                root,
                path,
                modified: info.mtime.toISOString(),
                size: info.size,
              });
            } catch {
              warnings.push(`无法检查轨迹：${item.name}`);
            }
          }
        }
      } catch (error) {
        checkCancelled(signal);
        warnings.push(
          `未能完整读取目录：${basename(dir)}${error instanceof Error && error.message.includes("链接") ? "（链接被禁止）" : ""}`,
        );
      }
    };
    for (const root of [...new Set(this.roots)]) await walk(root, root, 0);
    const unique = [...new Map(entries.map((e) => [e.path, e])).values()].sort(
      (a, b) =>
        b.modified.localeCompare(a.modified) || a.path.localeCompare(b.path),
    );
    checkCancelled(signal);
    await this.atomic(join(this.cacheDir, "manifest.json"), {
      version: 1,
      entries: unique,
    });
    return { entries: unique, warnings };
  }
  async load(entry: LibraryEntry, signal: AbortSignal): Promise<Trace> {
    checkCancelled(signal);
    if (!this.roots.includes(entry.root)) throw new Error("轨迹目录已撤销。");
    await checkedPath(entry.root, entry.path);
    const before = await stat(entry.path);
    const key = `${before.size}:${before.mtimeMs}:${before.ctimeMs}`;
    const cachePath = join(this.cacheDir, `${entry.sessionId}.json`);
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf8"));
      if (cached.version === 1 && cached.key === key) {
        const trace = traceSchema.parse(cached.trace);
        if (trace.path === entry.path) {
          checkCancelled(signal);
          return trace;
        }
      }
    } catch {
      /* Missing or damaged cache is rebuilt from the read-only source. */
    }
    const trace = await parseTraceFile(entry.path, signal);
    await checkedPath(entry.root, entry.path);
    const after = await stat(entry.path);
    if (`${after.size}:${after.mtimeMs}:${after.ctimeMs}` !== key)
      throw new Error("轨迹正在更新，本次跳过；请重新搜索。");
    checkCancelled(signal);
    await this.atomic(cachePath, { version: 1, key, trace });
    return trace;
  }
}
export function matchesMetadata(trace: Trace, f: LibraryFilter) {
  if (
    f.cwd &&
    !trace.cwd.toLocaleLowerCase().includes(f.cwd.toLocaleLowerCase())
  )
    return false;
  const date = trace.startedAt?.slice(0, 10);
  if (f.fromDate && (!date || date < f.fromDate)) return false;
  if (f.toDate && (!date || date > f.toDate)) return false;
  return true;
}
