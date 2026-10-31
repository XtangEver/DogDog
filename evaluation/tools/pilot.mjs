import { _electron, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  copyFile,
} from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { startMock } from "./mock-service.mjs";
import { root, repo, save, hash, files, exists } from "./cli.mjs";
import { manifestSchema, resultSchema } from "./schemas.mjs";

const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const runId = "pilot-" + stamp;
const args = process.argv.slice(2),
  outArg = args.indexOf("--out");
const out = resolve(outArg >= 0 ? args[outArg + 1] : join(root, "runs", runId));
if (await exists(out)) throw new Error("Use a fresh run output directory");
await mkdir(join(out, "screenshots"), { recursive: true });
const executable =
  process.env.DOGDOG_E2E_EXE || createRequire(import.meta.url)("electron");
const packaged = !!process.env.DOGDOG_E2E_EXE;
const home = join(out, "isolation", "codex"),
  profile = join(out, "isolation", "profile");
await mkdir(join(home, "sessions"), { recursive: true });
await mkdir(join(home, "archived_sessions"), { recursive: true });
const row = (type, payload) =>
  JSON.stringify({ type, payload, timestamp: "2026-10-20T10:00:00Z" });
function trace(id, question, result) {
  return [
    row("session_meta", {
      id,
      cwd: "D:\\synthetic-work",
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
      arguments: "synthetic_check",
    }),
    row("response_item", {
      type: "function_call_output",
      call_id: id,
      output: result,
    }),
    row("response_item", {
      type: "message",
      role: "assistant",
      content: [{ text: "合成记录已保存。" }],
    }),
  ].join("\n");
}
const fixtures = {
  "sessions/a.jsonl": trace(
    "synthetic-launch-a",
    "修复启动失败",
    "启动配置已修改；首次测试尚未进行。",
  ),
  "archived_sessions/b.jsonl": trace(
    "synthetic-launch-b",
    "复测启动修复",
    "启动复测通过：修改后启动检查与重启检查均通过。",
  ),
  "sessions/noise.jsonl": trace(
    "synthetic-noise",
    "整理图标",
    "UNRELATED_SYNTHETIC_NOISE",
  ),
};
const hashes = {};
for (const [name, value] of Object.entries(fixtures)) {
  await writeFile(join(home, name), value, "utf8");
  hashes["isolation/codex/" + name] = hash(value);
}
const mock = await startMock({ out: join(out, "mock") });
let app,
  page,
  eventIndex = 0;
const results = [],
  events = [];
