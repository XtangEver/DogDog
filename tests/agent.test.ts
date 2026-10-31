import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { parseTraceText } from "../src/core/trace";
import {
  attachSnapshot,
  ConversationStore,
  newConversation,
  revokeSource,
  sourceFingerprint,
} from "../src/core/conversations";
import {
  agentInstructions,
  agentTools,
  executeTraceTool,
  initialWire,
  runConversation,
  validateCitations,
} from "../src/core/agent";
import {
  buildAgentRequest,
  requestAgentTurn,
} from "../src/core/agent-provider";
import type {
  Conversation,
  ModelProtocol,
  Settings,
} from "../src/shared/types";
import { streamTurn, toolCall, traceFixture } from "./agent-fixtures";
const settings: Settings = {
  protocol: "openai-responses",
  baseUrl: "https://provider.example/responses",
  model: "fixture",
  maxInputChars: 60000,
  hasKey: true,
  traceRoots: [],
  allowTraceSend: true,
};
const signal = () => new AbortController().signal;
const authorize = (c: Conversation, s = settings) => {
  c.grant = {
    fingerprint: sourceFingerprint(c, s),
    at: new Date().toISOString(),
  };
};
const fetchTurn = (
  protocol: ModelProtocol,
  text: string,
  calls = [] as ReturnType<typeof toolCall>[],
) =>
  vi.fn(
    async () =>
      new Response(streamTurn(protocol, text, calls), {
        headers: { "Content-Type": "text/event-stream" },
      }),
  ) as unknown as typeof fetch;
const run = (
  c: Conversation,
  fetcher: typeof fetch,
  text = "分析这些任务",
  s = settings,
) =>
  runConversation(
    c,
    text,
    s,
    "TEST-ONLY-KEY",
    signal(),
    async () => {},
    () => {},
    fetcher,
  );

