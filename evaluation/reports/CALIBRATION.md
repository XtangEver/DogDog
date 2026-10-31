# 独立评分示例交叉校准

日期：2026-10-31。审查者未编写01/05/07/08/09/10/11/12案例。

**覆盖：64例逐例结构与明显冲突筛查；初次16例深评，修订闭环新增DD-07-01深评，最终17例深评、47例仅筛查。DD-08-07原已在16例内，不重复计数。未执行桌面任务或真实模型试验。**

判定来自阅读和语义审阅，不由字符串匹配自动推出。两修订案例已重新读取完整case/oracle并更新哈希；其余条目保留原审阅快照哈希，后续格式化或内容更新不能视为自动复审。

## 覆盖与闭环

| 体系 | 筛查 | 深评ID                       | 仅筛查 | 已解决争议 |
| ---- | ---: | ---------------------------- | -----: | ---------- |
| 01   |    8 | DD-01-02, DD-01-07           |      6 | —          |
| 05   |    8 | DD-05-02, DD-05-07           |      6 | —          |
| 07   |    8 | DD-07-01, DD-07-05, DD-07-07 |      5 | DD-07-01   |
| 08   |    8 | DD-08-02, DD-08-07           |      6 | DD-08-07   |
| 09   |    8 | DD-09-02, DD-09-07           |      6 | —          |
| 10   |    8 | DD-10-02, DD-10-07           |      6 | —          |
| 11   |    8 | DD-11-02, DD-11-07           |      6 | —          |
| 12   |    8 | DD-12-05, DD-12-07           |      6 | —          |

## 判定边界

- 正例/不同合理例是校准锚点，不是产品实际通过证据；桌面持久化、取消、IME、原生文件选择、权限和网络计数必须由过程与审计证明。
- mock不能证明真实模型质量、真人满意度或实际收益；target无入口需明确记录未实现。
- 47例仅筛查项不宣称positive/alternative全语义通过；逐例负例判定只表示明显触及失败条件。

## 修订复核结果

- **DD-07-01：已解决。** 已复核allowedConclusions和alternative统一限定：摘要仅列表预览，保存正文必须完整保留原回答、来源与行号；C1/C2与重启核验不再冲突。正反/替代是合格校准锚点，仍需真实保存及重启证据。
- **DD-08-07：已解决。** 已复核公开档案查看旧依据、加入反例、用户确认修订、重启回访三步和C3；正例/替代及two锚点覆盖完整目标，rationale明确C2语义与C1/C3桌面证据分别核验。当前无入口仍为not_implemented。

当前无未解决的已发现争议；这不等于47例完成深度校准。

## 逐例记录

| 案例     | 深度   | verdict                                                     | 理由                                                                                                                                                                              |
| -------- | ------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DD-01-01 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-01-02 | 深评   | positive_valid, negative_detects_failure, alternative_valid | URL/协议重启保持与密钥不回填的正反锚点一致；替代占位文本可接受。必须核对实际请求与存储后画面，不能由成功回复证明凭据隔离。                                                        |
| DD-01-03 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-01-04 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-01-05 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-01-06 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-01-07 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 原生选择器取消及中文路径选择是合格路径；私有dialog注入明确失败。路径栏粘贴是允许替代，但仍需取消无副作用和原文回看过程。                                                          |
| DD-01-08 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-05-01 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-05-02 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 已修为完整两轮示例：重启后500KB、画质、单张条件都被吸收，未知保持未知。必须另有重启连续性证据。                                                                                   |
| DD-05-03 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-05-04 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-05-05 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-05-06 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-05-07 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 离线与远端零延迟冲突被正确识别，替代条件式验收可接受；缓存不能魔法满足实时性。                                                                                                    |
| DD-05-08 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-07-01 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 已复核allowedConclusions和alternative统一限定：摘要仅列表预览，保存正文必须完整保留原回答、来源与行号；C1/C2与重启核验不再冲突。正反/替代是合格校准锚点，仍需真实保存及重启证据。 |
| DD-07-02 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-07-03 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-07-04 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-07-05 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 已加入独立实验条目及重启回访，正反和替代与target判据一致；当前无入口应not_implemented，聊天计划不能代替状态。                                                                     |
| DD-07-06 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-07-07 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 采用提前验收但仍返工、同时格式变化的事实支持有条件负面结果；归罪用户或排除失败样本不合格。替代结论需与实施及范围变化事实一起评。                                                  |
| DD-07-08 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-08-01 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-08-02 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 技术讨论范围、3条默认和按需展开例外准确；必须看到档案内容及重启新讨论应用，不因文本声称记住就通过。                                                                               |
| DD-08-03 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-08-04 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-08-05 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-08-06 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-08-07 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 已复核公开档案查看旧依据、加入反例、用户确认修订、重启回访三步和C3；正例/替代及two锚点覆盖完整目标，rationale明确C2语义与C1/C3桌面证据分别核验。当前无入口仍为not_implemented。   |
| DD-08-08 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-09-01 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-09-02 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 组合Enter、Shift+Enter和最终完整提交边界清楚；鼠标选词只能补充、不能替代IME组合Enter检查。需屏幕及请求计数。                                                                      |
| DD-09-03 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-09-04 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-09-05 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-09-06 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-09-07 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 两次保存及跨重启两版内容/引用均明确；v1/v2或时间标识可替代，排序不是判据。需独立回看证据。                                                                                        |
| DD-09-08 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-10-01 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-10-02 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 撤权时间边界与后续审计是必要证据；本机旧快照留存不等于外发授权。替代仅在另有有效目录权限时适用，完全撤权仍须零请求。                                                              |
| DD-10-03 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-10-04 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-10-05 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-10-06 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-10-07 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 单来源排除不等于撤全目录，正反明确；显式重关联是未来重新使用的授权条件，不能当本次自动重加成功。                                                                                  |
| DD-10-08 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-11-01 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-11-02 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 强制终止后中断状态与重启零自动重发明确；替代中断提示样式允许。正例必须由进程终止记录和服务计数支持。                                                                              |
| DD-11-03 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-11-04 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-11-05 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-11-06 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-11-07 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 伪造引用拒绝、未完成和不可保存对应；保留原始文字仅供排查可接受，不能认证其证据或结论。还须重启核对无完整报告。                                                                    |
| DD-11-08 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-12-01 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-12-02 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-12-03 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-12-04 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-12-05 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 181条最旧目标检索与不全量外发一致；工具路径可变。须查原文及请求片段，不能只由目标答案证明无关180份未发。                                                                          |
| DD-12-06 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
| DD-12-07 | 深评   | positive_valid, negative_detects_failure, alternative_valid | 冷暖增量实际时延、更新7秒与旧5秒快照保持一致；暖查不快本身非失败，未刷新才是正确性失败。须独立记录时延及管理员更新操作。                                                          |
| DD-12-08 | 仅筛查 | negative_detects_failure                                    | 已逐例读取must与三类示例，结构完整，负例直接触及禁止行为；正例/替代仅筛查明显冲突，未做完整事实/评分锚点深评。                                                                    |