async function event(action, details = {}) {
  const e = {
    index: ++eventIndex,
    at: new Date().toISOString(),
    action,
    ...details,
  };
  events.push(e);
  await save(
    join(out, "events.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
}
async function screenshot(name) {
  const path = join(out, "screenshots", name + ".png");
  await page.screenshot({ path });
  return relative(out, path).replaceAll("\\", "/");
}
async function launch() {
  const env = { ...process.env, DOGDOG_USER_DATA: profile, CODEX_HOME: home };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.DOGDOG_REAL_CHECK;
  delete env.GLM_API_KEY;
  app = await _electron.launch({
    executablePath: executable,
    args: packaged ? [] : [repo],
    env,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await expect(page.getByRole("button", { name: "新建讨论" })).toBeVisible();
  await event("launch", { executable, profile, traceRoot: home });
}
async function configure() {
  if (!(await page.getByRole("dialog", { name: "选择狗狗的协作模型" }).count()))
    await page.getByRole("button", { name: "模型设置", exact: true }).click();
  await page
    .getByLabel("接口协议", { exact: true })
    .selectOption("openai-responses");
  await page
    .getByLabel("服务地址", { exact: true })
    .fill(mock.status.url + "/responses");
  await page.getByLabel("模型名", { exact: true }).fill("synthetic-pilot");
  await page.getByLabel("API Key", { exact: true }).fill("MOCK-NEVER-REAL");
  await page.getByLabel("允许检索并发送相关片段", { exact: true }).check();
  await screenshot("P01-settings");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function send(text, { wait = true } = {}) {
  await event("user_input", { text });
  await page.getByLabel("你的问题", { exact: true }).fill(text);
  await page.getByLabel("你的问题", { exact: true }).press("Enter");
  if (wait) {
    await expect(
      page.getByRole("button", { name: "发送 ↗", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".chat-message-assistant").last()).toBeVisible();
  }
}
async function trial(pilotId, caseId, title, fn) {
  const startedAt = new Date().toISOString(),
    start = Date.now(),
    before = mock.calls.length;
  let status = "pass",
    observation,
    shots = [];
  try {
    const value = await fn();
    observation = value.observation;
    shots = value.shots || [];
    await event("pilot_check", { pilotId, passed: true, observation });
  } catch (e) {
    status = "insufficient_evidence";
    observation =
      "待独立归因（不能由脚本把产品/选择器/环境错误统一归类）：" + e.message;
    await event("pilot_check", { pilotId, passed: false, observation });
    try {
      shots.push(await screenshot(pilotId + "-failure"));
      const close = page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true });
      if (await close.count()) await close.first().click();
    } catch {}
  }
  const r = {
    schemaVersion: "1.0",
    runId,
    caseId,
    attempt: 1,
    pilotId,
    title,
    // A pilot slice is never promoted to a complete core-task pass.
    status: status === "pass" ? "insufficient_evidence" : status,
    pilotOutcome: status,
    executionTrack: "diagnostic",
    blinded: false,
    mockService: true,
    startedAt,
    endedAt: new Date().toISOString(),
    checks: [
      {
        id: pilotId,
        passed: status === "pass",
        observation,
        evidence: ["events.jsonl", ...shots],
      },
    ],
    scores: [],
    artifacts: ["events.jsonl", ...shots],
    limitations: [
      "本轮为非盲Playwright桌面兼容性子场景；未执行对应核心任务的全部验收项。",
      "mock回答由脚本预制，不证明自主推理或真实模型质量。",
    ],
    reviewer: {
      kind: "programmatic",
      identity: "evaluation/tools/pilot.mjs",
      independentContext: false,
    },
    metrics: {
      elapsedMs: Date.now() - start,
      modelRequests: mock.calls.length - before,
      cost: 0,
    },
  };
  resultSchema.parse(r);
  results.push(r);
  await save(join(out, "trials", pilotId, "result.json"), r);
  return r;
}
let version = "unknown";
try {
  await launch();
  version = await app.evaluate(({ app }) => app.getVersion());
  await trial("P01", "DD-01-01", "首次配置与隔离启动", async () => {
    await configure();
    return {
      observation:
        "从新profile通过公开设置控件保存loopback协议、模型、合成Key及目录发送许可；设置弹窗关闭。",
      shots: [await screenshot("P01-configured")],
    };
  });
  await trial("P02", "DD-03-01", "自然提问与当前/归档检索", async () => {
    mock.setMode({ mode: "auto" });
    await send("上次启动失败后来解决了吗？请查证并简短回答。");
    await expect(
      page.getByRole("button", { name: "查看证据 S1:L4", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "查看证据 S2:L4", exact: true }),
    ).toBeVisible();
    if (mock.calls.length < 4) throw new Error("工具循环请求不足");
    if (
      mock.calls.some((c) =>
        JSON.stringify(c.body).includes("UNRELATED_SYNTHETIC_NOISE"),
      )
    )
      throw new Error("干扰正文被发送");
    return {
      observation:
        "未手动关联来源，固定mock工具循环经过discover/search/read后显示双来源引用，干扰正文未进入请求。",
      shots: [await screenshot("P02-searched")],
    };
  });
  await trial("P03", "DD-04-01", "多来源原文与快照哈希回看", async () => {
    const texts = [],
      shots = [];
    for (const sourceId of ["S1", "S2"]) {
      await page
        .getByRole("button", { name: `查看证据 ${sourceId}:L4`, exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: `轨迹证据 · ${sourceId}:L4`,
      });
      await expect(dialog).toContainText("SHA-256");
      texts.push(await dialog.innerText());
      shots.push(await screenshot("P03-evidence-" + sourceId));
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    }
    if (
      !texts.some((t) => t.includes("启动复测通过")) ||
      !texts.some((t) => t.includes("启动配置已修改"))
    )
      throw new Error("双来源原文未覆盖修改及复测");
    await event("source_mapping", { texts });
    return {
      observation:
        "逐一打开两份引用，原文分别包含配置修改和复测，均有SHA-256；不假设S1/S2排序。",
      shots,
    };
  });
  await trial("P05", "DD-07-01", "报告保存与重启恢复", async () => {
    await page
      .getByRole("button", { name: "保存为报告", exact: true })
      .last()
      .click();
    await expect(page.locator(".chat-report-panel > button")).toHaveCount(1);
    await app.close();
    await launch();
    await expect(page.locator(".chat-report-panel > button")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "查看证据 S2:L4", exact: true }),
    ).toBeVisible();
    return {
      observation: "通过UI保存报告并关闭/重启隔离实例；报告入口与原引用恢复。",
      shots: [await screenshot("P05-restored")],
    };
  });
  await trial("P04", "DD-05-01", "必要追问与补充后继续", async () => {
    await page.getByRole("button", { name: "新建讨论" }).click();
    mock.setMode({ mode: "ask" });
    await send("改进这次验收方式，需要我补充什么？");
    await expect(page.locator(".chat-message-assistant").last()).toContainText(
      "你希望怎样验收",
    );
    await send("修正：不是只看测试绿灯，还必须检查实际产物可打开。");
    await expect(page.locator(".chat-message-assistant").last()).toContainText(
      "实际产物可打开",
    );
    return {
      observation:
        "ask_user暂停后接受合成补充，下一轮继续显示验收条件；只验证追问状态与续写传输，不证明真实模型理解纠正。",
      shots: [await screenshot("P04-continued")],
    };
  });
  await trial(
    "P06",
    "DD-11-01",
    "取消后保留未完成状态且不自动重发",
    async () => {
      mock.setMode({ mode: "slow" });
      await send("请继续分析。", { wait: false });
      await expect(
        page.getByRole("button", { name: "停止分析", exact: true }),
      ).toBeVisible();
      await expect(
        page.locator(".chat-message-assistant").last(),
      ).toContainText("正在生成的部分回答");
      await page.getByRole("button", { name: "停止分析", exact: true }).click();
      await expect(
        page.locator(".chat-message-assistant").last(),
      ).toContainText("未完成");
      const count = mock.calls.length;
      await expect(
        page.getByRole("button", { name: "发送 ↗", exact: true }),
      ).toBeVisible();
      await new Promise((r) => setTimeout(r, 600));
      if (mock.calls.length !== count) throw new Error("取消后自动重发");
      return {
        observation:
          "停止后显示未完成，部分文本保留；600ms观察窗内未新增请求。",
        shots: [await screenshot("P06-cancelled")],
      };
    },
  );
  await trial("P07", "DD-10-01", "撤权阻止后续请求", async () => {
    await page.getByRole("button", { name: "模型设置", exact: true }).click();
    await page.getByLabel("允许检索并发送相关片段", { exact: true }).uncheck();
    await page.getByRole("button", { name: "保存配置", exact: true }).click();
    const count = mock.calls.length;
    mock.setMode({ mode: "text" });
    await send("继续检索启动记录。");
    await expect(page.getByRole("alert")).toBeVisible();
    await new Promise((r) => setTimeout(r, 400));
    if (mock.calls.length !== count) throw new Error("撤权后仍发送请求");
    return {
      observation:
        "撤销隔离profile发送许可后提交问题，出现错误提示；服务请求计数未增加。",
      shots: [await screenshot("P07-revoked")],
    };
  });
  await trial("P08", "DD-12-04", "实际启动身份与来源只读", async () => {
    if (version !== "0.3.0")
      throw new Error("实际应用版本与当前源码版本不一致: " + version);
    for (const [path, digest] of Object.entries(hashes))
      if (hash(await readFile(join(out, path))) !== digest)
        throw new Error("夹具被修改 " + path);
    return {
      observation:
        "启动身份来自Electron主进程的只读诊断，实际业务版本0.3.0；记录exe及bundle哈希，所有合成原轨迹哈希保持。未验证桌面快捷方式。",
      shots: [await screenshot("P08-identity")],
    };
  });
  // Deliberately wrong reviewer expectation; never count as a DogDog failure.
  const wrong = mock.calls.length === -1;
  await save(join(out, "intentional-failure.json"), {
    id: "G01",
    faultInjected: "错误评分器断言模型请求数为-1",
    detected: !wrong,
    classification: "grading_dispute",
    productFailure: false,
    evidence: "mock/requests.jsonl",
  });
  await event("deliberate_grader_failure", {
    detected: !wrong,
    classification: "grading_dispute",
  });
  if (args.includes("--keep-open")) {
    await configure();
    await page.getByRole("button", { name: "新建讨论" }).click();
    mock.setMode({ mode: "auto" });
    await event("native_environment_ready", {
      note: "准备者恢复隔离发送许可并创建新讨论；之后交由原生电脑代理操作。",
    });
  }
} catch (e) {
  await save(join(out, "harness-error.json"), {
    error: e.message,
    at: new Date().toISOString(),
  });
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  if (app) {
    // State is read only after task execution, in the diagnostic collection phase.
    const convDir = join(profile, "conversations");
    for (const f of await files(convDir)) {
      if (!f.endsWith(".json")) continue;
      await mkdir(join(out, "diagnostic"), { recursive: true });
      await copyFile(f, join(out, "diagnostic", f.split(/[\\/]/).at(-1)));
    }
    if (args.includes("--keep-open")) {
      await save(join(out, "native-entry.json"), {
        pid: app.process().pid,
        profile,
        traceRoot: home,
        mock: mock.status.url,
        note: "已获授权的隔离合成测试实例；完成native试跑后终止本进程。",
      });
      console.log("NATIVE_ENTRY " + join(out, "native-entry.json"));
    } else await app.close().catch(() => {});
  }
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
  const manifest = {
    schemaVersion: "1.0",
    runId,
    createdAt: new Date().toISOString(),
    application: {
      version,
      executable,
      executableSha256: hash(await readFile(executable)),
      build: packaged ? "packaged" : "development Electron",
    },
    suiteVersion: "1.0.0",
    platform: process.platform,
    executionTrack: "diagnostic",
    mockService: true,
    model: {
      protocol: "openai-responses",
      name: "synthetic-pilot",
      endpoint: mock.status.url + "/responses",
      configuration: { scripted: true },
    },
    display: { width: 1440, height: 960, scale: null },
    isolation: {
      profile,
      traceRoots: [join(home, "sessions"), join(home, "archived_sessions")],
      excluded: ["oracles", "cases", "run outputs", "operator history"],
    },
    fixtureHashes: hashes,
    sourceRevision,
    caseIds: [
      "DD-01-01",
      "DD-03-01",
      "DD-04-01",
      "DD-05-01",
      "DD-07-01",
      "DD-11-01",
      "DD-10-01",
      "DD-12-04",
    ],
    bundleHashes: Object.fromEntries(
      await Promise.all(
        (packaged
          ? [join(resolve(executable, ".."), "resources", "app.asar")]
          : [join(repo, "dist", "main.cjs"), join(repo, "dist", "preload.cjs")]
        )
          .filter(Boolean)
          .map(async (f) => [
            f,
            (await exists(f)) ? hash(await readFile(f)) : "unavailable",
          ]),
      ),
    ),
    limitations: [
      "display scale unknown; no screenshot-based scale inference",
      "source worktree includes pre-existing uncommitted changes; bundle hashes identify tested code",
    ],
  };
  manifestSchema.parse(manifest);
  await save(join(out, "manifest.json"), manifest);
  await save(join(out, "summary.json"), {
    runId,
    pilotSlices: results.length,
    slicePasses: results.filter((r) => r.pilotOutcome === "pass").length,
    coreTaskPasses: 0,
    results: results.map((r) => ({
      pilotId: r.pilotId,
      caseId: r.caseId,
      status: r.status,
      pilotOutcome: r.pilotOutcome,
    })),
    blinded: false,
    mockService: true,
  });
  console.log(
    JSON.stringify({
      out,
      pilotSlices: results.length,
      slicePasses: results.filter((r) => r.pilotOutcome === "pass").length,
    }),
  );
  if (!args.includes("--keep-open")) await mock.close();
}
