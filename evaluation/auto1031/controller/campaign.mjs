// Campaign orchestrator CLI.
//   node evaluation/auto1031/controller/campaign.mjs preflight|round0|round <n>|
//          finalreg|holdout|status|resume|report|stop <reason>
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  repo, runRoot, ensureRunRoot, loadState, saveState, initialState,
  timeline, nowIso, budgetCheck, stopCampaign, atomicWriteJson, loadJson,
} from "./state.mjs";
import { pack as packRole, loadTasks, validateSuite } from "../../tools/cli.mjs";
import { runRole, readTranscript } from "./roles.mjs";
import { runTrial, readJson } from "./trial.mjs";
import { sha256File } from "./launch.mjs";
import { buildCasePlan, writeCasePlan, summaryLine } from "./caseplan.mjs";
import { installExitHooks, spawnTracked, killTree, confirmExited, sweepOrphans } from "./procs.mjs";

const args = process.argv.slice(2);
const cmd = args[0] ?? "status";

function sh(cmdStr, { cwd = repo, timeoutMs = 600000 } = {}) {
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", cmdStr], {
      cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String(e.stdout ?? "") + String(e.stderr ?? ""), error: String(e.message ?? e) };
  }
}

function saveLog(path, content) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Manifest assembly for a run root
// ---------------------------------------------------------------------------

async function createRunRoot({ roundDir, name, group, caseIds, exe, display, sourceRevision, suiteVersion, appVersion, modelInfo }) {
  const root = join(roundDir, name);
  if (existsSync(root)) throw new Error("run root exists: " + root);
  mkdirSync(join(root, "trials"), { recursive: true });
  mkdirSync(join(root, "screenshots"), { recursive: true });
  const manifest = {
    schemaVersion: "1.0",
    runId: `auto-1031-${relative(runRoot, roundDir).replaceAll("\\", "/")}-${name}-${Date.now()}`,
    createdAt: nowIso(),
    application: {
      version: appVersion,
      executable: exe.winUnpacked,
      executableSha256: exe.exeSha256,
      build: `auto ${exe.buildTag} git=${sourceRevision} asar=${exe.asarSha256 ?? "null"} nsis=${exe.installerSha256 ?? "null"}`,
    },
    suiteVersion,
    platform: "win32",
    executionTrack: "mixed",
    mockService: group === "mock",
    model: modelInfo,
    display,
    isolation: {
      profile: "per-trial staging profiles (see trials/<ID>/staging/profile)",
      traceRoots: ["per-trial: trials/<ID>/staging/codex/sessions", "per-trial: trials/<ID>/staging/codex/archived_sessions"],
      excluded: ["oracles", "cases", "runner packages", "repo history", "formal install", "real .codex"],
    },
    fixtureHashes: {},
    sourceRevision,
    caseIds,
  };
  atomicWriteJson(join(root, "manifest.json"), manifest);
  timeline({ kind: "run-root", root, group, cases: caseIds.length });
  return root;
}

