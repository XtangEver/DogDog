import { _electron, expect } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

// Explicit real-service check: credentials stay encrypted on disk and are only
// decrypted by the installed application's main process. No private trace is used.
const source = join(process.env.APPDATA, "DogDog", "reviews", "settings.json");
const original = await readFile(source);
const settings = JSON.parse(original.toString("utf8"));
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
if (option("--endpoint")) settings.baseUrl = option("--endpoint");
if (option("--protocol")) settings.protocol = option("--protocol");
if (!settings.encryptedKey) throw new Error("模型配置尚未保存密钥。");
const prefix = resolve(tmpdir(), "DogDog-real-check-");
const dir = await mkdtemp(prefix);
const env = {
  ...process.env,
  DOGDOG_USER_DATA: join(dir, "profile"),
  CODEX_HOME: join(dir, "codex"),
};
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(join(dir, "profile", "reviews"), { recursive: true });
await mkdir(join(dir, "codex", "sessions"), { recursive: true });
// Electron's encrypted credential also depends on the profile's encrypted
// OS-crypt master key. Copy it without decrypting or logging its contents.
await copyFile(
  join(process.env.APPDATA, "DogDog", "Local State"),
  join(dir, "profile", "Local State"),
);
await writeFile(
  join(dir, "profile", "reviews", "settings.json"),
  JSON.stringify(settings),
  { mode: 0o600 },
);
const tracePath = join(dir, "synthetic.jsonl");
const row = (type, payload) =>
  JSON.stringify({ timestamp: "2026-10-30T12:00:00Z", type, payload });
const syntheticTrace = [
  row("session_meta", {
    id: "synthetic-real-service-check",
    cwd: "synthetic-demo",
    cli_version: "test-fixture",
  }),
  row("event_msg", { type: "task_started", turn_id: "t1" }),
  row("response_item", {
    type: "message",
    role: "user",
    content: [{ text: "为纯测试项目实现导出功能，验收要求全部测试通过。" }],
  }),
  row("response_item", {
    type: "function_call",
    name: "exec_command",
    call_id: "test-call",
    arguments: "npm test",
  }),
  row("response_item", {
    type: "function_call_output",
    call_id: "test-call",
    output: "1 test failed",
  }),
  row("response_item", {
    type: "message",
    role: "assistant",
    content: [{ text: "已完成。" }],
  }),
].join("\n");
await writeFile(tracePath, syntheticTrace);
let app;
const result = {
  at: new Date().toISOString(),
  executable: join(
    process.env.LOCALAPPDATA,
    "Programs",
    "DogDog",
    "DogDog.exe",
  ),
  endpoint: settings.baseUrl,
  protocol: settings.protocol,
  model: settings.model,
  syntheticTrace: true,
  privateTraceSent: false,
};
try {
  app = await _electron.launch({ executablePath: result.executable, env });
  const page = await app.firstWindow();
  await page.getByText("下一次，让协作更顺一点。").waitFor();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
    globalThis.__realCheck = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const observation = { endpoint: String(args[0]) };
      globalThis.__realCheck.push(observation);
      const start = Date.now();
      const response = await realFetch(...args);
      observation.httpStatus = response.status;
      observation.contentType = response.headers.get("content-type");
      observation.headerLatencyMs = Date.now() - start;
      // Do not record request headers, response bodies or raw provider errors.
      return response;
    };
  }, tracePath);
  await page.getByRole("button", { name: "导入任务轨迹" }).click();
  await page
    .getByLabel("任务目标", { exact: true })
    .fill("合成测试：实现导出功能");
  await page
    .getByLabel("验收标准", { exact: true })
    .fill("全部测试通过；复盘判断应引用原文证据");
  await page
    .getByLabel("重点关注", { exact: true })
    .fill("合成轨迹中测试失败后声称完成；仅用于接口连通和报告结构验证");
  await page.getByRole("button", { name: "检查发送内容" }).click();
  await expect(
    page.getByRole("dialog", { name: "发送前，检查一下" }),
  ).toContainText(settings.baseUrl);
  result.previewConfirmed = true;
  const start = Date.now();
  await page.getByRole("button", { name: "发送并开始诊断" }).click();
  await expect
    .poll(
      async () => {
        const boot = await page.evaluate(() => window.dogdog.boot());
        return (
          !!boot.reviews[0]?.report ||
          (await page.getByRole("alert").isVisible())
        );
      },
      { timeout: 135000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
  result.durationMs = Date.now() - start;
  const boot = await page.evaluate(() => window.dogdog.boot());
  const review = boot.reviews[0];
  result.success = !!review?.report;
  result.network = await app.evaluate(() => globalThis.__realCheck);
  if (result.success) {
    const ids = new Set(review.trace.events.map((event) => event.id));
    result.evidenceValid = [
      ...(review.report.strengths ?? []),
      ...review.report.findings,
    ].every((item) => item.evidenceIds.every((id) => ids.has(id)));
    result.findings = review.report.findings.length;
    result.strengths = review.report.strengths.length;
    await writeFile(
      "verification/real-model-synthetic-report.json",
      JSON.stringify(review, null, 2),
    );
  } else {
    result.error = await page.getByRole("alert").innerText();
  }
  await page.screenshot({
    path: "verification/screenshots/real-model-check.png",
  });
} catch {
  result.success = false;
  result.error ??= "真实接口测试未完成；未记录底层错误，避免泄露凭据。";
  if (app)
    result.network = await app
      .evaluate(() => globalThis.__realCheck)
      .catch(() => []);
} finally {
  await app?.close();
  result.originalConfigUnchanged =
    createHash("sha256").update(original).digest("hex") ===
    createHash("sha256")
      .update(await readFile(source))
      .digest("hex");
  await writeFile(
    "verification/real-model-check.json",
    JSON.stringify(result, null, 2),
  );
  if (!resolve(dir).startsWith(prefix)) throw new Error("Unsafe cleanup path");
  await rm(dir, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exitCode = 1;
