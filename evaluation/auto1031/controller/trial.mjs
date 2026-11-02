// Per-case pipeline:
//   prepare → setup-A (seeds/mock/handoff) → launch → setup-B (UI pre-config)
//   → runner turn 1..n ⟷ admin checkpoints → post-trial audit
//   → visual reviewer (optional) → reviewer → finalize + validate-run → record
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { prepare } from "../../tools/cli.mjs";
import { runRole, readTranscript } from "./roles.mjs";
import { harvest, extractProgressLog, detectCheckpoint, redact } from "./harvest.mjs";
import { launchDogDog, stopDogDog, sha256File } from "./launch.mjs";
import { startIntervalCapture, captureScreen } from "./screen.mjs";
import { cleanupAll, spawnTracked } from "./procs.mjs";
import { timeline, nowIso, repo } from "./state.mjs";
import { finalizeResult, validateRunRoot } from "./validate.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// MUST stay synchronous: callers use it directly (an async version returns
// Promises whose .ready/.commit fields are silently undefined).
export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function appendEvent(runRootDir, ev) {
  mkdirSync(runRootDir, { recursive: true });
  writeFileSync(
    join(runRootDir, "events.jsonl"),
    redact(JSON.stringify({ ts: nowIso(), ...ev })) + "\n",
    { flag: "a" },
  );
}

// Long-running mocks are started by the CONTROLLER (SETUP.md's "管理员"),
// never by the setup session — claude's Bash kills background children on its
// own time limit and when the session exits, which orphaned mocks in smoke.
async function startMockFromRequest({ runRootDir, caseId, attempt, stagingDir, mockRequest }) {
  if (!mockRequest?.kind) return null;
  const outDir = mockRequest.outDir && !/^[a-z]:/i.test(mockRequest.outDir)
    ? join(stagingDir, mockRequest.outDir)
    : (mockRequest.outDir ?? join(stagingDir, "service"));
  mkdirSync(outDir, { recursive: true });
  let script, args;
  if (mockRequest.kind === "desktop-service") {
    const planPath = mockRequest.planPath?.replaceAll("/", "\\");
    if (!planPath || !existsSync(planPath)) throw new Error("mockRequest.planPath missing: " + planPath);
    script = join(repo, "evaluation", "fixtures", "_support", "desktop-service.mjs");
    args = [script, "--plan", planPath, "--out", outDir, "--port", "0"];
  } else {
    script = join(repo, "evaluation", "tools", "mock-service.mjs");
    args = [script, "--out", outDir, "--mode", mockRequest.mode ?? "text", "--port", "0"];
  }
  spawnTracked("mocks", {
    cmd: process.execPath, args, cwd: repo,
    label: `${caseId}:mock`, trialId: caseId,
  });
  const statusPath = join(outDir, "status.json");
  for (let i = 0; i < 20; i++) {
    const st = readJson(statusPath, null);
    if (st?.url) {
      appendEvent(runRootDir, { caseId, attempt, kind: "mock-started", url: st.url, mode: st.mode });
      return { statusPath, status: st };
    }
    await sleep(500);
  }
  throw new Error("mock did not report status.json within 10s");
}

// Mock services are spawned by the setup role's Bash (not in our registry).
// Kill them by the PID recorded in the trial's own status.json, guarded by a
// command-line match so a recycled PID can never be killed by mistake.
function killMockFromStatus(mockStatusJson, stagingDir) {
  const status = readJson(mockStatusJson, null);
  const pid = status?.pid;
  if (!pid || typeof pid !== "number") return null;
  let cmdline = "";
  try {
    cmdline = execFileSync(
      "powershell",
      ["-NoProfile", "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).CommandLine`],
      { encoding: "utf8", timeout: 15000 },
    );
  } catch { /* gone */ }
  const safe = /mock-service|desktop-service/.test(cmdline ?? "") ||
    (stagingDir && (cmdline ?? "").includes(stagingDir));
  if (!safe) return { pid, skipped: "command-line-guard" };
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { timeout: 20000 });
    return { pid, killed: true };
  } catch {
    return { pid, killed: false };
  }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const RUNNER_ENTRY = `你是 DogDog 的代理用户。只使用给定 brief 中的事实与允许回答；通过真实 UI 完成目标，不读取仓库、底稿、请求记录或存储文件。DogDog 追问时按 answers 的条件回答；未给定事实使用 unknownReply，不能为了让任务成功而发明背景。记录动作、输入、可见结果、时间和关键截图。遇到问题保留首次失败，不修复产品，不自行调整验收标准。达到回合/时间预算后停止并提交过程证据，不自行宣告最终通过。`;

