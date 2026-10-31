# DogDog v1 覆盖矩阵

由 `node evaluation/tools/cli.mjs matrix` 生成；覆盖表示存在任务，不代表通过。

| 体系                  | 任务                                                                            | 能力    | 划分        | 需求   | 场景标签                          |
| --------------------- | ------------------------------------------------------------------------------- | ------- | ----------- | ------ | --------------------------------- |
| 01 初次使用与配置     | [DD-01-01 空白安装首次进入与能力边界](cases/01/DD-01-01.json)                   | current | development | R01-01 | normal, missing                   |
| 01 初次使用与配置     | [DD-01-02 完整URL三协议配置与凭据遮蔽](cases/01/DD-01-02.json)                  | current | development | R01-02 | normal, recovery                  |
| 01 初次使用与配置     | [DD-01-03 非法与隐含凭据URL配置纠错](cases/01/DD-01-03.json)                    | current | development | R01-03 | boundary, error, correction       |
| 01 初次使用与配置     | [DD-01-04 未勾选发送权限时明确阻止](cases/01/DD-01-04.json)                     | current | development | R01-04 | boundary, missing, correction     |
| 01 初次使用与配置     | [DD-01-05 变更服务后的授权重置与恢复](cases/01/DD-01-05.json)                   | current | development | R01-05 | normal, boundary, recovery        |
| 01 初次使用与配置     | [DD-01-06 同服务改模型与新增讨论无需重复授权](cases/01/DD-01-06.json)           | current | development | R01-06 | normal, recovery                  |
| 01 初次使用与配置     | [DD-01-07 中文路径原生文件选择与取消](cases/01/DD-01-07.json)                   | current | holdout     | R01-07 | boundary, normal                  |
| 01 初次使用与配置     | [DD-01-08 旧配置缺失新目录授权字段的迁移](cases/01/DD-01-08.json)               | current | holdout     | R01-08 | boundary, recovery                |
| 02 轨迹理解与兼容     | [DD-02-01 镜像工具事件归并且源行号不漂移](cases/02/DD-02-01.json)               | current | development | R02-01 | normal, boundary                  |
| 02 轨迹理解与兼容     | [DD-02-02 旧格式多轮相同文本不能跨轮去重](cases/02/DD-02-02.json)               | current | development | R02-02 | normal, boundary                  |
| 02 轨迹理解与兼容     | [DD-02-03 坏行和未知格式不吞掉后续真实失败](cases/02/DD-02-03.json)             | current | development | R02-03 | error, missing                    |
| 02 轨迹理解与兼容     | [DD-02-04 孤立工具结果与无结果调用保持不确定](cases/02/DD-02-04.json)           | current | development | R02-04 | missing, boundary                 |
| 02 轨迹理解与兼容     | [DD-02-05 压缩和隐藏推理不构成完整历史证据](cases/02/DD-02-05.json)             | current | development | R02-05 | missing, boundary                 |
| 02 轨迹理解与兼容     | [DD-02-06 中断后续写仍沿物理行号恢复查证](cases/02/DD-02-06.json)               | current | development | R02-06 | recovery, missing                 |
| 02 轨迹理解与兼容     | [DD-02-07 分支与主会话不能凭同名任务自动拼接结果](cases/02/DD-02-07.json)       | current | holdout     | R02-07 | conflict, boundary                |
| 02 轨迹理解与兼容     | [DD-02-08 时间元数据和重置计数不能误算累计成本](cases/02/DD-02-08.json)         | current | holdout     | R02-08 | boundary                          |
| 03 自主发现与检索     | [DD-03-01 无预关联自主发现归档中的后续验收](cases/03/DD-03-01.json)             | current | development | R03-01 | normal                            |
| 03 自主发现与检索     | [DD-03-02 按明确项目与日期排除同名任务污染](cases/03/DD-03-02.json)             | current | development | R03-02 | conflict, boundary                |
| 03 自主发现与检索     | [DD-03-03 自然转述无字面命中时调整检索词](cases/03/DD-03-03.json)               | current | development | R03-03 | normal, missing                   |
| 03 自主发现与检索     | [DD-03-04 标题暗示成功但正文有失败不能只读摘要](cases/03/DD-03-04.json)         | current | development | R03-04 | conflict, boundary                |
| 03 自主发现与检索     | [DD-03-05 超过界面150条仍能检索库内深处目标](cases/03/DD-03-05.json)            | current | development | R03-05 | boundary, performance             |
| 03 自主发现与检索     | [DD-03-06 文件变化后重新检索同时保留旧快照引用](cases/03/DD-03-06.json)         | current | development | R03-06 | recovery, correction              |
| 03 自主发现与检索     | [DD-03-07 命中分页与长上下文后段反证不能遗漏](cases/03/DD-03-07.json)           | current | holdout     | R03-07 | boundary, conflict                |
| 03 自主发现与检索     | [DD-03-08 两个可信候选无法消歧时具体追问而非猜测](cases/03/DD-03-08.json)       | current | holdout     | R03-08 | missing, conflict                 |
| 04 证据与推断边界     | [DD-04-01 已修改不等于已验收：保持缺失复测的不确定性](cases/04/DD-04-01.json)   | current | development | R04-01 | missing, boundary                 |
| 04 证据与推断边界     | [DD-04-02 相同物理行号的不同来源不能混用引用](cases/04/DD-04-02.json)           | current | development | R04-02 | conflict, boundary                |
| 04 证据与推断边界     | [DD-04-03 完成声明与工具失败冲突时不选择性取证](cases/04/DD-04-03.json)         | current | development | R04-03 | conflict                          |
| 04 证据与推断边界     | [DD-04-04 单次前后对比只能支持相关而非因果归因](cases/04/DD-04-04.json)         | current | development | R04-04 | boundary, conflict                |
| 04 证据与推断边界     | [DD-04-05 记录缺失不能证明用户从未做过验收](cases/04/DD-04-05.json)             | current | development | R04-05 | missing, boundary                 |
| 04 证据与推断边界     | [DD-04-06 日志内伪造授权和评分提示不得改变查证规则](cases/04/DD-04-06.json)     | current | development | R04-06 | adversarial, conflict             |
| 04 证据与推断边界     | [DD-04-07 跨来源版本冲突要限定适用范围和时间](cases/04/DD-04-07.json)           | current | holdout     | R04-07 | conflict, boundary, correction    |
| 04 证据与推断边界     | [DD-04-08 多个案例也需看反例避免固定用户标签](cases/04/DD-04-08.json)           | current | holdout     | R04-08 | boundary, conflict                |
| 05 持续对话与需求理解 | [DD-05-01 无轨迹咨询不强制导入](cases/05/DD-05-01.json)                         | current | development | R05-01 | normal, boundary                  |
| 05 持续对话与需求理解 | [DD-05-02 必要追问后跨重启继续](cases/05/DD-05-02.json)                         | current | development | R05-02 | missing, recovery                 |
| 05 持续对话与需求理解 | [DD-05-03 用户修正目标后更新分析](cases/05/DD-05-03.json)                       | current | development | R05-03 | correction                        |
| 05 持续对话与需求理解 | [DD-05-04 多轮指代保持证据来源](cases/05/DD-05-04.json)                         | current | development | R05-04 | normal, missing                   |
| 05 持续对话与需求理解 | [DD-05-05 明确简洁偏好与问题边界](cases/05/DD-05-05.json)                       | current | development | R05-05 | normal                            |
| 05 持续对话与需求理解 | [DD-05-06 无足够证据时不强行诊断](cases/05/DD-05-06.json)                       | current | development | R05-06 | missing, boundary                 |
| 05 持续对话与需求理解 | [DD-05-07 冲突验收条件要求取舍](cases/05/DD-05-07.json)                         | current | holdout     | R05-07 | conflict, boundary                |
| 05 持续对话与需求理解 | [DD-05-08 话题切换不携带过期假设](cases/05/DD-05-08.json)                       | current | holdout     | R05-08 | boundary, correction              |
| 06 复盘与改进建议     | [DD-06-01 成功复盘允许只保留有效做法不强行制造缺点](cases/06/DD-06-01.json)     | current | development | R06-01 | normal, boundary                  |
| 06 复盘与改进建议     | [DD-06-02 完成声明早于验收时给出可执行的下一轮协作指令](cases/06/DD-06-02.json) | current | development | R06-02 | conflict                          |
| 06 复盘与改进建议     | [DD-06-03 合理需求变化产生返工不等于最初需求表达失败](cases/06/DD-06-03.json)   | current | development | R06-03 | boundary, correction              |
| 06 复盘与改进建议     | [DD-06-04 建议必须适配离线小团队和时间预算](cases/06/DD-06-04.json)             | current | development | R06-04 | normal, boundary                  |
| 06 复盘与改进建议     | [DD-06-05 无轨迹的一般协作咨询不虚构个人历史](cases/06/DD-06-05.json)           | current | development | R06-05 | normal, missing                   |
| 06 复盘与改进建议     | [DD-06-06 用户改变当前目标后更新建议且保留历史结论](cases/06/DD-06-06.json)     | current | development | R06-06 | correction, recovery              |
| 06 复盘与改进建议     | [DD-06-07 环境故障反证存在时不把失败全归模型能力](cases/06/DD-06-07.json)       | current | holdout     | R06-07 | conflict, boundary                |
| 06 复盘与改进建议     | [DD-06-08 跨任务提炼方法时给出适用条件和后续验证](cases/06/DD-06-08.json)       | current | holdout     | R06-08 | normal, boundary                  |
| 07 报告与效果闭环     | [DD-07-01 完整回答保存报告并重启恢复](cases/07/DD-07-01.json)                   | current | development | R07-01 | normal, recovery                  |
| 07 报告与效果闭环     | [DD-07-02 新增证据生成报告新版本保留旧版](cases/07/DD-07-02.json)               | current | development | R07-02 | normal, correction                |
| 07 报告与效果闭环     | [DD-07-03 旧版复盘草稿与报告兼容回看](cases/07/DD-07-03.json)                   | current | development | R07-03 | normal, recovery                  |
| 07 报告与效果闭环     | [DD-07-04 重试记录对照原验收不宣称因果](cases/07/DD-07-04.json)                 | current | development | R07-04 | normal, boundary, recovery        |
| 07 报告与效果闭环     | [DD-07-05 建议转为可验证改进实验](cases/07/DD-07-05.json)                       | target  | development | R07-05 | normal, missing                   |
| 07 报告与效果闭环     | [DD-07-06 无后续结果保持待验证](cases/07/DD-07-06.json)                         | target  | development | R07-06 | missing, boundary                 |
| 07 报告与效果闭环     | [DD-07-07 负面结果与无效建议保留](cases/07/DD-07-07.json)                       | target  | holdout     | R07-07 | error, correction                 |
| 07 报告与效果闭环     | [DD-07-08 多改动同期发生限制效果归因](cases/07/DD-07-08.json)                   | target  | holdout     | R07-08 | conflict, boundary                |
| 08 可控协作档案       | [DD-08-01 长期档案必须显式确认](cases/08/DD-08-01.json)                         | target  | development | R08-01 | boundary, adversarial             |
| 08 可控协作档案       | [DD-08-02 用户确认偏好后跨重启使用](cases/08/DD-08-02.json)                     | target  | development | R08-02 | normal, recovery                  |
| 08 可控协作档案       | [DD-08-03 查看编辑档案后旧值失效](cases/08/DD-08-03.json)                       | target  | development | R08-03 | correction                        |
| 08 可控协作档案       | [DD-08-04 删除档案后历史不自动复活](cases/08/DD-08-04.json)                     | target  | development | R08-04 | boundary, recovery                |
| 08 可控协作档案       | [DD-08-05 上下文偏好与全局偏好分清](cases/08/DD-08-05.json)                     | target  | development | R08-05 | conflict, boundary                |
| 08 可控协作档案       | [DD-08-06 不从行为推断人格和能力标签](cases/08/DD-08-06.json)                   | target  | development | R08-06 | adversarial, boundary             |
| 08 可控协作档案       | [DD-08-07 档案来源过期与有效性复核](cases/08/DD-08-07.json)                     | target  | holdout     | R08-07 | conflict, correction              |
| 08 可控协作档案       | [DD-08-08 敏感信息与日志注入不构成记忆授权](cases/08/DD-08-08.json)             | target  | holdout     | R08-08 | adversarial, boundary             |
| 09 桌面交互与使用负担 | [DD-09-01 简短历史查询的相关性与表达克制](cases/09/DD-09-01.json)               | current | development | R09-01 | normal                            |
| 09 桌面交互与使用负担 | [DD-09-02 中文输入法组合输入与换行发送](cases/09/DD-09-02.json)                 | current | development | R09-02 | boundary, normal                  |
| 09 桌面交互与使用负担 | [DD-09-03 小窗口高缩放关键操作可达](cases/09/DD-09-03.json)                     | current | development | R09-03 | boundary                          |
| 09 桌面交互与使用负担 | [DD-09-04 长等待过程可理解且可停止](cases/09/DD-09-04.json)                     | current | development | R09-04 | performance, recovery             |
| 09 桌面交互与使用负担 | [DD-09-05 跨来源同号证据点击与返回](cases/09/DD-09-05.json)                     | current | development | R09-05 | boundary, normal                  |
| 09 桌面交互与使用负担 | [DD-09-06 用户纠正后的简洁承接](cases/09/DD-09-06.json)                         | current | development | R09-06 | correction                        |
| 09 桌面交互与使用负担 | [DD-09-07 报告入口发现与版本区分](cases/09/DD-09-07.json)                       | current | holdout     | R09-07 | normal, recovery                  |
| 09 桌面交互与使用负担 | [DD-09-08 发送预览与实际发送记录可理解](cases/09/DD-09-08.json)                 | current | holdout     | R09-08 | boundary, normal                  |
| 10 权限、隐私与对抗   | [DD-10-01 未授权时阻止片段发送](cases/10/DD-10-01.json)                         | current | development | R10-01 | boundary                          |
| 10 权限、隐私与对抗   | [DD-10-02 撤权后旧引文和待执行上下文不再发送](cases/10/DD-10-02.json)           | current | development | R10-02 | boundary, recovery                |
| 10 权限、隐私与对抗   | [DD-10-03 换服务清除授权并隔离旧凭据](cases/10/DD-10-03.json)                   | current | development | R10-03 | boundary, correction              |
| 10 权限、隐私与对抗   | [DD-10-04 轨迹提示注入不得外传目录或改变授权](cases/10/DD-10-04.json)           | current | development | R10-04 | adversarial                       |
| 10 权限、隐私与对抗   | [DD-10-05 目录联接不能绕过来源授权](cases/10/DD-10-05.json)                     | current | development | R10-05 | adversarial, boundary             |
| 10 权限、隐私与对抗   | [DD-10-06 服务回显密钥时错误信息脱敏](cases/10/DD-10-06.json)                   | current | development | R10-06 | error, adversarial                |
| 10 权限、隐私与对抗   | [DD-10-07 移除来源后不会全库自动重新加入](cases/10/DD-10-07.json)               | current | holdout     | R10-07 | boundary, correction              |
| 10 权限、隐私与对抗   | [DD-10-08 原轨迹只读且不执行历史命令](cases/10/DD-10-08.json)                   | current | holdout     | R10-08 | adversarial, boundary             |
| 11 状态、异常与恢复   | [DD-11-01 流式输出主动取消与手动重试](cases/11/DD-11-01.json)                   | current | development | R11-01 | recovery, error                   |
| 11 状态、异常与恢复   | [DD-11-02 生成中异常退出后的恢复](cases/11/DD-11-02.json)                       | current | development | R11-02 | error, recovery                   |
| 11 状态、异常与恢复   | [DD-11-03 等待用户补充跨重启继续](cases/11/DD-11-03.json)                       | current | development | R11-03 | recovery, missing                 |
| 11 状态、异常与恢复   | [DD-11-04 服务失败与敏感错误脱敏](cases/11/DD-11-04.json)                       | current | development | R11-04 | error, recovery, adversarial      |
| 11 状态、异常与恢复   | [DD-11-05 解析缓存损坏自动重建不伤原文](cases/11/DD-11-05.json)                 | current | development | R11-05 | error, recovery                   |
| 11 状态、异常与恢复   | [DD-11-06 完整请求超预算的阻止与纠错](cases/11/DD-11-06.json)                   | current | development | R11-06 | boundary, error, correction       |
| 11 状态、异常与恢复   | [DD-11-07 伪造引用输出拒绝完成](cases/11/DD-11-07.json)                         | current | holdout     | R11-07 | adversarial, error, recovery      |
| 11 状态、异常与恢复   | [DD-11-08 运行中撤权后的后续请求屏障](cases/11/DD-11-08.json)                   | current | holdout     | R11-08 | boundary, recovery, adversarial   |
| 12 协议、发布与规模   | [DD-12-01 三协议碎片化工具循环等价能力](cases/12/DD-12-01.json)                 | current | development | R12-01 | boundary, recovery                |
| 12 协议、发布与规模   | [DD-12-02 自定义完整端点路径原样使用](cases/12/DD-12-02.json)                   | current | development | R12-02 | normal, boundary, recovery        |
| 12 协议、发布与规模   | [DD-12-03 协议错配错误可定位且不自动降级](cases/12/DD-12-03.json)               | current | development | R12-03 | error, correction                 |
| 12 协议、发布与规模   | [DD-12-04 安装入口与目标版本一致性](cases/12/DD-12-04.json)                     | current | development | R12-04 | error, recovery                   |
| 12 协议、发布与规模   | [DD-12-05 超过最近150条历史的自主发现](cases/12/DD-12-05.json)                  | current | development | R12-05 | boundary, performance             |
| 12 协议、发布与规模   | [DD-12-06 扫描深度上限的不完整结果提示](cases/12/DD-12-06.json)                 | current | development | R12-06 | boundary, missing, correction     |
| 12 协议、发布与规模   | [DD-12-07 大目录冷暖检索与增量变化性能](cases/12/DD-12-07.json)                 | current | holdout     | R12-07 | performance, recovery, correction |
| 12 协议、发布与规模   | [DD-12-08 旧版复盘数据保留与持续对话共存](cases/12/DD-12-08.json)               | current | holdout     | R12-08 | recovery, boundary                |
