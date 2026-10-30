# 新版安装与测试记录

日期：2026-10-30（Asia/Shanghai）。

## 安装结果

- 经用户授权运行 `release/protocol-fix/DogDog-Setup-0.1.0.exe /S`，安装程序退出码为 `0`。
- 安装路径：`C:\Users\Administrator\AppData\Local\Programs\DogDog\DogDog.exe`；Windows 卸载注册项为 `DogDog 0.1.0`。
- 已安装的 `resources/app.asar` 与修复构建的 SHA-256 相同：`53D4939F0D5CBAE864FB02240378A8ABFDD953A4F94FF1FE03668CF1FB51FA53`。
- 已启动安装路径中的应用；原生窗口显示协议选择与完整 URL 提示，既有 3 份复盘草稿可见。
- 既有 `settings.json` 未改写，测试前后 SHA-256 均为 `D0BEC699B9027757F6356B2C078FB9C43EE2A0E5F6880B95DF65E1B8F7CD4C45`。

## 安装版回归测试

`tests/desktop.e2e.ts` 新增 `DOGDOG_E2E_EXE` 可选参数，允许直接测试安装后的可执行文件；默认仍测试本地构建。

执行命令：

```powershell
$env:DOGDOG_E2E_EXE = "C:\Users\Administrator\AppData\Local\Programs\DogDog\DogDog.exe"
npx playwright test
```

结果：6 项通过，耗时 13.4 秒。所有桌面用例均启动已安装的应用，使用隔离临时用户目录及本机模拟 HTTP 服务：

- OpenAI Responses 与 Anthropic Messages：完整 URL（含代理路径、末尾斜杠）、鉴权、发送预览、响应解析、诊断保存和重启恢复。
- 原有 Chat Completions：导入、证据、复制、重试对比、密钥加密与重启恢复。
- 取消后重试、无效证据拒绝、无投诉复盘。

补充验证：`npm run typecheck`、`npm test`（23 项）及 `npx prettier --check tests/desktop.e2e.ts` 均通过。

截图位于 `verification/screenshots/protocol-*-settings.png` 与 `protocol-*-preview.png`，内容为隔离测试数据。

## 安装后初次检查时的真实接口测试条件

当前真实用户配置只保存了以 `/api/v1` 结尾的地址、模型名及输入上限；没有保存 API Key，也没有显式协议字段。应用已打开「模型设置」等待用户补齐完整 URL、协议及密钥。

截至该次检查，尚未向真实服务发送请求或用户轨迹；模拟服务通过不能证明真实服务兼容。

用户随后完成密钥配置，真实服务测试及完整 URL 修正均已完成，见 [真实服务验证记录](REAL-MODEL-TEST.md)。
