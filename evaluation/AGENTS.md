# AI Agent 评测执行指南

本文件适用于 `evaluation/` 及其子目录，供 Codex、Claude Code 等具备终端与电脑操作能力的 Agent 使用。仓库根 `AGENTS.md` 继续适用；当前用户指令与已授予的任务范围优先。

## 先确定你的角色

**先确定角色，再打开案例文件。不要为了熟悉评测而通读所有底稿。**

| 角色                | 可读材料                                                   | 交付物                                         |
| ------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| 协调者              | 本文件、`catalog.json`、`COVERAGE.md`、运行指南            | 任务范围、角色分包、运行清单和汇总             |
| 环境准备者          | setup 包或指定案例的 `environment`、夹具与准备脚本         | 隔离实例、启动信息、输入哈希和准备记录         |
| 模拟用户 runner     | runner 包中的指定 `briefs/<ID>.json`、准备者提供的启动信息 | 操作时间线、真实输入/输出、截图和结束状态      |
| 独立审查员 reviewer | reviewer 包、执行结束后的过程证据、`SCORING.md`            | 逐项检查、逐维评分、`result.json`、`review.md` |

未指定角色时先承担协调者。使用独立上下文承担准备、模拟用户和审查；平台支持且当前任务允许委派时，可交给不同 subagent。模拟用户上下文不得继承底稿、解法或准备脚本内容。没有隔离条件仍可运行，但必须记录 `blinded=false`，不能称为盲测。已经看过答案的上下文不能靠“忘记答案”恢复盲测资格。

**runner 不读原始 `cases/`、`oracles/`、`fixtures/`、模型响应脚本、请求审计或产品源码。** 原始任务卡也含验收信息；runner 应使用工具生成的简报。审查员不要在执行中给 runner 透题。

## 最短执行路线

所有下述仓库命令均从仓库根执行。本机路径为 `D:\work_record\DogDog`；独立分发包的命令见后文。

1. 读取 `catalog.json` 选择体系、案例与划分；先看索引，不用全库搜索底稿。未指定划分时使用 `development`；`holdout` 留给冻结版本的独立验收。
2. 校验资产，按角色分包，准备全新隔离目录。
3. 准备者完成案例专有 setup、启动指定版本并交付简报；runner 通过真实 UI 完成任务。
4. 执行结束后，独立审查员取得评分包和证据，逐项判定；协调者校验结果并汇总。

只做静态检查、资产检查或 `pilot.mjs`，不能报告为完成了核心任务评测。一次任务只执行部分条件时保留 `insufficient_evidence`。

### 1. 校验和选择

```powershell
Set-Location D:\work_record\DogDog
node evaluation/tools/cli.mjs validate
node --test evaluation/tools/tooling.test.mjs
```

索引含12体系、96核心任务：每体系6开发＋2独立验收。按 `system`、`split`、`capability` 选择，记录明确的案例ID列表。`current` 与 `target` 分榜；未实现目标须核对实际版本及缺口，不静默跳过。范围以用户要求为准，不把抽样擅自当作全量。

### 2. 分包：交给对应 Agent，不把三个包一起发给 runner

```powershell
$batchStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$batchDir = Join-Path (Get-Location).Path "evaluation/packages/$batchStamp"
node evaluation/tools/cli.mjs pack --role runner --split development --out "$batchDir/runner"
node evaluation/tools/cli.mjs pack --role setup --split development --out "$batchDir/setup"
node evaluation/tools/cli.mjs pack --role reviewer --split development --out "$batchDir/reviewer"
```

输出必须是新目录；重跑换目录，不清空或覆盖上次证据。现成ZIP见 `PACKAGES.md`。分包是文件分离，不是操作系统权限沙箱；需要配合工作目录权限和上下文隔离。

### 3. 准备一题

以下命令仅供准备者，示例ID可替换为已选任务：

