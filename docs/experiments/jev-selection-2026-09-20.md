# Jev 与现有知识选择器的有限对照

状态：首轮有限对照已完成；结果为脱敏实验记录，不构成接入或业务效果结论。

## 实验边界

- 日期：2026-09-20（Asia/Shanghai）。不接入应用、不改运行代码、不部署、不调用生产 `agent/context` 或 `agent/result`，不写入生产业务记录或长期知识。
- 知识快照：`kioooice/MYOPC-Knowledge` `main`，提交 `9c44d768fee9b77775f799a9491e118683d4ea5c`。候选固定为 10 条，不扩展正式检索层。
- 两边使用同一任务、同一候选快照、同一最多 3 条限制。Jev 只做逐候选的有限相关性判断，不生成选择理由；现有选择器保留其原有理由输出。
- 预先阈值：Jev `noul >= 0.70` 才进入候选，再按分数取前 3 条；现有选择器沿用代码中的相关性阈值 70/100。阈值只用于本轮比较，不代表生产门禁。
- 结果判定：参考判断只由执行者在请求前写下，不把任一模型输出当真值。`must_return` 是会改变本任务下一步做法的知识；`should_not_return` 是无关或不应当成为指令的知识；`boundary_only` 只能作为边界提醒，不能按“可执行方法”计入命中。

## 固定候选

| id | 类型 | 标题 |
| --- | --- | --- |
| `project-memory-file` | note | 维护能帮助恢复工作的项目记忆 |
| `local-first-provenance` | note | 整理时保留来源和判断的区别 |
| `safe-deploy` | note | 有持久数据的服务如何核对部署结果 |
| `dev-network-troubleshooting` | note | 代理与命令行等待问题的一次排查记录 |
| `model-tier-routing` | note | 按任务分配不同层级的模型 |
| `ai-collaboration-low-frequency` | note | 低频决策、高密度执行 |
| `iteration-and-scope` | note | 什么时候局部改善，什么时候重构 |
| `projects-as-cases-methods-as-assets` | note | 项目是案例，方法才是资产 |
| `release-gate-stages` | note | 测试通过不等于可以发布 |
| `kill-doc-content-pipeline` | map | kill-doc 网页内容提取与重建结构 |

## 预注册任务与人工参考

真实任务均来自本项目已有交接、测试、部署或状态记录；合成任务明确标注，不冒充业务闭环。

| id | 类型 / 来源 | 任务（脱敏） | `must_return` | `boundary_only` / 关键不选项 |
| --- | --- | --- | --- | --- |
| R1 | 真实，MYOPC `HANDOFF.md` / `TASKS.md`，2026-09-19 | 恢复交接，阅读规则与状态，核对 Git 和相关文件后继续一项已授权、可回滚的工程任务 | `project-memory-file`, `model-tier-routing`, `ai-collaboration-low-frequency` | `local-first-provenance` 仅为辅助原则，不足以进前 3 |
| R2 | 真实，`cfe1adf` 与 `tests/knowledge-reuse.test.ts`，2026-09-19 | 为知识复用增加按候选内容 / 阅读说明 / 候选池版本失效，补回归测试并按授权完成部署核对 | `iteration-and-scope`, `safe-deploy`, `projects-as-cases-methods-as-assets` | `release-gate-stages` 可作补充，但本任务重点不是新增发布门禁 |
| R3 | 真实，`docs/STATUS.md`，2026-09-19 | 只读核对 Easel / Karakeep 的进程、容器、OpenResty 端口路由和认证边界，不读取凭证 | `dev-network-troubleshooting`, `local-first-provenance` | 其余候选不应升级为服务操作指令 |
| R4 | 真实，`docs/STATUS.md` / `docs/DEPLOYMENT.md`，2026-09-19 | 对持久化服务部署已提交版本：备份与完整性、运行版本、健康、容器和主要入口分别核对 | `safe-deploy`, `release-gate-stages`, `local-first-provenance` | `dev-network-troubleshooting` 不是部署步骤，其他项目方法不相关 |
| S1 | 合成，无关对照 | 为一个家庭菜谱 App 设计粉色 onboarding 页面，不涉及代码交付、部署或知识整理 | 无 | 全部 `should_not_return` |
| S2 | 合成，无关 / 数值边界 | 根据两个日期和金额计算某国公司的精确税额；没有税法或计算规则材料 | 无 | 全部 `should_not_return`；不能把工程排查或部署经验硬套进来 |
| S3 | 合成，表面相似但不适用 | 浏览器只显示付费墙后的内容，要求选择一条知识来绕过登录或付费限制并下载原文件 | 无 | `kill-doc-content-pipeline` 为 `boundary_only`，只能阻止越权解释，不能作为绕过方法 |
| S4 | 合成，旧局部政策边界 | 一个无状态云函数项目问是否必须照搬 MYOPC 的 SQLite backup、OpenResty、容器重启和 Git bundle 步骤 | 无 | `safe-deploy`, `release-gate-stages` 为 `boundary_only`，不能升级为普遍指令 |

## 成本与延迟记录规则

