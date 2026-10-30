import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename } from "node:path";
import type { Trace, TraceEvent } from "../shared/types";

type Obj = Record<string, any>;
export function readable(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value))
    return value.map(readable).filter(Boolean).join("\n");
  if (typeof value === "object") {
    const v = value as Obj;
    if (typeof v.text === "string") return v.text;
    if (v.content) return readable(v.content);
    return JSON.stringify(v);
  }
  return String(value);
}

export class TraceParser {
  private events: TraceEvent[] = [];
  private seen = new Set<string>();
  private turnIds = new Map<string, number>();
  private currentTurn = 0;
  private warnings = new Set<string>();
  private fallback: Array<{
    item: Obj;
    line: number;
    timestamp?: string;
    turn: number;
  }> = [];
  private digest = createHash("sha256");
  private id = "";
  private cwd = "";
  private model?: string;
  private version?: string;
  private startedAt?: string;
  private lastAt?: string;
  private tokens?: number;
  private validLines = 0;
  constructor(private path: string) {}
  private turn(id?: string, start = false) {
    if (id) {
      if (!this.turnIds.has(id)) this.turnIds.set(id, this.turnIds.size + 1);
      this.currentTurn = this.turnIds.get(id)!;
    } else if (start) this.currentTurn++;
    if (!this.currentTurn) this.currentTurn = 1;
    return this.currentTurn;
  }
  private add(
    item: Obj,
    line: number,
    timestamp?: string,
    turn = this.currentTurn || 1,
  ) {
    const type = item.type;
    let event:
      Omit<TraceEvent, "id" | "line" | "turn" | "timestamp"> | undefined;
    if (type === "message" || type === "agent_message") {
      const role = item.role ?? "assistant";
      const text = readable(item.content);
      if (text) event = { kind: "message", role, text };
    } else if (type === "function_call" || type === "custom_tool_call") {
      event = {
        kind: "tool_call",
        name: item.name ?? "未知工具",
        callId: item.call_id ?? item.id,
        text: readable(item.arguments ?? item.input),
      };
    } else if (
      type === "function_call_output" ||
      type === "custom_tool_call_output"
    ) {
      event = {
        kind: "tool_result",
        callId: item.call_id,
        text: readable(item.output),
      };
    }
    if (!event) return;
    const signature =
      event.kind === "message"
        ? `${turn}:${event.kind}:${event.role}:${event.text}`
        : `${turn}:${event.kind}:${event.callId ?? ""}:${event.text}`;
    if (this.seen.has(signature)) return;
    this.seen.add(signature);
    this.events.push({ ...event, id: `L${line}`, line, turn, timestamp });
  }
  accept(line: string, n: number) {
    this.digest.update(line + "\n");
    if (!line.trim()) return;
    let row: Obj;
    try {
      row = JSON.parse(line.replace(/^\uFEFF/, ""));
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new Error();
    } catch {
      this.warnings.add(`第 ${n} 行不是有效事件，已跳过。`);
      return;
    }
    this.validLines++;
    const p: Obj =
      row.payload && typeof row.payload === "object" ? row.payload : {};
    if (typeof row.timestamp === "string") {
      this.startedAt ??= row.timestamp;
      this.lastAt = row.timestamp;
    }
    if (row.type === "session_meta") {
      this.id ||= p.id ?? p.session_id ?? "";
      this.cwd ||= p.cwd ?? "";
      this.version ||= p.cli_version;
      if (
        p.parent_thread_id ||
        p.forked_from_id ||
        (typeof p.source === "object" && p.source?.subagent)
      )
        this.warnings.add(
          "该记录包含分支或子 Agent 来源；未自动合并关联聊天，跨聊天结论可能不完整。",
        );
    } else if (row.type === "turn_context") {
      this.turn(p.turn_id);
      this.model = p.model ?? this.model;
      const text = JSON.stringify({
        model: p.model,
        cwd: p.cwd,
        mode: p.collaboration_mode?.mode,
        effort: p.effort,
        approval_policy: p.approval_policy,
        sandbox: p.sandbox_policy?.type,
      });
      this.events.push({
        id: `L${n}`,
        line: n,
        turn: this.currentTurn,
        kind: "context",
        text,
        timestamp: row.timestamp,
      });
    } else if (row.type === "response_item") {
      if (
        [
          "message",
          "agent_message",
          "function_call",
          "custom_tool_call",
          "function_call_output",
          "custom_tool_call_output",
        ].includes(p.type)
      )
        this.add(p, n, row.timestamp);
      else if (
        ![
          "reasoning",
          "additional_tools",
          "web_search_call",
          "compaction",
          "image_generation_call",
          "local_shell_call",
        ].includes(p.type)
      )
        this.warnings.add(
          `未知 response_item：${String(p.type)}，未纳入诊断。`,
        );
    } else if (row.type === "event_msg") {
      if (p.type === "task_started")
        this.turn(p.turn_id ?? p.root_turn_id, true);
      else if (p.type === "item_completed" && p.item)
        this.fallback.push({
          item: p.item,
          line: n,
          timestamp: row.timestamp,
          turn: this.turn(p.turn_id),
        });
      else if (p.type === "user_message" || p.type === "agent_message")
        this.fallback.push({
          item: {
            type: "message",
            role: p.type === "user_message" ? "user" : "assistant",
            content: p.message ?? p.text,
          },
          line: n,
          timestamp: row.timestamp,
          turn: this.currentTurn || 1,
        });
      else if (p.type === "token_count")
        this.captureTokens(p.info?.total_token_usage);
      else if (p.type === "turn_aborted")
        this.warnings.add(`第 ${n} 行记录任务中断。`);
      else if (
        ![
          "task_complete",
          "thread_settings_applied",
          "agent_reasoning",
          "agent_reasoning_delta",
          "context_compacted",
          "warning",
          "error",
        ].includes(p.type)
      )
        this.warnings.add(`未知 event_msg：${String(p.type)}，未纳入诊断。`);
      if (p.type === "error" || p.type === "warning")
        this.warnings.add(`第 ${n} 行含 ${p.type} 事件，请检查原始轨迹。`);
    } else if (row.type === "token_usage_record")
      this.captureTokens(p.thread_token_usage);
    else if (row.type === "compacted")
      this.warnings.add("轨迹包含上下文压缩，较早内容可能不完整。");
    else if (
      ![
        "world_state",
        "retained_context",
        "inter_agent_communication_metadata",
      ].includes(row.type)
    )
      this.warnings.add(`未知事件：${String(row.type)}，未纳入诊断。`);
  }
  private captureTokens(value: Obj | undefined) {
    if (!value) return;
    const total = value.total_tokens ?? value.total;
    if (typeof total === "number" && Number.isFinite(total) && total >= 0)
      this.tokens = Math.max(this.tokens ?? 0, total);
  }
  finish(): Trace {
    for (const f of this.fallback) {
      const item =
        f.item.type === "UserMessage" || f.item.type === "AgentMessage"
          ? {
              ...f.item,
              type: "message",
              role: f.item.type === "UserMessage" ? "user" : "assistant",
            }
          : f.item;
      this.add(item, f.line, f.timestamp, f.turn);
    }
    this.events.sort((a, b) => a.line - b.line);
    const calls = new Map(
      this.events
        .filter((e) => e.kind === "tool_call" && e.callId)
        .map((e) => [e.callId, e]),
    );
    for (const e of this.events.filter((e) => e.kind === "tool_result")) {
      const call = calls.get(e.callId);
      e.name = call?.name;
      if (!call)
        this.warnings.add(
          `第 ${e.line} 行工具结果缺少对应调用，可能仅导出了部分轨迹。`,
        );
    }
    const outputs = new Set(
      this.events.filter((e) => e.kind === "tool_result").map((e) => e.callId),
    );
    if ([...calls.keys()].some((id) => !outputs.has(id)))
      this.warnings.add("部分工具调用没有对应结果，记录可能中断或尚未写完。");
    if (!this.id) this.warnings.add("缺少会话元数据；以文件名标识。");
    if (!this.validLines || !this.events.length)
      throw new Error("没有发现可读的 Codex 消息、工具调用或执行上下文。");
    const firstUser = this.events.find(
      (e) =>
        e.role === "user" &&
        !/^\s*(<environment_context>|<external_|# AGENTS\.md|<permissions|<INSTRUCTIONS>)/.test(
          e.text,
        ),
    );
    const turns = this.events.reduce((max, e) => Math.max(max, e.turn), 1);
    const duration =
      this.startedAt && this.lastAt
        ? Date.parse(this.lastAt) - Date.parse(this.startedAt)
        : NaN;
    return {
      id: this.id || basename(this.path),
      path: this.path,
      hash: this.digest.digest("hex"),
      title:
        firstUser?.text.replace(/\s+/g, " ").slice(0, 90) ||
        basename(this.path),
      cwd: this.cwd,
      model: this.model,
      version: this.version,
      startedAt: this.startedAt,
      events: this.events,
      turns,
      warnings: [...this.warnings],
      stats: {
        turns,
        toolCalls: calls.size,
        durationMs:
          Number.isFinite(duration) && duration >= 0 ? duration : undefined,
        totalTokens: this.tokens,
      },
    };
  }
}
export function parseTraceText(text: string, path = "trace.jsonl"): Trace {
  const parser = new TraceParser(path);
  text.split(/\r?\n/).forEach((s, i) => parser.accept(s, i + 1));
  return parser.finish();
}
export async function parseTraceFile(path: string): Promise<Trace> {
  const s = await stat(path);
  if (!s.isFile() || s.size > 100 * 1024 * 1024)
    throw new Error("请选择不超过 100 MB 的 JSONL 文件。");
  const parser = new TraceParser(path);
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let n = 0;
  try {
    for await (const line of lines) parser.accept(line, ++n);
  } finally {
    lines.close();
    input.destroy();
  }
  return parser.finish();
}
