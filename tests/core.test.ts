import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseTraceText } from "../src/core/trace";
import {
  buildPreview,
  endpointUrl,
  requestDiagnosis,
  systemPrompt,
  validateReport,
} from "../src/core/diagnosis";
import { Store, validateReview } from "../src/core/store";
import type { Review, Settings } from "../src/shared/types";
const row = (type: string, payload: unknown, seconds = 0) =>
  JSON.stringify({
    timestamp: `2026-10-30T00:00:${String(seconds).padStart(2, "0")}Z`,
    type,
    payload,
  });
export const fixture = [
  row("session_meta", {
    id: "test-session",
    cwd: "D:\\中文目录",
    cli_version: "0.166",
  }),
  row("event_msg", { type: "task_started", turn_id: "t1" }),
  row("turn_context", {
    turn_id: "t1",
    model: "test-model",
    collaboration_mode: { mode: "plan" },
  }),
  row("response_item", {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "实现一个导出功能" }],
  }),
  row("response_item", {
    type: "function_call",
    name: "exec_command",
    call_id: "call1",
    arguments: '{"cmd":"npm test"}',
  }),
  row("event_msg", {
    type: "item_completed",
    turn_id: "t1",
    item: {
      type: "function_call",
      name: "exec_command",
      call_id: "call1",
      arguments: '{"cmd":"npm test"}',
    },
  }),
  row("response_item", {
    type: "function_call_output",
    call_id: "call1",
    output: "1 test failed",
  }),
  row(
    "response_item",
    { type: "message", role: "assistant", content: [{ text: "已完成" }] },
    30,
  ),
  row("event_msg", {
    type: "token_count",
    info: { total_token_usage: { total_tokens: 100 } },
  }),
  row("token_usage_record", { thread_token_usage: { total_tokens: 100 } }),
].join("\n");
const settings: Settings = {
  protocol: "openai-chat",
  baseUrl: "http://127.0.0.1:1234/v1/chat/completions",
  model: "configured-model",
  maxInputChars: 60000,
  hasKey: true,
};
export function reviewFixture(): Review {
  const now = new Date().toISOString();
  return {
    id: "ac661b55-9825-4dca-84d2-fdcb6cb96e96",
    createdAt: now,
    updatedAt: now,
    trace: parseTraceText(fixture),
    task: {
      goal: "完成导出",
      criteria: "测试通过",
      complaint: "测试失败却声称完成",
      fromTurn: 1,
      toTurn: 1,
    },
  };
}
export const validReport = {
  summary: "完成声明与测试结果不一致。",
  findings: [
    {
      id: "f1",
      title: "验收未闭环",
      category: "协作方式",
      certainty: "事实",
      explanation: "工具结果有失败，但随后声称完成。",
      evidenceIds: ["L7", "L8"],
      action: "将测试通过作为完成条件。",
      verification: "重试时检查测试输出与完成声明。",
      featureIds: [],
    },
  ],
  nextPrompt: "请先修复失败测试，测试通过后再报告完成，并提供测试结果。",
  limitations: ["只凭轨迹无法确认实际导出结果。"],
};
describe("Codex 轨迹", () => {
  it("归并 completed 镜像事件并关联工具输出，保留证据行号", () => {
    const t = parseTraceText(fixture);
    expect(t.events.filter((e) => e.kind === "tool_call")).toHaveLength(1);
    expect(t.events.find((e) => e.kind === "tool_result")).toMatchObject({
      name: "exec_command",
      line: 7,
      callId: "call1",
    });
    expect(t.stats.totalTokens).toBe(100);
    expect(t.turns).toBe(1);
    expect(t.title).toBe("实现一个导出功能");
  });
  it("跳过异常行与未知事件，并提示缺失调用", () => {
    const t = parseTraceText(
      fixture +
        "\n{broken\n" +
        row("future_event", {}) +
        "\n" +
        row("response_item", {
          type: "function_call_output",
          call_id: "missing",
          output: "result",
        }),
    );
    expect(t.warnings.join(" ")).toMatch(/第 11 行/);
    expect(t.warnings.join(" ")).toMatch(/未知事件/);
    expect(t.warnings.join(" ")).toMatch(/缺少对应调用/);
  });
  it("同样文本在不同轮次保留，旧版 event_msg 可读取", () => {
    const t = parseTraceText(
      [
        row("event_msg", { type: "task_started", turn_id: "a" }),
        row("event_msg", { type: "user_message", message: "再试一次" }),
        row("event_msg", { type: "task_started", turn_id: "b" }),
        row("event_msg", { type: "user_message", message: "再试一次" }),
      ].join("\n"),
    );
    expect(t.events).toHaveLength(2);
    expect(t.turns).toBe(2);
  });
  it("忽略加密推理、不把压缩记录误认为完整上下文", () => {
    const t = parseTraceText(
      fixture +
        "\n" +
        row("response_item", {
          type: "reasoning",
          encrypted_content: "SECRET",
        }) +
        "\n" +
        row("compacted", {}),
    );
    expect(JSON.stringify(t.events)).not.toContain("SECRET");
    expect(t.warnings.join(" ")).toMatch(/压缩/);
  });
  it("拒绝无可读事件的文件", () =>
    expect(() => parseTraceText("{}")).toThrow(/没有发现/));
});
describe("诊断边界", () => {
  it("单轮长任务可明确选择事件行范围，发送与保存都只包含所选片段", async () => {
    const r = reviewFixture();
    r.task.fromLine = 7;
    r.task.toLine = 8;
    const preview = buildPreview(r, settings);
    const body = JSON.parse(preview.payload);
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(["L7", "L8"]);
    expect(body.trace.warnings.join(" ")).toMatch(/另一端/);
    expect(() =>
      validateReport(
        {
          ...validReport,
          findings: [{ ...validReport.findings[0], evidenceIds: ["L4"] }],
        },
        new Set(body.events.map((e: { id: string }) => e.id)),
      ),
    ).toThrow(/证据/);
    const dir = await mkdtemp(join(tmpdir(), "狗狗-"));
    try {
      const store = new Store(dir, {
        encrypt: async (s) => s,
        decrypt: async (s) => s,
      });
      await store.saveReview(r);
      expect(
        (await store.reviews()).reviews[0].trace.events.map((e) => e.id),
      ).toEqual(["L7", "L8"]);
    } finally {
      if (!resolve(dir).startsWith(resolve(tmpdir(), "狗狗-")))
        throw new Error("Unsafe cleanup path");
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("没有不满意之处也能复盘，允许只有有效做法或没有改进项", () => {
    const r = reviewFixture();
    r.task.complaint = "";
    expect(buildPreview(r, settings).events).toBeGreaterThan(0);
    const result = validateReport(
      {
        ...validReport,
        findings: [],
        strengths: [{ text: "保留明确的原始任务描述", evidenceIds: ["L4"] }],
      },
      new Set(["L4"]),
    );
    expect(result.findings).toHaveLength(0);
    expect(result.strengths).toHaveLength(1);
    expect(() =>
      validateReport(
        { ...result, strengths: [{ text: "无效引用", evidenceIds: ["L999"] }] },
        new Set(["L4"]),
      ),
    ).toThrow(/证据/);
  });
  it("拒绝越界证据及伪造功能来源", () => {
    expect(() =>
      validateReport(
        {
          ...validReport,
          findings: [{ ...validReport.findings[0], evidenceIds: ["L999"] }],
        },
        new Set(["L7", "L8"]),
      ),
    ).toThrow(/证据/);
    expect(() =>
      validateReport(
        {
          ...validReport,
          findings: [{ ...validReport.findings[0], featureIds: ["invented"] }],
        },
        new Set(["L7", "L8"]),
      ),
    ).toThrow(/功能/);
  });
  it("模型能力只能标记推测，重复建议 ID 拒绝保存", () => {
    const f = { ...validReport.findings[0], category: "模型能力" };
    expect(
      validateReport({ ...validReport, findings: [f] }, new Set(["L7", "L8"]))
        .findings[0].certainty,
    ).toBe("推测");
    expect(() =>
      validateReport(
        { ...validReport, findings: [f, f] },
        new Set(["L7", "L8"]),
      ),
    ).toThrow(/重复/);
  });
  it("超预算与缺失任务条件在发送前阻止", () => {
    expect(() =>
      buildPreview(reviewFixture(), { ...settings, maxInputChars: 10 }),
    ).toThrow(/未发送/);
    expect(() =>
      buildPreview(
        { ...reviewFixture(), task: { ...reviewFixture().task, criteria: "" } },
        settings,
      ),
    ).toThrow(/验收/);
  });
  it("完整 URL 原样使用，不追加或删除路径，拒绝隐含鉴权及查询参数", () => {
    for (const url of [
      "https://example.test/v1/",
      "https://example.test/v1/responses",
      "https://example.test/proxy/v1/messages/",
      "http://localhost/v1/chat/completions",
      "https://example.test/custom-endpoint",
    ])
      expect(endpointUrl(` ${url} `)).toBe(url);
    for (const url of [
      "https://user:pass@example.test/v1",
      "https://example.test?key=secret",
      "file:///tmp/a",
      "https://example.test/#secret",
      "not-a-url",
    ])
      expect(() => endpointUrl(url)).toThrow();
  });
  it("请求不附带工具、不会跟随带密钥的重定向，校验返回 JSON", async () => {
    const fn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(validReport) } }],
        }),
      ),
    );
    const result = await requestDiagnosis(
      buildPreview(reviewFixture(), settings),
      "TEST-KEY",
      new AbortController().signal,
      fn,
    );
    expect(result.summary).toBe(validReport.summary);
    const init = fn.mock.calls[0][1]!;
    expect(init.redirect).toBe("error");
    expect(init.body).not.toContain("TEST-KEY");
    expect(JSON.parse(init.body as string)).not.toHaveProperty("tools");
  });
  it("API 失败不泄露响应中的密钥与内部错误", async () => {
    const fn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("SECRET-API-KEY", { status: 401 }));
    await expect(
      requestDiagnosis(
        buildPreview(reviewFixture(), settings),
        "key",
        new AbortController().signal,
        fn,
      ),
    ).rejects.toThrow(/HTTP 401/);
  });
  it.each(["openai-responses", "anthropic"] as const)(
    "%s 使用完整 URL、独立鉴权和请求结构，跳过推理块并拼接文本块",
    async (protocol) => {
      const content = "```json\n" + JSON.stringify(validReport) + "\n```";
      const parts = [content.slice(0, 70), content.slice(70)];
      const envelope =
        protocol === "openai-responses"
          ? {
              status: "completed",
              output: [
                { type: "reasoning", summary: [] },
                {
                  type: "message",
                  role: "assistant",
                  content: parts.map((text) => ({ type: "output_text", text })),
                },
              ],
            }
          : {
              type: "message",
              stop_reason: "end_turn",
              content: [
                { type: "thinking", thinking: "不要作为诊断 JSON 解析" },
                ...parts.map((text) => ({ type: "text", text })),
              ],
            };
      const endpoint = "https://proxy.test/custom/";
      const preview = buildPreview(reviewFixture(), {
        ...settings,
        protocol,
        baseUrl: endpoint,
      });
      const fn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(envelope)));
      const result = await requestDiagnosis(
        preview,
        "TEST-KEY",
        new AbortController().signal,
        fn,
      );
      expect(result.summary).toBe(validReport.summary);
      expect(fn.mock.calls[0][0]).toBe(endpoint);
      const init = fn.mock.calls[0][1]!;
      expect(init.redirect).toBe("error");
      const body = JSON.parse(init.body as string);
      expect(body).not.toHaveProperty("tools");
      expect(body).toMatchObject({ model: settings.model, stream: false });
      expect(init.body).not.toContain("TEST-KEY");
      if (protocol === "openai-responses") {
        expect(init.headers).toMatchObject({
          Authorization: "Bearer TEST-KEY",
        });
        expect(init.headers).not.toHaveProperty("x-api-key");
        expect(body).toMatchObject({
          instructions: systemPrompt,
          input: [{ role: "user", content: preview.payload }],
          store: false,
        });
        expect(body).not.toHaveProperty("messages");
      } else {
        expect(init.headers).toMatchObject({
          "x-api-key": "TEST-KEY",
          "anthropic-version": "2023-06-01",
        });
        expect(init.headers).not.toHaveProperty("Authorization");
        expect(body).toMatchObject({
          system: systemPrompt,
          max_tokens: 8192,
          messages: [{ role: "user", content: preview.payload }],
        });
        expect(body).not.toHaveProperty("input");
      }
    },
  );
  it.each(["openai-responses", "anthropic"] as const)(
    "%s 拒绝截断、拒答、协议不匹配、无效 JSON 和伪造证据，不回显响应正文",
    async (protocol) => {
      const wrap = (text: string) =>
        protocol === "openai-responses"
          ? {
              status: "completed",
              output: [
                { type: "message", content: [{ type: "output_text", text }] },
              ],
            }
          : { stop_reason: "end_turn", content: [{ type: "text", text }] };
      const badReport = {
        ...validReport,
        findings: [{ ...validReport.findings[0], evidenceIds: ["L999"] }],
      };
      const cases: Array<[unknown, RegExp]> = [
        [wrap("模型 SECRET-KEY invalid JSON"), /JSON/],
        [
          { choices: [{ message: { content: JSON.stringify(validReport) } }] },
          /协议|JSON/,
        ],
        [wrap(JSON.stringify(badReport)), /不存在的证据/],
      ];
      if (protocol === "openai-responses") {
        cases.push([
          { ...wrap(JSON.stringify(validReport)), status: "incomplete" },
          /未完成/,
        ]);
        cases.push([
          {
            status: "completed",
            output: [
              {
                type: "message",
                content: [{ type: "refusal", refusal: "SECRET-KEY" }],
              },
            ],
          },
          /没有可用文本/,
        ]);
        cases.push([
          { status: "failed", error: { message: "SECRET-KEY" } },
          /未完成/,
        ]);
      } else {
        cases.push([
          { ...wrap(JSON.stringify(validReport)), stop_reason: "max_tokens" },
          /输出上限/,
        ]);
        cases.push([
          { ...wrap(JSON.stringify(validReport)), stop_reason: "refusal" },
          /未完成/,
        ]);
        cases.push([
          { type: "error", error: { message: "SECRET-KEY" } },
          /模型服务返回错误/,
        ]);
      }
      for (const [envelope, error] of cases) {
        const fn = vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(JSON.stringify(envelope)));
        const result = requestDiagnosis(
          buildPreview(reviewFixture(), { ...settings, protocol }),
          "",
          new AbortController().signal,
          fn,
        );
        await expect(result).rejects.toThrow(error);
        await expect(result).rejects.not.toThrow(/SECRET-KEY/);
      }
    },
  );
  it.each(["openai-responses", "anthropic"] as const)(
    "%s 响应超限时停止读取，且不回显原文",
    async (protocol) => {
      const fn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("SECRET-KEY" + "x".repeat(2_000_000)));
      const result = requestDiagnosis(
        buildPreview(reviewFixture(), { ...settings, protocol }),
        "",
        new AbortController().signal,
        fn,
      );
      await expect(result).rejects.toThrow(/超过 2 MB/);
      await expect(result).rejects.not.toThrow(/SECRET-KEY/);
    },
  );
  it("网络错误、取消、无效 JSON 均明确失败", async () => {
    const preview = buildPreview(reviewFixture(), settings);
    await expect(
      requestDiagnosis(
        preview,
        "",
        new AbortController().signal,
        vi.fn().mockRejectedValue(new Error("SECRET")),
      ),
    ).rejects.toThrow(/无法连接/);
    const c = new AbortController();
    c.abort();
    await expect(
      requestDiagnosis(
        preview,
        "",
        c.signal,
        vi.fn().mockRejectedValue(new Error()),
      ),
    ).rejects.toThrow(/已取消/);
    await expect(
      requestDiagnosis(
        preview,
        "",
        new AbortController().signal,
        vi.fn().mockResolvedValue(new Response("garbage")),
      ),
    ).rejects.toThrow(/JSON/);
  });
});
describe("本地保存", () => {
  it("协议保存并恢复；旧设置按完整路径推断协议，地址保持原值", async () => {
    const dir = await mkdtemp(join(tmpdir(), "狗狗-"));
    const crypto = {
      encrypt: async (s: string) => s,
      decrypt: async (s: string) => s,
    };
    try {
      const store = new Store(dir, crypto);
      expect((await store.settings()).protocol).toBe("openai-responses");
      for (const [baseUrl, protocol] of [
        ["https://example.test/v1/responses", "openai-responses"],
        ["https://example.test/v1/messages/", "anthropic"],
        ["https://example.test/v1/chat/completions", "openai-chat"],
        ["https://example.test/v1", "openai-responses"],
      ] as const) {
        await writeFile(
          join(dir, "settings.json"),
          JSON.stringify({ ...settings, baseUrl, protocol: undefined }),
        );
        expect(await store.settings()).toMatchObject({ baseUrl, protocol });
      }
      await store.saveSettings({
        ...settings,
        baseUrl: "https://example.test/custom",
        protocol: "anthropic",
      });
      expect(await new Store(dir, crypto).settings()).toMatchObject({
        baseUrl: "https://example.test/custom",
        protocol: "anthropic",
      });
      await expect(
        store.saveSettings({
          ...settings,
          protocol: "unknown" as Settings["protocol"],
        }),
      ).rejects.toThrow();
    } finally {
      if (!resolve(dir).startsWith(resolve(tmpdir(), "狗狗-")))
        throw new Error("Unsafe cleanup path");
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("重启后恢复草稿和报告，已保存密钥不回传界面且更换服务后清除", async () => {
    const dir = await mkdtemp(join(tmpdir(), "狗狗-"));
    const crypto = {
      encrypt: async (s: string) => Buffer.from(s).toString("base64"),
      decrypt: async (s: string) => Buffer.from(s, "base64").toString(),
    };
    try {
      const s = new Store(dir, crypto);
      await s.saveSettings({ ...settings, apiKey: "MY-PRIVATE-KEY" });
      expect(await s.settings()).not.toHaveProperty("apiKey");
      expect(await readFile(join(dir, "settings.json"), "utf8")).not.toContain(
        "MY-PRIVATE-KEY",
      );
      const review = reviewFixture();
      review.report = validateReport(validReport, new Set(["L7", "L8"]));
      await s.saveReview(review);
      const again = new Store(dir, crypto);
      expect((await again.reviews()).reviews[0].report?.summary).toBe(
        validReport.summary,
      );
      expect(await again.key()).toBe("MY-PRIVATE-KEY");
      await again.saveSettings({
        ...settings,
        baseUrl: "http://another.test/v1",
      });
      expect(await again.key()).toBe("");
    } finally {
      if (!resolve(dir).startsWith(resolve(tmpdir(), "狗狗-")))
        throw new Error("Unsafe cleanup path");
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("拒绝可用于路径穿越的复盘 ID", () =>
    expect(() =>
      validateReview({ ...reviewFixture(), id: "../../bad" }),
    ).toThrow());
});