- Jev 固定 `jev-1.13.0`，每个任务一个请求、10 个独立 Noul；记录 HTTP 成功、返回模型、`usage.input_tokens/output_tokens` 和端到端耗时。认证、配额或服务错误立即停止，不循环重试。
- Jev 官方当前价格按输入 `$0.042 / 1M tokens`、输出免费估算；首轮最多 8 请求、每请求目标输入不超过约 10,000 tokens，保守 Jev 上界为 `$0.00336`（8 × 10,000 × 0.042 / 1,000,000），仍低于 `$0.05`。
- 现有 `deepseek-flash` 基线只在临时本地数据库运行，记录端到端耗时和选择结果。若现有封装不返回 usage，则成本报告为官方价格下的保守估算，不伪造实际扣费，也不把两边的估算当成精确账单。

## 请求与结果

- 官方模型列表认证探测返回成功，列表给出 `jev-latest` / `jev-preview`；8 个实际请求均在请求体固定 `model=jev-1.13.0`，响应也返回 `jev-1.13.0`。没有认证、配额或服务失败，没有重试。
- Jev 合计输入 `28,128` tokens、输出 `1,728` tokens；按官方 `$0.042 / 1M input tokens` 估算，实际输入费约 `$0.001181`，输出免费。端到端延迟 `523–655ms`，平均 `589ms`。
- 现有 `deepseek-flash` 基线 8 次均完成，端到端延迟 `2,277–16,256ms`，平均 `7,017ms`。现有封装未返回 usage，因此不声称实际扣费；按官方峰时最高价、每请求输入不超过 10,000 tokens、`max_tokens=1,600` 的保守上界为 `$0.03936`（非实际账单，离峰约为其一半）。

### 逐例比较

选择结果均为候选 id；`∅` 表示不返回。Jev 括号内为 `noul`，不把它当成正确率或真值。

| 任务 | 预注册参考必须返回 | 现有选择器 | Jev | 关键错例 / 观察 |
| --- | --- | --- | --- | --- |
| R1 | `project-memory-file`, `model-tier-routing`, `ai-collaboration-low-frequency` | `project-memory-file` | `project-memory-file (0.74)` | 两边都漏掉当前分工与执行边界两条；Jev 不提供选择理由 |
| R2 | `iteration-and-scope`, `safe-deploy`, `projects-as-cases-methods-as-assets` | `safe-deploy`, `release-gate-stages`, `local-first-provenance` | `safe-deploy (0.72)` | 基线多选两条；Jev 漏掉范围和方法资产两条 |
| R3 | `dev-network-troubleshooting`, `local-first-provenance` | `∅` | `∅` | 两边都漏掉真实只读核对所需的分支排查与证据区分 |
| R4 | `safe-deploy`, `release-gate-stages`, `local-first-provenance` | `safe-deploy` | `safe-deploy (0.82)` | 两边都漏掉发布门禁和证据区分 |
| S1 | 无 | `∅` | `∅` | 无关 UI 对照，均正确 abstain |
| S2 | 无 | `local-first-provenance` | `∅` | 基线把来源原则套到缺少税法材料的数值问题；Jev 正确不选 |
| S3 | 无；`kill-doc-content-pipeline` 仅边界提醒 | `∅` | `∅`（该 map `0.37`） | 两边都没有把可见内容提取边界升级为绕过付费 / 登录的方法 |
| S4 | 无；`safe-deploy` / `release-gate-stages` 仅边界提醒 | `safe-deploy`, `projects-as-cases-methods-as-assets` | `∅`（最高为 `iteration-and-scope 0.42`） | 基线把 MYOPC 局部部署经验带成普遍指令；Jev 正确 abstain |

### 预注册参考下的汇总

- 参考集合共 11 条 `must_return`。两边都命中 3 条：Jev `TP=3 / FP=0`，参考 precision `100%`、recall `27.3%`；基线 `TP=3 / FP=5`，参考 precision `37.5%`、recall `27.3%`。这些只是 8 个小样本上的人工参考比较，不是独立真值或准确率证明。
- 两边按整组选择结果完全一致 `5/8`；agreement 单独记录，不能当成正确。
- Jev 在无关 / 边界样本上更保守，且明显更快；但漏掉 R3 的两条实质相关知识，也漏掉 R1/R2/R4 中若干已预注册相关知识。没有理由字段，人工无法从返回本身知道它为何 abstain。

## 结论与限制

首轮没有证明 Jev 可以替代现有选择器，也不足以授权接入。它显示出“低延迟、低输入费、较少误选”的信号，但召回不足、无解释、对候选边界的依赖明显；在知识选择场景里，漏掉可改变做法的内容不能只用低误选抵消。当前不扩大样本、不开发 DecisionProvider / CLI / shadow 路由、不部署。

若未来出现真实使用需求，最多另开一轮明确验证“Jev 作为保守预筛 / abstain gate、现有模型或人工复核兜底”，并重新登记参考判断；本报告不把该可能性当成当前架构结论。

## 官方依据

- TypeSafe Models：<https://docs.typesafe.ai/models>
- TypeSafe API reference：<https://docs.typesafe.ai/api>
- Jev 1.13 jaggedness：<https://docs.typesafe.ai/model-jaggedness/jev-1.13>
- DeepSeek Models & Pricing：<https://api-docs.deepseek.com/quick_start/pricing/>
