# DogDog（狗狗）

陪你持续讨论与复盘 AI Agent 协作的 Windows 桌面应用。直接提问后可自主检索本机 Codex 当前和归档轨迹，按问题查证、追问背景，保留有证据的结论与待验证的改进机会。

## 使用

当前源码版本为 v0.3.0，执行 `npm run build` 后 `npm start`。历史 v0.2.0 安装包为 `release/v0.2.0/DogDog-Setup-0.2.0.exe`，免安装程序为 `release/v0.2.0/win-unpacked/DogDog.exe`；也可在本仓库执行 `npm run build` 后 `npm start`。安装包未签名。

### 持续对话（默认界面）

1. 在「模型设置」填写协议、完整接口 URL、模型名和 API Key，检查 Codex 轨迹目录（每行一个绝对路径），勾选「允许检索并发送相关片段」并保存。旧配置不会自动升级成目录发送授权，需要确认一次。
2. 直接提问并按 Enter；狗狗可自主发现、搜索当前与归档轨迹，再读取相关上下文，无需先找文件或手动关联。通用方法仍可直接讨论。
3. 权限适用于新讨论与重启。新轨迹、追问、模型名变化不重复确认；修改目录或服务会清除表单中的勾选，需要重新确认。取消勾选并保存即可撤销发送权限。
4. 「发送预览」可主动检查首次请求与来源范围，「发送记录」可检查实际请求；只按需发送命中片段与上下文，不把整个轨迹库发送给模型。
5. 命中会自动建立固定证据快照，引用如 `S1:L4` 可回看对应哈希及原文。原文件变化后，新搜索读取更新版本；历史引用保留旧版本。手动关联和刷新入口继续保留。
6. 完整回答可多版本保存为报告；对话、证据、追问均可重启恢复。目录授权变化、来源撤销或刷新后，后续模型上下文重新开始，避免发送旧内容；取消及中断不会自动重发。

### 旧版复盘

侧栏「旧版复盘」保留 v0.1 的流程及既有数据；旧协议修复构建位于 `release/protocol-fix/`，历史验证见 [协议修复验证](verification/PROTOCOL-FIX.md)。

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

历史 v0.2 新增三种协议的 SSE、工具循环、多来源证据、授权失效、追问恢复、部分回答取消与报告版本测试。v0.3 使用 `node scripts/check-library-real.mjs` 进行显式真实服务测试：主进程在隔离配置中读取 `GLM_API_KEY`，仅发送脚本生成的合成轨迹，默认使用 `GLM-5.3` 与 `https://open.bigmodel.cn/api/v1/responses`。不会改写正式配置；完整请求历史只保留本地，当前汇总与截图见 [v0.3 验证](verification/V0.3.md)，历史记录见 [v0.2 验证](verification/V0.2.md)。

`node scripts/check-local.mjs` 对本机随机选取的一份及另外两份 Codex 记录进行只读格式验证；报告 `verification/local-format-check.json` 仅含路径与统计，不含轨迹正文，不纳入版本管理。

## 数据与接口边界

- 默认检索 `$CODEX_HOME` 或 `%USERPROFILE%\.codex` 下的 `sessions`、`archived_sessions`，可在设置调整。Agent 不受界面最近 150 份列表限制；每次扫描最多 30000 项、12 层目录，达到上限或文件无法读取时明确提示。来源只读，单文件上限 100 MB；不跟随符号链接或目录联接。标题检索使用轨迹解析器提取的首条用户消息；界面列表另可使用 `session_index.jsonl` 的标题。
- 复盘保存在 Electron `userData/reviews` 中，Windows 默认位置通常为 `%APPDATA%\DogDog\reviews`，实际路径可在模型设置查看。包含所选事件快照、行号、任务、报告和重试结果；导出 JSON 同样包含轨迹快照。未加密的快照只存本机，删除相应复盘 JSON 可清理记录。
- 持续对话另存于 `userData/conversations`，包含讨论、全部关联快照（包括移除后的历史版本）、工具记录、实际请求及报告；同样为未加密的本地文件。移除来源仅撤销后续模型访问，不删除历史证据；清理整段讨论需删除对应 UUID 的 JSON 文件。
- 增量文件清单与按文件解析缓存位于 `userData/trace-index`，包含未加密的本机轨迹正文。按大小、修改与变更时间刷新；损坏缓存从原文件重建。撤权不删除本机历史及缓存，但工具不再读取撤销目录的缓存，旧上下文不再发送。
- API Key 使用 Electron `safeStorage` 和 Windows DPAPI 加密。用户输入仅短暂存在于设置表单和 IPC 调用中，保存后清空；主进程不把已保存密钥返回界面。更换服务地址会清除旧密钥，避免自动向新服务传递凭据。
- 持续对话在设置中确认目录、目标服务与发送权限后，按用户问题运行模型循环；旧版在点击「发送并开始诊断」后发起请求。主进程调用网络；渲染进程禁用 Node，启用 context isolation 和 sandbox，IPC 限定方法、来源和输入；外链仅允许内置官方指南。
- Agent 工具可检索获准目录及此对话的有效手动导入来源，不能执行命令、读取项目源码或操作任意路径。原始轨迹中的指令视为待分析数据，不构成授权；没有后台监控或跨对话长期记忆。
- 请求不跟随 HTTP 重定向，不记录鉴权头或原始服务错误。输入默认上限 60000 字符，持续对话按包含指令、历史、工具定义与结果的完整请求计数；超限明确失败，不静默截断。工具分页会显式返回下一位置。每次模型请求超时 120 秒，每轮最多 12 次请求（含追问后的续写），支持停止和手动继续；客户端取消不保证服务端停止计算或计费。
- Agent 的最终引用只能使用本轮工具实际返回的事件；无效引用、断流或取消的文本保留为未完成，不可保存成报告。旧版另校验 JSON 字段、建议数量、证据与功能来源 ID。结构校验与引用存在性不能证明语义正确，仍需结合原文和实际结果判断。

## 诊断依据与限制

解析器适配本机已观察到的 Codex JSONL 事件，包含消息、工具调用/结果、轮次上下文与累计 token；去重镜像事件、保留源行号。历史格式、截断、缺失工具结果和未知事件会提示。加密推理不解析；可显式关联多份快照进行比较，但不自动发现关联聊天/子 Agent 或重建其因果关系；这不是对所有 Codex 版本的兼容承诺。

功能指南记录来源、核验日期和适用条件，位于 `src/shared/guides.ts`；首版不自动追踪新功能。来源包括 [Codex 工作流](https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex)、[Goals](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) 与 [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)。模型接口参考 official OpenAI documentation 的 [Responses](https://developers.openai.com/api/docs/guides/text)、[Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) 和 [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create?version=2023-06-01)，密钥存储参考 [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。

轨迹未出现某行为不证明用户没使用某功能；更换模型属于待验证建议；单次前后比较不证明因果。轮次、工具数和日志时间跨度仅作辅助指标，token 显示为来源日志的全会话累计值，不计算提升百分比。

真实模型效果与使用能力提升尚需通过用户配置的服务和后续实际任务验证；模拟服务测试不替代这一验收。
