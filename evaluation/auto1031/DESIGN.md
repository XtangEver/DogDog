# auto-1031 控制器设计（DESIGN.md）

执行 `PLAN_1031.md` 契约的本地 Node 控制器。目标：以 Claude Code（GLM-5.3 / GLM-5.3-Flash）为各个角色子进程，windows-mcp 为桌面通道，对 DogDog 执行 96 项评测并自主迭代（≤30 产品修改轮 / 72h）。运行产物全部落在 gitignored 的 `evaluation/runs/auto-1031/`。

## 模块地图（`evaluation/auto1031/controller/`）

| 模块 | 职责 |
| --- | --- |
| `campaign.mjs` | CLI：`preflight / round0 / round <n> / finalreg / holdout / status / resume / report / stop <reason>`。轮次编排、差距清单、停滞/预算检查、最终报告 |
| `state.mjs` | `state.json` 原子写（tmp+rename）、`timeline.jsonl` 追加、预算/停止条件（72h、30 轮、停滞、手动停止） |
| `procs.mjs` | 进程注册表（dogdog/mocks/claude，各带 PID+trialId）；`killTree` 仅杀自己登记的 PID；`confirmExited` 轮询至 OS 报告消失；退出钩子全量清理 |
| `roles.mjs` | claude.exe 角色会话工厂（stream-json、`--no-session-persistence`、硬超时）；角色预设矩阵；windows-mcp 配置生成 |
| `launch.mjs` | **唯一**的产品启动入口：按 staging 的 `launch-env.json` 注入/删除环境变量（`GLM_API_KEY`/`DOGDOG_REAL_CHECK`/`ELECTRON_RUN_AS_NODE` 永不传给产品）；等主窗口；exe/asar 哈希记录 |
| `trial.mjs` | 逐案流水线（见下）；管理员检查点的确定性执行；试后审计（profile 快照、mock 请求审计、夹具复哈希）；mock 按 status.json.pid+命令行守卫杀灭 |
| `harvest.mjs` | stream-json → 动作/观察摘要；**落盘前强制脱敏**（GLM_API_KEY 值、Authorization、x-api-key、sk-…）；PROGRESS LOG / CHECKPOINT 提取 |
| `screen.mjs` | PowerShell CopyFromScreen 定时截图（45s/次），不依赖视觉模型 |
| `caseplan.mjs` | 机械分组表：`hasSemanticMust ? real : (setup 引用 mock ? mock : real)`；预算/门槛计数 → `case-plan.json` 冻结 |
| `diag-parse.mjs` | 体系02 诊断题：esbuild 打包 `src/core/trace.ts` 解析 staged 夹具 → `evidence/diag-parse.json` |
| `validate.mjs` | reviewer 结果的机械字段校正（每次校正记 timeline）+ 严格 schema 解析 + `validate-run` 调用 |

## 角色矩阵（roles.mjs ROLE_PRESETS）

| 角色 | 模型 | 工具 | MCP | effort | 上下文 |
| --- | --- | --- | --- | --- | --- |
| setup | glm-5.3 | Bash,Read,Write,Edit,Glob,Grep | windows | medium | cwd=setup 包；只读包+staging |
| runner | glm-5.3-flash | 无内置工具 | windows（allowedTools 仅 mcp__windows-mcp__*） | low | cwd=回合目录；只见 brief+启动信息+逐字 PROGRESS LOG |
| visual | glm-5.3-flash | Read,Glob,Grep | 无 | low | 仅截图目录；纯文字结论，无判定权 |
| reviewer | glm-5.3 | Read,Glob,Grep,Write | 无 | medium | 先读 SCORING.md；写 result-draft.json + review-draft.md |
| coder | glm-5.3 | 全部内置 | 无 | medium | cwd=仓库根；只见 dev 差距清单与 dev 案例卡（控制器拷贝到 coder-input/） |
| coordinator | glm-5.3 | Read,Glob,Grep | 无 | medium | 主控制器进程自身（Node），不承担模型会话 |

角色会话全部 `-p`一次性运行、`--no-session-persistence`，跨回合状态只经 PROGRESS LOG 文件逐字携带。runner 上下文永不包含 must/mustNot/grading（`runnerBrief()` 已剥离）。coder 永不接触 holdout 案例与 oracles。

## 逐案流水线（trial.mjs runTrial）

