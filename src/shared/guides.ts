import type { FeatureGuide } from "./types";
export const GUIDE_VERSION = "2026-10-30";
export const guides: FeatureGuide[] = [
  {
    id: "planning",
    name: "先明确计划与验收",
    description: "先澄清目标、约束和验收标准，再实施；规划本身不等于已执行。",
    when: "需求模糊、存在关键取舍或实施代价较高；具体模式入口需在用户安装版本中确认。",
    url: "https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex",
    checkedAt: GUIDE_VERSION,
  },
  {
    id: "goals",
    name: "Goals：持续推进明确目标",
    description: "以持久化的聊天目标跟踪进展、预算与完成状态。",
    when: "目标和完成标准已明确、需要持续执行；先确认客户端支持，不保证命令或入口跨版本一致。",
    url: "https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex",
    checkedAt: GUIDE_VERSION,
  },
  {
    id: "subagents",
    name: "Subagents：委派独立子任务",
    description: "将边界清楚的子任务委派给子 Agent，主 Agent 负责汇总与验收。",
    when: "确有可独立推进的工作，且权限、用户指令和客户端支持允许；不要仅因任务复杂就建议并行。",
    url: "https://learn.chatgpt.com/docs/agent-configuration/subagents",
    checkedAt: GUIDE_VERSION,
  },
];