const RUNNER_PROTOCOL = `【运行规程】
- 只使用 windows-mcp 工具操作桌面；每次动作前先用 Snapshot(use_vision=false) 重新观察，坐标以当前可访问性树为准；动作后再次观察确认。
- 不要依赖图像分析（视觉通道受限）。可在每次重要状态变化时保存一张普通 Screenshot 作为本地证据，但不要尝试分析图片内容；图像类错误(如429)直接忽略并继续用文本树。
- DogDog 窗口标题与进程见启动信息；不要启动或关闭 DogDog 进程，不要启动其他应用；如某步骤确需结束/重启应用或改动文件，完成当前观察后以单独一行 "CHECKPOINT: <名称>" 结束本回合并停止，其余交给准备者。本回合结束时若无需任何管理员动作，不要输出任何 CHECKPOINT 行。
- 用户接管（USER_CONTROL / ControlStatus 显示被接管）时：等待并重新观察，绝不绕过，累计超过5分钟则记录并在预算内继续其他观察。
- 载入/思考状态超过90秒无变化：Snapshot 记录现状后按预算继续。
- 时间预算以本回合提示给出的剩余毫秒为准（覆盖全部回合累计）；用户回合数按 brief.limits.maxUserTurns 自行控制；用尽即停，如实保留未完成状态。
- 每回合最后必须输出一个 "PROGRESS LOG" 小节（≤40行，仅事实）：发送的每条消息原文、关键观察与时间点、当前状态、未决问题。不要在此之外做总结性宣告。`;

function runnerPrompt({ brief, launchInfo, remainingMs, maxUserTurns, priorLogs, adminActions }) {
  let out = `${RUNNER_ENTRY}\n\n${RUNNER_PROTOCOL}\n\n【预算】剩余总时间 ${Math.max(0, remainingMs)} 毫秒；用户回合上限 ${maxUserTurns}。\n\n【用户简报（brief，唯一事实来源）】\n${JSON.stringify(brief, null, 1)}\n\n【启动信息（准备者提供）】\n${JSON.stringify(launchInfo, null, 1)}\n`;
  if (priorLogs?.length) {
    out += `\n【上一回合 PROGRESS LOG（逐字保留）】\n${priorLogs.join("\n\n---\n\n")}\n`;
  }
  if (adminActions?.length) {
    out += `\n【回合间管理员动作（准备者已执行，供你知悉）】\n${adminActions.map((a) => "- " + a).join("\n")}\n`;
  }
  out += `\n现在开始按 brief 的 initialMessage 与 actions 执行。记住：先观察后动作，事实不编造，预算用尽即停，最后输出 PROGRESS LOG。`;
  return out;
}