1. `prepare`（cli.mjs）→ 全新 staging（codex 输入、launch-env.json、brief.json、fixture-hashes.json、SETUP.md）。
2. **setup-A**（25min 上限）：执行 SETUP.md 专有步骤（seed/生成器/junction/mock 启动），写 `launch-request.json` / `admin-plan.json` / `launch-info.json`。real 组经可见 UI 配置服务时，密钥只由该角色从 env 读入输入框，永不回显、永不落盘。
3. **launch**：控制器启动 DogDog（唯一启动点），记录 PID/exe/asar 哈希。
4. **setup-B**（按需）：应用内预配置（服务地址/密钥/轨迹目录授权）。
5. **runner 回合 1..8**：每回合 = 全新 claude 会话 + 上回合 PROGRESS LOG 逐字携带；`CHECKPOINT: <名称>` 触发控制器按 admin-plan 确定性执行（杀灭→confirmExited→重启→复制文件→等待）；预算 `stopAfterMs` 跨回合累计、`maxUserTurns` 由 runner 自律；45s 定时截图。
6. **试后审计**：停应用（killTree+confirmExited）、末屏截图、profile 持久化快照（settings/reports/conversations/trace-index）、mock status+requests 审计、夹具漂移复哈希 → `audit.json` + `evidence/`。
6b. 体系02：`runDiag` 解析证据。
7. **visual**（仅 `probes.flashImage==="ok"`）：截图文字结论，供 reviewer 参考。
8. **reviewer**：全新上下文，先 SCORING.md 再案例卡/oracle/证据，写 drafts。
9. **finalize + validate-run**：机械字段由控制器时钟/清单填（判定字段永不动），严格 schema 解析，`validate-run --dir` 每案必跑。
- 异常 → infrastructure_failure 草稿（空判定数组），同条件重试 ≤2 次（attempt 递增、不覆盖）。
- finally：mock 按 status.json.pid+命令行守卫杀灭；`cleanupAll(onlyTrialId)`。

## run root 与 manifest 策略

每轮每组建一个独立运行根：`r<N>/dev-real`（53）、`r<N>/dev-mock`（19）、`final/pass{1,2,3}/dev-*`、`hold/hold-*`。理由：`validate-run` 要求 result 与 manifest 的 `runId/mockService` 严格相等（无 mixed 豁免），而 `executionTrack` 在 manifest="mixed" 时豁免。manifest.fixtureHashes 在每案完成后从该案 staging 增量并入（相对运行根路径 → 内容哈希），保证 `report --compare` 的哈希值集可比（资产冻结 ⇒ 每轮同案夹具字节相同）。

## 轮次循环

- **Round 0**：全 72 dev 案基线 → `r0/gaps/dev-gap-list.json`（product/notImplemented/infrastructure/dispute/insufficient 分组）。
- **轮 1..30**：coder 会话（读差距清单+dev 案例卡拷贝）→ plan/实现/回归/commit（Co-Authored-By: Claude Code）→ git 干净检查 → `npm run package` 新构建（哈希入 state）→ 波1受影响案 → 波2同体系 → 全绿才波3全扫 → 轮报告+差距清单再生成。
- **停滞判定**：连续 3 轮（硬门槛失败+未实现）未降且完整通过数未升 ⇒ 停止交还。
- **冻结终检**：22 非语义案 1 次干净尝试 + 50 语义案各 3 次独立尝试（每次全新 staging/runner/reviewer）＝172 trial 全 pass。
- **holdout**：全面冻结后全新分包跑 24 案；任何失败 ⇒ `state.stop="holdout-failed-handback"`，交还不调优。

## 铁律落点（模块级）

- 验收资产冻结：preflight 生成 `assets-frozen.json`；每轮 coder 前后 git 状态校验。
- 泄题隔离：runner 提示只含 brief+启动信息+PROGRESS LOG（harvest 产物本身已脱敏）；coder 输入由控制器拷贝 dev 案例卡，holdout/oracle 不进 coder 目录。
- 产品启动垄断：仅 `launch.mjs`；重启必 `confirmExited` 旧 PID；agent 自报重启不采信（process.json 记录控制器观察值）。
- `blinded=false` 恒定写入 result；mock 组不含语义 must（分组规则保证），mockService 与 manifest 一致。
- 密钥卫生：产品进程 env 删 `GLM_API_KEY`；real 组密钥只经 setup 角色击键入 UI；一切派生物经 `redact()`。
- 证据保留：不删不改任何 trial 产物；重试 attempt 递增。

## 诚实边界（写入 result 与 FINAL-REPORT）

blinded=false（过程性隔离，无 OS 沙箱）；合成夹具 ≠ 真实诊断质量；mock 通过仅证协议/工具/UI/记录链路；视觉路径若 429 则布局判断仅基于可访问性树+人工截图复核；IME 组合输入未验证；费用不可核实处为 null；上限停止 ≠ 达成。
