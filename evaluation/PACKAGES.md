# v1 角色分包

以下为本机已生成的独立目录与ZIP；内容由最终版本任务卡生成。归档与运行目录被Git忽略，源码中的任务、底稿和工具均保留，可重新生成。校验摘要见 [index.json](packages/v1/index.json)。

| 角色     | 开发集72例                                                       | 独立验收集24例                                           |
| -------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| 模拟用户 | [runner-development.zip](packages/v1/runner-development.zip)     | [runner-holdout.zip](packages/v1/runner-holdout.zip)     |
| 环境准备 | [setup-development.zip](packages/v1/setup-development.zip)       | [setup-holdout.zip](packages/v1/setup-holdout.zip)       |
| 独立审查 | [reviewer-development.zip](packages/v1/reviewer-development.zip) | [reviewer-holdout.zip](packages/v1/reviewer-holdout.zip) |

模拟用户只获得runner包和准备者交付的启动信息；不要把setup/reviewer包放进同一个执行上下文。setup包内可直接运行 `node tools/prepare-package.mjs --case <ID> --out <全新目录>`。只授权生成的codex/sessions与archived_sessions，其他材料不进入DogDog可检索目录。reviewer包含完整任务、底稿、夹具和评分/复核说明。

再生成时选择全新输出目录，保留历史包：

```powershell
node evaluation/tools/cli.mjs pack --role runner --split development --out <新目录>/runner-development
node evaluation/tools/cli.mjs pack --role setup --split development --out <新目录>/setup-development
node evaluation/tools/cli.mjs pack --role reviewer --split development --out <新目录>/reviewer-development
```

独立验收包把split改为holdout。分包的文件级分离不能代替操作系统权限和上下文隔离；读过底稿的作者/执行者必须标为非盲测。