function setupPrompt({ caseId, setupPkgDir, stagingDir, exePath, group, phase, launchInfoPath }) {
  const keyNote =
    group === "real"
      ? `本案例使用真实被测模型服务：接口协议 OpenAI Responses、模型名 GLM-5.3。服务地址必须填完整请求端点 https://open.bigmodel.cn/api/v1/responses —— 产品按原样使用该地址、不会自动拼接协议路径；填裸基址（如 https://open.bigmodel.cn/api/v1）会导致每次请求立即失败。真实 API Key 已在你的进程环境变量 GLM_API_KEY 中（机器级已授权、临时有效）。当需要通过 UI 配置 API Key 时，用 Bash 读取该环境变量的值并输入到界面输入框；绝不要把该值写进你的任何输出文本、报告或文件。`
      : `本案例使用本机 mock 服务（合成占位密钥 sk-test-placeholder），不要使用真实密钥。`;
  const phaseA = `阶段A（DogDog 尚未启动）：
1. 阅读 ${join(stagingDir, "SETUP.md")}（基础 staging 已由控制器生成：codex 输入、launch-env.json、brief.json、fixture-hashes.json 已就位）。跳过其中任何"运行 prepare/prepare-package"的步骤——staging 已存在，不得重复生成。
2. 用本包（${setupPkgDir}）中的夹具与工具执行 SETUP.md 其余全部专有步骤中**可在文件侧完成的部分**：seed、规模生成器、junction/目录构造等。生成的工作副本要更新 ${join(stagingDir, "fixture-hashes.json")}（保留原夹具不动）。绝不要自己启动任何长驻进程/服务器（mock、desktop-service 等）——你的会话结束时它们会被杀死，这类服务由控制器作为管理员启动（见第3步 mockRequest）。SETUP.md 中"管理员执行 desktop-service/mock-service"的步骤即属此类，只需按第3步申报。
3. 不要自己启动 DogDog。写 ${join(stagingDir, "launch-request.json")}：{"ready": true, "needPostLaunchSetup": <bool——SETUP.md 是否要求管理员在应用启动后经可见 UI 预配置（如服务地址/密钥/轨迹目录授权/勾选允许检索并发送相关片段）。真实模型组必须为 true：API Key 只能由你（setup，进程环境变量 GLM_API_KEY）经 UI 填入，模拟用户会话没有任何 Shell/文件工具，无法自行取得密钥；本案例若确无密钥需求才可为 false>, "mockRequest": <按 SETUP.md 需要本机 mock 时为 {"kind":"desktop-service","planPath":"<本包内该案例 mock-plan.json 的绝对路径>"} 或 {"kind":"mock-service","mode":"<SETUP.md 指定的 mode>","endpointPath":"<该案例协议对应的请求路径 /responses|/chat|/messages 之一，按 SETUP.md>"}，控制器会在 staging/service 下启动并回填完整请求 URL（含协议路径）；不需要 mock 则为 null>}。
4. 写 ${join(stagingDir, "admin-plan.json")}：若案例存在中途管理员动作（杀进程/重启/中途加文件等），按触发器列出 [{"trigger":"<如 restart-after-first-answer>", "actions":[{"type":"kill-app"|"restart-app"|"copy-file"|"write-file"|"wait-ms", ...}]}]；无则为 []。
5. 写 ${launchInfoPath}：模拟用户需要知道的启动信息 {"appStarted": false, "exe": "${exePath}", "mockServiceUrl": null（控制器启动 mock 后回填为完整请求 URL，含协议路径；模拟用户配置服务地址时原样使用该 URL）, "mockMode": <按SETUP.md的模式或null>, "profileDir": "<staging>/profile", "traceRoots": ["<staging>/codex/sessions","<staging>/codex/archived_sessions"], "notes": "<给模拟用户的注意事项，例如：应用已/未预配置；设置勿动/需自行配置等。真实模型组必须在 notes 写明接口协议、完整服务端点 URL（含协议路径，如 https://open.bigmodel.cn/api/v1/responses）与模型名，供模拟用户原样填入；产品不拼接路径，绝不要在 notes 写裸基址>"}。不要在 launch-info 或任何交接文件中写入案例验收信息或密钥明文。`;
  const phaseB = `阶段B（DogDog 已启动，PID 见 ${join(stagingDir, "process.json")}）：
按 SETUP.md 中要求的应用内预配置，通过 windows-mcp 在可见 UI 上完成（模型设置 → 接口协议/服务地址/模型名/API Key/轨迹目录/允许检索并发送相关片段 → 保存配置）。${keyNote}
完成后更新 ${launchInfoPath} 的 appStarted=true 与 notes（说明已预配置内容，不含密钥），并写 ${join(stagingDir, "setup-postlaunch.json")} 记录你做了什么（不含密钥明文）。不要做 SETUP.md 之外的任何配置，不要开始用户对话。`;
  return `你是 DogDog 评测的环境准备者（setup 角色）。只读 setup 包（${setupPkgDir}）、staging 目录（${stagingDir}）与 SETUP.md；包内不含验收答案，也不要试图读取其他目录。你的 Bash/文件操作仅限这两个目录树；桌面操作仅限本案例的 DogDog 窗口。

案例：${caseId}（${group === "real" ? "真实模型服务组" : "本机mock组"}）
被测应用（由控制器启动，你不要启动）：${exePath}
${keyNote}

${phase === "A" ? phaseA : phaseB}

完成后输出简短总结（做了什么、生成了哪些文件、哈希是否有变化）。遇到无法满足的准备步骤：如实写明缺项并停止，不要发明替代步骤。`;
}

function oraclePathFromCase(caseId) {
  return ["oracles", caseId.slice(3, 5), caseId + ".json"];
}

function reviewerPrompt({ caseId, reviewerPkgDir, evidenceDir, runRootDir, draftOutPath, reviewOutPath, templatePath, attempt, visualFindings }) {
  return `你是 DogDog 评测的独立审查员（reviewer 角色），在全新上下文中工作。按以下顺序阅读（均在本 reviewer 包 ${reviewerPkgDir} 内）：
1. ${join(reviewerPkgDir, "SCORING.md")}（先读，判定顺序与状态定义以它为准）
2. ${join(reviewerPkgDir, "cases", caseId.slice(3, 5), caseId + ".json")}（任务卡：must/mustNot/rubric）
3. ${join(reviewerPkgDir, ...oraclePathFromCase(caseId))}（事实底稿）
4. 证据目录：${evidenceDir}（本案例 ${attempt} 号尝试的全部过程证据：runner 回合动作摘要、控制器截图目录提示、audit.json、setup 报告、持久化快照、mock 请求审计等；截图位于 ${join(evidenceDir, "..", "..", "..", "screenshots")} 下本案例子目录 ${caseId}-a${attempt}）
5. 空白模板：${templatePath}

${visualFindings ? `视觉审查结论（独立视觉审查者返回，供参考）：\n${visualFindings}\n` : ""}
判定要求：
- 先核对输入、环境与版本有效性（audit.json / staging 的 process.json / setup 报告），排除检索污染与错误版本。
- checks 数组：逐个 must（用任务卡 must[].id），passed ∈ true/false/null，observation 写事实判定与理由，evidence 给出相对运行根（${runRootDir}）的证据路径（至少1条）。每项的准确形状（字段名必须是 id，不是 mustId）：
  {"id":"<must[].id>","passed":true,"observation":"…","evidence":["trials/…/…json","screenshots/…png"]}
- forbiddenChecks 数组：逐个 mustNot（0 起始 index），absent ∈ true/false，附观察与证据。形状：{"index":0,"absent":true,"observation":"…","evidence":["…"]}
- scores 数组：覆盖任务卡 grading.rubric 全部维度，score ∈ 0|1|2|null，附观察与证据。形状：{"dimension":"<rubric维度原文>","score":2,"observation":"…","evidence":["…"]}
- status 从 {pass, product_failure, infrastructure_failure, grading_dispute, insufficient_evidence, not_implemented, not_run} 中按 SCORING.md 选择；产品崩溃不得一律归环境；目标能力已实现但表现错误用 product_failure 不用 not_implemented。
- 不确定的写进 limitations；评分规则本身存疑列 grading_dispute。
- 以下字段由控制器统一填充，你无需提供（写了也会被覆盖）：schemaVersion/runId/caseId/attempt/executionTrack/mockService/blinded/startedAt/endedAt/metrics/reviewer。

产出（用 Write 工具写到绝对路径）：
1. ${draftOutPath} —— JSON：{status, checks, forbiddenChecks, scores, artifacts, limitations}
2. ${reviewOutPath} —— 按模板填写的完整文字复核。

只判定本案例。不得从代理用户自报完成推断通过；引用存在不等于支持结论。`;
}

