import { z } from "zod";
import type {
  Conversation,
  SourceSnapshot,
  ToolCall,
  Trace,
  TraceEvent,
} from "../shared/types";
import { attachSnapshot } from "./conversations";
import { executeTraceTool, searchSchema } from "./trace-tools";
import { checkCancelled, matchesMetadata, TraceLibrary } from "./trace-library";

export type ToolExecutor = (
  c: Conversation,
  call: ToolCall,
  read: Set<string>,
  signal: AbortSignal,
) => Promise<string>;
const discoverSchema = searchSchema
  .omit({ sourceId: true, sessionId: true })
  .extend({ query: z.string().max(500).optional() });
export function createToolExecutor(library?: TraceLibrary): ToolExecutor {
  return async (c, call, read, signal) => {
    checkCancelled(signal);
    if (call.name !== "discover_sessions" && call.name !== "search_traces")
      return executeTraceTool(c, call, read);
    const discovering = call.name === "discover_sessions";
    const args = (discovering ? discoverSchema : searchSchema).parse(
      JSON.parse(call.arguments),
    );
    if (args.fromDate && args.toDate && args.fromDate > args.toDate)
      throw new Error("检索日期范围无效。");
    if (!discovering && "sourceId" in args && args.sourceId)
      return executeTraceTool(c, call, read);
    if (!library) {
      if (discovering)
        return JSON.stringify({
          sessions: [],
          total: 0,
          warnings: ["未配置轨迹库。"],
        });
      return executeTraceTool(c, call, read);
    }
    const { entries, warnings } = await library.scan(signal);
    const sessions: unknown[] = [];
    const hits: Array<{
      trace: Trace;
      event: TraceEvent;
      root?: string;
      source?: SourceSnapshot;
    }> = [];
    const query = (args.query ?? "").toLocaleLowerCase(),
      offset = args.offset ?? 0;
    let total = 0;
    const seen = new Set<string>();
    const consider = (
      trace: Trace,
      root?: string,
      source?: SourceSnapshot,
      sessionId?: string,
    ) => {
      if (!matchesMetadata(trace, args)) return;
      const metadataMatch = trace.title.toLocaleLowerCase().includes(query);
      if (discovering) {
        if (
          !query ||
          metadataMatch ||
          trace.events.some((e) => e.text.toLocaleLowerCase().includes(query))
        ) {
          if (total >= offset && sessions.length < 20)
            sessions.push({
              sessionId,
              title: trace.title,
              cwd: trace.cwd,
              startedAt: trace.startedAt,
              turns: trace.turns,
              warnings: trace.warnings,
            });
          total++;
        }
      } else {
        for (const event of trace.events) {
          checkCancelled(signal);
          if (
            !query ||
            metadataMatch ||
            event.text.toLocaleLowerCase().includes(query)
          ) {
            if (total >= offset && hits.length < 20)
              hits.push({ trace, event, root, source });
            total++;
          }
        }
      }
    };
    for (const entry of entries) {
      checkCancelled(signal);
      if (c.excludedPaths?.includes(entry.path)) continue;
      if (
        "sessionId" in args &&
        args.sessionId &&
        args.sessionId !== entry.sessionId
      )
        continue;
      try {
        const trace = await library.load(entry, signal);
        seen.add(`${trace.path}:${trace.hash}`);
        consider(trace, entry.root, undefined, entry.sessionId);
      } catch (error) {
        checkCancelled(signal);
        warnings.push(
          error instanceof Error && /[\u3400-\u9fff]/.test(error.message)
            ? error.message
            : "部分轨迹损坏或无法读取，检索结果不完整。",
        );
      }
    }
    if (!discovering && !("sessionId" in args && args.sessionId)) {
      for (const source of c.sources.filter((s) => s.active)) {
        if (!seen.has(`${source.trace.path}:${source.trace.hash}`))
          consider(source.trace, source.libraryRoot, source);
      }
    }
    checkCancelled(signal);
    const results = hits.map(({ trace, event, root, source }) => {
      const snapshot: SourceSnapshot = source ?? attachSnapshot(c, trace);
      if (root) snapshot.libraryRoot = root;
      const at = query ? event.text.toLocaleLowerCase().indexOf(query) : 0;
      const start = Math.max(0, at - 120),
        text = event.text.slice(start, start + 420);
      const evidenceId = `${snapshot.id}:L${event.line}`;
      read.add(evidenceId);
      return {
        sourceId: snapshot.id,
        evidenceId,
        hash: trace.hash,
        title: trace.title,
        line: event.line,
        turn: event.turn,
        kind: event.kind,
        text,
        excerpt: start > 0 || start + text.length < event.text.length,
      };
    });
    const count = discovering ? sessions.length : results.length;
    return JSON.stringify({
      ...(discovering ? { sessions } : { results }),
      total,
      nextOffset: offset + count < total ? offset + count : null,
      warnings: [...new Set(warnings)].slice(0, 30),
      incomplete: warnings.length > 0,
    });
  };
}
