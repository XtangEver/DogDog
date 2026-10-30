# DogDog v0.1.0 验证记录

日期：2026-10-30（Asia/Shanghai）。

## 已通过

- `npm run build`：TypeScript 检查、主进程/preload 打包、前端构建、原创 SVG 图标转换通过。
- `npm test`：16 项测试通过；覆盖解析去重、调用关联、异常与未知事件、加密推理排除、证据/功能来源校验、API 失败与取消、本地恢复、密钥返回边界、无投诉复盘和明确选择事件行片段。
- `npx playwright test`：4 项桌面端测试通过；覆盖中文路径导入、服务配置、发送前检查、证据回看、复制、重试对比、重启恢复、取消后重试、无效证据拒绝和无投诉复盘。
- `npx playwright test --grep 日常复盘`：补充验证原文 L4–L4 范围在界面选择、实际请求与证据回看中保持一致，1 项通过。
- `node scripts/check-local.mjs`：只读解析 3 份真实本机记录，3 份在检查前后内容哈希一致；未调用模型。随机样本为“修复 ClientV2 启动失败”，另在原生界面成功载入并保存了待确认的任务草稿。
- `node scripts/smoke.mjs --dev`：开发界面加载、IPC 和渲染边界通过；原生界面另确认开发窗口可见。
- `node scripts/smoke.mjs`：打包应用加载成功，`isPackaged=true`，窗口可见，发现 7 份本机记录，渲染错误 0，渲染界面无 Node require。
- `computer-use` 原生检查：Windows 打包窗口、中文界面、会话标题读取、真实任务载入、验收草稿编辑与保存通过。
- `npx electron-builder --win nsis`：Windows x64 安装包生成成功；ASAR 包含主进程、preload 及唯一一套当前前端资源，不含 JSONL 轨迹或用户 settings.json。
- `npm audit --omit=dev`：0 vulnerabilities。

## 交付物

- 安装包：`release/DogDog-Setup-0.1.0.exe`
- 免安装应用：`release/win-unpacked/DogDog.exe`
- 安装包大小：122,773,616 bytes
- SHA-256：`D3B084FA18E79DAC308D580275DBDB54AFC9AD1DF89B877AFF3860B967A53791`
- 说明：`README.md`；自动测试：`tests/`；测试截图：`verification/screenshots/`。

## 验收边界

- 桌面闭环使用本机模拟模型服务验证；测试返回内容不代表真实模型的诊断水平或实际改进效果。
- 当前尚未配置真实模型 API，因此没有发送真实轨迹、生成真实模型诊断或验证实际能力提升；该项仍待配置服务并完成真实任务重试。
- 随机真实样本没有被预设为失败；验收标准草稿已明确标记“待确认”。重点关注可留空，报告可以没有改进项。
- 安装包未签名；已验证打包应用启动，未在这台电脑执行安装/卸载向导。
- 首版不自动合并跨聊天/子 Agent 记录，不自动跟踪功能更新；兼容性依据为已观察并测试的 Codex JSONL 格式。
