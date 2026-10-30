# DogDog（狗狗）

陪你复盘 AI Agent 协作的 Windows 桌面应用。既可以回看失败任务，也可以在没有明显问题时，保留有效做法、发现值得验证的改进机会。

## 使用

运行 `release/DogDog-Setup-0.1.0.exe` 安装，或直接运行 `release/win-unpacked/DogDog.exe`。

本次协议修复构建位于 `release/protocol-fix/`，使用其中的安装包或 `win-unpacked/DogDog.exe`；验证记录见 [协议修复验证](verification/PROTOCOL-FIX.md)。

1. 在「模型设置」选择 OpenAI Responses 或 Claude / Anthropic Messages 协议，填写**完整接口 URL**、模型名和 API Key，例如 `https://your-provider.example/v1/responses` 或 `https://your-provider.example/v1/messages`；应用按原地址发送，不追加路径。保留 Chat Completions 协议供旧接口使用，其地址也需包含完整路径。模型名不预设。
2. 从本机 Codex 会话列表选择任务，或手动导入 JSONL；确认目标与验收标准，按轮次选择复盘范围。单轮内容过长时可展开「精确选择原文行范围」选择片段；「重点关注」可留空。
3. 点击「检查发送内容」，确认范围、目标服务和完整数据后发送。
4. 查看有效做法、最多三个优先改进项和证据原文；复制下一轮提示词，在原 Agent 中重试。
5. 关联重试记录，选择重试轮次，记录采用的建议和验收结果。也可以不采用建议，仅记录后续观察。

旧配置若只填写了 `/v1` 基础地址，需要改为完整接口 URL；旧配置已有 `/responses`、`/messages` 或 `/chat/completions` 路径时会推断相应协议，地址保持原值。自定义路径需在设置中明确选择协议。

草稿需点击「保存草稿」；切换任务和开始诊断时也会保存。保存的轨迹快照仅包含当前所选轮次与事件行片段。已完成诊断的任务描述保持固定；需要修改时，使用「以此任务新建复盘」。重新选择原始会话可读取其他轮次。

## 开发与验证

需要 Node.js 22.12+、npm 和 Windows x64。依赖版本以 `package-lock.json` 为准。

```powershell
npm ci
npm run dev
npm test
npm run test:e2e
npm run package
```

`npm run dev` 提供界面热更新；修改主进程或 preload 后重启开发命令。Electron 二进制在第一次使用时可能需要下载。安装包为未签名的本地测试版本，不提供自动更新。

测试使用隔离的临时数据目录、中文文件路径和本机模拟 HTTP 服务，不发送真实轨迹给外部服务。端到端测试覆盖导入、模型配置、发送预览、证据回看、复制、重试关联、重启恢复、取消、无效证据拒绝及无投诉的日常复盘。界面截图位于 `verification/screenshots/`，诊断内容为测试夹具，不代表真实模型效果。

`node scripts/check-local.mjs` 对本机随机选取的一份及另外两份 Codex 记录进行只读格式验证；报告 `verification/local-format-check.json` 仅含路径与统计，不含轨迹正文，不纳入版本管理。

## 数据与接口边界

- 来源为 `$CODEX_HOME/sessions` 或 `%USERPROFILE%\.codex\sessions`；可选读取 `session_index.jsonl` 中的会话标题。最多列出最近 150 份，其他文件可手动导入。来源文件保持只读，单文件上限 100 MB。
- 复盘保存在 Electron `userData/reviews` 中，Windows 默认位置通常为 `%APPDATA%\DogDog\reviews`，实际路径可在模型设置查看。包含所选事件快照、行号、任务、报告和重试结果；导出 JSON 同样包含轨迹快照。未加密的快照只存本机，删除相应复盘 JSON 可清理记录。
- API Key 使用 Electron `safeStorage` 和 Windows DPAPI 加密。用户输入仅短暂存在于设置表单和 IPC 调用中，保存后清空；主进程不把已保存密钥返回界面。更换服务地址会清除旧密钥，避免自动向新服务传递凭据。
- 仅点击「发送并开始诊断」后发起请求。主进程调用网络；渲染进程禁用 Node，启用 context isolation 和 sandbox，IPC 限定方法、来源和输入；外链仅允许内置官方指南。
- 诊断请求不附带执行工具，不跟随 HTTP 重定向，不记录鉴权信息或服务响应正文。输入默认上限 60000 字符，超限要求缩小范围，不静默截断；超时 120 秒，可取消、手动重试。取消客户端请求不保证服务端停止计算或计费。
- 模型返回 JSON 后校验字段、建议数量、证据 ID 与功能来源 ID；无效报告不保存。结构校验不能证明语义正确，仍需结合证据和重试判断。

## 诊断依据与限制

解析器适配本机已观察到的 Codex JSONL 事件，包含消息、工具调用/结果、轮次上下文与累计 token；去重镜像事件、保留源行号。历史格式、截断、缺失工具结果和未知事件会提示。加密推理不解析，跨聊天或子 Agent 轨迹不自动合并；这不是对所有 Codex 版本的兼容承诺。

功能指南记录来源、核验日期和适用条件，位于 `src/shared/guides.ts`；首版不自动追踪新功能。来源包括 [Codex 工作流](https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex)、[Goals](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) 与 [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)。模型接口参考 official OpenAI documentation 的 [Responses](https://developers.openai.com/api/docs/guides/text)、[Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) 和 [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create?version=2023-06-01)，密钥存储参考 [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。

轨迹未出现某行为不证明用户没使用某功能；更换模型属于待验证建议；单次前后比较不证明因果。轮次、工具数和日志时间跨度仅作辅助指标，token 显示为来源日志的全会话累计值，不计算提升百分比。

真实模型效果与使用能力提升尚需通过用户配置的服务和后续实际任务验证；模拟服务测试不替代这一验收。
