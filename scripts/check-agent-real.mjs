import { _electron, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

if (!process.env.GLM_API_KEY)
  throw new Error("GLM_API_KEY 不存在；未发起真实请求。");
const binary = createRequire(import.meta.url)("electron");
const prefix = resolve(tmpdir(), "dogdog-real-agent-");
const dir = await mkdtemp(prefix);
const endpoint =
  process.env.DOGDOG_CHECK_ENDPOINT ||
  "https://open.bigmodel.cn/api/v1/responses";
const model = process.env.DOGDOG_CHECK_MODEL || "GLM-5.3";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const originalSettings = join(
  process.env.APPDATA,
  "DogDog",
  "reviews",
  "settings.json",
);
const before = await readFile(originalSettings).catch(() => undefined);
const env = {
  ...process.env,
  DOGDOG_USER_DATA: join(dir, "profile"),
  CODEX_HOME: join(dir, "codex"),
  DOGDOG_REAL_CHECK: "1",
  DOGDOG_CHECK_ENDPOINT: endpoint,
  DOGDOG_CHECK_MODEL: model,
};
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(join(dir, "codex", "sessions"), { recursive: true });
await mkdir("verification/screenshots", { recursive: true });
const fixture = (id) => {
  const row = (type, payload) =>
    JSON.stringify({ timestamp: "2026-10-30T12:00:00Z", type, payload });
  return [
    row("session_meta", {
      id: `synthetic-${id}`,
      cwd: "synthetic-demo",
      cli_version: "fixture",
    }),
    row("response_item", {
      type: "message",
      role: "user",
      content: [
        { text: `合成任务 ${id}：实现导出功能，全部测试通过才算完成。` },
      ],
    }),
    row("response_item", {
      type: "function_call",
      name: "exec_command",
      call_id: `test-${id}`,
      arguments: "npm test",
    }),
    row("response_item", {
      type: "function_call_output",
      call_id: `test-${id}`,
      output: `1 test failed (synthetic ${id})`,
    }),
    row("response_item", {
      type: "message",
      role: "assistant",
      content: [{ text: "已完成。" }],
    }),
  ].join("\n");
};
const files = [join(dir, "合成任务甲.jsonl"), join(dir, "合成任务乙.jsonl")];
await writeFile(files[0], fixture("A"));
await writeFile(files[1], fixture("B"));
const sourceHashes = await Promise.all(
  files.map(async (f) => hash(await readFile(f))),
);
let app, page;
const result = {
  at: new Date().toISOString(),
  endpoint,
  model,
  protocol: "openai-responses",
  syntheticTrace: true,
  privateTraceSent: false,
  checks: [],
  network: [],
  success: false,
};
const record = async (name, details = {}) => {
  result.checks.push({ name, ...details });
  await writeFile(
    "verification/v02-real-agent.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ step: name, ...details }));
};
async function launch() {
  app = await _electron.launch({
    executablePath: binary,
    args: [resolve(".")],
    env,
  });
  app.process().stderr?.on("data", (value) => {
    const lines = value
      .toString()
      .split("\n")
      .filter((line) => line.startsWith('{"agentFailure"'));
    for (const line of lines) console.log(line);
  });
  page = await app.firstWindow();
  await page.getByRole("button", { name: "新建讨论" }).waitFor();
  await app.evaluate(() => {
    globalThis.__agentNetwork = [];
    const fetcher = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const response = await fetcher(...args);
      globalThis.__agentNetwork.push({
        endpoint: String(args[0]),
        httpStatus: response.status,
        contentType: response.headers.get("content-type"),
      });
      return response;
    };
  });
}
async function close() {
  if (!app) return;
  result.network.push(
    ...(await app.evaluate(() => globalThis.__agentNetwork).catch(() => [])),
  );
  await app.close();
  app = undefined;
}
async function send(text, confirm = false) {
  await page.getByLabel("你的问题", { exact: true }).fill(text);
  await page.getByRole("button", { name: "发送 ↗", exact: true }).click();
  if (confirm)
    await page.getByRole("button", { name: "确认范围并发送" }).click();
  await expect(
    page.getByRole("button", { name: "发送 ↗", exact: true }),
  ).toBeVisible({ timeout: 12 * 120000 + 30000 });
  const c = (await page.evaluate(() => window.dogdog.conversations()))[0];
  const run = c.runs.at(-1);
  if (run.status === "failed" || run.status === "cancelled")
    throw new Error(run.error || "真实模型未完成分析。");
  return c;
}
try {
  await launch();
  let c = await send(
    "作为 AI 协作顾问，给我两条关于验收标准的通用建议，明确标识为通用建议。",
    true,
  );
  if (c.runs.at(-1).status !== "completed")
    throw new Error("无轨迹回答未完成。");
  await record("无轨迹持续对话", { requests: c.runs.at(-1).requests.length });
  c = await send(
    "我想改善协作，但还没告诉你任务类型和验收目标。请先用 ask_user 工具向我询问一个关键问题，不要替我假定答案。",
  );
  if (c.runs.at(-1).status !== "waiting")
    throw new Error("模型没有通过 ask_user 进入等待状态。");
  await record("真实模型追问", {
    tools: c.runs.at(-1).tools.map((t) => t.name),
  });
  await close();
  await launch();
  c = await send(
    "任务类型是软件开发，验收目标是全部测试通过且导出文件可打开。先给出简短的一般指导即可。",
  );
  if (c.runs.at(-1).status !== "completed")
    throw new Error("重启后追问未继续完成。");
  await record("重启后回答并继续");
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, files);
  await page.getByRole("button", { name: "关联轨迹" }).click();
  await expect(page.locator(".chat-source-list article")).toHaveCount(2);
  c = await send(
    "请比较关联的两份合成轨迹：先列举来源，再搜索测试失败记录，使用 read_trace 读取两个来源中失败输出及其前后文，找出共同的可观察问题。回答区分事实、假设、通用建议，并分别引用两个来源的原文证据。",
    true,
  );
  const run = c.runs.at(-1),
    answer = c.messages.at(-1);
  if (
    run.status !== "completed" ||
    !run.tools.some((t) => t.name === "read_trace") ||
    new Set(answer.evidenceIds.map((id) => id.split(":")[0])).size < 2
  )
    throw new Error("跨轨迹读取或双来源引用未通过。");
  await record("真实跨轨迹工具循环与引用", {
    requests: run.requests.length,
    tools: run.tools.map((t) => t.name),
    evidenceIds: answer.evidenceIds,
  });
  await page
    .getByRole("button", { name: "保存为报告", exact: true })
    .last()
    .click();
  await expect(page.locator(".chat-report-panel > button")).toHaveCount(1);
  await page.screenshot({ path: "verification/screenshots/v02-real-glm.png" });
  const count = c.messages.length;
  await close();
  await launch();
  c = (await page.evaluate(() => window.dogdog.conversations()))[0];
  if (c.messages.length !== count || c.reports.length !== 1)
    throw new Error("真实讨论或报告重启恢复失败。");
  await record("真实讨论与报告恢复");
  await writeFile(
    "verification/v02-real-synthetic-conversation.json",
    JSON.stringify(c, null, 2),
  );
  result.sourceFilesUnchanged = (
    await Promise.all(
      files.map(async (f, i) => hash(await readFile(f)) === sourceHashes[i]),
    )
  ).every(Boolean);
  result.success = result.sourceFilesUnchanged;
} catch (e) {
  // Provider bodies and credentials are deliberately excluded from failure output.
  result.error =
    e instanceof Error &&
    /[\u3400-\u9fff]/.test(e.message) &&
    e.message.length < 500
      ? e.message
      : "真实 Agent 验证未完成；详细底层响应未记录。";
  if (page) {
    const conversations = await page
      .evaluate(() => window.dogdog.conversations())
      .catch(() => []);
    if (conversations[0])
      await writeFile(
        "verification/v02-real-synthetic-conversation.json",
        JSON.stringify(conversations[0], null, 2),
      );
  }
} finally {
  await close();
  const after = await readFile(originalSettings).catch(() => undefined);
  result.originalSettingsUnchanged =
    before && after ? hash(before) === hash(after) : before === after;
  result.success = result.success && result.originalSettingsUnchanged;
  await writeFile(
    "verification/v02-real-agent.json",
    JSON.stringify(result, null, 2),
  );
  if (!resolve(dir).startsWith(prefix)) throw new Error("Unsafe cleanup path");
  await rm(dir, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exitCode = 1;
