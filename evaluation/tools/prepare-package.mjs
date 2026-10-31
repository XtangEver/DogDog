// Dependency-free entrypoint copied into setup role packages; never reads oracles.
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
  access,
} from "node:fs/promises";
import { resolve, dirname, join, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2),
  arg = (k) => args[args.indexOf("--" + k) + 1];
if (!args.includes("--case") || !args.includes("--out"))
  throw new Error("Use --case ID --out FRESH_DIR");
const id = arg("case");
if (!/^DD-(0[1-9]|1[0-2])-0[1-8]$/.test(id)) throw new Error("Invalid case id");
const task = JSON.parse(
    await readFile(join(base, "setup", id + ".json"), "utf8"),
  ),
  out = resolve(arg("out"));
try {
  await access(out);
  throw new Error("Output exists; retain previous trials");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
function checked(path) {
  const full = resolve(base, path),
    r = relative(base, full);
  if (r === ".." || r.startsWith(".." + sep) || isAbsolute(r))
    throw new Error("Unsafe asset path");
  return full;
}
async function all(path) {
  const list = [];
  for (const e of await readdir(path, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw new Error("Symlink not allowed");
    const p = join(path, e.name);
    if (e.isDirectory()) list.push(...(await all(p)));
    else list.push(p);
  }
  return list;
}
const traceRoots = [
  join(out, "codex", "sessions"),
  join(out, "codex", "archived_sessions"),
];
for (const dir of traceRoots) await mkdir(dir, { recursive: true });
const hashes = {};
if (task.environment.fixtureDir) {
  const input = checked(task.environment.fixtureDir);
  for (const f of await all(input)) {
    if (!f.endsWith(".jsonl")) continue;
    const rel = relative(input, f).replaceAll("\\", "/");
    const deferred =
      task.environment.inputFiles && !task.environment.inputFiles.includes(rel);
    const target = deferred
      ? join(out, "deferred-fixtures", rel)
      : join(/archive/i.test(rel) ? traceRoots[1] : traceRoots[0], rel);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(f, target);
    if (!deferred)
      hashes[relative(out, target)] = createHash("sha256")
        .update(await readFile(target))
        .digest("hex");
  }
}
const env = {
  DOGDOG_USER_DATA: join(out, "profile"),
  CODEX_HOME: join(out, "codex"),
  DOGDOG_REAL_CHECK: null,
  ELECTRON_RUN_AS_NODE: null,
};
await mkdir(env.DOGDOG_USER_DATA, { recursive: true });
await writeFile(join(out, "launch-env.json"), JSON.stringify(env, null, 2));
await writeFile(
  join(out, "fixture-hashes.json"),
  JSON.stringify(hashes, null, 2),
);
await writeFile(
  join(out, "SETUP.md"),
  "# " +
    id +
    "\n\n" +
    task.environment.setup.map((x) => "- " + x).join("\n") +
    "\n\n本工具只复制声明的初始JSONL；特殊生成器、mock和异常注入由准备者按步骤执行。\n",
);
console.log(
  JSON.stringify(
    {
      caseId: id,
      directory: out,
      environment: env,
      traceRoots,
      fixtureHashes: hashes,
    },
    null,
    2,
  ),
);