function visualPrompt({ screenshotDir, listing }) {
  return `你是视觉审查助手。以下目录中有本案例的屏幕截图（控制器定时截图与关键检查点截图）：
${screenshotDir}
文件清单：
${listing}
请逐张查看关键截图（用 Read 工具读图），描述：可见窗口与标题、主要 UI 区域与文字、明显布局异常/遮挡/截断/乱码、与"DogDog 中文界面"预期的偏差。只返回文字结论与文件名定位，不做通过/失败判定，不读取其他目录。结论写在你的最终回复中。`;
}

// ---------------------------------------------------------------------------
// Admin checkpoint execution (deterministic)
// ---------------------------------------------------------------------------

async function executeAdminActions({ actions, stagingDir, exePath, dogdog, label }) {
  const done = [];
  for (const a of actions ?? []) {
    if (a.type === "kill-app") {
      if (dogdog?.pid) {
        await stopDogDog(dogdog.pid, label);
        dogdog = null;
      }
      done.push("kill-app");
    } else if (a.type === "restart-app") {
      if (dogdog?.pid) {
        await stopDogDog(dogdog.pid, label);
        dogdog = null;
      }
      dogdog = await launchDogDog({
        exePath,
        launchEnvPath: join(stagingDir, "launch-env.json"),
        trialDir: stagingDir,
        attemptDir: stagingDir,
        label,
      });
      done.push(`restart-app pid=${dogdog.pid}`);
    } else if (a.type === "copy-file") {
      // Setup-role sessions have written both {from,to} and {src,dest}
      // spellings, and both staging-relative and absolute paths. Absolute
      // paths must NOT be joined onto stagingDir (that produced
      // "staging\D:\..." phantom paths); they are used as-is, bounded to
      // staging or the frozen fixture root.
      const rawFrom = a.from ?? a.src;
      const rawTo = a.to ?? a.dest;
      if (typeof rawFrom !== "string" || typeof rawTo !== "string")
        throw new Error(`copy-file needs from/src and to/dest strings: ${JSON.stringify(a).slice(0, 200)}`);
      const from = isAbsolute(rawFrom) ? rawFrom : join(stagingDir, rawFrom);
      const to = isAbsolute(rawTo) ? rawTo : join(stagingDir, rawTo);
      const fixtureRoot = join(repo, "evaluation", "fixtures");
      const inside = (p, root) => {
        const rel = relative(root, p);
        return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
      };
      if (!inside(from, stagingDir) && !inside(from, fixtureRoot))
        throw new Error(`copy-file src outside staging/fixtures: ${rawFrom}`);
      if (!inside(to, stagingDir))
        throw new Error(`copy-file dest outside staging: ${rawTo}`);
      mkdirSync(join(to, ".."), { recursive: true });
      copyFileSync(from, to);
      done.push(`copy ${rawFrom}→${rawTo} sha=${sha256File(to).slice(0, 12)}`);
    } else if (a.type === "write-file") {
      const rawTo = a.path ?? a.to ?? a.dest;
      if (typeof rawTo !== "string")
        throw new Error(`write-file needs a path string: ${JSON.stringify(a).slice(0, 200)}`);
      const to = isAbsolute(rawTo) ? rawTo : join(stagingDir, rawTo);
      const relTo = relative(stagingDir, to);
      if (relTo.startsWith("..") || isAbsolute(relTo))
        throw new Error(`write-file dest outside staging: ${rawTo}`);
      mkdirSync(join(to, ".."), { recursive: true });
      writeFileSync(to, a.content ?? "", "utf8");
      done.push(`write ${rawTo} sha=${sha256File(to).slice(0, 12)}`);
    } else if (a.type === "wait-ms") {
      await sleep(Math.min(a.ms ?? 1000, 30000));
      done.push(`wait ${a.ms ?? 1000}ms`);
    } else {
      throw new Error("Unknown admin action type " + a.type);
    }
  }
  return { dogdog, done };
}

