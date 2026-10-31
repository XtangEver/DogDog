# v1 authoring contract

All assets are synthetic or privacy-safe historical adaptations. Do not edit product files. UTF-8 JSON; no dependencies required for authoring. This document describes the internal authoring format, never the simulated user's input.

## Paths and ownership

`cases/SS/DD-SS-NN.json`, `oracles/SS/DD-SS-NN.json`, `fixtures/SS/DD-SS-NN/` where SS=01..12, NN=01..08. Cases 01..06 are development, 07..08 holdout. Family IDs must not cross splits; variants stay with their parent. Each system has eight substantively different task families. Sources use repository-relative paths and real line numbers; historical adaptations must not retain private identifiers.

## Task JSON

Required keys:

```json
{
  "schemaVersion": "1.0",
  "id": "DD-01-01",
  "system": "01",
  "title": "中文标题",
  "split": "development",
  "family": "unique-family",
  "capability": "current",
  "provenance": {
    "kind": "synthetic",
    "sources": ["AGENTS.md:50"],
    "privacy": "no private trace content"
  },
  "tags": ["normal"],
  "track": "desktop",
  "requirements": ["R01-01"],
  "environment": {
    "profile": "fresh",
    "protocol": "openai-responses",
    "fixtureDir": null,
    "setup": ["具体准备步骤"]
  },
  "user": {
    "goal": "用户目标",
    "brief": "仅用户可知的背景",
    "knownFacts": ["事实"],
    "initialMessage": "自然问题或初始操作",
    "answers": [{ "when": "条件", "reply": "允许回答" }],
    "unknownReply": "我没有更多记录，请说明哪些无法确认。"
  },
  "steps": [{ "action": "可执行操作", "observe": "审查时检查的具体可见结果" }],
  "completion": {
    "when": "具体结束条件",
    "stopAfterMs": 180000,
    "maxUserTurns": 6
  },
  "must": [
    {
      "id": "C1",
      "description": "具体验收条件",
      "kind": "desktop",
      "gate": false
    }
  ],
  "mustNot": ["禁止行为"],
  "grading": {
    "oracle": "oracles/01/DD-01-01.json",
    "rubric": ["task_success"],
    "checks": [
      {
        "entry": "tests/agent.e2e.ts",
        "command": "npx playwright test tests/agent.e2e.ts",
        "purpose": "仅相关工程回归，不替代桌面代理任务"
      }
    ]
  },
  "variants": [
    {
      "id": "V1",
      "change": "输入的具体变化",
      "expectedDifference": "应变化的判定"
    }
  ]
}
```

`capability` is current or target (target includes a clear current-gap reason in environment.setup); `track` desktop, diagnostic or semantic; `kind` programmatic, desktop or semantic; `tags` use normal, missing, conflict, error, correction, adversarial, boundary, recovery, performance where applicable. At least two cases per system include a boundary/counterexample and at least one is multi-turn/restart. Future-only memory cases must not assert already implemented. Each task needs >=2 concrete must checks and a forbidden outcome. Checks may be empty if no existing automatic test applies. Do not invent existing commands. Do not prescribe private IPC as desktop user actions. No self-reported completion as sole evidence.

## Oracle JSON

Required keys: `schemaVersion`, `id`, `facts` (array of `{id,statement,evidence:[{file,fromLine,toLine,contains}]}`), `counterEvidence` (array), `unknowns` (array), `allowedConclusions` (array), `forbiddenConclusions` (array), `rubric` (array of `{dimension,zero,one,two}`), `positiveExamples` (array of `{answer,rationale}`), `negativeExamples` (same), `alternativeValidExamples` (same), `checks` (array of `{mustId,method,expected}`). `facts.evidence` can be empty only for UI/config expectations, which must be backed by observable checks. Evidence files are relative to evaluation/, with exact physical line numbers. Each nonempty `contains` must literally occur in the cited line range. Rubric dimensions must match task.grading.rubric. All three example arrays need >=1 substantive example. Anchors must be task-specific, not generic good/medium/bad.

## Trace fixture format

Use genuine parser-supported JSONL, e.g. line 1 `{"type":"session_meta","payload":{"id":"synthetic-...","cwd":"D:\\synthetic-work","cli_version":"fixture"},"timestamp":"2026-10-20T10:00:00Z"}`; subsequent response_item messages: `{"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"..."}]},"timestamp":"..."}`. Tool records are response_item function_call with name/call_id/arguments and function_call_output with call_id/output. Do not label answers in filenames. Unknown/malformed formats must be deliberate and explicitly documented in the oracle. Do not read actual private traces.

## Quality

Each system must cover its actual subsystem, not eight rewordings. Make fixtures and answer branches sufficient for execution. Prefer controlled pairs (retest present/absent, evidence consistent/conflicting, permission active/revoked) and include at least two variants per system. A known product limitation is a valid evaluation failure, not a reason to weaken the oracle. Do not claim synthetic outcomes prove real user benefit.
