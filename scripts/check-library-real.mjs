import { _electron, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

if (!process.env.GLM_API_KEY)
  throw new Error("GLM_API_KEY 不存在；未发起真实请求。");
const outputDir = resolve(process.env.DOGDOG_VERIFY_DIR || "verification");
const screenshotDir = join(outputDir, "screenshots");
const packagedBinary = process.env.DOGDOG_E2E_EXE;
const prefix = resolve(tmpdir(), "dogdog-library-real-");
const dir = await mkdtemp(prefix);
const roots = [
  join(dir, "codex", "sessions"),
  join(dir, "codex", "archived_sessions"),
];
for (const root of roots) await mkdir(root, { recursive: true });
await mkdir(screenshotDir, { recursive: true });
const row = (type, payload) =>
  JSON.stringify({ type, payload, timestamp: "2026-10-30T12:00:00Z" });
const fixture = (id, question, answer) =>
  [
    row("session_meta", {
      id,
      cwd: "D:\\synthetic-demo",
      cli_version: "fixture",
    }),
    row("response_item", {
      type: "message",
      role: "user",
      content: [{ text: question }],
    }),
    row("response_item", {
      type: "function_call",
      name: "exec_command",
      call_id: id,
      arguments: "synthetic_read_mouse_settings",
    }),
    row("response_item", {
      type: "function_call_output",
      call_id: id,
      output: answer,
    }),
    row("response_item", {
      type: "message",
      role: "assistant",
      content: [{ text: "合成验证记录已保存；无真实系统操作。" }],
    }),
  ].join("\n");
const files = [
  join(roots[0], "mouse.jsonl"),
  join(roots[1], "verify.jsonl"),
  join(roots[0], "noise.jsonl"),
];
await writeFile(
  files[0],
  fixture(
    "synthetic-mouse",
    "排查并修复鼠标移动缓慢",
    "合成诊断：Logitech G102 硬件 DPI 为 400；Windows 指针速度正常。将 DPI 调整至 1600 后移动速度恢复。",
  ),
);
await writeFile(
  files[1],
  fixture(
    "synthetic-verify",
    "复测鼠标移动速度",
    "合成复测：G102 保持 1600 DPI，鼠标移动正常，重启后仍正常。",
  ),
);
await writeFile(
  files[2],
  fixture("synthetic-noise", "实现导出", "UNRELATED_NOISE_NOT_TO_SEND"),
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const hashes = await Promise.all(
  files.map(async (f) => hash(await readFile(f))),
);
const originalPath = join(
  process.env.APPDATA,
  "DogDog",
  "reviews",
  "settings.json",
);
const original = await readFile(originalPath).catch(() => undefined);
const env = {
  ...process.env,
  DOGDOG_USER_DATA: join(dir, "profile"),
  CODEX_HOME: join(dir, "codex"),
  DOGDOG_REAL_CHECK: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const result = {
  at: new Date().toISOString(),
  protocol: "openai-responses",
  executable: packagedBinary || "development Electron",
  syntheticOnly: true,
  privateTraceSent: false,
  checks: [],
  success: false,
};
let app, page;
const record = (name, details = {}) => {
  result.checks.push({ name, ...details });
  console.log(JSON.stringify({ name, ...details }));
};
async function launch() {
  app = await _electron.launch({
    executablePath:
      packagedBinary || createRequire(import.meta.url)("electron"),
    args: packagedBinary ? [] : [resolve(".")],
    env,
  });
  page = await app.firstWindow();
  await page.getByRole("button", { name: "新建讨论" }).waitFor();
}
async function send(text) {
  await page.getByLabel("你的问题").fill(text);
  await page.getByLabel("你的问题").press("Enter");
  await expect(
    page.getByRole("button", { name: "停止分析", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "发送 ↗", exact: true }),
  ).toBeVisible({ timeout: 12 * 120000 + 30000 });
  const c = (await page.evaluate(() => window.dogdog.conversations()))[0];
  if (c.runs.at(-1)?.status !== "completed")
    throw new Error("真实模型未完成检索回答。");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return c;
}
try {
  await launch();
  const { settings } = await page.evaluate(() => window.dogdog.boot());
  result.model = settings.model;
  result.endpoint = settings.baseUrl;
  await page.getByRole("button", { name: "模型设置" }).click();
  await page.getByLabel("允许检索并发送相关片段").check();
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  result.appVersion = await app.evaluate(({ app }) => app.getVersion());
  let c = await send("之前鼠标移动缓慢如何解决？");
  let run = c.runs.at(-1),
    answer = c.messages.at(-1);
  if (
    !run.tools.some((t) => t.name === "search_traces") ||
    !run.tools.some((t) => t.name === "read_trace") ||
    !answer.evidenceIds.length ||
    !answer.text.includes("1600")
  )
    throw new Error("真实模型未完成自然提问的自主检索、原文读取及引用。");
  record("直接 Enter 自主检索并引用", {
    question: "之前鼠标移动缓慢如何解决？",
    requests: run.requests.length,
    tools: run.tools.map((t) => t.name),
    evidenceIds: answer.evidenceIds,
    answer: answer.text,
  });
  await page.screenshot({ path: join(screenshotDir, "v03-real-first.png") });
  c = await send("后来有复测吗？请结合原文核对修复与复测的记录。");
  run = c.runs.at(-1);
  answer = c.messages.at(-1);
  const cited = new Set(answer.evidenceIds.map((id) => id.split(":")[0]));
  if (cited.size < 2 || !run.tools.some((t) => t.name === "read_trace"))
    throw new Error("跨轨迹追问未完成双来源核对与引用。");
  if (
    c.runs.some((r) =>
      r.requests.some((request) =>
        request.payload.includes("UNRELATED_NOISE_NOT_TO_SEND"),
      ),
    )
  )
    throw new Error("检索发送了无关轨迹正文。");
  record("跨轨迹追问并核对修复与复测", {
    requests: run.requests.length,
    tools: run.tools.map((t) => t.name),
    evidenceIds: answer.evidenceIds,
    answer: answer.text,
  });
  await page.screenshot({ path: join(screenshotDir, "v03-real-glm.png") });
  const evidenceId = answer.evidenceIds.find((id) => {
    const [sourceId, line] = id.split(":L");
    return c.sources
      .find((source) => source.id === sourceId)
      ?.trace.events.some(
        (event) => event.line === Number(line) && event.text.includes("1600"),
      );
  });
  if (!evidenceId) throw new Error("回答没有可回看的 DPI 原文证据。");
  await page
    .getByRole("button", { name: `查看证据 ${evidenceId}`, exact: true })
    .last()
    .click();
  const evidence = page.getByRole("dialog");
  await expect(evidence).toContainText("SHA-256");
  await expect(evidence).toContainText("1600");
  await page.screenshot({ path: join(screenshotDir, "v03-real-evidence.png") });
  await evidence.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .getByRole("button", { name: "保存为报告", exact: true })
    .last()
    .click();
  await expect(page.locator(".chat-report-panel > button")).toHaveCount(1);
  record("原文引用回看与报告保存");
  const count = c.messages.length;
  await app.close();
  app = undefined;
  await launch();
  c = (await page.evaluate(() => window.dogdog.conversations()))[0];
  if (
    c.messages.length !== count ||
    c.sources.length < 2 ||
    c.reports.length !== 1
  )
    throw new Error("重启未恢复对话、来源或报告。");
  c = await send("根据刚才的讨论，给一条简短的通用建议即可。");
  record("重启恢复并直接 Enter 继续，无重复确认");
  await page.screenshot({ path: join(screenshotDir, "v03-real-restored.png") });
  await writeFile(
    join(outputDir, "v03-real-synthetic-conversation.json"),
    JSON.stringify(c, null, 2),
  );
  result.success = true;
} catch (error) {
  result.error =
    error instanceof Error && /^[\u3400-\u9fff]/.test(error.message)
      ? error.message.slice(0, 300)
      : "真实检索验证未完成；底层响应和凭据未记录。";
  result.failureLocation =
    error instanceof Error
      ? error.stack
          ?.split("\n")
          .find((line) => line.includes("check-library-real.mjs:"))
          ?.trim()
      : undefined;
} finally {
  await app?.close();
  const after = await readFile(originalPath).catch(() => undefined);
  result.originalSettingsUnchanged =
    original && after ? hash(original) === hash(after) : original === after;
  result.sourceFilesUnchanged = (
    await Promise.all(
      files.map(async (file, i) => hash(await readFile(file)) === hashes[i]),
    )
  ).every(Boolean);
  result.success =
    result.success &&
    result.originalSettingsUnchanged &&
    result.sourceFilesUnchanged;
  await writeFile(
    join(outputDir, "v03-real-library.json"),
    JSON.stringify(result, null, 2),
  );
  const target = resolve(dir);
  if (!target.startsWith(prefix) || target === prefix)
    throw new Error("Unsafe cleanup path");
  await rm(target, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exitCode = 1;