// ---------------------------------------------------------------------------
// Post-trial audit
// ---------------------------------------------------------------------------

function listDirTree(dir, base, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = base ? relative(base, p).replaceAll("\\", "/") : name;
    const st = statSync(p);
    out.push(st.isDirectory() ? rel + "/" : rel);
    if (st.isDirectory() && out.length < 2000) listDirTree(p, base, out);
  }
  return out;
}

async function postTrialAudit({ stagingDir, evidenceDir, attemptDir, mockStatusJson, dogdogExit }) {
  mkdirSync(evidenceDir, { recursive: true });
  const audit = { at: nowIso(), dogdogExit, profileFiles: [], mockAudit: null, fixtureDrift: [] };
  const profile = join(stagingDir, "profile");
  if (existsSync(profile)) {
    for (const rel of ["reviews/settings.json", "reviews/reports", "conversations", "trace-index/manifest.json"]) {
      const src = join(profile, rel);
      if (!existsSync(src)) continue;
      const dest = join(evidenceDir, "profile", rel.replaceAll("/", "_"));
      mkdirSync(join(dest, ".."), { recursive: true });
      try {
        if (statSync(src).isDirectory()) {
          // dest itself was never created (only its parent), and listDirTree
          // yields directory markers ("sub/") alongside files — copying those
          // threw ENOENT/EISDIR and aborted the whole conversations bundle
          // (flagged by two independent reviewers in round 0).
          mkdirSync(dest, { recursive: true });
          for (const f of listDirTree(src, src)) {
            if (f.endsWith("/")) continue;
            copyFileSync(join(src, f), join(dest, f.replaceAll("/", "_")));
          }
        } else copyFileSync(src, dest);
        audit.profileFiles.push(rel);
      } catch (e) {
        audit.profileFiles.push(rel + " (copy-failed: " + String(e.message).slice(0, 80) + ")");
      }
    }
  }
  if (mockStatusJson && existsSync(mockStatusJson)) {
    const status = readJson(mockStatusJson, {});
    const reqPath = join(join(mockStatusJson, ".."), "requests.jsonl");
    let count = null;
    if (existsSync(reqPath))
      count = readFileSync(reqPath, "utf8").split(/\r?\n/).filter(Boolean).length;
    audit.mockAudit = { status, requestCount: count, requestsCopy: null };
    if (existsSync(reqPath)) {
      copyFileSync(reqPath, join(evidenceDir, "requests.jsonl"));
      audit.mockAudit.requestsCopy = "requests.jsonl";
    }
  }
  const fh = readJson(join(stagingDir, "fixture-hashes.json"), {});
  for (const [rel, expected] of Object.entries(fh)) {
    const p = join(stagingDir, rel);
    if (!existsSync(p)) {
      audit.fixtureDrift.push({ rel, missing: true });
      continue;
    }
    const actual = sha256File(p);
    if (actual !== expected) audit.fixtureDrift.push({ rel, changed: true });
  }
  writeFileSync(join(attemptDir, "audit.json"), JSON.stringify(audit, null, 2), "utf8");
  return audit;
}

// ---------------------------------------------------------------------------
// The trial
// ---------------------------------------------------------------------------

