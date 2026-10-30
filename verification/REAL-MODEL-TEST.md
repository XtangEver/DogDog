# 真实模型接口验证

日期：2026-10-30（Asia/Shanghai）；响应成功时间约 22:19:37。

## 结果

- 已安装应用调用真实 `GLM-5.3` 服务成功：OpenAI Responses 协议，HTTP 200，端到端耗时 84441 ms。
- 请求的完整 URL：`https://open.bigmodel.cn/api/v1/responses`。
- 真实模型返回的诊断通过应用的结构及证据 ID 校验；得到 2 项有效做法、2 项改进建议，证据引用均在合成轨迹范围内。
- 数据：`real-model-check.json`；真实返回的合成任务报告：`real-model-synthetic-report.json`；截图：`screenshots/real-model-check.png`。
- 使用独立临时用户目录、合成 JSONL 与显式发送预览；只向用户指定的智谱服务发送合成任务，不发送用户的私有轨迹。密钥由已安装应用的主进程解密，未返回界面、写入日志或报告。

## 地址问题与配置修正

- 用户刚保存的配置地址为 `https://open.bigmodel.cn/api/v1`。应用按完整 URL 原样请求该地址，服务返回 HTTP 200，但响应不符合 Responses 结构，应用明确报协议不匹配。证据：`real-model-configured-url-check.json`。
- 智谱官方 [Responses 接入示例](https://docs.bigmodel.cn/cn/guide/develop/responses/introduction) 的 cURL 使用 `https://open.bigmodel.cn/api/v1/responses`；文档中的 `/api/v1` 是 SDK 基础 URL，并非直接 POST 的完整接口 URL。
- 在隔离配置中改用完整端点后，真实诊断成功；测试过程中原用户配置未改写（JSON 记录中的 `originalConfigUnchanged: true` 对应该阶段）。
- 成功后已将用户保存的地址修正为上述完整端点；协议仍为 `openai-responses`，模型仍为 `GLM-5.3`，保留原加密密钥。新旧 URL 的 origin 完全相同。原加密设置备份为用户数据目录中的 `settings.json.before-endpoint-fix.bak`，未纳入项目。
- 观察到用户正在编辑真实任务，未重启或关闭用户窗口；诊断和发送预览的主进程每次读取保存的设置，因此后续请求使用修正后的地址。

## 验证边界

- 本次真实验证覆盖当前密钥、模型与 Responses 端点；Anthropic Messages 仍以此前已安装应用的模拟服务回归测试为证据，未声称已验证真实 Anthropic 服务。
- 报告结构与证据引用校验通过，不代表已证明诊断语义或建议效果；未执行用户真实任务的复盘。
- 新增 `scripts/check-real-model.mjs` 支持重跑该合成任务验证；可选 `--endpoint` / `--protocol` 仅修改隔离测试配置。脚本的语法检查与 Prettier 检查通过。
