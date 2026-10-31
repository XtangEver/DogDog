import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { build } from "esbuild";
import { prepare, root, repo, save, validateSuite } from "./cli.mjs";

const work = await mkdtemp(join(tmpdir(), "dogdog-desktop-asset-qa-"));
const results = [];
const run = (args) =>
  new Promise((ok, fail) => {
    const process = spawn(globalThis.process.execPath, args, {
      cwd: repo,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      error = "";
    process.stdout.on("data", (chunk) => {
      out += chunk;
    });
    process.stderr.on("data", (chunk) => {
      error += chunk;
    });
    process.on("error", fail);
    process.on("close", (code) =>
      code === 0 ? ok(out) : fail(new Error(error || out || "child failed")),
    );
  });
const walk = async (dir) =>
  (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map(async (entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : [join(dir, entry.name)],
      ),
    )
  ).flat();

const bundled = await build({
  stdin: {
    contents:
      'export {validateReview} from "./src/core/store.ts"; export {parseTraceText} from "./src/core/trace.ts";',
    resolveDir: repo,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const validatorPath = join(work, "runtime-validators.mjs");
await writeFile(validatorPath, bundled.outputFiles[0].contents);
const { validateReview, parseTraceText } = await import(
  pathToFileURL(validatorPath).href
);

for (const id of [
  "DD-01-07",
  "DD-01-08",
  "DD-12-05",
  "DD-12-06",
  "DD-12-07",
  "DD-12-08",
]) {
  const dir = join(work, id);
  await prepare(id, dir);
  const fixture = join(root, "fixtures", id.slice(3, 5), id);
  const generated = ["DD-12-05", "DD-12-06", "DD-12-07"].includes(id);
  await run([
    join(fixture, generated ? "generate.mjs" : "seed.mjs"),
    dir,
    ...(id === "DD-01-08" ? ["http://127.0.0.1:1234/responses"] : []),
  ]);
  const input = (await walk(join(dir, "codex", "sessions"))).filter((file) =>
    file.endsWith(".jsonl"),
  );
  for (const file of input) {
    const trace = parseTraceText(await readFile(file, "utf8"), file);
    assert.ok(trace.events.length >= 2, file + ": parser-supported messages");
  }
  const expected = {
    "DD-01-07": 1,
    "DD-01-08": 2,
    "DD-12-05": 181,
    "DD-12-06": 2,
    "DD-12-07": 1000,
    "DD-12-08": 0,
  }[id];
  assert.equal(input.length, expected);
  if (id === "DD-01-08") {
    const settings = JSON.parse(
      await readFile(join(dir, "profile", "settings.json"), "utf8"),
    );
    assert.equal(settings.baseUrl, "http://127.0.0.1:1234/responses");
    assert.equal(settings.allowTraceSend, undefined);
    assert.equal(settings.traceRoots, undefined);
  }
  if (id === "DD-12-06")
    assert.ok(input.some((file) => file.includes("level-13")));
  if (id === "DD-12-08") {
    const review = JSON.parse(
      await readFile(
        join(
          dir,
          "profile",
          "reviews",
          "bbf03625-eaa1-4d31-8c63-a9db59cde931.json",
        ),
        "utf8",
      ),
    );
    validateReview(review);
    await stat(review.trace.path);
    assert.equal(
      parseTraceText(await readFile(review.trace.path, "utf8")).events.find(
        (event) => event.line === 4,
      ).text,
      "1 test failed SYNTHETIC_EXPORT。",
    );
  }
  results.push({
    check: id + " prepare/seed + current parser",
    passed: true,
    authorizedJsonl: input.length,
  });
}

async function withMock(id, check) {
  const out = join(work, "mock-" + id);
  const child = spawn(
    process.execPath,
    [
      join(root, "fixtures", "_support", "desktop-service.mjs"),
      "--plan",
      join(root, "fixtures", id.slice(3, 5), id, "mock-plan.json"),
      "--out",
      out,
    ],
    { cwd: repo, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    const status = await new Promise((ok, fail) => {
      const timer = setTimeout(
        () => fail(new Error("mock startup timeout")),
        10000,
      );
      const lines = createInterface({ input: child.stdout });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      lines.once("line", (line) => {
        clearTimeout(timer);
        lines.close();
        try {
          ok(JSON.parse(line));
        } catch (error) {
          fail(error);
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        fail(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code) fail(new Error(stderr || "mock exited " + code));
      });
    });
    await check(status, out);
    const logs = await readFile(join(out, "requests.jsonl"), "utf8");
    assert.ok(
      !logs.includes("DD-SYNTHETIC-KEY") &&
        !logs.includes("DD-SYNTHETIC-SECRET"),
      "credential headers must not enter audit log",
    );
    results.push({ check: id + " controlled HTTP mode", passed: true });
  } finally {
    if (child.exitCode === null) {
      const ended = new Promise((ok) => child.once("exit", ok));
      child.kill();
      await ended;
    }
  }
}
const post = (url, signal) =>
  fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: "Bearer DD-SYNTHETIC-KEY",
    },
    body: JSON.stringify({ model: "fixture", input: [] }),
    signal,
  });
for (const [id, expected] of [
  ["DD-01-02", "配置检查完成"],
  ["DD-12-02", "配置检查完成"],
  ["DD-12-03", "content_block"],
  ["DD-11-04", "DD-SYNTHETIC-SECRET"],
  ["DD-11-07", "S99:L999"],
]) {
  await withMock(id, async (status) => {
    const response = await post(status.endpoint);
    assert.ok((await response.text()).includes(expected));
    if (id === "DD-11-04") assert.equal(response.status, 503);
    if (id === "DD-12-02")
      assert.equal((await post(status.url + "/responses")).status, 404);
  });
}
await withMock("DD-11-03", async (status) => {
  assert.ok((await (await post(status.endpoint)).text()).includes("验收目标"));
  assert.ok(
    (await (await post(status.endpoint)).text()).includes("健康检查通过"),
  );
});
await withMock("DD-12-01", async (status) => {
  for (const endpoint of ["/responses", "/chat", "/messages"]) {
    for (const expected of [
      "list_sources",
      "read_trace",
      "S1:L3",
      "list_sources",
      "read_trace",
      "S1:L3",
    ]) {
      assert.ok(
        (await (await post(status.url + endpoint)).text()).includes(expected),
        endpoint + ": " + expected,
      );
    }
  }
});
await withMock("DD-11-01", async (status) => {
  const control = new AbortController();
  const response = await post(status.endpoint, control.signal);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.ok(new TextDecoder().decode(first.value).includes("开始查证"));
  control.abort();
  await reader.cancel().catch(() => {});
});
await withMock("DD-11-08", async (status, out) => {
  const pending = post(status.endpoint);
  let received = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      received = (await readFile(join(out, "requests.jsonl"), "utf8")).includes(
        "delayed-tool",
      );
    } catch {}
    if (received) break;
    await new Promise((ok) => setTimeout(ok, 10));
  }
  assert.ok(
    received,
    "request must reach delayed service before administrative release",
  );
  await fetch(status.url + "/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ release: true }),
  });
  assert.ok((await (await pending).text()).includes("search_traces"));
});
results.push({
  check: "legacy-review validated by current validateReview",
  passed: true,
});
const suite = await validateSuite();
assert.equal(suite.valid, true, JSON.stringify(suite.errors));
results.push({
  check: "full suite structural validation",
  passed: true,
  tasks: suite.tasks,
  errors: suite.errors.length,
  warnings: suite.warnings.length,
});
const summary = {
  command: "node evaluation/tools/check-desktop-assets.mjs",
  checkedAt: new Date().toISOString(),
  passed: results.length,
  failed: 0,
  workDirectory: work,
  checks: results,
  limitations: [
    "No DogDog UI was launched or operated.",
    "HTTP mode checks validate fixture infrastructure only, not desktop task passes, semantic model quality or real user experience.",
  ],
};
await save(join(root, "reports", "DESKTOP-ASSET-QA.json"), summary);
await save(
  join(root, "reports", "DESKTOP-ASSET-QA.md"),
  "# 桌面评测资产可执行性检查\n\n" +
    "命令：`" +
    summary.command +
    "`。执行时间：" +
    summary.checkedAt +
    "。\n\n" +
    "**本报告仅验证评测基础设施和合成夹具；未启动或操作 DogDog UI，不代表桌面任务通过、真实模型语义质量或真人体验已验证。**\n\n" +
    results
      .map(
        (result) =>
          "- PASS：" +
          result.check +
          (result.authorizedJsonl === undefined
            ? ""
            : "；授权 JSONL=" + result.authorizedJsonl) +
          (result.tasks === undefined
            ? ""
            : "；tasks=" +
              result.tasks +
              "，errors=" +
              result.errors +
              "，warnings=" +
              result.warnings),
      )
      .join("\n") +
    "\n\n共 " +
    results.length +
    " 项通过；失败 0。每次使用系统临时目录中的全新隔离目录，详情见 [JSON结果](DESKTOP-ASSET-QA.json)。不改产品源码、正式配置或私有轨迹。\n",
);
console.log(JSON.stringify(summary, null, 2));
