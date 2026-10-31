import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const electronBinary = createRequire(import.meta.url)("electron") as string;
const installedBinary = process.env.DOGDOG_E2E_EXE;
const screenshotDir =
  process.env.DOGDOG_SCREENSHOT_DIR || "verification/screenshots";

const row = (type: string, payload: unknown, sec = 0) =>
  JSON.stringify({
    timestamp: `2026-10-30T00:00:${String(sec).padStart(2, "0")}Z`,
    type,
    payload,
  });
function fixture(retry = false) {
  return [
    row("session_meta", {
      id: retry ? "retry-session" : "original-session",
      cwd: "D:\\中文项目",
      cli_version: "0.166.0",
    }),
    row("event_msg", { type: "task_started", turn_id: "t1" }),
    row("turn_context", { turn_id: "t1", model: "source-model" }),
    row("response_item", {
      type: "message",
      role: "user",
      content: [{ text: "实现导出功能" }],
    }),
    row("response_item", {
      type: "function_call",
      name: "exec_command",
      call_id: "c1",
      arguments: "npm test",
    }),
    row("event_msg", {
      type: "item_completed",
      turn_id: "t1",
      item: {
        type: "function_call",
        name: "exec_command",
        call_id: "c1",
        arguments: "npm test",
      },
    }),
    row(
      "response_item",
      {
        type: "function_call_output",
        call_id: "c1",
        output: retry ? "all tests passed" : "1 test failed",
      },
      20,
    ),
    row(
      "response_item",
      {
        type: "message",
        role: "assistant",
        content: [{ text: retry ? "测试通过，导出成功" : "已完成" }],
      },
      30,
    ),
  ].join("\n");
}
const report = {
  summary: "完成声明与测试输出不一致，需要把测试通过作为验收条件。",
  findings: [
    {
      id: "f1",
      category: "协作方式",
      title: "完成声明缺少验收依据",
      certainty: "事实",
      explanation: "工具输出失败后，仍然声称完成。",
      evidenceIds: ["L7", "L8"],
      action: "修复失败测试并提供最终通过结果。",
      verification: "重试后检查测试全部通过。",
      featureIds: [],
    },
  ],
  nextPrompt: "请修复失败测试，运行完整验证，提供通过结果后再报告完成。",
  limitations: ["无法仅凭日志确认功能实际行为。"],
};
let app: ElectronApplication;
let page: Page;
let dir: string;
let original: string;
let retry: string;
let service: Server;
let url: string;
let mode: string;
let requests: Array<{
  body: any;
  auth?: string;
  path?: string;
  apiKey?: string;
  version?: string;
}>;
async function launch() {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  env.DOGDOG_USER_DATA = join(dir, "用户数据");
  env.CODEX_HOME = join(dir, "codex");
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: installedBinary || electronBinary,
    args: installedBinary ? [] : [resolve(".")],
    env,
  });
  page = await app.firstWindow();
  const legacy = page.getByRole("button", { name: "旧版复盘", exact: true });
  await legacy.or(page.getByText("下一次，让协作更顺一点。")).waitFor();
  if (await legacy.isVisible()) await legacy.click();
  await page.getByText("下一次，让协作更顺一点。").waitFor();
}
async function importOriginal() {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, original);
  await page.getByRole("button", { name: "导入任务轨迹" }).click();
  await page.getByLabel("任务目标", { exact: true }).fill("完成导出并通过测试");
  await page
    .getByLabel("验收标准", { exact: true })
    .fill("全部测试通过；实际导出文件可读取");
  await page
    .getByLabel("重点关注", { exact: true })
    .fill("测试失败却声称已经完成");
}
async function configure(
  protocol = "openai-chat",
  path = "/v1/chat/completions",
) {
  await page.getByRole("button", { name: "模型设置" }).click();
  await page.getByLabel("接口协议", { exact: true }).selectOption(protocol);
  await page.getByLabel("服务地址", { exact: true }).fill(url + path);
  await page
    .getByLabel("模型名", { exact: true })
    .fill("test-diagnostic-model");
  await page.getByLabel("API Key", { exact: true }).fill("DOGDOG-TEST-KEY");
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function send() {
  await page.getByRole("button", { name: "检查发送内容" }).click();
  await expect(
    page.getByRole("dialog", { name: "发送前，检查一下" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "发送并开始诊断" }).click();
}
test.beforeEach(async () => {
  await mkdir(screenshotDir, { recursive: true });
  dir = await mkdtemp(join(tmpdir(), "DogDog-桌面验证-"));
  await mkdir(join(dir, "codex", "sessions"), { recursive: true });
  original = join(dir, "原任务.jsonl");
  retry = join(dir, "重试任务.jsonl");
  await writeFile(original, fixture());
  await writeFile(retry, fixture(true));
  mode = "success";
  requests = [];
  service = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      body: JSON.parse(body),
      auth: req.headers.authorization,
      path: req.url,
      apiKey: req.headers["x-api-key"] as string | undefined,
      version: req.headers["anthropic-version"] as string | undefined,
    });
    if (mode === "delay") {
      setTimeout(() => {
        if (!res.destroyed) res.end("{}");
      }, 2000);
      return;
    }
    const output: Record<string, any> = structuredClone(report);
    if (mode === "neutral") {
      output.summary = "任务目标明确，本次没有足够证据支持优先改进项。";
      output.findings = [];
      output.strengths = [
        { text: "用户明确说明了想完成的功能。", evidenceIds: ["L4"] },
      ];
    }
    if (mode === "bad-evidence") output.findings[0].evidenceIds = ["L999"];
    res.setHeader("Content-Type", "application/json");
    const text = JSON.stringify(output);
    res.end(
      JSON.stringify(
        req.url === "/proxy/responses/"
          ? {
              status: "completed",
              output: [
                { type: "reasoning", summary: [] },
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text }],
                },
              ],
            }
          : req.url === "/proxy/messages/"
            ? {
                type: "message",
                stop_reason: "end_turn",
                content: [
                  { type: "thinking", thinking: "ignored" },
                  { type: "text", text },
                ],
              }
            : req.url === "/v1/chat/completions"
              ? { choices: [{ message: { content: text } }] }
              : { error: "unexpected URL" },
      ),
    );
  });
  await new Promise<void>((r) => service.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(service.address() as { port: number }).port}`;
  await launch();
});
test.afterEach(async () => {
  await app?.close();
  service?.closeAllConnections();
  await new Promise<void>((r) => service?.close(() => r()));
  if (!resolve(dir).startsWith(resolve(tmpdir(), "DogDog-桌面验证-")))
    throw new Error("Unsafe test cleanup path");
  await rm(dir, { recursive: true, force: true });
});
for (const protocol of ["openai-responses", "anthropic"] as const) {
  test(`${protocol} 完整 URL、协议预览、诊断和重启恢复`, async () => {
    const path =
      protocol === "anthropic" ? "/proxy/messages/" : "/proxy/responses/";
    await configure(protocol, path);
    await page.getByRole("button", { name: "模型设置" }).click();
    await expect(page.getByLabel("接口协议", { exact: true })).toHaveValue(
      protocol,
    );
    await expect(
      page.getByText(
        "填写完整接口 URL，按原地址发送，不追加路径；更换地址时需重新填写密钥。",
      ),
    ).toBeVisible();
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({
      path: `${screenshotDir}/protocol-${protocol}-settings.png`,
    });
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await importOriginal();
    await page.getByRole("button", { name: "检查发送内容" }).click();
    await expect(page.getByRole("dialog")).toContainText(url + path);
    await expect(page.getByRole("dialog")).toContainText(
      protocol === "anthropic"
        ? "Claude / Anthropic Messages"
        : "OpenAI Responses",
    );
    expect(requests).toHaveLength(0);
    await page.screenshot({
      path: `${screenshotDir}/protocol-${protocol}-preview.png`,
    });
    await page.getByRole("button", { name: "发送并开始诊断" }).click();
    await expect(
      page.getByRole("heading", { name: "完成声明缺少验收依据" }),
    ).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe(path);
    expect(requests[0].body).not.toHaveProperty("tools");
    if (protocol === "anthropic") {
      expect(requests[0].apiKey).toBe("DOGDOG-TEST-KEY");
      expect(requests[0].version).toBe("2023-06-01");
      expect(requests[0].auth).toBeUndefined();
      expect(requests[0].body.system).toContain("输出中文 JSON");
      expect(requests[0].body.max_tokens).toBe(8192);
    } else {
      expect(requests[0].auth).toBe("Bearer DOGDOG-TEST-KEY");
      expect(requests[0].apiKey).toBeUndefined();
      expect(requests[0].body.instructions).toContain("输出中文 JSON");
      expect(requests[0].body.input[0].role).toBe("user");
    }
    await app.close();
    await launch();
    await page.getByRole("button", { name: "模型设置" }).click();
    await expect(page.getByLabel("接口协议", { exact: true })).toHaveValue(
      protocol,
    );
    await expect(page.getByLabel("服务地址", { exact: true })).toHaveValue(
      url + path,
    );
    await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  });
}

test("中文路径下导入、配置、证据诊断、复制、重试对比与重启恢复", async () => {
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: join(screenshotDir, "01-welcome.png") });
  await configure();
  await importOriginal();
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "检查发送内容" }).click();
  await page.getByText("展开完整待发送数据").click();
  await expect(page.getByLabel("完整待发送数据")).toHaveValue(/1 test failed/);
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "发送并开始诊断" }).click();
  await expect(
    page.getByRole("heading", { name: "完成声明缺少验收依据" }),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].auth).toBe("Bearer DOGDOG-TEST-KEY");
  expect(requests[0].body).not.toHaveProperty("tools");
  await page.screenshot({ path: join(screenshotDir, "02-diagnosis.png") });
  await page.getByRole("button", { name: "L7", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("1 test failed");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "复制提示词" }).click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    report.nextPrompt,
  );
  const bootData = await page.evaluate(() => window.dogdog.boot());
  expect(JSON.stringify(bootData)).not.toContain("DOGDOG-TEST-KEY");
  expect(
    await readFile(join(dir, "用户数据", "reviews", "settings.json"), "utf8"),
  ).not.toContain("DOGDOG-TEST-KEY");
  await page.getByRole("button", { name: "关联一次重试" }).click();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, retry);
  await page.getByRole("button", { name: "手动导入重试轨迹" }).click();
  await page.getByRole("checkbox", { name: "完成声明缺少验收依据" }).check();
  await page
    .getByLabel("验收结果", { exact: true })
    .fill("全部测试通过；手动检查导出文件可读取。");
  await page.getByLabel("整体结果", { exact: true }).selectOption("改善");
  await page.getByRole("button", { name: "保存验证结果" }).click();
  await expect(
    page.getByRole("heading", { name: "这一次，有没有更接近目标？" }),
  ).toBeVisible();
  await expect(page.locator(".outcome")).toHaveText("改善");
  await page.screenshot({ path: join(screenshotDir, "03-comparison.png") });
  expect(await readFile(original, "utf8")).toBe(fixture());
  await app.close();
  await launch();
  await page.locator(".saved-review").first().click();
  await page.getByRole("button", { name: /重试与对比/ }).click();
  await expect(page.locator(".outcome")).toHaveText("改善");
  await page.getByRole("button", { name: "模型设置" }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute(
    "placeholder",
    /已加密保存/,
  );
});
test("取消诊断不会保存报告，允许手动重试", async () => {
  mode = "delay";
  await configure();
  await importOriginal();
  await send();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole("button", { name: "取消诊断" }).click();
  await expect(page.getByRole("alert")).toContainText("已取消");
  const b = await page.evaluate(() => window.dogdog.boot());
  expect(b.reviews[0].report).toBeUndefined();
  mode = "success";
  await page.getByRole("button", { name: "返回任务与轨迹" }).click();
  await send();
  await expect(
    page.getByRole("heading", { name: "完成声明缺少验收依据" }),
  ).toBeVisible();
});
test("模型伪造证据时拒绝报告", async () => {
  mode = "bad-evidence";
  await configure();
  await importOriginal();
  await send();
  await expect(page.getByRole("alert")).toContainText("不存在的证据");
  const b = await page.evaluate(() => window.dogdog.boot());
  expect(b.reviews[0].report).toBeUndefined();
});
test("日常复盘无需投诉，不强行制造改进项", async () => {
  mode = "neutral";
  await configure();
  await importOriginal();
  await page.getByLabel("重点关注", { exact: true }).fill("");
  await page.getByText("长任务：精确选择原文行范围（可选）").click();
  await page.getByLabel("起始事件行", { exact: true }).fill("4");
  await page.getByLabel("结束事件行", { exact: true }).fill("4");
  await send();
  await expect(
    page.getByRole("heading", { name: "值得保留的做法" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "本次没有足够证据支持优先改进项" }),
  ).toBeVisible();
  expect(JSON.parse(requests[0].body.messages[1].content).task.complaint).toBe(
    "",
  );
  expect(
    JSON.parse(requests[0].body.messages[1].content).events.map(
      (e: { id: string }) => e.id,
    ),
  ).toEqual(["L4"]);
  await page.getByRole("button", { name: "L4", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("实现导出功能");
});
