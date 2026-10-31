# v0.3.0 打包版端到端重试

日期：2026-10-31（Asia/Shanghai）。

## 结论

自主检索与持续对话的核心功能通过本次验收；仍有回答风格及本机部署状态两项限制，不能据此声称全部使用体验已经满足。

| 验收项 | 本次结果 | 依据 |
| --- | --- | --- |
| 未关联轨迹，直接按 Enter | 通过；没有旧发送范围确认弹窗 | 三协议桌面用例、真实模型第一轮 |
| 自主发现当前及归档轨迹 | 通过；无需提供文件路径或要求模型调用指定工具 | 真实自然问题“之前鼠标移动缓慢如何解决？” |
| 查上下文并关联原文 | 通过；第一轮 3 次请求，返回 S1/S2 引用 | 真实模型结果及引用回看截图 |
| 跨轨迹追问 | 通过；第二轮 2 次请求，重新读取两份原文 | 问题“后来有复测吗？请结合原文核对修复与复测的记录。” |
| 原文回看、报告保存、重启续聊 | 通过；哈希及 DPI 原文可回看，报告和来源恢复，重启后直接 Enter | 真实模型结果、原文及恢复截图 |
| 取消、撤权、超预算、异常引用、旧版复盘 | 通过 | 打包版 16 项桌面测试全部通过，无跳过、失败或重试通过 |
| 无关材料及正式配置 | 干扰正文未发送；原始文件和正式设置未改写 | 真实模型脚本的请求检查及哈希比较 |

## 本次证据

- 实际执行文件：`release/v0.3.0/win-unpacked/DogDog.exe`，应用自报版本 `0.3.0`，Windows 产品版本 `0.3.0.0`；不是开发态 Electron。
- [16 项桌面测试 JSON](playwright.json)：expected=16，unexpected=0，skipped=0，flaky=0，耗时约 40.9 秒。覆盖 Responses、Anthropic Messages 和 Chat Completions，服务为本机模拟 HTTP。
- [真实模型结果](v03-real-library.json)：GLM-5.3，OpenAI Responses，`success=true`；仅使用隔离合成轨迹，没有发送真实私有轨迹。保存的回答文本可用于核对下面的风格问题。
- [首次自然提问](screenshots/v03-real-first.png)、[跨轨迹追问](screenshots/v03-real-glm.png)、[引用回看](screenshots/v03-real-evidence.png)、[重启恢复](screenshots/v03-real-restored.png)。
- [产物与本机版本信息](environment.json)；安装包为 `release/v0.3.0/DogDog-Setup-0.3.0.exe`，SHA-256：`F3204F4CA2CD8D3F4C5E24B5A2FEAEA36B983DF88E4D63F4C5E3228A59724900`。
- 构建、打包、类型检查、Prettier 和 `git diff --check` 均通过。

## 尚未满足的部分

1. **回答风格**：真实首轮回答虽然找到了证据，但仍输出了长篇排查建议、无线鼠标/电池等没有被问到的泛化内容，并追加了询问。功能性工具检查不会将这种回答判为失败；本次没有修改生产提示词，因此该问题仍存在。
2. **桌面快捷方式未更新**：桌面和开始菜单快捷方式均仍指向 `C:\Users\Administrator\AppData\Local\Programs\DogDog\DogDog.exe`，实测产品版本 `0.1.0.0`。本次生成并验证了 v0.3.0 包，没有覆盖已安装应用或改动正式设置。点击原快捷方式不能代表运行的是本次新版本。
3. 本次真实服务只覆盖 Responses 和合成轨迹；真实私有历史上的检索召回、诊断质量及大型目录性能没有在本次试验中验证。

## 复现命令

```powershell
npm run build
npx electron-builder --win nsis --config.directories.output=release/v0.3.0
$env:DOGDOG_E2E_EXE = (Resolve-Path release/v0.3.0/win-unpacked/DogDog.exe).Path
$env:DOGDOG_SCREENSHOT_DIR = "verification/retest-v03/mock-screenshots"
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = "verification/retest-v03/playwright.json"
npx playwright test --reporter=list,json
$env:DOGDOG_VERIFY_DIR = "verification/retest-v03"
node scripts/check-library-real.mjs
```

真实模型命令需要 `GLM_API_KEY`；该密钥仅供隔离验证配置使用。完整请求历史被 Git 忽略，历史版本截图未覆盖。

首次真实重试因验证脚本选取首个引用 `S1:L2`（任务描述行），却断言该行包含 DPI 数值而停止；修正脚本为选择实际含 DPI 结果的引用后，完整重试通过。首次结果保留于 [attempt-1.json](attempt-1.json)，不是产品检索失败。本轮生产代码未改动，只完善了验证脚本和证据输出隔离。
