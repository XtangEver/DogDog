import { randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { traceSchema } from "./store";
import type { Conversation, Settings, Trace } from "../shared/types";

const call = z.object({
  id: z.string().min(1),
  name: z.string(),
  arguments: z.string(),
});
const schema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  title: z.string().max(200),
  createdAt: z.string(),
  updatedAt: z.string(),
  contextStart: z.number().int().nonnegative(),
  sources: z.array(
    z.object({
      id: z.string().regex(/^S[1-9]\d*$/),
      trace: traceSchema,
      attachedAt: z.string(),
      active: z.boolean(),
      libraryRoot: z.string().optional(),
    }),
  ),
  messages: z.array(
    z.object({
      id: z.string().uuid(),
      role: z.enum(["user", "assistant"]),
      text: z.string(),
      createdAt: z.string(),
      runId: z.string().uuid(),
      status: z.enum(["complete", "generating", "incomplete"]),
      kind: z.enum(["answer", "question"]),
      evidenceIds: z.array(z.string()),
    }),
  ),
  runs: z.array(
    z.object({
      id: z.string().uuid(),
      status: z.enum([
        "running",
        "waiting",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
      ]),
      startedAt: z.string(),
      updatedAt: z.string(),
      fingerprint: z.string(),
      requests: z.array(
        z.object({
          at: z.string(),
          protocol: z.enum(["openai-responses", "anthropic", "openai-chat"]),
          endpoint: z.string(),
          model: z.string(),
          payload: z.string(),
          chars: z.number(),
        }),
      ),
      tools: z.array(
        z.object({
          name: z.string(),
          arguments: z.string(),
          result: z.string(),
        }),
      ),
      wire: z.array(
        z.object({
          role: z.enum(["user", "assistant", "tool"]),
          text: z.string(),
          calls: z.array(call).optional(),
          callId: z.string().optional(),
          native: z.array(z.unknown()).optional(),
        }),
      ),
      evidenceIds: z.array(z.string()),
      questionCallId: z.string().optional(),
      error: z.string().optional(),
    }),
  ),
  reports: z.array(
    z.object({
      id: z.string().uuid(),
      version: z.number().int().positive(),
      messageId: z.string().uuid(),
      text: z.string(),
      evidenceIds: z.array(z.string()),
      createdAt: z.string(),
    }),
  ),
  accessFingerprint: z.string().optional(),
  excludedPaths: z.array(z.string()).optional(),
  grant: z.object({ fingerprint: z.string(), at: z.string() }).optional(),
});
export function validateConversation(input: unknown): Conversation {
  const c = schema.parse(input);
  if (
    new Set(c.sources.map((s) => s.id)).size !== c.sources.length ||
    c.contextStart > c.messages.length
  )
    throw new Error("对话来源或上下文记录无效。");
  return c;
}
export function newConversation(): Conversation {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: randomUUID(),
    title: "新的讨论",
    createdAt: now,
    updatedAt: now,
    contextStart: 0,
    sources: [],
    messages: [],
    runs: [],
    reports: [],
  };
}
export function sourceFingerprint(c: Conversation, settings: Settings) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        protocol: settings.protocol,
        endpoint: settings.baseUrl,
        model: settings.model,
        sources: c.sources
          .filter((s) => s.active)
          .map((s) => [s.id, s.trace.hash]),
      }),
    )
    .digest("hex");
}
export function attachSnapshot(c: Conversation, trace: Trace) {
  const duplicate = c.sources.find(
    (s) => s.active && s.trace.hash === trace.hash,
  );
  if (duplicate) return duplicate;
  const source = {
    id: `S${c.sources.reduce((n, s) => Math.max(n, Number(s.id.slice(1))), 0) + 1}`,
    trace,
    attachedAt: new Date().toISOString(),
    active: true,
  };
  c.sources.push(source);
  delete c.grant;
  return source;
}
export function revokeSource(c: Conversation, sourceId: string) {
  const s = c.sources.find((s) => s.id === sourceId && s.active);
  if (!s) throw new Error("来源不存在或已移除。");
  s.active = false;
  // Earlier messages can contain quotes from the revoked source. Keep them local,
  // but start a new model context so removed material cannot be sent again.
  c.contextStart = c.messages.length;
  delete c.grant;
  const waiting = c.runs.find((r) => r.status === "waiting");
  if (waiting) {
    waiting.status = "interrupted";
    waiting.error = "来源已更新，请重新提问。";
  }
}
export class ConversationStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public dir: string) {}
  private path(id: string) {
    return join(this.dir, `${z.string().uuid().parse(id)}.json`);
  }
  async load(id: string): Promise<Conversation> {
    try {
      return validateConversation(
        JSON.parse(await readFile(this.path(id), "utf8")),
      );
    } catch {
      throw new Error("对话无法读取，原文件已保留。");
    }
  }
  async list(): Promise<Conversation[]> {
    await mkdir(this.dir, { recursive: true });
    const all: Conversation[] = [];
    for (const f of await readdir(this.dir)) {
      if (!/^[0-9a-f-]{36}\.json$/i.test(f)) continue;
      // A damaged conversation is reported rather than silently disappearing.
      all.push(await this.load(f.slice(0, -5)));
    }
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async save(input: Conversation) {
    const c = validateConversation(input);
    c.updatedAt = new Date().toISOString();
    const work = async () => {
      await mkdir(this.dir, { recursive: true });
      const path = this.path(c.id),
        temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(c), {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
      return c;
    };
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }
  async recover() {
    for (const c of await this.list()) {
      let changed = false;
      for (const r of c.runs.filter((r) => r.status === "running")) {
        r.status = "interrupted";
        r.error = "应用退出时分析未完成，请手动继续。";
        changed = true;
      }
      for (const m of c.messages.filter((m) => m.status === "generating")) {
        m.status = "incomplete";
        changed = true;
      }
      if (changed) await this.save(c);
    }
  }
}
