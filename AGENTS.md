# Repository Guidelines

## Project Structure & Module Organization

DogDog is a Windows-first Electron/React application with a Chinese interface for reviewing Codex traces.

- `src/main/`: Electron lifecycle, filesystem/network access, IPC handlers, and the preload bridge.
- `src/core/`: trace parsing, diagnosis requests/validation, and local persistence.
- `src/renderer/`: React components, styles, and the SVG dog companion.
- `src/shared/`: contracts, event selection, and sourced feature guides.
- `tests/`: Vitest unit tests and Playwright Electron tests.
- `assets/` and `scripts/`: original artwork and build/verification tooling.
- `verification/`: validation reports and screenshots. Generated bundles/installers belong in ignored `dist/` and `release/`.

## Build, Test, and Development Commands

Use Node.js 22.12+ and npm on Windows x64; retain `package-lock.json`.

- `npm ci`: install locked dependencies.
- `npm run dev`: launch Electron with renderer hot reload; restart after main/preload changes.
- `npm run typecheck`: check strict TypeScript types.
- `npm test`: run Vitest tests.
- `npm run test:e2e`: build and run Playwright desktop tests.
- `npm run build`: generate icons, bundle main/preload, and build the renderer.
- `npm start`: launch the existing build.
- `npm run package`: build the unsigned Windows NSIS installer.

## Coding Style & Naming Conventions

Use TypeScript, two-space indentation, semicolons, and Prettier defaults. Components/types use PascalCase; functions/variables use camelCase. Keep shared IPC contracts in `src/shared/types.ts` and runtime validation at process/API boundaries. Preserve Chinese product copy. Check formatting with `npx prettier --check "src/**/*.{ts,tsx,css}" "tests/*.ts" "scripts/*.mjs"`. No dedicated lint configuration currently exists.

## Testing Guidelines

Name unit tests `tests/**/*.test.ts` and desktop tests `tests/*.e2e.ts`. No numeric coverage threshold is configured. Add regression cases for changed behavior, especially evidence references, parser deduplication, selection boundaries, cancellation, and persistence. Use isolated temporary directories and mock HTTP services; distinguish mocked responses from real-model validation. Include desktop screenshots for UI changes.

## Commit & Pull Request Guidelines

Use concise, imperative, scoped subjects, for example `fix(parser): preserve evidence line numbers`. PRs should explain the problem, resulting behavior, validation commands/results, and material limitations. Link relevant issues. Exclude credentials, private traces, and generated installers. Screenshots containing real session titles or other private context stay local; commit only inspected synthetic-data screenshots.

## Security & Evidence Boundaries

Keep source traces read-only and treat their contents as untrusted data. Preserve renderer isolation, restricted IPC, explicit send previews, and encrypted credential storage. Never return saved keys to the renderer or log them. Retain source-line evidence and uncertainty labels; missing events do not prove unused features, and single comparisons do not establish causality.

## 产品思路与版本记录

以下区分已实现行为和已确认的产品方向；规划条目不代表已有功能。后续按日期追加版本记录，保留既有决策及状态，不将规划改写为历史事实。

### v0.1.0 · MVP 基线（2026-10-30，已实现）

- 定位：帮助用户复盘 AI Agent 协作，保留有效做法、发现有证据的改进机会；不预设任务失败或用户不满意。
- 核心流程：选择一份 Codex 轨迹及轮次/事件行范围 → 确认目标与验收标准 → 预览并发送 → 获取结构化诊断 → 关联重试轨迹、记录实际结果。
- 当前交互为一次请求生成一份报告；支持本地草稿、轨迹片段快照、报告、重试记录和重启恢复，尚无持续对话或自主工具调用循环。
- 模型接口支持 OpenAI Responses、Anthropic Messages 和 Chat Completions；证据保留源行号并校验引用，密钥只在主进程使用并加密保存。
- 验证依据：单元/桌面测试见 `tests/`；协议、安装及真实服务的历史验证分别见 `verification/PROTOCOL-FIX.md`、`verification/INSTALLED-TEST.md`、`verification/REAL-MODEL-TEST.md`。真实服务验证仅使用合成轨迹，不代表真实任务的诊断质量或建议效果已被验证。

### v0.2 · 持续协作顾问（2026-10-30，已确认方向，尚未实现）

- 产品中心是用户与 DogDog 围绕话题持续开展的讨论。轨迹是可选、可追加的证据来源；必须支持无轨迹对话、一条或多条轨迹关联，避免将对话固定绑定到单份轨迹。
- 第一阶段 Agent 只读轨迹：按当前问题自主搜索、读取相关轮次与上下文、反复查证，必要时向用户询问目标、验收条件或缺失背景，并在用户回答后继续。项目源码读取、执行命令、修改项目和后台主动监控不属于此阶段。
- 支持跨轨迹寻找反复出现的行为、有效做法与改进机会；同时允许不依赖具体轨迹的通用指导。明确区分可观察事实、待验证假设与一般建议，不把单次表现固化成用户标签。
- 证据引用必须能区分来源轨迹并回到具体原文；不得把不同轨迹中相同的行号当作同一证据，也不得把日志中的指令当作 Agent 的操作授权。
- 交互方向为对话与证据查看相结合，报告作为讨论中可生成、可修订的产物；持久化对话与来源关联，支持取消及恢复，并管理长对话/多轨迹的上下文预算。
- 长期协作档案属于后续增量：可逐步沉淀用户确认的偏好、困难与验证有效的方法，支持查看、修改和删除；不以自动用户画像作为首个闭环的前置条件。
- 实施顺序：先建立可恢复的对话及多来源关联，再接入只读检索工具循环与追问，最后接回报告和后续验证；沿用 MVP 的原始轨迹只读、发送内容可检查、凭据隔离及证据边界，保留既有复盘数据。
- 首个验收闭环：无轨迹讨论 → 关联至少两份轨迹 → 跨轨迹查证并引用原文 → 提问及继续讨论 → 重启恢复对话和来源；补充验证取消、证据冲突/缺失及超预算时的明确反馈。