```powershell
$trialStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$trialDir = Join-Path (Get-Location).Path "evaluation/runs/$trialStamp-DD-03-01"
node evaluation/tools/cli.mjs prepare --case DD-03-01 --out "$trialDir"
```

读取生成的 `SETUP.md`，再完成指定案例的 `environment.setup`；`prepare` **不会**自动执行 seed、规模生成器、mock、配置迁移或异常注入。特殊脚本与输入都在案例夹具中，按题执行，不凭记忆替代。

只把指定初始输入放入 `codex/sessions` 和 `codex/archived_sessions`。`environment.inputFiles` 未包含的JSONL位于 `deferred-fixtures`，须到任务指定时机才加入；不要提前把后续复测、反例或变体送给 DogDog。生成或变更工作副本后更新哈希清单，并保留原始夹具不变。

本机 mock 在另一个专用终端启动；优先采用案例给出的专有服务/模式。普通协议检查可用：

```powershell
node evaluation/tools/mock-service.mjs --out "$trialDir/mock" --mode text
```

从 `status.json` 获取实际URL，按协议使用 `/responses`、`/chat` 或 `/messages`；API Key 使用合成占位符。通用 `auto` 只适配其约定夹具，不能用于任意案例模拟智能检索。固定mock不能验证真实模型判断质量。

在**专用启动终端**加载隔离环境，再启动目标应用：

```powershell
$launchVars = Get-Content -LiteralPath "$trialDir/launch-env.json" -Raw | ConvertFrom-Json
foreach ($entry in $launchVars.PSObject.Properties) {
  if ($null -eq $entry.Value) {
    Remove-Item -LiteralPath "Env:$($entry.Name)" -ErrorAction SilentlyContinue
  } else {
    Set-Item -LiteralPath "Env:$($entry.Name)" -Value ([string]$entry.Value)
  }
}
# 源码开发版；安装/发布题改为启动任务指定的实际exe，不能以开发版替代。
npm run build
npm start
```

终端间不会自动共享 `$trialDir`；另开终端时显式设置为该题实际绝对路径。没有Node依赖时先依据根目录说明执行 `npm ci`，保留锁文件。

核对 `DOGDOG_USER_DATA`、`CODEX_HOME` 都指向新目录，`DOGDOG_REAL_CHECK` 已移除；不要使用正式profile、真实 `.codex` 或历史结果目录。记录实际exe、业务版本、exe与bundle/app.asar哈希、模型/协议、显示条件和夹具哈希。只授权隔离的两类轨迹根，不能授权整个 trialDir 或仓库。

独立setup包不需要读取原仓库案例；从解压后的setup包根执行：

```powershell
node tools/prepare-package.mjs --case DD-03-01 --out D:/dogdog-eval-runs/new-trial
```

## runner 如何模拟用户

- 入口是指定 `briefs/<ID>.json`。按 `user.initialMessage` 开始，按 `user.answers` 的条件回应；缺失背景用 `unknownReply`，不发明事实，也不提供本应由 DogDog 自行找到的文件或答案。
- 使用当前屏幕、键鼠或可访问性控件；每次动作后重新观察。原生文件选择、中文输入法、等待和恢复等须真的操作，不用私有IPC、DOM注入或改写存储绕过。
- 桌面代理结果标 `desktop_proxy`；Playwright工程回归标 `diagnostic`。电脑工具不可用时记录原因；可以另跑诊断，但不能把诊断成功补写成桌面通过。
- 按简报的时间/回合预算停止。保存首次失败及全部重试，不修改产品、夹具或评分标准来换取通过；正常追问、纠错和手动重试按案例允许范围执行。
- 记录用户输入、可见回答、动作及时间、关键截图、最终可见状态。只向独立审查者提交过程证据，不自行宣告通过。

可直接给 runner 的指令：

> 只阅读本角色指南、给定brief与启动信息，像真实用户一样通过DogDog界面完成目标；追问按brief回答，未知不编造。不读答案、源码或存储，不修产品。保留全部操作、输入输出、截图和终止状态，结束后提交独立审查。

