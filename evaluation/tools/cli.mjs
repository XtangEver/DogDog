import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  stat,
  copyFile,
  access,
} from "node:fs/promises";
import { resolve, relative, dirname, join, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  taskSchema,
  oracleSchema,
  resultSchema,
  manifestSchema,
  jsonSchemas,
} from "./schemas.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repo = resolve(root, "..");
export const systemNames = [
  "初次使用与配置",
  "轨迹理解与兼容",
  "自主发现与检索",
  "证据与推断边界",
  "持续对话与需求理解",
  "复盘与改进建议",
  "报告与效果闭环",
  "可控协作档案",
  "桌面交互与使用负担",
  "权限、隐私与对抗",
  "状态、异常与恢复",
  "协议、发布与规模",
];
export const hash = (data) => createHash("sha256").update(data).digest("hex");
export async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
export async function save(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    "utf8",
  );
}
export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
export async function files(dir) {
  if (!(await exists(dir))) return [];
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isSymbolicLink())
      throw new Error(
        "Symbolic links are not allowed in evaluation assets: " + path,
      );
    if (ent.isDirectory()) out.push(...(await files(path)));
    else out.push(path);
  }
  return out.sort();
}
export function inside(base, path) {
  const full = resolve(base, path),
    rel = relative(base, full);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("Path escapes asset root: " + path);
  return full;
}
export async function loadTasks() {
  return await Promise.all(
    (await files(join(root, "cases")))
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => ({ path: f, task: taskSchema.parse(await json(f)) })),
  );
}
export async function trialFiles(runRoot) {
  runRoot = resolve(runRoot);
  const results = [];
  for (const path of (await files(runRoot)).filter((f) =>
    /result(?:-[^\\/]+)?\.json$/.test(f),
  )) {
    let dir = dirname(path),
      nested = false;
    while (dir !== resolve(runRoot)) {
      if (await exists(join(dir, "manifest.json"))) {
        nested = true;
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) throw new Error("Trial outside run root");
      dir = parent;
    }
    if (!nested) results.push(path);
  }
  return results;
}
export async function validateSuite({ partial = false } = {}) {
  const errors = [],
    warnings = [],
    tasks = [];
  for (const path of (await files(join(root, "cases"))).filter((f) =>
    f.endsWith(".json"),
  )) {
    try {
      tasks.push({ path, task: taskSchema.parse(await json(path)) });
    } catch (e) {
      errors.push(relative(root, path) + ": " + e.message);
    }
  }
  const seen = new Set(),
    families = new Map(),
    fixtureSplits = new Map();
  for (const { path, task: t } of tasks) {
    try {
      if (seen.has(t.id)) throw new Error("duplicate id");
      seen.add(t.id);
      if (t.id !== `DD-${t.system}-${t.id.slice(-2)}`)
        throw new Error("id/system mismatch");
      if (
        relative(root, path).replaceAll("\\", "/") !==
        `cases/${t.system}/${t.id}.json`
      )
        throw new Error("unexpected task path");
      if (t.split !== (Number(t.id.slice(-2)) <= 6 ? "development" : "holdout"))
        throw new Error("split/id mismatch");
      if (families.has(t.family) && families.get(t.family) !== t.split)
        throw new Error("family crosses split: " + t.family);
      families.set(t.family, t.split);
      if (new Set(t.must.map((c) => c.id)).size !== t.must.length)
        throw new Error("duplicate check IDs");
      for (const source of t.provenance.sources) {
        const match = source.match(/^(.+?):(\d+)(?:[-–](\d+))?$/);
        if (match) {
          const lines = (await readFile(inside(repo, match[1]), "utf8")).split(
            /\r?\n/,
          );
          if (Number(match[2]) > lines.length)
            throw new Error("source line out of range: " + source);
        } else if (
          !/^https?:/.test(source) &&
          !(await exists(inside(repo, source)))
        )
          throw new Error("missing provenance source: " + source);
      }
      for (const check of t.grading.checks)
        if (!(await exists(inside(repo, check.entry))))
          throw new Error("missing check entry " + check.entry);
      if (t.environment.fixtureDir) {
        const fixtureRoot = inside(root, t.environment.fixtureDir);
        if (!(await stat(fixtureRoot)).isDirectory())
          throw new Error("missing fixture directory");
        const ff = await files(fixtureRoot);
        if (!ff.length) throw new Error("empty fixture directory");
        if (t.environment.inputFiles)
          for (const input of t.environment.inputFiles) {
            if (
              !input.endsWith(".jsonl") ||
              !(await exists(inside(fixtureRoot, input)))
            )
              throw new Error("invalid initial input file " + input);
          }
        for (const f of ff.filter((f) => f.endsWith(".jsonl"))) {
          const contents = await readFile(f, "utf8");
          const key = hash(contents);
          if (fixtureSplits.has(key) && fixtureSplits.get(key) !== t.split)
            warnings.push(
              `${t.id}: byte-identical fixture across splits: ${relative(root, f)}`,
            );
          fixtureSplits.set(key, t.split);
        }
      }
      const o = oracleSchema.parse(await json(inside(root, t.grading.oracle)));
      if (o.id !== t.id) throw new Error("oracle id mismatch");
      const dims = [...t.grading.rubric].sort();
      if (
        JSON.stringify(dims) !==
        JSON.stringify(o.rubric.map((x) => x.dimension).sort())
      )
        throw new Error("rubric dimensions mismatch");
      for (const c of t.must)
        if (!o.checks.some((x) => x.mustId === c.id))
          throw new Error("missing oracle check " + c.id);
      for (const c of o.checks)
        if (!t.must.some((x) => x.id === c.mustId))
          throw new Error("orphan oracle check " + c.mustId);
      for (const f of o.facts)
        for (const e of f.evidence) {
          const source = (await readFile(inside(root, e.file), "utf8")).split(
            /\r?\n/,
          );
          if (e.fromLine > e.toLine || e.toLine > source.length)
            throw new Error(
              `evidence line out of range: ${e.file}:${e.fromLine}-${e.toLine}`,
            );
          if (
            !source
              .slice(e.fromLine - 1, e.toLine)
              .join("\n")
              .includes(e.contains)
          )
            throw new Error(`evidence text mismatch: ${e.file}:${e.fromLine}`);
        }
      if (
        o.rubric.some(
          (r) => r.zero === r.one || r.one === r.two || r.zero === r.two,
        )
      )
        throw new Error("indistinct rubric anchors");
      if (
        t.capability === "target" &&
        !t.environment.setup.some((s) =>
          /未实现|未提供|缺口|尚无|尚未|target|未来|待实现/.test(s),
        )
      )
        warnings.push(
          t.id + ": target should explain current implementation gap",
        );
    } catch (e) {
      errors.push(t.id + ": " + e.message);
    }
  }
  if (!partial) {
    if (tasks.length !== 96)
      errors.push(`Expected 96 valid tasks, got ${tasks.length}`);
    for (let i = 1; i <= 12; i++) {
      const ss = String(i).padStart(2, "0"),
        group = tasks.map((x) => x.task).filter((x) => x.system === ss);
      if (group.length !== 8)
        errors.push(`System ${ss}: expected 8 tasks, got ${group.length}`);
      if (new Set(group.map((t) => t.family)).size !== 8)
        errors.push(`System ${ss}: expected 8 distinct families`);
      if (
        group.filter((t) =>
          t.tags.some((tag) =>
            [
              "boundary",
              "conflict",
              "missing",
              "error",
              "adversarial",
            ].includes(tag),
          ),
        ).length < 2
      )
        errors.push(
          `System ${ss}: fewer than two boundary/counterexample cases`,
        );
      if (
        !group.some(
          (t) =>
            t.tags.some((tag) =>
              ["recovery", "correction", "multi_turn", "multi-turn"].includes(
                tag,
              ),
            ) ||
            (t.steps.length >= 3 && t.user.answers.length > 0),
        )
      )
        errors.push(`System ${ss}: no multi-turn/recovery task`);
      if (group.reduce((n, t) => n + t.variants.length, 0) < 2)
        errors.push(`System ${ss}: fewer than 2 counterfactual variants`);
    }
  }
  const summary = {
    valid: !errors.length,
    tasks: tasks.length,
    development: tasks.filter((x) => x.task.split === "development").length,
    holdout: tasks.filter((x) => x.task.split === "holdout").length,
    current: tasks.filter((x) => x.task.capability === "current").length,
    target: tasks.filter((x) => x.task.capability === "target").length,
    variants: tasks.reduce((n, x) => n + x.task.variants.length, 0),
    errors,
    warnings,
  };
  return summary;
}
export function runnerBrief(t) {
  return {
    schemaVersion: "1.0",
    id: t.id,
    track: t.track,
    user: t.user,
    actions: t.steps
      .filter(
        (s) =>
          t.track !== "desktop" ||
          !/^(管理员|准备者|审查者|审查员|环境准备者)/.test(s.action),
      )
      .map((s) => s.action),
    limits: {
      stopAfterMs: t.completion.stopAfterMs,
      maxUserTurns: t.completion.maxUserTurns,
    },
    restrictions: [
      "仅使用模拟用户可知信息；未给定的事实使用unknownReply。",
      "桌面轨道禁止源码、DOM、IPC、持久化文件与答案文件辅助完成。",
      "记录所有尝试；没有证据不得声明成功。",
      "结束后由独立审查上下文判定；本简报不包含验收答案。",
    ],
  };
}
async function copyTree(from, to) {
  for (const f of await files(from)) {
    const dest = join(to, relative(from, f));
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(f, dest);
  }
}
export async function pack({ role, split, out }) {
  if (
    !["runner", "setup", "reviewer"].includes(role) ||
    !["development", "holdout"].includes(split)
  )
    throw new Error(
      "Specify --role runner|setup|reviewer and --split development|holdout",
    );
  const dest = resolve(out);
  if (await exists(dest))
    throw new Error("Output must be a fresh directory: " + dest);
  const tasks = (await loadTasks())
    .map((x) => x.task)
    .filter((t) => t.split === split);
  const manifest = {
    schemaVersion: "1.0",
    role,
    split,
    count: tasks.length,
    files: [],
  };
  for (const t of tasks) {
    if (role === "runner")
      await save(join(dest, "briefs", t.id + ".json"), runnerBrief(t));
    else if (role === "setup") {
      const environment = {
        ...t.environment,
        setup: t.environment.setup.map((s) =>
          s
            .replaceAll(
              "node evaluation/tools/cli.mjs prepare",
              "node tools/prepare-package.mjs",
            )
            .replaceAll("evaluation/", "./"),
        ),
      };
      await save(join(dest, "setup", t.id + ".json"), {
        id: t.id,
        environment,
        variants: t.variants.map((v) => ({ id: v.id, change: v.change })),
      });
      if (t.environment.fixtureDir)
        await copyTree(
          inside(root, t.environment.fixtureDir),
          join(dest, t.environment.fixtureDir),
        );
    } else {
      await save(join(dest, "cases", t.system, t.id + ".json"), t);
      await save(
        join(dest, t.grading.oracle),
        await json(inside(root, t.grading.oracle)),
      );
      if (t.environment.fixtureDir)
        await copyTree(
          inside(root, t.environment.fixtureDir),
          join(dest, t.environment.fixtureDir),
        );
    }
  }
  if (role === "setup") {
    if (await exists(join(root, "fixtures", "_support")))
      await copyTree(
        join(root, "fixtures", "_support"),
        join(dest, "fixtures", "_support"),
      );
    for (const name of ["mock-service.mjs", "prepare-package.mjs"])
      await save(
        join(dest, "tools", name),
        await readFile(join(root, "tools", name), "utf8"),
      );
    await save(
      join(dest, "PREPARE.md"),
      "# 独立环境包\n\n在本包根运行 `node tools/prepare-package.mjs --case DD-03-01 --out <全新目录>`；按SETUP.md执行额外准备。只授权生成的codex目录，绝不授权本包。特殊support服务可从fixtures/_support启动；通用服务为tools/mock-service.mjs。\n",
    );
  }
  if (role === "reviewer")
    for (const name of ["SCORING.md", "RUNNER.md"])
      await save(join(dest, name), await readFile(join(root, name), "utf8"));
  await save(
    join(dest, "ROLE.md"),
    `# ${role} / ${split}\n\n${role === "runner" ? "只见用户简报。不要读取setup或reviewer包。环境清单由准备者另行传入。" : "仅将trace夹具复制到DogDog授权目录；任务、底稿、脚本和输出永远位于检索范围之外。"}\n\n本包为文件级分离，不是OS权限沙箱。真正盲测需独立上下文及最小文件权限。\n`,
  );
  for (const f of await files(dest))
    manifest.files.push({
      path: relative(dest, f).replaceAll("\\", "/"),
      sha256: hash(await readFile(f)),
    });
  await save(join(dest, "package.json"), manifest);
  return manifest;
}
export async function prepare(id, out) {
  const t = (await loadTasks()).map((x) => x.task).find((t) => t.id === id);
  if (!t) throw new Error("Unknown case " + id);
  const dest = resolve(out);
  if (await exists(dest)) throw new Error("Staging must be a fresh directory");
  const traceRoot = join(dest, "codex", "sessions");
  await mkdir(traceRoot, { recursive: true });
  await mkdir(join(dest, "codex", "archived_sessions"), { recursive: true });
  const hashes = {};
  if (t.environment.fixtureDir)
    for (const f of await files(inside(root, t.environment.fixtureDir))) {
      if (!f.endsWith(".jsonl")) continue;
      const rel = relative(inside(root, t.environment.fixtureDir), f);
      const normalized = rel.replaceAll("\\", "/");
      if (
        t.environment.inputFiles &&
        !t.environment.inputFiles.includes(normalized)
      ) {
        const deferred = join(dest, "deferred-fixtures", rel);
        await mkdir(dirname(deferred), { recursive: true });
        await copyFile(f, deferred);
        continue;
      }
      const target = /archived|archive/i.test(rel)
        ? join(dest, "codex", "archived_sessions", rel)
        : join(traceRoot, rel);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(f, target);
      hashes[relative(dest, target)] = hash(await readFile(target));
    }
  const env = {
    DOGDOG_USER_DATA: join(dest, "profile"),
    CODEX_HOME: join(dest, "codex"),
    DOGDOG_REAL_CHECK: null,
    ELECTRON_RUN_AS_NODE: null,
  };
  await mkdir(env.DOGDOG_USER_DATA, { recursive: true });
  await save(join(dest, "launch-env.json"), env);
  await save(join(dest, "fixture-hashes.json"), hashes);
  await save(join(dest, "brief.json"), runnerBrief(t));
  await save(
    join(dest, "SETUP.md"),
    `# ${id}\n\n${t.environment.setup.map((s) => "- " + s).join("\n")}\n\n仅复制了JSONL；二进制文件、mock脚本、配置迁移和异常注入依任务准备步骤处理，尚未自动执行。不要授权整个staging目录。\n`,
  );
  return {
    caseId: id,
    directory: dest,
    environment: env,
    traceRoots: [traceRoot, join(dest, "codex", "archived_sessions")],
    fixtureHashes: hashes,
  };
}
export async function matrix() {
  const tasks = (await loadTasks()).map((x) => x.task);
  let md =
    "# DogDog v1 覆盖矩阵\n\n由 `node evaluation/tools/cli.mjs matrix` 生成；覆盖表示存在任务，不代表通过。\n\n| 体系 | 任务 | 能力 | 划分 | 需求 | 场景标签 |\n|---|---|---|---|---|---|\n";
  for (const t of tasks)
    md += `| ${t.system} ${systemNames[Number(t.system) - 1]} | [${t.id} ${t.title}](cases/${t.system}/${t.id}.json) | ${t.capability} | ${t.split} | ${t.requirements.join(", ")} | ${t.tags.join(", ")} |\n`;
  await save(join(root, "COVERAGE.md"), md);
  await save(join(root, "catalog.json"), {
    schemaVersion: "1.0",
    version: "1.0.0",
    systems: systemNames.map((name, i) => ({
      id: String(i + 1).padStart(2, "0"),
      name,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      system: t.system,
      title: t.title,
      capability: t.capability,
      split: t.split,
      family: t.family,
      requirements: t.requirements,
    })),
  });
  for (const [name, schema] of Object.entries(jsonSchemas()))
    await save(join(root, "schemas", name + ".schema.json"), schema);
  return { tasks: tasks.length };
}
export async function validateRun(path) {
  const manifest = manifestSchema.parse(
      await json(join(path, "manifest.json")),
    ),
    results = [];
  for (const [file, digest] of Object.entries(manifest.fixtureHashes)) {
    const fixture = inside(path, file);
    if (!(await exists(fixture)) || hash(await readFile(fixture)) !== digest)
      throw new Error("Run fixture hash mismatch: " + file);
  }
  const taskMap = new Map(
    (await loadTasks()).map(({ task }) => [task.id, task]),
  );
  for (const f of await trialFiles(resolve(path))) {
    const result = resultSchema.parse(await json(f));
    if (!manifest.caseIds.includes(result.caseId))
      throw new Error("Unlisted case " + result.caseId);
    const evidence = [
      ...result.artifacts,
      ...result.checks.flatMap((x) => x.evidence),
      ...result.scores.flatMap((x) => x.evidence),
    ];
    for (const ref of evidence) {
      const file = ref.split("#")[0];
      if (!(await exists(inside(path, file))))
        throw new Error("Missing run evidence " + ref);
    }
    if (result.runId !== manifest.runId)
      throw new Error("Result runId differs from manifest");
    if (result.mockService !== manifest.mockService)
      throw new Error("Result mockService differs from manifest");
    if (
      result.executionTrack !== manifest.executionTrack &&
      manifest.executionTrack !== "mixed"
    )
      throw new Error("Result track differs from manifest");
    if (result.status === "pass") {
      const task = taskMap.get(result.caseId);
      if (!task) throw new Error("Unknown core case " + result.caseId);
      if (result.mockService && task.must.some((m) => m.kind === "semantic"))
        throw new Error(
          "Scripted mock cannot establish semantic core-task quality",
        );
      if (new Set(result.checks.map((c) => c.id)).size !== result.checks.length)
        throw new Error("Duplicate check IDs");
      if (result.checks.some((c) => !task.must.some((m) => m.id === c.id)))
        throw new Error("Unknown check ID");
      for (const required of task.must)
        if (
          !result.checks.some((c) => c.id === required.id && c.passed === true)
        )
          throw new Error("Pass missing required check " + required.id);
      if (result.checks.some((c) => c.passed !== true))
        throw new Error(
          "Pass requires positive evidence for every recorded check",
        );
      if (
        !Array.isArray(result.forbiddenChecks) ||
        result.forbiddenChecks.length !== task.mustNot.length ||
        task.mustNot.some(
          (_, i) =>
            !result.forbiddenChecks.some(
              (c) => c.index === i && c.absent === true && c.evidence?.length,
            ),
        )
      )
        throw new Error(
          "Pass requires explicit evidence for every forbidden behavior",
        );
      for (const c of result.forbiddenChecks)
        for (const ref of c.evidence)
          if (!(await exists(inside(path, ref.split("#")[0]))))
            throw new Error("Missing forbidden behavior evidence " + ref);
      if (
        new Set(result.scores.map((s) => s.dimension)).size !==
        result.scores.length
      )
        throw new Error("Duplicate score dimensions");
      for (const dimension of task.grading.rubric)
        if (
          !result.scores.some((s) => s.dimension === dimension && s.score === 2)
        )
          throw new Error(
            "Pass requires fully satisfied dimension " + dimension,
          );
      if (result.scores.some((s) => !task.grading.rubric.includes(s.dimension)))
        throw new Error("Unknown score dimension");
      if (task.track === "desktop" && result.executionTrack !== "desktop_proxy")
        throw new Error(
          "A diagnostic run cannot establish a desktop core task pass",
        );
    }
    if (Date.parse(result.endedAt) < Date.parse(result.startedAt))
      throw new Error("Invalid trial timestamps");
    results.push(result);
  }
  if (!results.length) throw new Error("No trial results");
  return {
    valid: true,
    runId: manifest.runId,
    results: results.length,
    statuses: Object.fromEntries(
      [...new Set(results.map((r) => r.status))].map((s) => [
        s,
        results.filter((r) => r.status === s).length,
      ]),
    ),
  };
}
async function main() {
  const args = process.argv.slice(2),
    command = args.shift(),
    arg = (name) => {
      const i = args.indexOf("--" + name);
      return i < 0 ? undefined : args[i + 1];
    };
  let result;
  if (command === "validate") {
    result = await validateSuite({ partial: args.includes("--partial") });
    if (!result.valid) process.exitCode = 1;
  } else if (command === "matrix") result = await matrix();
  else if (command === "pack")
    result = await pack({
      role: arg("role"),
      split: arg("split"),
      out:
        arg("out") || join(root, "packages", `${arg("role")}-${arg("split")}`),
    });
  else if (command === "prepare")
    result = await prepare(
      arg("case"),
      arg("out") || join(root, "runs", "staging", arg("case")),
    );
  else if (command === "validate-run")
    result = await validateRun(resolve(arg("dir")));
  else
    throw new Error(
      "Commands: validate [--partial], matrix, pack --role ROLE --split SPLIT [--out DIR], prepare --case ID [--out DIR], validate-run --dir DIR",
    );
  console.log(JSON.stringify(result, null, 2));
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
