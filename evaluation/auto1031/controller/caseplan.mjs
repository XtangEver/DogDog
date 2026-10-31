// Mechanical per-case plan: grouping (real|mock), budgets, flags. Computed
// from case JSONs by script only — no role session sees this build step, and
// the coordinator never browses case content beyond this derived table.
import { loadTasks } from "../../tools/cli.mjs";
import { atomicWriteJson, repo } from "./state.mjs";
import { join } from "node:path";

export async function buildCasePlan() {
  const tasks = (await loadTasks()).map((x) => x.task);
  const rows = [];
  for (const t of tasks) {
    const hasSemanticMust = (t.must ?? []).some((m) => m.kind === "semantic");
    const setupStr = JSON.stringify(t.environment ?? {});
    const refsMock = /desktop-service|mock-service/.test(setupStr);
    const group = hasSemanticMust ? "real" : refsMock ? "mock" : "real";
    rows.push({
      id: t.id,
      system: t.system,
      split: t.split,
      capability: t.capability,
      track: t.track,
      group,
      hasSemanticMust,
      refsMock,
      stopAfterMs: t.completion.stopAfterMs,
      maxUserTurns: t.completion.maxUserTurns,
      mustCount: (t.must ?? []).length,
      gateCount: (t.must ?? []).filter((m) => m.gate).length,
      mustNotCount: (t.mustNot ?? []).length,
      rubric: t.grading.rubric,
      family: t.family,
    });
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    dev: {
      total: rows.filter((r) => r.split === "development").length,
      real: rows.filter((r) => r.split === "development" && r.group === "real")
        .length,
      mock: rows.filter((r) => r.split === "development" && r.group === "mock")
        .length,
      semantic: rows.filter(
        (r) => r.split === "development" && r.hasSemanticMust,
      ).length,
    },
    hold: {
      total: rows.filter((r) => r.split === "holdout").length,
      real: rows.filter((r) => r.split === "holdout" && r.group === "real")
        .length,
      mock: rows.filter((r) => r.split === "holdout" && r.group === "mock")
        .length,
    },
    rows,
  };
  return summary;
}

export async function writeCasePlan() {
  const plan = await buildCasePlan();
  const path = join(repo, "evaluation", "runs", "auto-1031", "case-plan.json");
  atomicWriteJson(path, plan);
  return { path, plan };
}

export function summaryLine(plan) {
  const { dev, hold } = plan;
  return `dev=${dev.total} (real=${dev.real}, mock=${dev.mock}, semantic=${dev.semantic}) hold=${hold.total} (real=${hold.real}, mock=${hold.mock})`;
}
