# 桌面评测资产可执行性检查

命令：`node evaluation/tools/check-desktop-assets.mjs`。执行时间：2026-10-31T03:48:53.759Z。

**本报告仅验证评测基础设施和合成夹具；未启动或操作 DogDog UI，不代表桌面任务通过、真实模型语义质量或真人体验已验证。**

- PASS：DD-01-07 prepare/seed + current parser；授权 JSONL=1
- PASS：DD-01-08 prepare/seed + current parser；授权 JSONL=2
- PASS：DD-12-05 prepare/seed + current parser；授权 JSONL=181
- PASS：DD-12-06 prepare/seed + current parser；授权 JSONL=2
- PASS：DD-12-07 prepare/seed + current parser；授权 JSONL=1000
- PASS：DD-12-08 prepare/seed + current parser；授权 JSONL=0
- PASS：DD-01-02 controlled HTTP mode
- PASS：DD-12-02 controlled HTTP mode
- PASS：DD-12-03 controlled HTTP mode
- PASS：DD-11-04 controlled HTTP mode
- PASS：DD-11-07 controlled HTTP mode
- PASS：DD-11-03 controlled HTTP mode
- PASS：DD-12-01 controlled HTTP mode
- PASS：DD-11-01 controlled HTTP mode
- PASS：DD-11-08 controlled HTTP mode
- PASS：legacy-review validated by current validateReview
- PASS：full suite structural validation；tasks=96，errors=0，warnings=0

共 17 项通过；失败 0。每次使用系统临时目录中的全新隔离目录，详情见 [JSON结果](DESKTOP-ASSET-QA.json)。不改产品源码、正式配置或私有轨迹。
