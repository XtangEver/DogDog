import { z } from "zod";
import type { ToolDefinition } from "./agent-provider";
import type { Conversation, SourceSnapshot, ToolCall } from "../shared/types";
export const objectParameters = (
  properties: Record<string, unknown>,
  required: string[],
) => ({ type: "object", properties, required, additionalProperties: false });
export const agentTools: ToolDefinition[] = [
  {
    name: "discover_sessions",
    description:
      "自主发现获准的本机 Codex 当前和归档会话；按标题或正文关键词、日期、项目目录过滤并分页。不要求先关联来源。返回 sessionId 后可用 search_traces 进一步读取。",
    parameters: objectParameters(
      {
        query: { type: "string" },
        cwd: { type: "string" },
        fromDate: { type: "string", description: "YYYY-MM-DD，含当天" },
        toDate: { type: "string", description: "YYYY-MM-DD，含当天" },
        offset: { type: "integer", minimum: 0 },
      },
      [],
    ),
  },
  {
    name: "list_sources",
    description:
      "列出当前对话可读取的固定轨迹快照，返回 ID、标题、轮次和警告。",
    parameters: objectParameters({}, []),
  },
  {
    name: "search_traces",
    description:
      "按字面文本搜索整个获准的 Codex 轨迹库和已关联快照（忽略大小写，中文子串）；无需手动关联。命中自动建立固定快照，返回 sourceId/evidenceId，再用 read_trace 查上下文。可指定 sessionId、sourceId、cwd、日期；query 为空浏览，offset 翻页。",
    parameters: objectParameters(
      {
        query: { type: "string" },
        sourceId: { type: "string", description: "可选，仅搜索此快照" },
        sessionId: {
          type: "string",
          description: "discover_sessions 返回的 ID",
        },
        cwd: { type: "string" },
        fromDate: { type: "string" },
        toDate: { type: "string" },
        offset: { type: "integer", minimum: 0 },
      },
      ["query"],
    ),
  },
  {
    name: "read_trace",
    description:
      "按源文件原文行号读取某个来源的事件和上下文；结果过长时按 nextFromLine 或 nextOffset 继续。",
    parameters: objectParameters(
      {
        sourceId: { type: "string" },
        fromLine: { type: "integer", minimum: 1 },
        toLine: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0 },
      },
      ["sourceId", "fromLine", "toLine"],
    ),
  },
  {
    name: "ask_user",
    description: "暂停分析，向用户询问一个关键问题；必须单独调用，回答后继续。",
    parameters: objectParameters({ question: { type: "string" } }, [
      "question",
    ]),
  },
];
const sourceIdSchema = z.string().regex(/^S[1-9]\d*$/);
export const searchSchema = z
  .object({
    query: z.string().max(500),
    sourceId: sourceIdSchema.optional(),
    sessionId: z.string().max(64).optional(),
    cwd: z.string().max(4000).optional(),
    fromDate: z.iso.date().optional(),
    toDate: z.iso.date().optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();
const readSchema = z
  .object({
    sourceId: sourceIdSchema,
    fromLine: z.number().int().positive(),
    toLine: z.number().int().positive(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();
export const questionSchema = z
  .object({ question: z.string().trim().min(1).max(4000) })
  .strict();
export const evidenceId = (s: SourceSnapshot, line: number) =>
  `${s.id}:L${line}`;
export function validateCitations(
  text: string,
  allowed: Set<string>,
): string[] {
  const tokens = text.match(/\[S[^\]\n]{0,120}\]/g) ?? [];
  const ids = tokens.map((t) => t.slice(1, -1));
  if (ids.some((id) => !/^S[1-9]\d*:L[1-9]\d*$/.test(id) || !allowed.has(id)))
    throw new Error("回答引用了本轮未读取或无效的证据，未保存为完整回答。");
  return [...new Set(ids)];
}
export function executeTraceTool(
  c: Conversation,
  call: ToolCall,
  read: Set<string>,
): string {
  const active = c.sources.filter((s) => s.active);
  const getSource = (id: string) => {
    const s = active.find((s) => s.id === id);
    if (!s) throw new Error("来源未关联或已移除，禁止访问。");
    return s;
  };
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    throw new Error("工具参数不是有效 JSON。");
  }
  if (call.name === "list_sources") {
    z.object({}).strict().parse(args);
    return JSON.stringify(
      active.map((s) => ({
        sourceId: s.id,
        hash: s.trace.hash,
        title: s.trace.title,
        turns: s.trace.turns,
        events: s.trace.events.length,
        warnings: s.trace.warnings,
      })),
    );
  }
  if (call.name === "search_traces") {
    const a = searchSchema.parse(args),
      sources = a.sourceId ? [getSource(a.sourceId)] : active;
    const query = a.query.toLocaleLowerCase(),
      offset = a.offset ?? 0;
    const matches = sources.flatMap((s) =>
      s.trace.events
        .filter((e) => !query || e.text.toLocaleLowerCase().includes(query))
        .map((e) => ({ s, e })),
    );
    const results = matches.slice(offset, offset + 20).map(({ s, e }) => {
      const at = query ? e.text.toLocaleLowerCase().indexOf(query) : 0;
      const start = Math.max(0, at - 120),
        excerpt = e.text.slice(start, start + 420),
        id = evidenceId(s, e.line);
      read.add(id);
      return {
        sourceId: s.id,
        title: s.trace.title,
        evidenceId: id,
        hash: s.trace.hash,
        line: e.line,
        turn: e.turn,
        kind: e.kind,
        text: excerpt,
        excerpt: start > 0 || start + excerpt.length < e.text.length,
      };
    });
    return JSON.stringify({
      results,
      total: matches.length,
      nextOffset:
        offset + results.length < matches.length
          ? offset + results.length
          : null,
    });
  }
  if (call.name === "read_trace") {
    const a = readSchema.parse(args);
    if (a.toLine < a.fromLine) throw new Error("读取行范围无效。");
    const s = getSource(a.sourceId),
      events = s.trace.events.filter(
        (e) => e.line >= a.fromLine && e.line <= a.toLine,
      );
    const results: unknown[] = [];
    let remaining = 10000,
      nextFromLine: number | null = null,
      nextOffset: number | null = null;
    for (const e of events) {
      const offset = results.length ? 0 : (a.offset ?? 0);
      if (offset > e.text.length) throw new Error("文本偏移超出事件范围。");
      if (remaining <= 0 || results.length >= 30) {
        nextFromLine = e.line;
        break;
      }
      const text = e.text.slice(offset, offset + remaining),
        id = evidenceId(s, e.line);
      remaining -= text.length;
      read.add(id);
      results.push({
        sourceId: s.id,
        title: s.trace.title,
        evidenceId: id,
        hash: s.trace.hash,
        line: e.line,
        turn: e.turn,
        role: e.role,
        kind: e.kind,
        text,
        textOffset: offset,
        excerpt: offset > 0 || offset + text.length < e.text.length,
      });
      if (offset + text.length < e.text.length) {
        nextFromLine = e.line;
        nextOffset = offset + text.length;
        break;
      }
    }
    return JSON.stringify({
      events: results,
      nextFromLine,
      nextOffset,
      warnings: s.trace.warnings,
    });
  }
  throw new Error("工具不在只读轨迹白名单中。");
}
