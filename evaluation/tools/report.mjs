import { resolve, join } from "node:path";
import {
  trialFiles,
  json,
  loadTasks,
  save,
  validateRun,
  systemNames,
} from "./cli.mjs";
import { statuses } from "./schemas.mjs";
const args = process.argv.slice(2),
  arg = (k) => args[args.indexOf("--" + k) + 1];
if (!args.includes("--run"))
  throw new Error("Use --run DIR [--compare PREVIOUS_DIR]");
async function collect(dir) {
  await validateRun(dir);
  const manifest = await json(join(dir, "manifest.json"));
  const trials = [];
  for (const f of await trialFiles(dir)) trials.push(await json(f));
  const tasks = (await loadTasks()).map((x) => x.task),
    rows = [];
  for (const task of tasks) {
    const attempts = trials
      .filter((r) => r.caseId === task.id)
      .sort(
        (a, b) =>
          a.attempt - b.attempt || a.startedAt.localeCompare(b.startedAt),
      );
    rows.push({
      caseId: task.id,
      system: task.system,
      capability: task.capability,
      split: task.split,
      status: attempts[0]?.status || "not_run",
      attempts: attempts.map((r) => ({
        attempt: r.attempt,
        status: r.status,
        startedAt: r.startedAt,
        metrics: r.metrics,
        pilotOutcome: r.pilotOutcome,
      })),
    });
  }
  const grouped = [];
  for (let i = 1; i <= 12; i++)
    for (const capability of ["current", "target"]) {
      const system = String(i).padStart(2, "0"),
        set = rows.filter(
          (r) => r.system === system && r.capability === capability,
        );
      if (!set.length) continue;
      grouped.push({
        system,
        name: systemNames[i - 1],
        capability,
        total: set.length,
        states: Object.fromEntries(
          statuses.map((s) => [s, set.filter((r) => r.status === s).length]),
        ),
      });
    }
  return {
    runId: manifest.runId,
    manifest,
    taskCount: rows.length,
    trialCount: trials.length,
    firstAttemptPolicy: true,
    rows,
    grouped,
  };
}
const dir = resolve(arg("run")),
  report = await collect(dir);
let comparison;
if (args.includes("--compare")) {
  const before = await collect(resolve(arg("compare")));
  const keys = [
    "suiteVersion",
    "model",
    "display",
    "executionTrack",
    "mockService",
  ];
  const mismatches = keys.filter(
    (k) =>
      JSON.stringify(before.manifest[k]) !== JSON.stringify(report.manifest[k]),
  );
  const fixtureValues = (r) => Object.values(r.manifest.fixtureHashes).sort();
  if (
    JSON.stringify(fixtureValues(before)) !==
    JSON.stringify(fixtureValues(report))
  )
    mismatches.push("fixtureHashes");
  comparison = {
    before: before.runId,
    after: report.runId,
    comparable: mismatches.length === 0,
    mismatches,
    changes: report.rows
      .filter(
        (r) =>
          before.rows.find((b) => b.caseId === r.caseId)?.status !== r.status,
      )
      .map((r) => ({
        caseId: r.caseId,
        before: before.rows.find((b) => b.caseId === r.caseId)?.status,
        after: r.status,
      })),
    limitation:
      "比较仅描述观察变化，不证明因果。所有attempt保留，主表使用首次attempt。",
  };
}
await save(join(dir, "suite-summary.json"), { ...report, comparison });
let md = `# ${report.runId}\n\n任务分母 ${report.taskCount}；已记录trial ${report.trialCount}。首次attempt为主表，重试不覆盖历史。\n\n| 体系 | 能力 | 总数 | 通过 | 产品失败 | 环境失败 | 评分争议 | 证据不足 | 未实现 | 未运行 |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const g of report.grouped)
  md += `| ${g.system} ${g.name} | ${g.capability} | ${g.total} | ${statuses.map((s) => g.states[s]).join(" | ")} |\n`;
md +=
  "\nmock与代理体验不证明真实模型能力或真人收益；核心任务与pilot子场景成绩分离。\n";
if (comparison) md += "\n比较：" + JSON.stringify(comparison, null, 2) + "\n";
await save(join(dir, "SUMMARY.md"), md);
console.log(
  JSON.stringify(
    {
      runId: report.runId,
      taskCount: report.taskCount,
      trialCount: report.trialCount,
      comparison,
    },
    null,
    2,
  ),
);