function mergeFixtureHashes(runRootDir, stagingDir) {
  const manifestPath = join(runRootDir, "manifest.json");
  const manifest = loadJson(manifestPath, null);
  if (!manifest) return;
  const fh = readJson(join(stagingDir, "fixture-hashes.json"), {});
  for (const [rel, hash] of Object.entries(fh)) {
    manifest.fixtureHashes[relative(runRootDir, join(stagingDir, rel)).replaceAll("\\", "/")] = hash;
  }
  atomicWriteJson(manifestPath, manifest);
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

async function preflight() {
  ensureRunRoot();
  let state = loadJson(join(runRoot, "state.json"), null);
  if (state && state.phase !== "preflight" && !state.stop)
    throw new Error("campaign already started; use resume");
  if (!state) { state = initialState(); saveState(state); }
  installExitHooks();
  await sweepOrphans();
  timeline({ kind: "preflight-start", resumed: Object.keys(state.preflight.checks).length > 0 });
  const pf = join(runRoot, "preflight");
  const mark = (key, value) => {
    state.preflight.checks[key] = value;
    saveState(state); // incremental: a later crash keeps what already passed
  };
  const passed = (key) => state.preflight.checks[key] === "ok";

  // 1. freeze assets (cheap, always re-verified)
  const val = await validateSuite();
  saveLog(join(pf, "suite-validate.json"), val);
  if (!val.valid) throw new Error("suite invalid: " + JSON.stringify(val.errors?.slice(0, 5)));
  const tooling = sh("node --test evaluation/tools/tooling.test.mjs", { timeoutMs: 300000 });
  saveLog(join(pf, "tooling-tests.log"), tooling.out);
  if (!tooling.ok) throw new Error("tooling tests failed");
  const frozen = {};
  for (const sub of ["cases", "oracles", "fixtures", "tools", "schemas", "templates"]) {
    const dir = join(repo, "evaluation", sub);
    for (const walk of listFiles(dir)) frozen[relative(repo, walk).replaceAll("\\", "/")] = sha256File(walk);
  }
  atomicWriteJson(join(runRoot, "assets-frozen.json"), frozen);
  const { plan } = await writeCasePlan();
  saveLog(join(pf, "case-plan-summary.json"), { line: summaryLine(plan), dev: plan.dev, hold: plan.hold });
  mark("assetsFrozen", sha256File(join(runRoot, "assets-frozen.json")).slice(0, 16));

  // 2. engineering baseline (skip steps already green on a resume)
  const eng = join(pf, "engineering");
  const steps = [
    ["typecheck", "npm run typecheck"],
    ["unit", "npm test"],
    ["e2e", "npm run test:e2e"],
    ["build", "npm run build"],
  ];
  let buildOk = true;
  for (const [name, command] of steps) {
    if (passed("eng-" + name)) { timeline({ kind: "engineering-skip", name }); continue; }
    const r = sh(command, { timeoutMs: 1800000 });
    saveLog(join(eng, name + ".log"), r.out);
    timeline({ kind: "engineering", name, ok: r.ok });
    if (!r.ok && name === "build") buildOk = false;
    mark("eng-" + name, r.ok ? "ok" : "failed");
  }
  if (!buildOk) throw new Error("build impossible — cannot start campaign");

  // 3. claude.exe probes (both models; preset already carries the right model)
  for (const [model, role] of [["glm-5.3", "coordinator"], ["glm-5.3-flash", "visual"]]) {
    if (passed("claude-" + model)) continue;
    const probeDir = join(pf, "claude-" + model);
    const res = await runRole({
      role,
      promptText: "请只回复两个字符：OK",
      cwd: probeDir, outDir: probeDir, label: "probe:" + model,
      timeoutMs: 120000,
    });
    const t = readTranscript(join(probeDir, role + ".jsonl"));
    mark("claude-" + model,
      res.exitCode === 0 && t.subtype === "success" ? "ok" : `fail(${res.exitCode}/${t.subtype})`);
    timeline({ kind: "probe-claude", model, code: res.exitCode, subtype: t.subtype });
  }

  // 4. windows-mcp probe (runner preset drives DisplayInventory+Snapshot)
  if (state.probes.windowsMcp !== "ok") {
    const mcpDir = join(pf, "mcp-probe");
    const mcpRes = await runRole({
      role: "runner",
      promptText: `依次调用 windows-mcp 的 DisplayInventory 与 Snapshot(use_vision=false)，然后只回复一行 JSON：{"displays":<主显示器宽x高与缩放>,"windows":<可见窗口数>,"dogdogVisible":<布尔，桌面是否可见标题含 DogDog 的窗口>}。不要做其他事。`,
      cwd: mcpDir, outDir: mcpDir, label: "probe:mcp",
      timeoutMs: 180000,
    });
    const mcpT = readTranscript(join(mcpDir, "runner.jsonl"));
    state.probes.windowsMcp = mcpRes.exitCode === 0 && mcpT.subtype === "success" ? "ok" : "fail";
    saveState(state);
    try {
      const inv = JSON.parse((mcpT.finalText ?? "").trim());
      if (inv.displays) state.probes.display = { raw: inv.displays };
    } catch {}
    if (state.probes.windowsMcp !== "ok") throw new Error("windows-mcp probe failed");
  }

  // display geometry (authoritative, from PowerShell)
  const disp = sh("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { \"$($_.Bounds.Width)x$($_.Bounds.Height) scale=$([Math]::Round($([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width / [System.Windows.Forms.SystemInformation]::VirtualScreen.Width * 100)))\" }");
  state.probes.displayGeometry = disp.out.trim() || null;

  // 5. GLM text probe (direct request, key from env, never logged)
  const glm = await glmTextProbe();
  mark("glmText", glm ? "ok" : "fail");
  if (!glm) throw new Error("GLM text probe failed (credential/service dead?)");

  // 6. Flash image probe (3 tries) -> 429 fallback decision
  if (state.probes.flashImage !== "ok" && state.probes.flashImage !== "429-fallback-text") {
    const shot = join(pf, "probe-shot.png");
    try {
      const { captureScreen } = await import("./screen.mjs");
      captureScreen(shot);
    } catch {}
    let imgOk = 0, img429 = 0;
    for (let i = 1; i <= 3; i++) {
      const dir = join(pf, "flash-img-" + i);
      const res = await runRole({
        role: "visual",
        promptText: `用 Read 工具读取图片 ${shot}，然后用不超过20个汉字描述其主要内容。`,
        cwd: dir, outDir: dir, label: "probe:flash-img-" + i,
        timeoutMs: 120000,
      });
      const t = readTranscript(join(dir, "visual.jsonl"));
      if (res.exitCode === 0 && t.subtype === "success" && (t.finalText ?? "").trim()) imgOk++;
      else {
        const raw = readFileSync(join(dir, "visual.jsonl"), "utf8");
        if (/429|rate.?limit/i.test(raw + readFileSync(join(dir, "visual.stderr.log"), "utf8"))) img429++;
      }
    }
    state.probes.flashImage = imgOk > 0 ? "ok" : img429 > 0 ? "429-fallback-text" : "fail-no-image";
    saveState(state);
    timeline({ kind: "probe-flash-image", ok: imgOk, err429: img429, decision: state.probes.flashImage });
  }

  // 7. baseline build auto-r0 + DogDog accessibility probe
  let exe;
  const r0ExePath = join(repo, "release", "auto-r0", "win-unpacked", "DogDog.exe");
  if (passed("buildR0") && existsSync(r0ExePath) &&
      sha256File(r0ExePath).startsWith(String(state.preflight.checks.buildR0))) {
    exe = readExeIdentity("release/auto-r0", "r0");
    timeline({ kind: "package-skip", tag: "r0" });
  } else {
    const buildRes = sh("npm run package -- --config.directories.output=release/auto-r0", { timeoutMs: 3600000 });
    saveLog(join(pf, "package-r0.log"), buildRes.out);
    if (!buildRes.ok) throw new Error("packaging r0 failed");
    exe = readExeIdentity("release/auto-r0", "r0");
    mark("buildR0", exe.exeSha256.slice(0, 16));
  }
  if (state.preflight.checks.dogdogAccessibility !== "ok") {
    await dogdogProbe({ exe, pf, state });
  }

  // 8. PID discipline self-test (spawn own process → killTree → confirmExited)
  try {
    const { child } = spawnTracked("mocks", {
      cmd: "notepad.exe", args: [], label: "selftest-notepad", trialId: "preflight",
    });
    await new Promise((r) => setTimeout(r, 1500));
    killTree(child.pid);
    await confirmExited(child.pid, 15000);
    mark("pidDiscipline", "ok");
  } catch (e) {
    mark("pidDiscipline", "fail: " + String(e.message ?? e).slice(0, 120));
  }

  // 9. environment items (record-only)
  const power = sh("powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE; powercfg /query SCHEME_CURRENT SUB_VIDEO VIDEOIDLE");
  saveLog(join(pf, "powercfg.log"), power.out);
  const disk = sh("(Get-PSDrive D).Free / 1GB");
  const freeGb = Number((disk.out ?? "").trim());
  mark("diskFreeGb", Number.isFinite(freeGb) ? Math.round(freeGb) : null);
  mark("imeComposition", "unverified-unicode-injection-only");
  mark("installCaseDD1204", "deferred-to-trial (isolated provisioning attempted in round 0)");

  state.preflight.checks.baselineCommit = sh("git rev-parse HEAD").out.trim();
  state.phase = "baseline-round";
  state.round = { n: 0, phase: "testing", gitSha: state.preflight.checks.baselineCommit, buildDir: "release/auto-r0", ...exe };
  saveState(state);
  timeline({ kind: "preflight-done", checks: state.preflight.checks });
  console.log("preflight complete:", JSON.stringify(state.preflight.checks, null, 1));
}

function listFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

async function glmTextProbe() {
  const key = process.env.GLM_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://open.bigmodel.cn/api/anthropic/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "glm-5.3", max_tokens: 8, messages: [{ role: "user", content: "ping" }] }),
      signal: AbortSignal.timeout(30000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

function readExeIdentity(buildDirRel, tag) {
  // buildDirRel is repo-relative, e.g. "release/auto-r0"
  const winUnpacked = join(repo, buildDirRel, "win-unpacked", "DogDog.exe");
  if (!existsSync(winUnpacked)) throw new Error("missing packaged exe " + winUnpacked);
  const asarPath = join(repo, buildDirRel, "win-unpacked", "resources", "app.asar");
  const installer = readdirSync(join(repo, buildDirRel)).find((n) => /^DogDog-Setup-.*\.exe$/.test(n));
  const pkg = loadJson(join(repo, "package.json"), {});
  return {
    winUnpacked,
    exeSha256: sha256File(winUnpacked),
    asarSha256: existsSync(asarPath) ? sha256File(asarPath) : null,
    installer: installer ? join(repo, buildDirRel, installer) : null,
    installerSha256: installer ? sha256File(join(repo, buildDirRel, installer)) : null,
    appVersion: pkg.version ?? null,
    buildTag: tag,
  };
}

async function dogdogProbe({ exe, pf, state }) {
  const { launchDogDog, stopDogDog } = await import("./launch.mjs");
  const staging = join(pf, "dogdog-probe-staging");
  mkdirSync(join(staging, "codex", "sessions"), { recursive: true });
  mkdirSync(join(staging, "codex", "archived_sessions"), { recursive: true });
  mkdirSync(join(staging, "profile"), { recursive: true });
  writeFileSync(join(staging, "launch-env.json"), JSON.stringify({
    DOGDOG_USER_DATA: join(staging, "profile"),
    CODEX_HOME: join(staging, "codex"),
    DOGDOG_REAL_CHECK: null,
    ELECTRON_RUN_AS_NODE: null,
  }), "utf8");
  let rec = null;
  try {
    rec = await launchDogDog({
      exePath: exe.winUnpacked,
      launchEnvPath: join(staging, "launch-env.json"),
      trialDir: staging, attemptDir: staging, label: "preflight-probe",
    });
    const probeDir = join(pf, "dogdog-probe");
    const res = await runRole({
      role: "runner",
      promptText: `DogDog 已启动（窗口标题应含 DogDog）。调用 Snapshot(use_vision=false) 观察桌面，然后只回复一行 JSON：{"titleFound":<布尔>,"newChat":<布尔，是否存在"新建讨论">,"questionBox":<布尔，是否存在"你的问题">,"settings":<布尔，是否存在"模型设置">,"notes":"<其他观察>"}。不要点击任何东西。`,
      cwd: probeDir, outDir: probeDir, label: "probe:dogdog",
      timeoutMs: 180000,
    });
    const t = readTranscript(join(probeDir, "runner.jsonl"));
    state.preflight.checks.dogdogAccessibility = res.exitCode === 0 && t.subtype === "success" ? "ok" : "fail";
    saveState(state);
    saveLog(join(pf, "dogdog-probe-result.json"), { finalText: t.finalText, subtype: t.subtype });
    if (state.preflight.checks.dogdogAccessibility !== "ok")
      throw new Error("DogDog accessibility probe failed");
  } finally {
    if (rec?.pid) { try { await stopDogDog(rec.pid, "preflight-probe"); } catch {} }
  }
}

// ---------------------------------------------------------------------------
// Round runner (round 0 baseline and round N retest share this)
// ---------------------------------------------------------------------------

async function runCases({ state, roundDir, exe, caseRows, display }) {
  const suiteVersion = loadJson(join(repo, "evaluation", "catalog.json"), {}).version ?? "1.0.0";
  // fresh role packages for the round
  const packs = {};
  for (const role of ["runner", "setup", "reviewer"]) {
    const dir = join(roundDir, "pack-" + role);
    await packRole({ role, split: caseRows[0]?.split === "holdout" ? "holdout" : "development", out: dir });
    packs[role] = dir;
  }
  const roots = {};
  for (const group of ["real", "mock"]) {
    const ids = caseRows.filter((r) => r.group === group).map((r) => r.id);
    if (!ids.length) continue;
    roots[group] = await createRunRoot({
      roundDir, name: (caseRows[0].split === "holdout" ? "hold-" : "dev-") + group,
      group, caseIds: ids, exe, display,
      sourceRevision: state.round.gitSha,
      suiteVersion, appVersion: exe.appVersion,
      modelInfo: group === "real"
        ? { protocol: "openai-responses", name: "GLM-5.3", endpoint: "https://open.bigmodel.cn/api/v1/responses", configuration: { credential: "env:GLM_API_KEY (value not recorded)" } }
        : { protocol: "openai-responses", name: "fixture-mock", endpoint: "per-trial 127.0.0.1 (see trials/<ID>/staging/service/status.json)", configuration: { scripted: true } },
    });
  }
  const results = {};
  for (const row of caseRows) {
    const stop = budgetCheck(state);
    if (stop) { stopCampaign(state, stop); break; }
    const root = roots[row.group];
    let attempt = 1;
    let last = null;
    while (attempt <= 3) {
      state.activeTrial = { caseId: row.id, attempt, stage: "pipeline", startedAt: nowIso() };
      saveState(state);
      last = await runTrial({
        state, caseRow: row, runRootDir: root,
        setupPkgDir: packs.setup, reviewerPkgDir: packs.reviewer,
        exePath: exe.winUnpacked, attempt,
      });
      mergeFixtureHashes(root, join(root, "trials", row.id, "staging"));
      saveState(state);
      if (last.status !== "infrastructure_failure" && last.status !== "controller-error") break;
      if (attempt === 3) break;
      timeline({ kind: "infra-retry", caseId: row.id, attempt });
      attempt += 1;
    }
    results[row.id] = { status: last.status, attempts: attempt };
    state.activeTrial = null;
    saveState(state);
  }
  // per-round reports
  for (const [group, root] of Object.entries(roots)) {
    const r = sh(`node evaluation/tools/report.mjs --run "${root}"`, { timeoutMs: 300000 });
    saveLog(join(roundDir, `report-${group}.log`), r.out);
  }
  return { results, roots };
}

function gapListFromResults({ roundDir, plan, results }) {
  const gaps = { generatedAt: nowIso(), product: [], notImplemented: [], infrastructure: [], dispute: [], insufficient: [], passed: [] };
  for (const row of plan.rows.filter((r) => r.split === "development")) {
    const res = results[row.id];
    if (!res) continue;
    const detail = { id: row.id, system: row.system, capability: row.capability, family: row.family, status: res.status, attempts: res.attempts, semantic: row.hasSemanticMust, gates: row.gateCount };
    if (res.status === "pass") gaps.passed.push(row.id);
    else if (res.status === "not_implemented") gaps.notImplemented.push(detail);
    else if (res.status === "infrastructure_failure") gaps.infrastructure.push(detail);
    else if (res.status === "grading_dispute") gaps.dispute.push(detail);
    else if (res.status === "insufficient_evidence") gaps.insufficient.push(detail);
    else gaps.product.push(detail);
  }
  atomicWriteJson(join(roundDir, "gaps", "dev-gap-list.json"), gaps);
  return gaps;
}

async function round0() {
  const state = loadState();
  if (state.phase !== "baseline-round") throw new Error("not in baseline phase: " + state.phase);
  installExitHooks();
  await sweepOrphans();
  const plan = loadJson(join(runRoot, "case-plan.json"), null);
  if (!plan) throw new Error("missing case-plan.json");
  const roundDir = join(runRoot, "r0");
  const exe = readExeIdentity("release/auto-r0", "r0");
  const display = displayFromState(state);
  const devRows = plan.rows.filter((r) => r.split === "development");
  const { results } = await runCases({ state, roundDir, exe, caseRows: devRows, display });
  if (state.stop) { saveState(state); updateGoalProgress("r0 因停止条件中断：" + state.stop.reason); return; }
  const gaps = gapListFromResults({ roundDir, plan, results });
  state.phase = "iteration";
  state.round.phase = "decided";
  state.stagnation = {
    lastPassCount: gaps.passed.length,
    lastHardGateFails: gaps.product.length + gaps.dispute.length,
    lastNotImplemented: gaps.notImplemented.length,
  };
  saveState(state);
  updateGoalProgress(`r0 基线完成：pass=${gaps.passed.length}/72；product=${gaps.product.length} notImpl=${gaps.notImplemented.length} infra=${gaps.infrastructure.length} dispute=${gaps.dispute.length} insuff=${gaps.insufficient.length}`);
  console.log("round0 done:", JSON.stringify({ passed: gaps.passed.length, product: gaps.product.length, notImplemented: gaps.notImplemented.length }));
}

function displayFromState(state) {
  const m = /(\d+)x(\d+)/.exec(state.probes.displayGeometry ?? "");
  return { width: m ? Number(m[1]) : null, height: m ? Number(m[2]) : null, scale: null };
}

// ---------------------------------------------------------------------------
// Coder round
// ---------------------------------------------------------------------------

async function coderRound(n) {
  const state = loadState();
  if (state.stop) throw new Error("campaign stopped: " + state.stop.reason);
  installExitHooks();
  await sweepOrphans();
  const plan = loadJson(join(runRoot, "case-plan.json"), null);
  const prevRound = join(runRoot, "r" + (n - 1));
  const gaps = loadJson(join(prevRound, "gaps", "dev-gap-list.json"), null);
  if (!gaps) throw new Error("missing previous gap list");
  const roundDir = join(runRoot, "r" + n);
  mkdirSync(roundDir, { recursive: true });

  // coder input: gap list + dev case cards for failing cases (dev only)
  const failIds = [...gaps.product, ...gaps.notImplemented, ...gaps.insufficient, ...gaps.dispute].map((g) => g.id);
  const coderInput = join(roundDir, "coder-input");
  mkdirSync(join(coderInput, "cases"), { recursive: true });
  atomicWriteJson(join(coderInput, "dev-gap-list.json"), gaps);
  for (const id of failIds) {
    const src = join(repo, "evaluation", "cases", id.slice(3, 5), id + ".json");
    if (existsSync(src)) copyFileSync(src, join(coderInput, "cases", id + ".json"));
  }
  const coderDir = join(roundDir, "coder");
  const prompt = `你是本轮的产品修改工程师（coder 角色），在仓库 D:\\work_record\\DogDog 内工作。

【输入（只依赖这些做判断）】
1. 差距清单与失败案例卡：${coderInput}（均为 development 案例；含 must/mustNot 描述，供你理解预期行为）
2. 上一轮验证记录：${prevRound}（report-*.log、trials 证据、review 文件）
3. 产品源码、测试、verification/ 历史记录

【任务】
1. 先写 ${join(roundDir, "coder-plan.md")}：每个要修问题的根因、预期行为、最小修改范围、关联案例ID、验证方式；按优先级排序（gate 硬门槛 > 阻塞闭环 > 共同根因）。
2. 实现修改并补回归测试（tests/ 下，遵循仓库测试规范）。
3. 运行 npm run typecheck、npm test，及与改动相关的定向桌面检查；全部通过。
4. git add -A && git commit（信息以 feat/fix(scope): 开头，结尾加 Co-Authored-By: Claude Code <noreply@anthropic.com>）。
5. 写 ${join(roundDir, "coder-summary.json")}：{"commit":"<sha>","affectedCases":[...],"relatedCases":[...],"checksRun":[...],"notes":"..."}。

【铁律】
- 禁止：答案硬编码、按夹具文件名/案例ID特判、识别评测环境后改变行为、修改 evaluation/ 下任何文件。
- 不读取 evaluation/oracles/** 与 holdout 案例（NN=07/08）。
- 保持既有中文产品文案与仓库代码风格（两空格、分号、Prettier）。
- 产品安全边界不放松：凭据只在主进程、原始轨迹只读、证据行号保留。
- 若判断某差距属于评分问题或环境问题而非产品缺陷：在 coder-plan.md 中说明并跳过修改，不要为通过评测而改变产品语义。`;
  const res = await runRole({
    role: "coder",
    promptText: prompt,
    cwd: repo,
    outDir: coderDir,
    label: `r${n}:coder`,
    timeoutMs: 120 * 60 * 1000,
  });
  state.budget.claudeTurns += 1;
  const summary = readJson(join(roundDir, "coder-summary.json"), null);
  if (res.exitCode !== 0 || !summary?.commit)
    throw new Error(`coder round failed exit=${res.exitCode} (see ${coderDir})`);

  // build freeze
  const gitStatus = sh("git status --porcelain");
  if (gitStatus.out.trim())
    throw new Error("worktree not clean after coder: " + gitStatus.out.slice(0, 300));
  const buildTag = "r" + n;
  const buildRes = sh(`npm run package -- --config.directories.output=release/auto-${buildTag}`, { timeoutMs: 3600000 });
  saveLog(join(roundDir, "package.log"), buildRes.out);
  if (!buildRes.ok) throw new Error("packaging failed");
  const exe = readExeIdentity("release/auto-" + buildTag, buildTag);
  state.round = { n, phase: "testing", gitSha: summary.commit, buildDir: "release/auto-" + buildTag, ...exe };
  state.budget.productRounds += 1;
  saveState(state);

  // wave selection: affected + related(system), then full sweep only if green
  const affected = new Set(summary.affectedCases ?? []);
  for (const id of summary.relatedCases ?? []) affected.add(id);
  const affectedSystems = new Set(
    [...affected].map((a) => String(a.split("-")[1] ?? "").padStart(2, "0")),
  );
  const wave12 = plan.rows.filter(
    (r) => r.split === "development" &&
      (affected.has(r.id) || affectedSystems.has(String(r.system).padStart(2, "0"))),
  );
  const { results } = await runCases({
    state, roundDir, exe,
    caseRows: wave12.length ? wave12 : plan.rows.filter((r) => r.split === "development"),
    display: displayFromState(state),
  });
  if (state.stop) { saveState(state); updateGoalProgress(`r${n} 因停止条件中断：` + state.stop.reason); return; }
  let allGreen = plan.rows.filter((r) => r.split === "development").every((r) => results[r.id]?.status === "pass");
  if (!allGreen && wave12.length) {
    // full sweep on this build only if waves 1-2 green
    const wave12Green = wave12.every((r) => results[r.id]?.status === "pass");
    if (wave12Green) {
      const full = await runCases({ state, roundDir: join(roundDir, "full"), exe, caseRows: plan.rows.filter((r) => r.split === "development"), display: displayFromState(state) });
      Object.assign(results, full.results);
      allGreen = plan.rows.filter((r) => r.split === "development").every((r) => results[r.id]?.status === "pass");
    }
  }
  const gapsN = gapListFromResults({ roundDir, plan, results });
  // stagnation accounting
  const pass = gapsN.passed.length;
  const hard = gapsN.product.length + gapsN.dispute.length;
  const nimpl = gapsN.notImplemented.length;
  const st = state.stagnation;
  const noProgress =
    st.lastPassCount !== null &&
    hard >= st.lastHardGateFails && nimpl >= st.lastNotImplemented && pass <= st.lastPassCount;
  state.stagnation = { lastPassCount: pass, lastHardGateFails: hard, lastNotImplemented: nimpl };
  state.budget.stagnantRounds = noProgress ? state.budget.stagnantRounds + 1 : 0;
  if (state.budget.stagnantRounds >= 3) stopCampaign(state, "stagnation-3-rounds");
  if (!state.stop) state.phase = allGreen ? "frozen-candidate" : "iteration";
  saveState(state);
  updateGoalProgress(`r${n} 完成：pass=${pass}/72 product=${gapsN.product.length} notImpl=${gapsN.notImplemented.length} stagnant=${state.budget.stagnantRounds}${allGreen ? " → 冻结候选" : ""}`);
  console.log(`round ${n} done`, JSON.stringify({ pass, allGreen }));
}

// ---------------------------------------------------------------------------
// Final regression + holdout
// ---------------------------------------------------------------------------

async function finalreg() {
  const state = loadState();
  if (state.phase !== "frozen-candidate") throw new Error("not frozen-candidate: " + state.phase);
  installExitHooks();
  await sweepOrphans();
  const plan = loadJson(join(runRoot, "case-plan.json"), null);
  const exe = readExeIdentity(state.round.buildDir, state.round.buildTag);
  const roundDir = join(runRoot, "final");
  const devRows = plan.rows.filter((r) => r.split === "development");
  const display = displayFromState(state);
  // pass 1: every case once (fresh roots/contexts)
  const p1 = await runCases({ state, roundDir: join(roundDir, "pass1"), exe, caseRows: devRows, display });
  const results = { ...p1.results };
  const allPass = devRows.every((r) => results[r.id]?.status === "pass");
  if (!allPass) {
    state.phase = "iteration";
    saveState(state);
    throw new Error("final regression pass1 not all green — back to iteration");
  }
  // pass 2/3 for the 50 semantic cases
  for (const pass of [2, 3]) {
    const semRows = devRows.filter((r) => r.hasSemanticMust);
    const px = await runCases({ state, roundDir: join(roundDir, "pass" + pass), exe, caseRows: semRows, display });
    for (const [id, r] of Object.entries(px.results)) results[id + ":p" + pass] = r;
    const ok = semRows.every((r) => px.results[r.id]?.status === "pass");
    if (!ok) {
      state.phase = "iteration";
      saveState(state);
      throw new Error(`final regression pass${pass} semantic 3x failed — back to iteration`);
    }
  }
  state.phase = "holdout";
  saveState(state);
  updateGoalProgress("终检完成：172/172 trial 全部 pass，进入 holdout");
  console.log("final regression green (3x semantic)");
}

async function holdout() {
  const state = loadState();
  if (state.phase !== "holdout") throw new Error("not in holdout phase: " + state.phase);
  installExitHooks();
  await sweepOrphans();
  const plan = loadJson(join(runRoot, "case-plan.json"), null);
  const exe = readExeIdentity(state.round.buildDir, state.round.buildTag);
  const roundDir = join(runRoot, "hold");
  const holdRows = plan.rows.filter((r) => r.split === "holdout");
  const { results } = await runCases({ state, roundDir, exe, caseRows: holdRows, display: displayFromState(state) });
  const failed = Object.entries(results).filter(([, r]) => r.status !== "pass");
  if (failed.length) {
    stopCampaign(state, "holdout-failed-handback", failed.map(([id, r]) => id + ":" + r.status).join(","));
  } else {
    state.phase = "done";
    saveState(state);
  }
  updateGoalProgress(`holdout 完成：${holdRows.length - failed.length}/${holdRows.length} pass`);
  console.log("holdout done", JSON.stringify({ failed: failed.length }));
}

// ---------------------------------------------------------------------------
// Report / status / resume / goal
// ---------------------------------------------------------------------------

function updateGoalProgress(line) {
  const p = join(runRoot, "GOAL.md");
  try {
    const text = readFileSync(p, "utf8");
    const stamped = `- [${new Date().toISOString().slice(0, 16).replace("T", " ")}] ${line}\n`;
    writeFileSync(p, text.replace(/## 进度速记[\s\S]*$/, "## 进度速记（每次会话结束前更新）\n\n" + stamped), "utf8");
  } catch {}
}

function status() {
  const state = loadJson(join(runRoot, "state.json"), null);
  if (!state) { console.log("no state — run preflight"); return; }
  console.log(JSON.stringify({
    phase: state.phase, round: state.round?.n ?? null, stop: state.stop,
    budget: state.budget, deadlineAt: state.deadlineAt,
    probes: state.probes, activeTrial: state.activeTrial,
  }, null, 1));
}

async function resume() {
  const state = loadState();
  if (state.stop) { console.log("stopped:", state.stop.reason); return; }
  const stop = budgetCheck(state);
  if (stop) { stopCampaign(state, stop); console.log("stopped:", stop); return; }
  switch (state.phase) {
    case "preflight": await preflight(); break;
    case "baseline-round": await round0(); break;
    case "iteration": {
      const n = (state.round?.n ?? 0) + 1;
      await coderRound(n);
      break;
    }
    case "frozen-candidate": await finalreg(); break;
    case "holdout": await holdout(); break;
    case "done": console.log("campaign done — write final report"); break;
    default: throw new Error("unknown phase " + state.phase);
  }
}

function finalReport() {
  const state = loadState();
  const plan = loadJson(join(runRoot, "case-plan.json"), { rows: [] });
  const perCase = {};
  for (const rootRel of ["r0", "final", "hold"]) {
    const base = join(runRoot, rootRel);
    if (!existsSync(base)) continue;
    for (const sub of readdirSync(base)) {
      const trials = join(base, sub, "trials");
      if (!existsSync(trials) || !readdirSync(trials).length) continue;
      for (const id of readdirSync(trials)) {
        for (const f of readdirSync(join(trials, id))) {
          if (/^result(-.*)?\.json$/.test(f)) {
            const r = loadJson(join(trials, id, f), null);
            if (r) perCase[id] = [...(perCase[id] ?? []), { root: rootRel + "/" + sub, attempt: r.attempt, status: r.status }];
          }
        }
      }
    }
  }
  const report = {
    campaignId: "auto-1031",
    stoppedAt: state.stop ?? { reason: state.phase === "done" ? "completed" : "in-progress" },
    startedAt: state.startedAt,
    budget: state.budget,
    finalBuild: state.round ? { n: state.round.n, gitSha: state.round.gitSha, exe: state.round.exeSha256, asar: state.round.asarSha256, installer: state.round.installerSha256 } : null,
    perCaseCount: Object.keys(perCase).length,
    perCase,
    honestLimits: [
      "blinded=false（过程性隔离，无OS沙箱）",
      "合成夹具；mock 通过仅证协议/工具/UI链路",
      state.probes.flashImage !== "ok" ? "视觉路径受限，布局判断基于可访问性树与事后截图" : null,
      "IME 组合输入未验证（Type=Unicode注入）",
      "费用不可核实处为 null",
    ].filter(Boolean),
  };
  atomicWriteJson(join(runRoot, "report", "FINAL-REPORT.json"), report);
  writeFileSync(
    join(runRoot, "report", "FINAL-REPORT.md"),
    `# auto-1031 最终报告\n\n- 停止原因：${report.stoppedAt.reason}${report.stoppedAt.detail ? "（" + report.stoppedAt.detail + "）" : ""}\n- 最终构建：${JSON.stringify(report.finalBuild)}\n- 预算使用：${JSON.stringify(state.budget)}\n- 逐题状态：见 FINAL-REPORT.json（${report.perCaseCount} 案）\n- 诚实边界：\n${report.honestLimits.map((l) => "  - " + l).join("\n")}\n`,
    "utf8",
  );
  console.log("final report written");
}

async function main() {
  switch (cmd) {
    case "preflight": await preflight(); break;
    case "round0": await round0(); break;
    case "round": await coderRound(Number(args[1])); break;
    case "finalreg": await finalreg(); break;
    case "holdout": await holdout(); break;
    case "status": status(); break;
    case "resume": await resume(); break;
    case "report": finalReport(); break;
    case "stop": {
      const state = loadState();
      stopCampaign(state, args[1] ?? "manual");
      console.log("stopped:", state.stop);
      break;
    }
    default: throw new Error("unknown command " + cmd);
  }
}

main().catch((e) => {
  console.error("campaign error:", e?.stack ?? e);
  timeline({ kind: "campaign-error", error: String(e?.message ?? e).slice(0, 400) });
  process.exitCode = 1;
});
