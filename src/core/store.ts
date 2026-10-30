import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Review, Settings, SaveSettings } from "../shared/types";
import { modelProtocols } from "../shared/types";
import { inferLegacyProtocol } from "../shared/protocol";
import { endpointUrl, validateReport } from "./diagnosis";
import { selectEvents } from "../shared/selection";

const traceEvent = z.object({
  id: z.string(),
  kind: z.enum(["message", "tool_call", "tool_result", "context"]),
  role: z.string().optional(),
  text: z.string(),
  line: z.number().int().positive(),
  turn: z.number().int().positive(),
  timestamp: z.string().optional(),
  callId: z.string().optional(),
  name: z.string().optional(),
});
const trace = z.object({
  id: z.string(),
  path: z.string(),
  hash: z.string(),
  title: z.string(),
  cwd: z.string(),
  model: z.string().optional(),
  version: z.string().optional(),
  startedAt: z.string().optional(),
  events: z.array(traceEvent).max(200000),
  turns: z.number().int().positive(),
  warnings: z.array(z.string()),
  stats: z.object({
    turns: z.number(),
    toolCalls: z.number(),
    durationMs: z.number().optional(),
    totalTokens: z.number().optional(),
  }),
});
const task = z.object({
  goal: z.string().max(20000),
  criteria: z.string().max(20000),
  complaint: z.string().max(20000),
  fromTurn: z.number().int().positive(),
  toTurn: z.number().int().positive(),
  fromLine: z.number().int().positive().optional(),
  toLine: z.number().int().positive().optional(),
});
export const reviewSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  trace,
  task,
  report: z.unknown().optional(),
  analyzedTask: task.optional(),
  analyzedEventIds: z.array(z.string()).optional(),
  analysisMeta: z
    .object({
      model: z.string(),
      endpoint: z.string(),
      at: z.string(),
      guideVersion: z.string(),
    })
    .optional(),
  retry: z
    .object({
      trace,
      adopted: z.array(z.string()),
      outcome: z.enum(["改善", "无改善", "无法判断"]),
      criteriaResults: z.string().max(20000),
      notes: z.string().max(20000),
      savedAt: z.string(),
    })
    .optional(),
});
export function validateReview(value: unknown): Review {
  const r = reviewSchema.parse(value);
  if (r.task.toTurn < r.task.fromTurn || r.task.toTurn > r.trace.turns)
    throw new Error("任务轮次范围无效。");
  if (r.report) {
    const ids =
      r.analyzedEventIds ?? selectEvents(r.trace, r.task).map((e) => e.id);
    const allIds = new Set(r.trace.events.map((e) => e.id));
    if (ids.some((id) => !allIds.has(id)))
      throw new Error("诊断证据快照无效。");
    r.report = validateReport(r.report, new Set(ids));
  }
  if (
    r.retry?.adopted.some(
      (id) =>
        !(r.report as Review["report"])?.findings.some((f) => f.id === id),
    )
  )
    throw new Error("重试关联了不存在的建议。");
  return r as Review;
}
const settingsSchema = z.object({
  protocol: z.enum(modelProtocols),
  baseUrl: z.string().trim().max(2000),
  model: z.string().trim().max(300),
  maxInputChars: z.number().int().min(5000).max(1000000),
  apiKey: z.string().max(16000).optional(),
  clearKey: z.boolean().optional(),
});
export interface CryptoProvider {
  encrypt(text: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}
export class Store {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    public dir: string,
    private crypto: CryptoProvider,
  ) {}
  private async json(path: string): Promise<any> {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("本地数据无法读取，请检查数据目录中的文件。");
    }
  }
  private async atomic(path: string, value: unknown) {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }
  async settings(): Promise<Settings> {
    const s = await this.json(join(this.dir, "settings.json"));
    return {
      protocol: z
        .enum(modelProtocols)
        .parse(s?.protocol ?? inferLegacyProtocol(s?.baseUrl ?? "")),
      baseUrl: s?.baseUrl ?? "",
      model: s?.model ?? "",
      maxInputChars: s?.maxInputChars ?? 60000,
      hasKey: !!s?.encryptedKey,
    };
  }
  async key(): Promise<string> {
    const s = await this.json(join(this.dir, "settings.json"));
    if (!s?.encryptedKey) return "";
    try {
      return await this.crypto.decrypt(s.encryptedKey);
    } catch {
      throw new Error("API Key 无法解密，请在模型设置中重新填写。");
    }
  }
  async saveSettings(input: SaveSettings): Promise<Settings> {
    return this.serialize(async () => {
      const s = settingsSchema.parse(input);
      endpointUrl(s.baseUrl);
      if (!s.model) throw new Error("模型名不能为空。");
      const old = await this.json(join(this.dir, "settings.json"));
      // Never carry a saved credential over to a different endpoint without explicit re-entry.
      let encryptedKey = old?.encryptedKey;
      if (old?.baseUrl !== s.baseUrl || s.clearKey) encryptedKey = undefined;
      if (s.apiKey?.trim())
        encryptedKey = await this.crypto.encrypt(s.apiKey.trim());
      await this.atomic(join(this.dir, "settings.json"), {
        protocol: s.protocol,
        baseUrl: s.baseUrl,
        model: s.model,
        maxInputChars: s.maxInputChars,
        encryptedKey,
      });
      return this.settings();
    });
  }
  async saveReview(input: Review): Promise<Review> {
    const r = validateReview(input);
    r.updatedAt = new Date().toISOString();
    r.trace.events = selectEvents(r.trace, r.task);
    if (!r.trace.events.some((e) => e.kind !== "context"))
      throw new Error(
        "所选轮次没有可读消息或工具事件，请重新读取原轨迹并调整范围。",
      );
    if (r.retry) {
      if (!r.report || !r.retry.criteriaResults.trim())
        throw new Error("重试需要报告与验收结果。");
      if (
        r.retry.trace.id === r.trace.id &&
        r.retry.trace.events.some((e) =>
          r.trace.events.some((old) => old.id === e.id && old.text === e.text),
        )
      )
        throw new Error("重试范围与原复盘重叠，请选择后续轮次。");
    }
    return this.serialize(async () => {
      await this.atomic(join(this.dir, `${r.id}.json`), r);
      return r;
    });
  }
  async reviews(): Promise<{ reviews: Review[]; warnings: string[] }> {
    await mkdir(this.dir, { recursive: true });
    const reviews: Review[] = [];
    const warnings: string[] = [];
    for (const name of await readdir(this.dir)) {
      if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
      try {
        reviews.push(validateReview(await this.json(join(this.dir, name))));
      } catch {
        warnings.push(`复盘记录 ${name} 无法读取，已保留原文件。`);
      }
    }
    return {
      reviews: reviews.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      warnings,
    };
  }
}