## 审查、结果落盘与汇总

审查员先读 `SCORING.md`，再读指定任务及其 `grading.oracle`。对照完整事实、反证与未知，接受不同但有效的措辞和工具路径。引用存在不等于支持结论；回答示例不能替代保存、重启、撤权等真实状态证据。

每个独立运行根至少保存：

```text
manifest.json          # 依schemas/manifest.schema.json，记录版本、配置、隔离与输入哈希
events.jsonl          # 动作、时间、输入、观察；首次失败和重试保留
trials/<ID>/result.json
trials/<ID>/review.md
screenshots/          # 结果内使用相对于运行根的证据路径
inputs/或原夹具副本   # 相对路径须与manifest.fixtureHashes一致；与实际授权根区分
```

格式以 `schemas/result.schema.json` 和工具校验为准；可参考 `reports/pilot/` 的真实产物结构，但不能复制它的结论。文字复核模板见 `templates/REVIEW.md`，版本比较模板见 `templates/COMPARISON.md`。

- `checks` 使用任务的 must ID；`forbiddenChecks` 使用 mustNot 的0起始index；`scores` 覆盖该题全部rubric维度，逐项附观察和可定位证据。
- `pass` 需要全部must通过、禁止行为有明确审查、各维度达到完整满足且无硬阻断。mock不能承担含语义must的核心通过；桌面题不能以诊断轨道通过。
- 状态分别使用 `pass`、`product_failure`、`infrastructure_failure`、`grading_dispute`、`insufficient_evidence`、`not_implemented`、`not_run`。不要把产品崩溃一概归环境，也不要把没有证据归为通过。
- `runId`、轨道、mock标记须与manifest一致；夹具副本须匹配其哈希。费用未知写null；mock模型账单为0不代表操作Agent无成本。

```powershell
node evaluation/tools/cli.mjs validate-run --dir <运行根目录>
node evaluation/tools/report.mjs --run <运行根目录>
# 条件可比时再比较；主表保留首次attempt，不用成功重跑覆盖失败。
node evaluation/tools/report.mjs --run <本次运行根目录> --compare <前次运行根目录>
```

`validate-run` 通过只说明结果契约和引用文件有效，不证明语义评分正确。汇总按体系、划分及current/target呈现，保留未运行和未实现分母。完整任务通过、子场景通过、资产检查通过分别报告。

## 默认边界与常见故障

- 当前默认路线使用合成/脱敏夹具与本机mock。真实模型基线须具备用户已授权的服务、材料范围和预算；已有授权不重复询问。缺关键运行条件时集中说明缺项，继续可独立完成的非付费检查，不擅自使用正式密钥或私有历史。
- 电脑操作平台的适用技能与权限要求继续适用。运行完成后只关闭本次启动的测试实例/服务；保留结果，不批量结束用户其他应用。
- 查不到材料先核对实际授权根、inputFiles、专有生成步骤和缓存状态；不要直接向 DogDog 提供答案。应用版本不符先记录启动身份，不把旧快捷方式启动当新版验收。
- 操作工具失效、遮挡或控件缓存失效时重新观察并记录恢复；无法确认动作是否完成时先核对，避免盲目重复发送。
- `holdout` 一旦用于调优或向执行者泄题，记录失去独立验收资格，后续按版本迁入开发回归并补新家族。
- 代理用户认同、mock优质回答或单次前后差异，均不能证明真人满意度、真实模型能力或建议的因果收益。

## 需要更多细节时

- `RUNNER.md`：完整角色协议与mock模式。
- `SCORING.md`：评分锚点、硬门槛与失败归因。
- `AUTHORING.md`：新增或修改案例的契约；仅编写评测资产时读取。
- `PROVENANCE.md`：来源与隐私；`reports/PILOT.md`：已完成的抽样及明确限制。

仅修改本文等运行文档时做格式检查即可，不需要启动产品或执行真实模型评测；改案例或工具后，再运行对应校验和必要回归。
