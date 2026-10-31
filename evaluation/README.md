# DogDog 分体系评测集 v1

版本：1.0.0；日期：2026-10-31（Asia/Shanghai）。本目录是评测资产，不新增产品功能。

## 产品终点

帮助用户通过持续讨论和历史证据，理解 AI 协作中的有效做法与问题，形成可执行改进，并追踪实际效果。产品围绕话题和持续讨论组织，轨迹是可选证据；支持成功任务复盘，不预设失败或不满意。

终点包含用户可控的协作档案和效果闭环；源码访问、命令执行、修改工程、后台监控不在本评测的产品目标内。外部执行 Agent 的电脑操作权限不等于 DogDog 具有这些权限。

## 资产和体系

96 个核心任务，12 体系各 8 个；每体系 01–06 为开发集，07–08 为独立验收集。同源任务、反事实变体不得跨侧。完整索引见 [COVERAGE.md](COVERAGE.md) 和 [catalog.json](catalog.json)。任务存在不代表产品已具备或通过该能力。

本机已封装的六个独立ZIP及分发方式见 [PACKAGES.md](PACKAGES.md)。

| 体系                  | 核心验收对象                             |
| --------------------- | ---------------------------------------- |
| 01 初次使用与配置     | 用途、协议/服务/目录配置、错误恢复与授权 |
| 02 轨迹理解与兼容     | 格式、去重、工具结果、缺失/压缩/截断     |
| 03 自主发现与检索     | 自然问题、归档、分页、近义词、项目和干扰 |
| 04 证据与推断边界     | 语义支持、反证、冲突、未知、因果边界     |
| 05 持续对话与需求理解 | 澄清、纠错、切换话题、表达偏好与续聊     |
| 06 复盘与改进建议     | 有效做法、优先问题、可执行及可验证建议   |
| 07 报告与效果闭环     | 版本修订、后续尝试、采纳/实施/效果区分   |
| 08 可控协作档案       | 确认、查看、修改、删除、过时及冲突处理   |
| 09 桌面交互与使用负担 | 可发现性、中文输入、证据、等待、纠错负担 |
| 10 权限、隐私与对抗   | 发送范围、凭据、撤权、提示注入和路径边界 |
| 11 状态、异常与恢复   | 取消、断流、预算、损坏、崩溃及恢复       |
| 12 协议、发布与规模   | 协议、实际入口、升级、规模和资源         |

`current` 表示当前承诺，`target` 表示理想能力目标；分榜报告。目标能力尚未实现时记录 `not_implemented` 和检查依据，不视为通过、不从覆盖率中消失。当前缺陷仍应按客观标准判失败，不因实现限制降低要求。

- `cases/`：内部任务卡，含用户简报、环境和验收入口。
- `fixtures/`：可控合成/脱敏改编轨迹与必要准备材料；只把 JSONL 输入复制到授权检索根目录。
- `oracles/`：独立事实底稿、反证、未知、评分锚点与正反例。
- `schemas/`：任务、底稿、运行清单和结果的 JSON Schema。
- `tools/`：校验、生成索引、分角色打包、隔离准备、本机 mock 与抽样试跑。
- `reports/`：检查过的合成数据试跑报告；`runs/` 和 `packages/` 默认忽略。

## 可复现命令

在仓库根目录，使用已有 Node.js/npm 锁定依赖；不需要新增依赖：

```powershell
node evaluation/tools/cli.mjs validate
node evaluation/tools/cli.mjs matrix
node --test evaluation/tools/tooling.test.mjs
node evaluation/tools/cli.mjs pack --role runner --split development
node evaluation/tools/cli.mjs pack --role setup --split development
node evaluation/tools/cli.mjs pack --role reviewer --split development
node evaluation/tools/cli.mjs prepare --case DD-03-01 --out D:/dogdog-eval-runs/query-01
node evaluation/tools/report.mjs --run <运行目录> --compare <前版本运行目录>
```

输出目录必须是全新目录；不要为重跑清空已有结果。独立验收时把 `development` 替换为 `holdout`，在全新执行上下文使用。执行用户只拿 runner 包；环境准备者拿 setup 包；审查者拿 reviewer 包。文件分包不是访问控制沙箱，真正盲测还需隔离上下文和工作目录权限。作者或已经看过底稿的运行必须标记非盲。

mock 服务：

```powershell
node evaluation/tools/mock-service.mjs --out D:/dogdog-eval-runs/mock-01 --mode text
```

服务仅监听 `127.0.0.1`；地址写入 `status.json`。配置 `/responses`、`/chat` 或 `/messages` 对应协议，API Key 使用任意合成占位符。`requests.jsonl` 含合成请求正文及凭据摘要，不保存鉴权头原文；不得用于真实私有材料。详见 [RUNNER.md](RUNNER.md)。

抽样运行：`node evaluation/tools/pilot.mjs`。默认只使用隔离合成轨迹和本机模拟服务。它是已知场景的非盲桌面兼容性试跑，不是现实模型诊断质量基线；原生电脑代理证据单独记录。详见 [reports/PILOT.md](reports/PILOT.md)。

## 适用边界

自动检查、模型辅助评分和电脑代理复核可完成本套流程，但代理用户满意、mock 返回优质答案、单次前后改善均不能证明真人满意度、真实模型能力或建议因果效果。实际收益只能报告可观测的后续结果与不确定性。

评测根源见 [PROVENANCE.md](PROVENANCE.md)，评分和失败归因见 [SCORING.md](SCORING.md)，角色操作与升级比较见 [RUNNER.md](RUNNER.md)。不修改生产设置，不运行付费真实模型基线，不将原始私有历史提交或发往模型。
