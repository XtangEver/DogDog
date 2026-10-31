import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  inside,
  runnerBrief,
  pack,
  files,
  validateSuite,
  validateRun,
  save,
  loadTasks,
  prepare,
} from "./cli.mjs";
import { resultSchema } from "./schemas.mjs";
import { startMock, stream } from "./mock-service.mjs";
async function cleanup(temp) {
  const rel = relative(resolve(tmpdir()), resolve(temp));
  if (!/^dogdog-eval-[^\\/]+$/.test(rel))
    throw new Error("Unsafe cleanup " + temp);
  await rm(temp, { recursive: true, force: true });
}

test("asset paths cannot escape their designated root", () => {
  assert.throws(
    () => inside(resolve("evaluation"), "../src/main/main.ts"),
    /escapes/,
  );
  assert.equal(
    inside(resolve("evaluation"), "cases/01/task.json"),
    resolve("evaluation/cases/01/task.json"),
  );
});
test("runner projection cannot include oracle, must checks or expected observations", () => {
  const brief = runnerBrief({
    id: "DD-01-01",
    track: "desktop",
    user: { goal: "用户任务" },
    steps: [{ action: "打开设置", observe: "SECRET_ORACLE" }],
    completion: { when: "SECRET_END", stopAfterMs: 500, maxUserTurns: 1 },
    must: ["SECRET_MUST"],
    grading: { oracle: "SECRET_PATH" },
  });
  const bytes = JSON.stringify(brief);
  assert.ok(bytes.includes("打开设置"));
  assert.ok(!bytes.includes("SECRET"));
});
test("role packages contain no reviewer inputs in runner bundle", async () => {
  const temp = await mkdtemp(join(tmpdir(), "dogdog-eval-pack-"));
  try {
    const dest = join(temp, "runner");
    const m = await pack({ role: "runner", split: "development", out: dest });
    assert.equal(m.count, 72);
    const names = (await files(dest)).map((f) => relative(dest, f));
    assert.ok(!names.some((n) => /oracle|fixture|cases/.test(n)));
    for (const f of (await files(dest)).filter(
      (f) => f.endsWith(".json") && !f.endsWith("package.json"),
    )) {
      const b = JSON.parse(await readFile(f, "utf8"));
      assert.equal(b.must, undefined);
      assert.equal(b.grading, undefined);
      assert.equal(b.completion, undefined);
    }
    await assert.rejects(
      pack({ role: "runner", split: "development", out: dest }),
      /fresh/,
    );
  } finally {
    await cleanup(temp);
  }
});
test("results cannot claim unsupported status or out-of-range semantic scores", () => {
  assert.equal(resultSchema.safeParse({ status: "looks_good" }).success, false);
});
test("mock scripts isolate local traffic, fingerprint credentials and expose real failure injection", async () => {
  const temp = await mkdtemp(join(tmpdir(), "dogdog-eval-mock-"));
  const mock = await startMock({ out: temp });
  try {
    const response = await fetch(mock.status.url + "/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer SYNTHETIC-TEST-SECRET",
      },
      body: JSON.stringify({ input: "synthetic" }),
    });
    assert.ok((await response.text()).includes("response.completed"));
    await fetch(mock.status.url + "/control", {
      method: "POST",
      body: JSON.stringify({ mode: "http401" }),
    });
    assert.equal(
      (
        await fetch(mock.status.url + "/responses", {
          method: "POST",
          body: "{}",
        })
      ).status,
      401,
    );
    const audit = await readFile(join(temp, "requests.jsonl"), "utf8");
    assert.ok(!audit.includes("SYNTHETIC-TEST-SECRET"));
    assert.ok(audit.includes("credentialSha256"));
    assert.ok(stream("anthropic", "测试").includes("message_stop"));
    assert.ok(stream("openai-chat", "测试").includes("[DONE]"));
  } finally {
    await mock.close();
    await cleanup(temp);
  }
});
test("all 96 tasks and exact evidence line spans pass suite integrity checks", async () => {
  const report = await validateSuite();
  assert.deepEqual(report.errors, []);
  assert.equal(report.tasks, 96);
  assert.equal(report.development, 72);
  assert.equal(report.holdout, 24);
});
test("run validation rejects invented success and manifest/result disagreement", async () => {
  const temp = await mkdtemp(join(tmpdir(), "dogdog-eval-verdict-"));
  try {
    const t = (await loadTasks()).find((x) => x.task.id === "DD-05-01").task;
    const now = new Date().toISOString();
    await save(join(temp, "evidence.txt"), "synthetic evidence placeholder");
    const manifest = {
      schemaVersion: "1.0",
      runId: "selftest",
      createdAt: now,
      application: {
        version: "fixture",
        executable: "fixture",
        executableSha256: "fixture",
        build: "fixture",
      },
      suiteVersion: "1.0.0",
      platform: "test",
      executionTrack: "desktop_proxy",
      mockService: false,
      model: {
        protocol: "fixture",
        name: "fixture",
        endpoint: "http://127.0.0.1",
        configuration: {},
      },
      display: { width: null, height: null, scale: null },
      isolation: {
        profile: "fixture",
        traceRoots: ["fixture"],
        excluded: ["answers"],
      },
      fixtureHashes: {},
      sourceRevision: "fixture",
      caseIds: [t.id],
    };
    await save(join(temp, "manifest.json"), manifest);
    const result = {
      schemaVersion: "1.0",
      runId: "selftest",
      caseId: t.id,
      attempt: 1,
      status: "pass",
      executionTrack: "desktop_proxy",
      blinded: false,
      mockService: false,
      startedAt: now,
      endedAt: now,
      checks: [
        {
          id: "invented",
          passed: true,
          observation: "asserted",
          evidence: ["evidence.txt"],
        },
      ],
      scores: [],
      artifacts: ["evidence.txt"],
      limitations: ["synthetic tooling test"],
      reviewer: {
        kind: "programmatic",
        identity: "selftest",
        independentContext: false,
      },
      metrics: { elapsedMs: 0, modelRequests: 0, cost: null },
    };
    await save(join(temp, "result.json"), result);
    await assert.rejects(validateRun(temp), /Unknown check/);
    result.checks = t.must.map((c) => ({
      id: c.id,
      passed: true,
      observation: "asserted",
      evidence: ["evidence.txt"],
    }));
    await save(join(temp, "result.json"), result);
    await assert.rejects(validateRun(temp), /forbidden/);
    result.forbiddenChecks = t.mustNot.map((_, index) => ({
      index,
      absent: true,
      observation: "asserted",
      evidence: ["evidence.txt"],
    }));
    await save(join(temp, "result.json"), result);
    await assert.rejects(validateRun(temp), /dimension/);
    result.scores = t.grading.rubric.map((dimension) => ({
      dimension,
      score: 2,
      observation: "asserted",
      evidence: ["evidence.txt"],
    }));
    result.mockService = true;
    await save(join(temp, "result.json"), result);
    await assert.rejects(validateRun(temp), /mockService/);
    manifest.mockService = true;
    await save(join(temp, "manifest.json"), manifest);
    await assert.rejects(validateRun(temp), /semantic/);
  } finally {
    await cleanup(temp);
  }
});
test("deferred evidence stays outside the initial trace roots", async () => {
  const temp = await mkdtemp(join(tmpdir(), "dogdog-eval-stage-"));
  try {
    const task = (await loadTasks())
      .map((x) => x.task)
      .find(
        (t) =>
          t.environment.inputFiles &&
          t.environment.fixtureDir &&
          t.id === "DD-03-06",
      );
    assert.ok(task);
    const value = await prepare(task.id, join(temp, "staged"));
    const staged = (await files(join(temp, "staged", "codex"))).filter((f) =>
      f.endsWith(".jsonl"),
    );
    assert.equal(staged.length, task.environment.inputFiles.length);
    assert.ok(
      (await files(join(temp, "staged", "deferred-fixtures"))).length > 0,
    );
    assert.ok(value.traceRoots.every((r) => !r.includes("deferred-fixtures")));
  } finally {
    await cleanup(temp);
  }
});
