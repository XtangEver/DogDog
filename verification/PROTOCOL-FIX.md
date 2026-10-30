# 完整 URL 与双协议修复验证

日期：2026-10-30（Asia/Shanghai）。

## 变更及依据

- 已确认旧代码无条件追加 `/chat/completions`，且仅解析 `choices[0].message.content`；这两处行为与完整 URL、Responses / Anthropic 响应格式不兼容。没有调用用户的真实服务，不能确认截图错误是否还包含其他服务端原因。
- `src/core/diagnosis.ts`：URL 校验后仅去除首尾空白，保留完整路径及末尾斜杠，不拼接路径；继续拒绝内嵌用户名/密码、查询参数、片段和非 HTTP(S) 地址。
- OpenAI Responses：Bearer 鉴权，发送 `instructions`、`input`、`stream: false`、`store: false`；读取 `output` 中 message 的 `output_text` 内容，跳过 reasoning 等项目。
- Claude / Anthropic Messages：`x-api-key` 与 `anthropic-version: 2023-06-01` 鉴权/版本头，发送独立的 `system`、user `messages` 和 `max_tokens: 8192`；只解析 `content` 中的 text 块，跳过 thinking。
- 保留原有 Chat Completions 协议。设置持久化协议，发送前预览显示协议和实际 URL；旧设置按已知完整路径推断协议，自定义路径可以手动选择。旧 `/v1` 基础地址必须手动改为完整接口地址。
- 截断、拒答、无文本、协议不匹配与超过 2 MB 的响应明确失败；无效 JSON 不回显服务响应。所有协议继续校验证据和功能来源，不保存无效报告。
- 加密密钥、显式发送确认、禁止重定向、120 秒超时和取消行为保留。

字段核对依据：official OpenAI documentation 的 [Text generation / Responses](https://developers.openai.com/api/docs/guides/text) 与 [Anthropic Messages（2023-06-01）](https://platform.claude.com/docs/en/api/messages/create?version=2023-06-01)。

## 验证结果

- `npm test`：23 项通过。新增完整 URL、协议请求体与鉴权、多文本块及推理块解析、截断/拒答/伪造证据拒绝、无效响应不泄露原文、2 MB 上限、旧设置迁移与协议恢复测试。
- `npm run build`：类型检查、主进程/preload 打包和前端构建通过。
- `npx playwright test`：6 项桌面测试通过。两种新协议均通过本机模拟 HTTP 服务完成完整 URL（含代理路径及末尾斜杠）、发送确认、诊断、协议/URL/加密密钥重启恢复验证；原有导入、证据回看、重试对比、取消与无效报告拒绝回归通过。
- `npx prettier --check "src/**/*.{ts,tsx,css}" "tests/*.ts" "scripts/*.mjs"`：全部通过。
- `npx electron-builder --win nsis --config.directories.output=release/protocol-fix`：Windows x64 安装包生成成功。使用独立输出目录，保留当前运行的旧应用。
- 打包应用隔离启动检查通过：`isPackaged=true`，可选择 Responses / Anthropic 协议并切换对应 URL 占位提示，renderer 无 Node require，渲染错误 0。记录见 `protocol-packaged-smoke.json`。
- 设置与发送预览截图：`screenshots/protocol-openai-responses-settings.png`、`screenshots/protocol-openai-responses-preview.png`、`screenshots/protocol-anthropic-settings.png`、`screenshots/protocol-anthropic-preview.png`；打包截图：`screenshots/protocol-packaged-settings.png`。

## 交付与限制

- 安装包：`release/protocol-fix/DogDog-Setup-0.1.0.exe`。
- 免安装应用：`release/protocol-fix/win-unpacked/DogDog.exe`。
- 安装包：122774090 bytes；SHA-256：`198F97D0DBDA1F68B0C9D3E3E6874D4178E4BE28A555FEE9262BFFB3EAA5BF6E`。
- 模型请求验证使用隔离测试数据与模拟服务；未使用用户密钥、发送真实轨迹或完成真实服务验证。非标准网关兼容性尚无法确认。
- 安装包未签名，未执行安装向导；当前已运行的旧应用不会自动加载新构建。
