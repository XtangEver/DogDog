// Reproducible author QA for systems 02/03/04/06; does not grade DogDog answers.
// Run from any directory: node evaluation/tools/check-content.mjs
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const evaluationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(evaluationRoot, "..");
const systems = ["02", "03", "04", "06"];
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const lines = async (file) =>
  (await readFile(file, "utf8")).trimEnd().split(/\r?\n/);
async function files(root) {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(join(root, entry.name))
          : [join(root, entry.name)],
      ),
    )
  ).flat();
}

// Compile the actual parser in memory. No alternate parser or product edits.
const transformed = await transform(
  await readFile(join(repositoryRoot, "src/core/trace.ts"), "utf8"),
  {
    loader: "ts",
    format: "esm",
  },
);
const { parseTraceText } = await import(
  "data:text/javascript;base64," +
    Buffer.from(transformed.code).toString("base64")
);
let tasksChecked = 0;
let evidenceReferencesChecked = 0;
let fixturesParsed = 0;
let intentionallyMalformedLines = 0;
for (const system of systems) {
  const taskFiles = (await files(join(evaluationRoot, "cases", system))).filter(
    (file) => file.endsWith(".json"),
  );
  assert.equal(taskFiles.length, 8, `${system}: expected eight cases`);
  const tasks = await Promise.all(taskFiles.map(json));
  assert.equal(
    new Set(tasks.map((task) => task.family)).size,
    8,
    `${system}: family reuse`,
  );
  assert.equal(tasks.filter((task) => task.split === "holdout").length, 2);
  assert.ok(
    tasks.reduce((count, task) => count + task.variants.length, 0) >= 2,
  );
  assert.ok(
    tasks.filter((task) =>
      task.tags.some((tag) =>
        ["boundary", "conflict", "missing", "error", "adversarial"].includes(
          tag,
        ),
      ),
    ).length >= 2,
  );
  assert.ok(
    tasks.some((task) =>
      task.steps.some((step) => /重启|追问/.test(step.action)),
    ),
  );
  for (const task of tasks) {
    tasksChecked++;
    assert.equal(
      task.user.goal,
      task.user.initialMessage,
      `${task.id}: user goal must not reveal scoring title`,
    );
    assert.ok(task.must.length >= 2 && task.mustNot.length >= 1);
    const oracle = await json(join(evaluationRoot, task.grading.oracle));
    assert.ok(oracle.facts.length > 0);
    assert.deepEqual(
      [...task.grading.rubric].sort(),
      oracle.rubric.map((item) => item.dimension).sort(),
    );
    for (const collection of [
      "positiveExamples",
      "negativeExamples",
      "alternativeValidExamples",
    ])
      assert.ok(oracle[collection].length);
    for (const fact of [...oracle.facts, ...oracle.counterEvidence])
      for (const evidence of fact.evidence) {
        const sourceLines = await lines(join(evaluationRoot, evidence.file));
        assert.ok(
          evidence.fromLine >= 1 &&
            evidence.toLine >= evidence.fromLine &&
            evidence.toLine <= sourceLines.length,
        );
        assert.ok(
          sourceLines
            .slice(evidence.fromLine - 1, evidence.toLine)
            .join("\n")
            .includes(evidence.contains),
          `${task.id}: evidence literal mismatch`,
        );
        evidenceReferencesChecked++;
      }
    if (task.environment.inputFiles) {
      for (const input of task.environment.inputFiles)
        await readFile(
          join(evaluationRoot, task.environment.fixtureDir, input),
        );
    }
  }
  for (const fixture of (
    await files(join(evaluationRoot, "fixtures", system))
  ).filter((file) => file.endsWith(".jsonl"))) {
    const content = await readFile(fixture, "utf8");
    const parsed = parseTraceText(content, fixture);
    assert.ok(parsed.events.length > 0);
    if (system !== "02")
      assert.ok(
        !parsed.warnings.some((warning) =>
          /缺少对应调用|没有对应结果/.test(warning),
        ),
        `${fixture}: accidental orphan call/result`,
      );
    for (const [index, line] of content.trimEnd().split(/\r?\n/).entries()) {
      try {
        JSON.parse(line);
      } catch {
        assert.ok(
          fixture
            .replaceAll("\\", "/")
            .endsWith("02/DD-02-03/session-a.jsonl") && index === 2,
          `unexpected malformed line: ${fixture}:${index + 1}`,
        );
        intentionallyMalformedLines++;
      }
    }
    fixturesParsed++;
  }
}
const parserCase = async (number) =>
  parseTraceText(
    await readFile(
      join(evaluationRoot, "fixtures/02", `DD-02-${number}`, "session-a.jsonl"),
      "utf8",
    ),
  );
let parsed = await parserCase("01");
assert.equal(
  parsed.events.filter((event) => event.kind === "tool_call").length,
  1,
);
assert.equal(
  parsed.events.find((event) => event.kind === "tool_result").line,
  6,
);
assert.equal(
  parsed.events.find((event) => event.kind === "tool_result").name,
  "exec_command",
);
parsed = await parserCase("02");
assert.equal(parsed.turns, 2);
assert.deepEqual(
  parsed.events
    .filter((event) => event.role === "user")
    .map((event) => event.line),
  [3, 6],
);
parsed = await parserCase("03");
assert.ok(parsed.warnings.some((warning) => warning.includes("第 3 行")));
assert.ok(parsed.events.some((event) => event.line === 6));
parsed = await parserCase("04");
assert.ok(parsed.warnings.some((warning) => warning.includes("缺少对应调用")));
assert.ok(parsed.warnings.some((warning) => warning.includes("没有对应结果")));
parsed = await parserCase("05");
assert.ok(
  !JSON.stringify(parsed.events).includes("SYNTHETIC_HIDDEN_REASONING_TOKEN"),
);
assert.ok(parsed.warnings.some((warning) => warning.includes("压缩")));
parsed = await parserCase("07");
assert.equal(
  parsed.events.find((event) => event.kind === "tool_result").line,
  4,
);
parsed = await parserCase("08");
assert.equal(parsed.stats.totalTokens, 420);
assert.equal(parsed.stats.durationMs, 12000);
console.log(
  JSON.stringify(
    {
      systems,
      tasksChecked,
      fixturesParsed,
      evidenceReferencesChecked,
      intentionallyMalformedLines,
      parserAssertions: "passed",
      limitation:
        "Authoring/parser QA only; no semantic answer grading, desktop task execution, or real-model capability claim.",
    },
    null,
    2,
  ),
);