describe("多来源证据与访问边界", () => {
  it("快照按内容去重，同号行按来源区分并绑定内容哈希", () => {
    const c = newConversation(),
      a = parseTraceText(traceFixture()),
      b = parseTraceText(traceFixture("b", "TRACE_ONLY_B"));
    attachSnapshot(c, a);
    attachSnapshot(c, a);
    attachSnapshot(c, b);
    expect(c.sources).toHaveLength(2);
    const read = new Set<string>();
    const result = JSON.parse(
      executeTraceTool(c, toolCall("search_traces", { query: "failed" }), read),
    );
    expect(result.results.map((e: any) => e.evidenceId)).toEqual([
      "S1:L4",
      "S2:L4",
    ]);
    expect(result.results[0].hash).toBe(a.hash);
    expect(validateCitations("事实 [S1:L4] [S2:L4]", read)).toHaveLength(2);
    expect(() => validateCitations("错误 [S3:L4]", read)).toThrow("未读取");
    expect(() => validateCitations("错误 [S1:Lx]", read)).toThrow();
  });
  it("拒绝越界来源、路径注入、未知工具与无效参数", () => {
    const c = newConversation();
    attachSnapshot(c, parseTraceText(traceFixture()));
    const read = new Set<string>();
    expect(() =>
      executeTraceTool(
        c,
        toolCall("read_trace", { sourceId: "S2", fromLine: 1, toLine: 8 }),
        read,
      ),
    ).toThrow("禁止访问");
    expect(() =>
      executeTraceTool(
        c,
        toolCall("read_trace", {
          sourceId: "S1",
          fromLine: 1,
          toLine: 8,
          path: "C:/secret",
        }),
        read,
      ),
    ).toThrow();
    expect(() =>
      executeTraceTool(
        c,
        toolCall("exec_command", { command: "whoami" }),
        read,
      ),
    ).toThrow("白名单");
    expect(() =>
      executeTraceTool(
        c,
        toolCall("read_trace", { sourceId: "S1", fromLine: 8, toLine: 1 }),
        read,
      ),
    ).toThrow("行范围");
    expect(() =>
      executeTraceTool(
        c,
        { id: "x", name: "search_traces", arguments: "{" },
        read,
      ),
    ).toThrow("JSON");
  });
  it("分页显式标记长文本片段，移除来源后阻止历史内容再次发送", () => {
    const c = newConversation(),
      trace = parseTraceText(traceFixture());
    trace.events[0].text = "X".repeat(15000);
    attachSnapshot(c, trace);
    const read = new Set<string>(),
      result = JSON.parse(
        executeTraceTool(
          c,
          toolCall("read_trace", { sourceId: "S1", fromLine: 2, toLine: 2 }),
          read,
        ),
      );
    expect(result.events[0].text).toHaveLength(10000);
    expect(result.nextOffset).toBe(10000);
    const next = JSON.parse(
      executeTraceTool(
        c,
        toolCall("read_trace", {
          sourceId: "S1",
          fromLine: 2,
          toLine: 2,
          offset: 10000,
        }),
        read,
      ),
    );
    expect(next.events[0].text).toHaveLength(5000);
    c.messages.push({
      id: randomUUID(),
      role: "assistant",
      text: "PRIVATE_OLD_QUOTE",
      createdAt: "now",
      runId: randomUUID(),
      status: "complete",
      kind: "answer",
      evidenceIds: [],
    });
    authorize(c);
    revokeSource(c, "S1");
    expect(c.grant).toBeUndefined();
    expect(JSON.stringify(initialWire(c, "新问题"))).not.toContain(
      "PRIVATE_OLD_QUOTE",
    );
    expect(() =>
      executeTraceTool(
        c,
        toolCall("read_trace", { sourceId: "S1", fromLine: 1, toLine: 5 }),
        read,
      ),
    ).toThrow();
  });
  it("历史快照指纹仍可读取（不再用于新发送授权）", () => {
    const c = newConversation();
    attachSnapshot(c, parseTraceText(traceFixture()));
    authorize(c);
    const before = c.grant!.fingerprint;
    expect(
      sourceFingerprint(c, { ...settings, baseUrl: "https://other.example/" }),
    ).not.toBe(before);
    expect(
      sourceFingerprint(c, { ...settings, protocol: "anthropic" }),
    ).not.toBe(before);
    expect(sourceFingerprint(c, { ...settings, model: "another" })).not.toBe(
      before,
    );
    attachSnapshot(c, parseTraceText(traceFixture("b")));
    expect(c.grant).toBeUndefined();
    expect(sourceFingerprint(c, settings)).not.toBe(before);
    revokeSource(c, "S1");
    attachSnapshot(c, parseTraceText(traceFixture("a", "CHANGED")));
    expect(c.sources.at(-1)?.id).toBe("S3");
    expect(c.sources[0].active).toBe(false);
  });
});
describe("协议与流式工具循环", () => {
  for (const protocol of [
    "openai-responses",
    "anthropic",
    "openai-chat",
  ] as const) {
    it(`${protocol} 支持碎片化 SSE、工具请求结果及实际发送预算`, async () => {
      const s = { ...settings, protocol },
        request = buildAgentRequest(
          s,
          agentInstructions,
          initialWire(newConversation(), "你好"),
          agentTools,
        );
      const encoded = new TextEncoder().encode(
        streamTurn(protocol, "", [
          toolCall("search_traces", { query: "失败" }),
        ]),
      );
      const fetcher = vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                for (let i = 0; i < encoded.length; i += 7)
                  controller.enqueue(encoded.slice(i, i + 7));
                controller.close();
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      );
      const turn = await requestAgentTurn(
        request,
        "TEST-ONLY-KEY",
        signal(),
        () => {},
        fetcher as typeof fetch,
      );
      expect(turn.calls[0]).toEqual(
        toolCall("search_traces", { query: "失败" }),
      );
      const next = buildAgentRequest(
        s,
        agentInstructions,
        [
          ...initialWire(newConversation(), "你好"),
          {
            role: "assistant",
            text: turn.text,
            calls: turn.calls,
            native: turn.native,
          },
          { role: "tool", callId: turn.calls[0].id, text: "RESULT_MARKER" },
        ],
        agentTools,
      );
      expect(next.payload).toContain("RESULT_MARKER");
      expect(next.chars).toBe(next.payload.length);
      const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
      expect(init[1].redirect).toBe("error");
      expect(request.payload).not.toContain("TEST-ONLY-KEY");
      await expect(
        requestAgentTurn(
          request,
          "",
          signal(),
          () => {},
          fetchTurn(protocol, "中文回答"),
        ),
      ).resolves.toMatchObject({ text: "中文回答" });
    });
  }
  it("无轨迹可讨论，授权缺失不发请求，输入超预算不发请求", async () => {
    const c = newConversation(),
      fetcher = fetchTurn("openai-responses", "一般建议：明确验收条件。");
    await expect(
      run(c, fetcher, "问题", { ...settings, allowTraceSend: false }),
    ).rejects.toThrow("确认");
    expect(fetcher).not.toHaveBeenCalled();
    authorize(c);
    await run(c, fetcher);
    expect(c.runs[0].status).toBe("completed");
    const next = newConversation();
    authorize(next);
    const over = vi.fn();
    await run(next, over as typeof fetch, "大".repeat(70000));
    expect(over).not.toHaveBeenCalled();
    expect(next.runs[0].error).toContain("超过上限");
  });
  it("多轮读证据后回答；保留每次请求以供检查", async () => {
    const c = newConversation();
    attachSnapshot(c, parseTraceText(traceFixture()));
    authorize(c);
    let stage = 0;
    const fetcher = vi.fn(
      async () =>
        new Response(
          stage++ === 0
            ? streamTurn("openai-responses", "", [
                toolCall("read_trace", {
                  sourceId: "S1",
                  fromLine: 2,
                  toLine: 5,
                }),
              ])
            : streamTurn(
                "openai-responses",
                "事实：测试失败后声明完成 [S1:L4] [S1:L5]。",
              ),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    await run(c, fetcher as typeof fetch);
    expect(c.runs[0].requests).toHaveLength(2);
    expect(c.messages.at(-1)?.evidenceIds).toEqual(["S1:L4", "S1:L5"]);
    expect(c.runs[0].requests[1].payload).toContain("TRACE_ONLY_A");
  });
  it("追问在重启后恢复，用户回答作为原工具结果继续", async () => {
    let c = newConversation();
    authorize(c);
    await run(
      c,
      fetchTurn("openai-responses", "", [
        toolCall("ask_user", { question: "你的验收条件是什么？" }),
      ]),
    );
    expect(c.runs[0].status).toBe("waiting");
    c = JSON.parse(JSON.stringify(c));
    const fetcher = fetchTurn(
      "openai-responses",
      "依据你补充的验收条件，可以开始验证。",
    );
    await run(c, fetcher, "测试全部通过");
    expect(c.runs).toHaveLength(1);
    expect(c.runs[0].status).toBe("completed");
    expect(c.runs[0].requests[1].payload).toContain("function_call_output");
    expect(c.runs[0].requests[1].payload).toContain("测试全部通过");
  });
  it("无效证据与 12 次循环上限不会产生完整回答", async () => {
    const c = newConversation();
    authorize(c);
    await run(c, fetchTurn("openai-responses", "伪造事实 [S1:L900]"));
    expect(c.runs[0].status).toBe("failed");
    expect(c.messages.at(-1)?.status).toBe("incomplete");
    const repeat = newConversation();
    authorize(repeat);
    await run(
      repeat,
      fetchTurn("openai-responses", "", [toolCall("list_sources")]),
    );
    expect(repeat.runs[0].requests).toHaveLength(12);
    expect(repeat.runs[0].error).toContain("12 次");
  });
  it("取消保留部分文本，断流与协议错误明确失败", async () => {
    const c = newConversation();
    authorize(c);
    const controller = new AbortController();
    await runConversation(
      c,
      "问题",
      settings,
      "",
      controller.signal,
      async () => {},
      (e) => {
        if (e.type === "delta") controller.abort();
      },
      fetchTurn("openai-responses", "部分回答"),
    );
    expect(c.runs[0].status).toBe("cancelled");
    expect(c.messages.at(-1)?.text).toContain("部分");
    const req = buildAgentRequest(
      settings,
      agentInstructions,
      initialWire(newConversation(), "问题"),
      agentTools,
    );
    await expect(
      requestAgentTurn(
        req,
        "",
        signal(),
        () => {},
        (async () =>
          new Response(
            'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
            { headers: { "Content-Type": "text/event-stream" } },
          )) as typeof fetch,
      ),
    ).rejects.toThrow("意外结束");
    await expect(
      requestAgentTurn(
        req,
        "",
        signal(),
        () => {},
        (async () =>
          new Response(JSON.stringify({ choices: [] }))) as typeof fetch,
      ),
    ).rejects.toThrow("协议");
  });
});
describe("对话持久化与恢复", () => {
  it("原子保存、重启标记中断、等待问题保持、拒绝路径穿越并保留损坏记录", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dogdog-conversation-"));
    try {
      const store = new ConversationStore(dir),
        c = newConversation();
      authorize(c);
      await run(
        c,
        fetchTurn("openai-responses", "", [
          toolCall("ask_user", { question: "需要补充什么？" }),
        ]),
      );
      await store.save(c);
      await store.recover();
      expect((await store.load(c.id)).runs[0].status).toBe("waiting");
      c.runs[0].status = "running";
      c.messages.at(-1)!.status = "generating";
      await store.save(c);
      await store.recover();
      const recovered = await store.load(c.id);
      expect(recovered.runs[0].status).toBe("interrupted");
      expect(recovered.messages.at(-1)?.status).toBe("incomplete");
      await expect(store.load("../settings")).rejects.toThrow("原文件已保留");
      await writeFile(join(dir, `${c.id}.json`), "{bad");
      await expect(store.list()).rejects.toThrow("原文件已保留");
      expect(await readFile(join(dir, `${c.id}.json`), "utf8")).toBe("{bad");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
