# DogDog 评测集 v1：交付与抽样验证

日期：2026-10-31（Asia/Shanghai）。本次交付评测集与执行设施，没有修改产品功能或正式配置，没有发送私有轨迹，没有运行付费真实模型基线。

## 资产结果

- 12体系、96核心任务：72开发＋24独立验收；84项当前承诺、12项未来目标；另含26个反事实变体。
- 每任务包含用户背景、条件式回应、环境、步骤、结束条件、必须/禁止行为；独立底稿包含事实行号、反证、未知、三级锚点及正反/不同合理示例。
- 6个角色包：runner/setup/reviewer × development/holdout；分包具有文件哈希，setup包带独立prepare入口与必要mock依赖。真正盲测仍需分离执行上下文和文件权限。
- 已修复交叉审阅发现的简报泄题、提前暴露后续材料、缺must仍可pass、mock冒充语义通过、target仅测普通聊天等问题。参见 [交叉审阅](CROSS-REVIEW.md) 和 [评分校准](CALIBRATION.md)。

## 实际验证

| 检查             | 实际结果                                                       | 边界                                                      |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| suite validate   | 96任务，0错误、0警告                                           | 格式、来源、引用字面、分组和覆盖约束，不等于语义正确      |
| tooling tests    | 8项通过                                                        | 路径、角色泄漏、错误成功声明、mock凭据摘要、延后输入等    |
| content QA       | 32任务、201夹具、98物理行引用及parser断言通过                  | 仅02/03/04/06的内容与真实解析器验证                       |
| desktop asset QA | 17项通过；生成/解析1186份授权JSONL、9种HTTP模式等              | 准备流程和mock可执行性，不是32张桌面任务通过              |
| 评分校准         | 其他作者64例筛查，其中17例深评、47例仅筛查；发现争议均修复复核 | 不声称96例已完成独立全语义校准                            |
| 桌面诊断试跑     | 8条子场景检查通过，8个核心结果仍为insufficient_evidence        | mock、非盲、Playwright工程轨道                            |
| 原生电脑代理     | 自然输入、Enter发送、双来源检索、引用原文回看完成              | mock、非盲；仅代理抽样，核心结果仍为insufficient_evidence |
| 产品基线检查     | npm test：48项通过；npm run build：通过                        | 复用现有测试，不代表真实模型能力或整体体验通过            |

独立setup包实际抽查：开发包DD-03-06只把初始library文件放入授权根，更新文件留在deferred-fixtures；保留包DD-12-08可独立prepare并生成有效旧复盘，旧source不进入授权根。全部准备目录均为新的隔离目录。

可复现命令：

```powershell
node evaluation/tools/cli.mjs validate
node --test evaluation/tools/tooling.test.mjs
node evaluation/tools/check-content.mjs
node evaluation/tools/check-desktop-assets.mjs
node evaluation/tools/pilot.mjs
node evaluation/tools/cli.mjs validate-run --dir evaluation/reports/pilot
node evaluation/tools/cli.mjs validate-run --dir evaluation/reports/native
```

## 八条诊断子场景与证据

冻结运行：[manifest](pilot/manifest.json)、[汇总](pilot/summary.json)、[事件](pilot/events.jsonl)、[96任务状态表](pilot/SUMMARY.md)、[独立复核](PILOT-REVIEW.md)。截图、诊断会话及请求正文只包含检查过的合成材料；未复制任何profile凭据文件。

| 子场景        | 已观察结果                                                              |
| ------------- | ----------------------------------------------------------------------- |
| P01 配置      | 新profile通过公开控件保存loopback服务、协议、合成凭据与发送许可         |
| P02 检索      | 未手动关联，mock驱动发现/搜索/读取，出现两来源引用，干扰正文未发送      |
| P03 原文      | 逐一回看两份来源和哈希，不预设S1/S2的排序                               |
| P04 追问      | ask_user暂停后接收补充并继续，验收条件显示于回答                        |
| P05 报告恢复  | UI保存报告，重启后报告入口与原引用存在                                  |
| P06 取消      | 部分文本保留并标未完成；600ms窗口内无新增请求                           |
| P07 撤权      | 撤销隔离许可后请求被阻止，服务计数不增加                                |
| P08 身份/只读 | development Electron的业务版本0.3.0，记录exe/bundle哈希，原夹具哈希保持 |

共7次本机模型POST。8个子场景不是各自关联核心任务的全部验收，故不得转换为8个核心pass；96个完整任务尚未执行。安装版、快捷方式、真实模型自主检索及真人体验未由本次试跑验证。

## 原生电脑代理证据

使用computer-use的sky接口，通过当前窗口观察、点击、输入、Enter及引用按钮操作；没有DOM注入、私有IPC、源码或持久化文件辅助完成。环境与mock由准备者提前配置。证据：[事件](native/events.jsonl)、[回答观察](native/answer-tree.txt)、[引用观察](native/evidence-tree.txt)、[结果](native/result.json)、[manifest](native/manifest.json)。

提交的可访问性文本树副本仅移除行尾空白；截图和语义内容保持不变，原始捕获保留在本机忽略的运行目录。

首次UIA控件缓存不可用，刷新窗口绑定后恢复；helper焦点返回文档根时，通过屏幕中光标和实际输入文本核对。该工具故障与恢复保留记录，不归为产品失败。结果为非盲代理抽样，不代表完整DD-03-01通过。

![原生代理自然提问](native/answer.jpg)

![原生代理引用回看](native/evidence.jpg)

## 故意失败与首次尝试

- [G01](pilot/intentional-failure.json)：故意使用请求数=-1的错误评分断言，记录grading_dispute，不冒充产品失败；它只验证这一已知错误断言的归类。
- 工具测试及[交叉反例](cross-review-selftest.json)另验证遗漏must、虚构check、缺禁止行为/维度、mock语义pass、错误runId等会被拒绝。
- [首次选择器错误](attempts/initial-selector-error.json)：把带“＋”按钮写成精确名称导致选择器未命中，属于执行脚本问题。
- [后续首次尝试事件](attempts/source-order-and-modal.jsonl)：原先错误假定S2一定是复测，并因残留弹窗产生后续阻塞；修为逐一回看、清理任务间模态状态后再运行。固定mock回答也改成中性双引用汇总，避免排序假设。首次记录没有被覆盖。

## 保留限制

本交付未获得真人满意度、真实模型质量、长期建议收益或因果效果的基线。可控档案和部分结构化效果闭环仍为target，应在运行时依据实际版本记not_implemented。完整运行、独立保留集和真实服务评测需要使用本套角色/证据契约另行执行，不能从资产校验或mock示例推导通过。
