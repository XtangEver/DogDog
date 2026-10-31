import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkedPath,
  applyAccessPolicy,
  accessFingerprint,
} from "../src/core/access-policy";
import { TraceLibrary } from "../src/core/trace-library";
import { createToolExecutor } from "../src/core/tool-runtime";
import { newConversation } from "../src/core/conversations";
import { runConversation } from "../src/core/agent";
import { Store } from "../src/core/store";
import { parseTraceFile } from "../src/core/trace";
import type { Settings } from "../src/shared/types";
import { streamTurn, toolCall, traceFixture } from "./agent-fixtures";

let dir: string, roots: string[], library: TraceLibrary;
const signal = () => new AbortController().signal;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dogdog-library-"));
  roots = [join(dir, "sessions"), join(dir, "archived_sessions")];
  for (const root of roots) await mkdir(root);
  library = new TraceLibrary(roots, join(dir, "cache"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const settings = (): Settings => ({
  protocol: "openai-responses",
  baseUrl: "https://example.test/responses",
  model: "fixture",
  maxInputChars: 60000,
  hasKey: false,
  traceRoots: roots,
  allowTraceSend: true,
});
describe("轨迹库与自主检索", () => {
  it("正在读取轨迹时可以取消，不产生完整结果", async () => {
    const file = join(roots[0], "large.jsonl");
    await writeFile(
      file,
      Array.from({ length: 10000 }, (_, i) => traceFixture(String(i))).join(
        "\n",
      ),
    );
    const controller = new AbortController();
    const parsing = parseTraceFile(file, controller.signal);
    const timer = setTimeout(() => controller.abort(), 2);
    try {
      await expect(parsing).rejects.toThrow();
    } finally {
      clearTimeout(timer);
    }
  });
  it("工具检索中取消后不继续请求模型，保存未完成状态", async () => {
    const c = newConversation(),
      controller = new AbortController();
    const fetcher = vi.fn(
      async () =>
        new Response(
          streamTurn("openai-responses", "", [
            toolCall("search_traces", { query: "鼠标" }),
          ]),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    ) as unknown as typeof fetch;
    await runConversation(
      c,
      "搜索",
      settings(),
      "",
      controller.signal,
      async () => {},
      () => {},
      fetcher,
      async () => {
        controller.abort();
        throw new Error("已停止分析。");
      },
    );
    expect(c.runs[0].status).toBe("cancelled");
    expect(c.messages.at(-1)?.status).toBe("incomplete");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("检索归档中文正文，自动快照、来源引用与上下文读取；无关材料不返回", async () => {
    const mouse = traceFixture("mouse", "鼠标移动缓慢，DPI 过低，调整后恢复");
    await writeFile(
      join(roots[0], "干扰.jsonl"),
      traceFixture("noise", "NOISE_SECRET"),
    );
    await writeFile(join(roots[1], "鼠标.jsonl"), mouse);
    const c = newConversation(),
      read = new Set<string>(),
      execute = createToolExecutor(library);
    const found = JSON.parse(
      await execute(
        c,
        toolCall("discover_sessions", { query: "鼠标" }),
        read,
        signal(),
      ),
    );
    expect(found.sessions).toHaveLength(1);
    expect(c.sources).toHaveLength(0);
    const result = JSON.parse(
      await execute(
        c,
        toolCall("search_traces", {
          query: "鼠标",
          sessionId: found.sessions[0].sessionId,
          cwd: "合成项目",
          fromDate: "2026-10-30",
          toDate: "2026-10-30",
        }),
        read,
        signal(),
      ),
    );
    expect(result.results[0].evidenceId).toBe("S1:L4");
    expect(JSON.stringify(result)).not.toContain("NOISE_SECRET");
    expect(c.sources[0].libraryRoot).toBe(roots[1]);
    expect(read).toEqual(new Set(["S1:L4"]));
    const context = JSON.parse(
      await execute(
        c,
        toolCall("read_trace", { sourceId: "S1", fromLine: 2, toLine: 5 }),
        read,
        signal(),
      ),
    );
    expect(context.events).toHaveLength(4);
    expect(await readFile(join(roots[1], "鼠标.jsonl"), "utf8")).toBe(mouse);
  });
  it("超过 150 份仍可检索、分页稳定且只快照返回的命中", async () => {
    for (let i = 0; i < 155; i++)
      await writeFile(
        join(roots[0], `${i}.jsonl`),
        traceFixture(String(i), "鼠标"),
      );
    const c = newConversation(),
      execute = createToolExecutor(library),
      read = new Set<string>();
    const page = JSON.parse(
      await execute(
        c,
        toolCall("search_traces", { query: "鼠标", offset: 140 }),
        read,
        signal(),
      ),
    );
    expect(page.total).toBe(155);
    expect(page.results).toHaveLength(15);
    expect(page.nextOffset).toBeNull();
    expect(c.sources).toHaveLength(15);
    expect(read.size).toBe(15);
  });
  it("缓存跨实例复用、损坏重建、文件变化增量更新且保留旧引用", async () => {
    const file = join(roots[0], "trace.jsonl");
    await writeFile(file, traceFixture("a", "OLD"));
    const [entry] = (await library.scan(signal())).entries;
    const old = await library.load(entry, signal());
    const cache = join(dir, "cache", `${entry.sessionId}.json`);
    const before = await readFile(cache, "utf8");
    expect(
      await new TraceLibrary(roots, join(dir, "cache")).load(entry, signal()),
    ).toEqual(old);
    expect(await readFile(cache, "utf8")).toBe(before);
    await writeFile(cache, "{broken");
    expect((await library.load(entry, signal())).hash).toBe(old.hash);
    await writeFile(file, traceFixture("a", "NEW_CONTENT"));
    const current = await library.load(entry, signal());
    expect(current.hash).not.toBe(old.hash);
    expect(current.events[2].text).toContain("NEW_CONTENT");
  });
  it("空结果、损坏文件、缺失目录与取消有明确反馈", async () => {
    await writeFile(join(roots[0], "bad.jsonl"), "{bad");
    const execute = createToolExecutor(library),
      c = newConversation();
    const result = JSON.parse(
      await execute(
        c,
        toolCall("search_traces", { query: "找不到" }),
        new Set(),
        signal(),
      ),
    );
    expect(result.total).toBe(0);
    expect(result.incomplete).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    const missing = await new TraceLibrary(
      [join(dir, "missing")],
      join(dir, "cache"),
    ).scan(signal());
    expect(missing.warnings.length).toBeGreaterThan(0);
    const controller = new AbortController();
    controller.abort();
    await expect(
      execute(
        c,
        toolCall("search_traces", { query: "a" }),
        new Set(),
        controller.signal,
      ),
    ).rejects.toThrow("停止");
  });
  it("拒绝越界、目录联接与包含联接的根目录", async () => {
    const outside = join(dir, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.jsonl"), traceFixture());
    await expect(
      checkedPath(roots[0], join(outside, "secret.jsonl")),
    ).rejects.toThrow("越出");
    const linked = join(roots[0], "linked");
    await symlink(outside, linked, "junction");
    await expect(
      checkedPath(roots[0], join(linked, "secret.jsonl")),
    ).rejects.toThrow("链接");
    expect((await library.scan(signal())).entries).toHaveLength(0);
    expect(
      (await new TraceLibrary([linked], join(dir, "cache")).scan(signal()))
        .warnings.length,
    ).toBeGreaterThan(0);
  });
  it("标题、日期、项目目录过滤，非法日期拒绝", async () => {
    await writeFile(join(roots[0], "task.jsonl"), traceFixture());
    const execute = createToolExecutor(library),
      c = newConversation(),
      read = new Set<string>();
    expect(
      JSON.parse(
        await execute(
          c,
          toolCall("discover_sessions", { query: "实现导出" }),
          read,
          signal(),
        ),
      ).total,
    ).toBe(1);
    expect(
      JSON.parse(
        await execute(
          c,
          toolCall("discover_sessions", { fromDate: "2026-10-31" }),
          read,
          signal(),
        ),
      ).total,
    ).toBe(0);
    expect(
      JSON.parse(
        await execute(
          c,
          toolCall("discover_sessions", { cwd: "other" }),
          read,
          signal(),
        ),
      ).total,
    ).toBe(0);
    await expect(
      execute(
        c,
        toolCall("search_traces", { query: "", fromDate: "2026-99-99" }),
        read,
        signal(),
      ),
    ).rejects.toThrow();
  });
  it("每种协议支持从未关联对话完成自动搜索、原文读取和引用", async () => {
    await writeFile(
      join(roots[1], "mouse.jsonl"),
      traceFixture("mouse", "鼠标 DPI 过低"),
    );
    for (const protocol of [
      "openai-responses",
      "anthropic",
      "openai-chat",
    ] as const) {
      const c = newConversation();
      let step = 0;
      const fetcher = vi.fn(
        async () =>
          new Response(
            streamTurn(
              protocol,
              step === 2 ? "调整 DPI 后恢复 [S1:L4]" : "",
              step++ === 0
                ? [toolCall("search_traces", { query: "鼠标" })]
                : step === 2
                  ? [
                      toolCall("read_trace", {
                        sourceId: "S1",
                        fromLine: 2,
                        toLine: 5,
                      }),
                    ]
                  : [],
            ),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      ) as unknown as typeof fetch;
      await runConversation(
        c,
        "之前鼠标移动缓慢如何解决？",
        { ...settings(), protocol },
        "",
        signal(),
        async () => {},
        () => {},
        fetcher,
        createToolExecutor(library),
      );
      expect(c.runs[0].status).toBe("completed");
      expect(c.messages.at(-1)?.evidenceIds).toEqual(["S1:L4"]);
      expect(c.runs[0].requests).toHaveLength(3);
    }
  });
});
describe("持久授权", () => {
  it("新讨论与重启无需对话授权；模型和新快照不改变发送授权", async () => {
    const store = new Store(join(dir, "profile"), {
      encrypt: async (s) => s,
      decrypt: async (s) => s,
    });
    const saved = await store.saveSettings(settings());
    const loaded = await new Store(join(dir, "profile"), {
      encrypt: async (s) => s,
      decrypt: async (s) => s,
    }).settings();
    expect(loaded.allowTraceSend).toBe(true);
    expect(accessFingerprint(saved)).toBe(accessFingerprint(loaded));
    expect(accessFingerprint(loaded)).toBe(
      accessFingerprint({ ...loaded, model: "other" }),
    );
    const c = newConversation();
    expect(() => applyAccessPolicy(c, loaded)).not.toThrow();
    expect(() => applyAccessPolicy(newConversation(), loaded)).not.toThrow();
    expect(
      (
        await store.saveSettings({
          ...loaded,
          baseUrl: "https://other.test/responses",
          allowTraceSend: undefined,
        })
      ).allowTraceSend,
    ).toBe(false);
  });
  it("撤销范围后历史上下文与等待步骤不再发送，原快照留本机", async () => {
    await writeFile(
      join(roots[1], "mouse.jsonl"),
      traceFixture("mouse", "鼠标"),
    );
    const c = newConversation(),
      s = settings();
    applyAccessPolicy(c, s);
    await createToolExecutor(library)(
      c,
      toolCall("search_traces", { query: "鼠标" }),
      new Set(),
      signal(),
    );
    const changed = { ...s, traceRoots: [roots[0]] };
    applyAccessPolicy(c, changed);
    expect(c.sources[0].active).toBe(false);
    expect(c.sources[0].trace.events).not.toHaveLength(0);
    expect(() =>
      applyAccessPolicy(c, { ...changed, allowTraceSend: false }),
    ).toThrow("发送权限");
  });
  it("移除后的来源不会被全库检索重新加入", async () => {
    const file = join(roots[0], "a.jsonl");
    await writeFile(file, traceFixture("a", "鼠标"));
    const c = newConversation();
    c.excludedPaths = [file];
    const result = JSON.parse(
      await createToolExecutor(library)(
        c,
        toolCall("search_traces", { query: "鼠标" }),
        new Set(),
        signal(),
      ),
    );
    expect(result.total).toBe(0);
    expect(c.sources).toHaveLength(0);
  });
});
