import {
  test,
  expect,
  _electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { streamTurn, toolCall, traceFixture } from "./agent-fixtures";
import type { ModelProtocol } from "../src/shared/types";

let app: ElectronApplication,
  page: Page,
  dir: string,
  server: Server,
  url: string;
let protocol: ModelProtocol, scenario: string, stage: number;
let requests: Array<{ body: any; authorization?: string; key?: string }>;
const binary = createRequire(import.meta.url)("electron") as string;
const installedBinary = process.env.DOGDOG_E2E_EXE;
async function launch() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  env.DOGDOG_USER_DATA = join(dir, "profile");
  env.CODEX_HOME = join(dir, "codex");
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.DOGDOG_REAL_CHECK;
  app = await _electron.launch({
    executablePath: installedBinary || binary,
    args: installedBinary ? [] : [resolve(".")],
    env,
  });
  page = await app.firstWindow();
  await expect(page.getByRole("button", { name: "新建讨论" })).toBeVisible();
}
async function configure(p: ModelProtocol) {
  protocol = p;
  await page.getByRole("button", { name: "模型设置" }).click();
  await page.getByLabel("接口协议", { exact: true }).selectOption(p);
  await page.getByLabel("服务地址", { exact: true }).fill(
    url +
      {
        "openai-responses": "/responses",
        anthropic: "/messages",
        "openai-chat": "/chat",
      }[p],
  );
  await page.getByLabel("模型名", { exact: true }).fill("fixture-agent");
  await page
    .getByLabel("API Key", { exact: true })
    .fill("DOGDOG-MOCK-ONLY-KEY");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function send(text: string, confirm = false) {
  await page.getByLabel("你的问题", { exact: true }).fill(text);
  await page.getByRole("button", { name: "发送 ↗", exact: true }).click();
  if (confirm) {
    await expect(
      page.getByRole("dialog", { name: "确认对话的发送范围" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "确认范围并发送" }).click();
  }
  await expect(
    page.getByRole("button", { name: "发送 ↗", exact: true }),
  ).toBeVisible();
}
async function attach(
  paths = [join(dir, "任务甲.jsonl"), join(dir, "任务乙.jsonl")],
) {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, paths);
  await page.getByRole("button", { name: "关联轨迹", exact: false }).click();
  await expect(page.locator(".chat-source-list article")).toHaveCount(
    paths.length === 2 ? 2 : 1,
  );
}
test.beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dogdog-agent-e2e-"));
  await mkdir(join(dir, "codex", "sessions"), { recursive: true });
  await writeFile(join(dir, "任务甲.jsonl"), traceFixture());
  await writeFile(join(dir, "任务乙.jsonl"), traceFixture("b", "TRACE_ONLY_B"));
  scenario = "generic";
  stage = 0;
  protocol = "openai-responses";
  requests = [];
  server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({
      body,
      authorization: req.headers.authorization,
      key: req.headers["x-api-key"] as string | undefined,
    });
    const p: ModelProtocol =
      req.url === "/messages"
        ? "anthropic"
        : req.url === "/chat"
          ? "openai-chat"
          : "openai-responses";
    res.setHeader("Content-Type", "text/event-stream");
    let text = "",
      calls = [] as ReturnType<typeof toolCall>[];
    if (scenario === "delay") {
      res.write(
        'data: {"type":"response.output_text.delta","delta":"正在生成的部分回答"}\n\n',
      );
      return;
    }
    if (scenario === "bad") text = "错误引用 [S9:L999]";
    else if (scenario === "ask") {
      if (stage++ === 0)
        calls = [
          toolCall("ask_user", { question: "你希望怎样验收这次改进？" }),
        ];
      else text = "根据补充的验收条件，先运行测试，再检查导出文件。";
    } else if (scenario === "compare") {
      const n = stage++;
      if (n === 0) calls = [toolCall("list_sources")];
      else if (n === 1)
        calls = [toolCall("search_traces", { query: "failed" })];
      else if (n === 2)
        calls = [
          toolCall(
            "read_trace",
            { sourceId: "S1", fromLine: 2, toLine: 5 },
            "read-a",
          ),
          toolCall(
            "read_trace",
            { sourceId: "S2", fromLine: 2, toLine: 5 },
            "read-b",
          ),
        ];
      else
        text =
          "**事实：两个合成任务均有测试失败记录 [S1:L4] [S2:L4]。**\n推测：可能需要强化验收闭环。\n通用建议：完成声明前逐条核对验收条件。";
    } else
      text =
        "通用建议：明确目标、约束和可验证的验收条件，再根据反馈调整协作方式。";
    const bytes = Buffer.from(streamTurn(p, text, calls));
    for (let i = 0; i < bytes.length; i += 29)
      res.write(bytes.subarray(i, i + 29));
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await launch();
});
test.afterEach(async () => {
  await app?.close();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  const root = resolve(dir),
    prefix = resolve(tmpdir(), "dogdog-agent-e2e-");
  if (!root.startsWith(prefix)) throw new Error("Unsafe cleanup path");
  await rm(root, { recursive: true, force: true });
});
for (const p of ["openai-responses", "anthropic", "openai-chat"] as const) {
  test(`${p} 无轨迹、多轨迹工具循环、追问与重启、报告和原文证据`, async () => {
    await configure(p);
    await send("怎样表达验收条件？", true);
    await expect(page.locator(".chat-message-assistant").last()).toContainText(
      "通用建议",
    );
    expect(requests).toHaveLength(1);
    scenario = "ask";
    stage = 0;
    await send("需要我补充什么？");
    await expect(page.locator(".chat-message-assistant").last()).toContainText(
      "你希望怎样验收",
    );
    await app.close();
    await launch();
    await expect(page.getByLabel("你的问题")).toHaveAttribute(
      "placeholder",
      /补充你的回答/,
    );
    await send("测试全部通过，实际导出文件可打开。");
    await expect(page.locator(".chat-message-assistant").last()).toContainText(
      "根据补充",
    );
    const beforeA = await readFile(join(dir, "任务甲.jsonl"), "utf8"),
      beforeB = await readFile(join(dir, "任务乙.jsonl"), "utf8");
    await attach();
    scenario = "compare";
    stage = 0;
    await send("比较这两个任务反复出现的问题。", true);
    await expect(
      page.getByRole("button", { name: "查看证据 S1:L4", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "查看证据 S2:L4", exact: true })
      .click();
    const evidence = page.getByRole("dialog", { name: "轨迹证据 · S2:L4" });
    await expect(evidence).toContainText("TRACE_ONLY_B");
    await expect(evidence).toContainText("SHA-256");
    await evidence.getByRole("button", { name: "关闭", exact: true }).click();
    await page
      .getByRole("button", { name: "保存为报告", exact: true })
      .last()
      .click();
    await expect(page.locator(".chat-report-panel > button")).toHaveCount(1);
    await page
      .getByRole("button", { name: "保存为报告", exact: true })
      .last()
      .click();
    await expect(page.locator(".chat-report-panel > button")).toHaveCount(2);
    await page.getByRole("button", { name: "发送记录", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "实际发送记录" }),
    ).not.toContainText("DOGDOG-MOCK-ONLY-KEY");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    expect(await readFile(join(dir, "任务甲.jsonl"), "utf8")).toBe(beforeA);
    expect(await readFile(join(dir, "任务乙.jsonl"), "utf8")).toBe(beforeB);
    const conversations = await page.evaluate(() =>
      window.dogdog.conversations(),
    );
    expect(conversations[0].runs.at(-1)?.requests).toHaveLength(4);
    expect(conversations[0].runs.at(-1)?.tools).toHaveLength(4);
    expect(requests.every((r) => r.body.stream === true)).toBe(true);
    if (p === "anthropic")
      expect(requests.every((r) => r.key === "DOGDOG-MOCK-ONLY-KEY")).toBe(
        true,
      );
    else
      expect(
        requests.every(
          (r) => r.authorization === "Bearer DOGDOG-MOCK-ONLY-KEY",
        ),
      ).toBe(true);
    await app.close();
    await launch();
    await expect(page.locator(".chat-report-panel > button")).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "查看证据 S1:L4", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `verification/screenshots/v02-${p}-conversation.png`,
    });
  });
}
test("刷新快照保留历史证据、重新授权，移除来源后不发送旧引文", async () => {
  await configure("openai-responses");
  await attach();
  scenario = "compare";
  stage = 0;
  await send("比较任务", true);
  await writeFile(
    join(dir, "任务甲.jsonl"),
    traceFixture("a", "NEW_SNAPSHOT_ONLY"),
  );
  await page
    .getByRole("button", { name: "刷新快照", exact: true })
    .first()
    .click();
  await expect(page.locator(".chat-source-list article").last()).toContainText(
    "S3",
  );
  await page
    .getByRole("button", { name: "查看证据 S1:L4", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("TRACE_ONLY_A");
  await expect(page.getByRole("dialog")).toContainText("历史快照");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "移除", exact: true }).first().click();
  scenario = "generic";
  await send("从新的范围继续", true);
  const c = (await page.evaluate(() => window.dogdog.conversations()))[0];
  const payload = c.runs.at(-1)!.requests[0].payload;
  expect(payload).not.toContain("TRACE_ONLY_A");
  expect(payload).not.toContain("TRACE_ONLY_B");
  expect(payload).not.toContain("两个合成任务");
  expect(c.sources.filter((s) => s.active).map((s) => s.id)).toEqual(["S3"]);
});
test("取消保留未完成文本，不自动重试，伪造引用拒绝完整回答", async () => {
  await configure("openai-responses");
  scenario = "delay";
  await page.getByLabel("你的问题").fill("请分析");
  await page.getByRole("button", { name: "发送 ↗", exact: true }).click();
  await page.getByRole("button", { name: "确认范围并发送" }).click();
  await expect(page.locator(".chat-message-assistant").last()).toContainText(
    "正在生成的部分回答",
  );
  const blocked = await page.evaluate(async () => {
    const [c] = await window.dogdog.conversations();
    const { settings } = await window.dogdog.boot();
    const results = await Promise.allSettled([
      window.dogdog.sendMessage(c.id, "重复请求"),
      window.dogdog.removeSource(c.id, "S1"),
      window.dogdog.saveSettings(settings),
      window.dogdog.diagnose({} as never),
    ]);
    return results.map((r) => r.status);
  });
  expect(blocked).toEqual(["rejected", "rejected", "rejected", "rejected"]);
  await page.getByRole("button", { name: "停止分析", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "发送 ↗", exact: true }),
  ).toBeVisible();
  expect(
    (await page.evaluate(() => window.dogdog.conversations()))[0].runs.at(-1)
      ?.status,
  ).toBe("cancelled");
  expect(requests).toHaveLength(1);
  scenario = "bad";
  await send("继续分析");
  await expect(page.getByRole("alert")).toContainText("未读取");
  await expect(
    page.getByRole("button", { name: "保存为报告", exact: true }),
  ).toHaveCount(0);
});
test("超预算阻止发送，旧授权票据不能覆盖新增来源", async () => {
  await configure("openai-responses");
  const c = await page.evaluate(() => window.dogdog.createConversation());
  const preview = await page.evaluate(
    (id) => window.dogdog.previewConversation(id, "问题"),
    c.id,
  );
  await app.evaluate(
    ({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    },
    join(dir, "任务甲.jsonl"),
  );
  await page.evaluate((id) => window.dogdog.attachSources(id), c.id);
  const rejected = await page.evaluate(
    async ({ id, token }) => {
      try {
        await window.dogdog.authorizeConversation(id, token);
        return false;
      } catch {
        return true;
      }
    },
    { id: c.id, token: preview.token },
  );
  expect(rejected).toBe(true);
  const oversize = await page.evaluate(async (id) => {
    try {
      await window.dogdog.previewConversation(id, "大".repeat(70000));
      return false;
    } catch {
      return true;
    }
  }, c.id);
  expect(oversize).toBe(true);
  expect(requests).toHaveLength(0);
});