export async function runTrial({
  state,
  caseRow,
  runRootDir,
  setupPkgDir,
  reviewerPkgDir,
  exePath,
  attempt,
}) {
  const caseId = caseRow.id;
  const startedAt = nowIso();
  const trialDir = join(runRootDir, "trials", caseId);
  const attemptDir = join(trialDir, `attempt-${attempt}`);
  // Fresh staging PER ATTEMPT: prepare() refuses an existing directory, so a
  // shared trials/<ID>/staging made every retry after attempt 1 fail instantly
  // ("Staging must be a fresh directory") and burned the whole retry budget.
  const stagingDir = join(attemptDir, "staging");
  const shotsDir = join(runRootDir, "screenshots");
  mkdirSync(attemptDir, { recursive: true });
  timeline({ kind: "trial-start", caseId, attempt, group: caseRow.group });

  let dogdog = null;
  let mockStatusJson = null;
  try {
    // 1. prepare (controller-side scaffold; fresh dir inside run root)
    await prepare(caseId, stagingDir);
    appendEvent(runRootDir, { caseId, attempt, kind: "prepared", staging: relative(runRootDir, stagingDir) });

    // 2. setup phase A
    const launchInfoPath = join(stagingDir, "launch-info.json");
    const setupADir = join(attemptDir, "setup-a");
    const setupARes = await runRole({
      role: "setup",
      promptText: setupPrompt({ caseId, setupPkgDir, stagingDir, exePath, group: caseRow.group, phase: "A", launchInfoPath }),
      cwd: setupPkgDir,
      outDir: setupADir,
      label: `${caseId}:setup-a`,
      timeoutMs: 25 * 60 * 1000,
    });
    state.budget.claudeTurns += 1;
    const launchReq = readJson(join(stagingDir, "launch-request.json"), null);
    if (!launchReq?.ready)
      throw new Error(`setup-A not ready (exit=${setupARes.exitCode})`);
    if (launchReq.mockRequest) {
      const m = await startMockFromRequest({
        runRootDir, caseId, attempt, stagingDir,
        mockRequest: launchReq.mockRequest,
      });
      mockStatusJson = m.statusPath;
      const li = readJson(launchInfoPath, {});
      // The product requests the configured URL verbatim, so the runner needs
      // the FULL request URL. mock-service only serves /responses /chat
      // /messages (the base URL 404s — round-0 DD-01-02); desktop-service
      // reports its full endpoint directly.
      const base = String(m.status.url ?? "");
      let full = m.status.endpoint ?? null;
      if (!full) {
        const p = launchReq.mockRequest.endpointPath;
        if (launchReq.mockRequest.kind === "mock-service" &&
            !/^\/(responses|chat|messages)$/.test(String(p ?? ""))) {
          throw new Error(
            'launch-request.mockRequest.endpointPath missing/invalid: setup must declare the SETUP.md protocol path (/responses|/chat|/messages) so the controller can build the full request URL');
        }
        full = base + String(p ?? "");
      }
      li.mockServiceUrl = full;
      li.mockServiceBaseUrl = base;
      li.mockMode = m.status.mode ?? null;
      writeFileSync(launchInfoPath, JSON.stringify(li, null, 2), "utf8");
      appendEvent(runRootDir, { caseId, attempt, kind: "mock-url", base, full });
    } else {
      mockStatusJson = launchReq.mockStatusJson ?? null;
    }
    harvest({
      transcriptPath: join(setupADir, "setup.jsonl"),
      screenshotDir: shotsDir,
      outPath: join(attemptDir, "setup-a.actions.json"),
    });

    // 3. launch DogDog (controller only)
    dogdog = await launchDogDog({
      exePath,
      launchEnvPath: join(stagingDir, "launch-env.json"),
      trialDir: stagingDir,
      attemptDir: stagingDir, // process.json lives with staging for setup-B
      label: caseId,
    });
    appendEvent(runRootDir, { caseId, attempt, kind: "launched", pid: dogdog.pid });

    // 4. setup phase B (UI pre-config) when required
    if (launchReq.needPostLaunchSetup) {
      const setupBDir = join(attemptDir, "setup-b");
      const setupBRes = await runRole({
        role: "setup",
        promptText: setupPrompt({ caseId, setupPkgDir, stagingDir, exePath, group: caseRow.group, phase: "B", launchInfoPath }),
        cwd: setupPkgDir,
        outDir: setupBDir,
        label: `${caseId}:setup-b`,
        timeoutMs: 25 * 60 * 1000,
      });
      state.budget.claudeTurns += 1;
      harvest({
        transcriptPath: join(setupBDir, "setup.jsonl"),
        screenshotDir: shotsDir,
        outPath: join(attemptDir, "setup-b.actions.json"),
      });
      if (setupBRes.exitCode !== 0)
        throw new Error(`setup-B failed exit=${setupBRes.exitCode}`);
    }
    const launchInfo = readJson(launchInfoPath, { appStarted: false });
    launchInfo.appStarted = true;

    // 5. runner turns
    const brief = readJson(join(stagingDir, "brief.json"), null);
    if (!brief) throw new Error("missing brief.json in staging");
    const deadline = Date.now() + caseRow.stopAfterMs;
    const priorLogs = [];
    let adminEcho = [];
    const adminPlan = readJson(join(stagingDir, "admin-plan.json"), []);
    let checkpoints = 0;
    let runnerElapsed = 0;
    for (let turn = 1; turn <= 8; turn++) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        appendEvent(runRootDir, { caseId, attempt, kind: "budget-exhausted-before-turn", turn });
        break;
      }
      const prompt = runnerPrompt({
        brief,
        launchInfo,
        remainingMs,
        maxUserTurns: caseRow.maxUserTurns,
        priorLogs,
        adminActions: adminEcho,
      });
      const cap = startIntervalCapture({
        dir: join(shotsDir, `${caseId}-a${attempt}`),
        prefix: `t${turn}`,
        intervalMs: 45000,
      });
      const turnT0 = Date.now();
      let res;
      const turnDir = join(attemptDir, `runner-t${turn}`);
      try {
        res = await runRole({
          role: "runner",
          promptText: prompt,
          cwd: join(turnDir, "work"),
          outDir: turnDir,
          label: `${caseId}:runner-t${turn}`,
          timeoutMs: remainingMs + 180000,
        });
      } finally {
        cap.stop();
      }
      runnerElapsed += Date.now() - turnT0;
      state.budget.claudeTurns += 1;
      const hv = harvest({
        transcriptPath: join(turnDir, "runner.jsonl"),
        screenshotDir: join(shotsDir, `${caseId}-a${attempt}`),
        outPath: join(turnDir, "actions.json"),
      });
      const log = extractProgressLog(hv.finalText);
      if (log) priorLogs.push(log);
      appendEvent(runRootDir, {
        caseId, attempt, kind: "runner-turn", turn,
        subtype: hv.subtype, actions: hv.actionCount,
        summary: (hv.finalText ?? "").slice(0, 300),
      });
      const checkpoint = detectCheckpoint(hv.finalText);
      // Runners sometimes close a turn with "CHECKPOINT: 无（…）" meaning NO
      // admin action is needed — that is a natural end, not a checkpoint
      // (round-0 DD-01-01 burned 3 attempts on exactly this).
      const noopCheckpoint = !!checkpoint &&
        /^(无|none|no|n\/a|不需要|无需|没有)(?![\w一-鿿-])/i.test(checkpoint.trim());
      if (noopCheckpoint) {
        appendEvent(runRootDir, { caseId, attempt, kind: "checkpoint-none", text: checkpoint.slice(0, 120) });
        break;
      }
      if (checkpoint && checkpoints < 4) {
        checkpoints += 1;
        const entry =
          adminPlan.find(
            (p) => checkpoint.includes(p.trigger) || String(p.trigger).includes(checkpoint),
          ) ?? (adminPlan.length === 1 ? adminPlan[0] : null);
        if (!entry) {
          // The runner asked for an admin action this case never staged (e.g.
          // "please confirm the model settings" at a designed in-app
          // confirmation gate). That is a runner-level question, not a
          // controller error: echo a no-op and let the next runner turn
          // self-serve in the UI instead of burning the attempt before
          // reviewer judgment (round-0 DD-02-01).
          appendEvent(runRootDir, {
            caseId, attempt, kind: "checkpoint-unmatched", text: checkpoint.slice(0, 160),
          });
          adminEcho = [
            ...adminEcho,
            `[管理员] 本案例没有与「${checkpoint.slice(0, 80)}」对应的编排动作。凡真实用户能在应用内自行完成的操作（如设置填写与确认、重试、更换入口）都由你自己完成；不要假设任何人已代为完成，完成后继续任务并如实报告。`,
          ];
          continue;
        }
        appendEvent(runRootDir, { caseId, attempt, kind: "checkpoint", name: checkpoint.slice(0, 120), trigger: String(entry.trigger) });
        const out = await executeAdminActions({
          actions: entry.actions,
          stagingDir, exePath, dogdog, label: caseId,
        });
        dogdog = out.dogdog;
        adminEcho = [...adminEcho, ...out.done.map((d) => `${checkpoint}: ${d}`)];
        continue;
      }
      break; // natural end (no checkpoint)
    }

    // 6. stop app + audit
    let dogdogExit = "clean";
    if (dogdog?.pid) {
      try {
        await stopDogDog(dogdog.pid, caseId);
      } catch {
        dogdogExit = "kill-failed";
      }
      dogdog = null;
    }
    try {
      captureScreen(join(shotsDir, `${caseId}-a${attempt}-final.png`));
    } catch {}
    const audit = await postTrialAudit({
      stagingDir,
      evidenceDir: join(attemptDir, "evidence"),
      attemptDir,
      mockStatusJson,
      dogdogExit,
    });
    appendEvent(runRootDir, { caseId, attempt, kind: "audited", auditDrift: audit.fixtureDrift.length });

    // 6b. diagnostic sub-step (system 02): parser run recorded as evidence
    if (caseRow.system === "02" && caseRow.track === "diagnostic") {
      try {
        const { runDiag } = await import("./diag-parse.mjs");
        await runDiag({ caseId, stagingDir, evidenceDir: join(attemptDir, "evidence") });
      } catch (e) {
        appendEvent(runRootDir, { caseId, attempt, kind: "diag-failed", error: String(e.message ?? e).slice(0, 200) });
      }
    }

    // 7. visual reviewer (only if image path proven)
    let visualFindings = null;
    if (state.probes.flashImage === "ok") {
      const shotDir = join(shotsDir, `${caseId}-a${attempt}`);
      const shots = existsSync(shotDir)
        ? readdirSync(shotDir).filter((n) => n.endsWith(".png"))
        : [];
      if (shots.length) {
        const visualDir = join(attemptDir, "visual");
        const vRes = await runRole({
          role: "visual",
          promptText: visualPrompt({ screenshotDir: shotDir, listing: shots.join("\n") }),
          cwd: visualDir,
          outDir: visualDir,
          label: `${caseId}:visual`,
          timeoutMs: 10 * 60 * 1000,
        });
        state.budget.claudeTurns += 1;
        if (vRes.exitCode === 0) {
          const vt = readTranscript(join(visualDir, "visual.jsonl"));
          visualFindings = vt.finalText;
          writeFileSync(join(attemptDir, "visual-findings.md"), vt.finalText ?? "", "utf8");
        }
      }
    }

    // 8. reviewer
    const templatePath = join(attemptDir, "REVIEW-template.md");
    copyFileSync(join(repo, "evaluation", "templates", "REVIEW.md"), templatePath);
    // Underscore names: trialFiles() picks up anything matching
    // /result(?:-[^\\/]+)?\.json$/ — "result_draft.json" stays out of it.
    const draftOutPath = join(attemptDir, "result_draft.json");
    const reviewOutPath = join(attemptDir, "review_draft.md");
    const reviewerDir = join(attemptDir, "reviewer");
    const revRes = await runRole({
      role: "reviewer",
      promptText: reviewerPrompt({
        caseId, reviewerPkgDir, evidenceDir: attemptDir, runRootDir,
        draftOutPath, reviewOutPath, templatePath, attempt,
        visualFindings,
      }),
      cwd: join(reviewerDir, "work"),
      outDir: reviewerDir,
      label: `${caseId}:reviewer`,
      timeoutMs: 30 * 60 * 1000,
    });
    state.budget.claudeTurns += 1;
    if (revRes.exitCode !== 0 || !existsSync(draftOutPath))
      throw new Error(`reviewer failed exit=${revRes.exitCode}`);

    // 9. finalize + validate
    const outPath = attempt === 1
      ? join(trialDir, "result.json")
      : join(trialDir, `result-${attempt}.json`);
    const finalized = await finalizeResult({
      draftPath: draftOutPath,
      runRootDir, caseId, attempt,
      group: caseRow.group, track: caseRow.track,
      startedAt,
      endedAt: nowIso(),
      modelRequests: audit.mockAudit?.requestCount ?? null,
      outPath,
    });
    if (existsSync(reviewOutPath))
      copyFileSync(reviewOutPath, join(trialDir, attempt === 1 ? "review.md" : `review-${attempt}.md`));
    const vrun = await validateRunRoot(runRootDir);
    appendEvent(runRootDir, { caseId, attempt, kind: "finalized", status: finalized.status, validateRun: vrun.valid ? "valid" : vrun.error });

    state.budget.trialCount += 1;
    timeline({ kind: "trial-end", caseId, attempt, status: finalized.status, runnerElapsedMs: runnerElapsed });
    return { status: finalized.status, result: finalized, validateRun: vrun };
  } catch (e) {
    if (dogdog?.pid) {
      try { await stopDogDog(dogdog.pid, caseId); } catch {}
    }
    timeline({ kind: "trial-error", caseId, attempt, error: String(e.message ?? e).slice(0, 400) });
    appendEvent(runRootDir, { caseId, attempt, kind: "trial-error", error: String(e.message ?? e).slice(0, 400) });
    try {
      const infraDraftPath = join(attemptDir, "result_infra_draft.json");
      writeFileSync(infraDraftPath, JSON.stringify({
        status: "infrastructure_failure",
        checks: [], forbiddenChecks: [], scores: [],
        artifacts: [],
        limitations: [
          "Controller-level failure before reviewer judgment: " + String(e.message ?? e).slice(0, 300),
        ],
      }, null, 2), "utf8");
      const outPath = attempt === 1
        ? join(trialDir, "result.json")
        : join(trialDir, `result-${attempt}.json`);
      const finalized = await finalizeResult({
        draftPath: infraDraftPath,
        runRootDir, caseId, attempt,
        group: caseRow.group, track: caseRow.track,
        startedAt, endedAt: nowIso(),
        modelRequests: null,
        outPath,
      });
      state.budget.trialCount += 1;
      timeline({ kind: "trial-end", caseId, attempt, status: finalized.status, infra: true });
      return { status: finalized.status, result: finalized, validateRun: await validateRunRoot(runRootDir) };
    } catch (e2) {
      return { status: "controller-error", error: String(e2.message ?? e2) };
    }
  } finally {
    try { if (mockStatusJson && existsSync(mockStatusJson)) {
      const m = killMockFromStatus(mockStatusJson, stagingDir);
      if (m) appendEvent(runRootDir, { caseId, attempt, kind: "mock-cleanup", ...m });
    } } catch {}
    try { await cleanupAll({ onlyTrialId: caseId }); } catch {}
  }
}
