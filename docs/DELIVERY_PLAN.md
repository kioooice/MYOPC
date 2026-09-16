# 开发计划入口

当前任务统一维护在 [TASKS.md](../TASKS.md)，实际实现和运行状态见 [STATUS.md](STATUS.md)。

原 S0/S1/S2、多环境接续与两轮内容生产要求不再作为开发关卡。推进方式：选择具体需求，完成实现和必要验证，提交后继续下一项。

---

# 本轮：OPC V0.2（项目进展即时回流 + 新会话恢复）

状态：实施中。这是现有 OPC 的增量升级，不新建项目；目标、边界、任务与最终验证结果都维护在本文件。

## 目标

让日常开发保持「打开项目 → 给 Codex 任务 → 正常开发」，不需要手动维护交接文件：

1. 有意义的阶段把关键进展回流：关键决定、阶段完成、环境变化、重要发现、阻塞。
2. 新对话进入已识别项目时恢复：项目目标与阶段、最近完成、关键决定与理由、环境验证、未完成事项与阻塞、下一步与证据。
3. 恢复后先核对当前工作区（分支、提交、相关文件），再继续任务。
4. 事件接收与保存、恢复筛选与组装、客户端已提交的候选经验保存都**不调用服务器模型**；模型只保留在知识阅读说明与知识相关性判断。
5. 计划、执行方报告、附验证依据三种状态分开，不把模型或执行方报告自动提升为验证事实。

## 边界

- 不建 MCP、Semble、长期会话互聊、完整 Observer、图数据库或新的 Agent 框架。
- 不在业务仓库创建 OPC 专用文件；路径映射、机器身份、待重传队列只在全局 OPC 目录。
- 上传载荷不包含密码、Token、API Key、完整 `.env`；不整包上传配置文件。
- 原始会话、日志、代码不整体上传，只保存提交号、测试摘要、文件或会话定位等证据引用。
- 同一仓库不同分支 / 不同机器互不覆盖；更正保留历史；同一次回流重试去重。
- 服务不可用、项目未识别、没有记录时正常继续开发，回流失败只提示并保留待重传记录，不无限重试。

## 任务

| # | 任务 | 状态 |
| --- | --- | --- |
| 1 | 扩展 `opc result`：阶段事件（decision / progress / environment / finding / blocker / plan）、一次多个事件、提交去重、机器 / 分支 / 提交 / 未提交标记 | 已完成 |
| 2 | 新增 `opc bootstrap`：按仓库 + 分支 + 机器 + 提交筛选并组装恢复摘要，长度有上限，记录 ID 可单独读取 | 已完成 |
| 3 | 候选经验处置：已合并 / 已新增 / 暂存 / 舍弃，记录理由、条目与知识仓库提交，处理后移出待整理列表 | 已完成 |
| 4 | 页面：项目详情最近进展（阶段、更新时间、关键事件、环境验证、阻塞、下一步、证据可展开）与候选处置入口 | 已完成 |
| 5 | 全局规则最小增补：新会话恢复一次、恢复后核对本地事实、关键阶段回流、普通改动不回流 | 已完成 |
| 6 | 真实视频项目验收：现场检查 → 阶段回流 → 新对话恢复 → 核对本地 → 接续任务 | 见「验证结果」 |
| 7 | 提交、推送、部署与文档更新 | 见「验证结果」 |

## 设计要点

- 数据：新增 `project_events`（项目事件：类型、内容、理由、状态、验证、证据、下一步、机器 / 分支 / 提交 / 脏标记、父子更正关系）；`agent_task_results` 增加 `submission_id / machine / branch / commit_sha / dirty / event_count`；`knowledge_candidates` 增加处置字段（`resolution_note / resolved_entry_id / knowledge_commit / resolved_at`）。
- 状态语义：`planned`（计划）、`reported`（执行方报告）、`verified`（附验证依据）、`blocked`（未解决）、`superseded`（已被替代）。`verified` 必须有验证方式或证据，否则按报告记录。
- 恢复排序：先按分支相关性分层，再按时间；环境记录区分「本机已验证」与「其他机器验证，不代表本机已就绪」；记录对应更早提交时显式提示核对。
- 冲突不做自动裁决：同一主题下内容不同的未替代记录显式列出，交人工确认。

## 验证结果

提交与部署：

- 提交 `357917e` 已推送并部署到 124.222.190.89（`/opt/apps/opc` 快进到该提交，`MYOPC_RELEASE=357917e`，容器 `myopc` 重建后 `/api/v1/health` 返回 `release=357917e`）。
- 部署前备份 `/opt/backups/opc/pre-v02-357917e.sqlite`（integrity ok、无外键违规）；migration 13 / 14 在该实例生效，`project_events` 已建。
- 本机 CLI 更新到 `opc-bridge 0.2.0`，并在 `%LOCALAPPDATA%\OPC\config.json` 增加路径映射 `D:\Projects\video → video-project`（视频项目没有 git remote）。

真实视频项目验收（video，`D:\Projects\video`）：

1. 现场检查：`hypit --version` = 0.1.9；`.hypit/runtime` 指向 `hypit.runtime.json`（endpoints：autodl.h3 / senseaudio.tts / senseaudio.asr / media.local / hyperframes.local）；`packages/` 下三个自建 provider；`ffprobe output\zh-short-final.mp4` = h264 720x1280 30fps / 8.000s / AAC / 182,494 字节。
2. 阶段回流：一次 `opc result` 写入 5 条事件——progress（verified，证据 `file:output/zh-short-final.mp4`）、decision（WhisperX 对齐由 SenseAudio ASR 承担，附理由）、environment（本地 runtime 已选择，凭据只写槽名）、blocker（发行版修复不可持久）、finding（产物复用，8 → 3 个请求）。返回 `extraction: skipped_events_only`，服务器没有调用模型。
3. 新会话恢复：`opc bootstrap` 返回阶段、决定（含理由）、环境验证（`verifiedOnThisMachine: true`）、未解除阻塞、下一步与 5 个 record ID。
4. 核对本地：用 ffprobe、`hypit --version`、`.hypit/runtime`、`packages/` 逐项核对，与恢复摘要一致。
5. 接续实际任务：按记录里的下一步新增 `scripts/check-distribution.mjs`（只读检查发行版修复是否还在），运行结果 112 个内部包 junction / 13 个外部依赖 / 字体依赖齐全、退出码 0，并回流为第 6 条事件；再次 `bootstrap --force` 能看到新的阶段与下一步。

边界与失败路径（部署实例实测）：

- 幂等：同 `submission_id` 重发返回 `deduped:true`，结果 id 与事件 id 不变。
- 分支 / 机器 / 提交：`OTHER-PC / feature-x / cafebabe` 的记录在 bootstrap 里标成 `sameBranch/sameMachine/sameCommit = false`、`verifiedOnThisMachine: false`，并提示"其他机器验证不代表本机已就绪、请核对更早提交"。
- 凭据：含 `sk-…` 与 `API_KEY=…` 的载荷返回 `redactions: 2`，库内保存为 `DEEPSEEK_API_KEY=[已脱敏]`。
- 服务不可用：把 `OPC_SERVER` 指向不可达地址时 `opc result` 返回 `queued:true`，下一次命令自动补发（doctor `flush.sent = 1`），事件最终落库。
- 页面：本地实例用 Playwright 实测项目详情「最近进展」（阶段、关键事件、环境验证、下一步）与空间页候选处置（保存后待整理 0、最近处理 1）。
- 业务仓库没有产生任何 OPC 文件；配置、机器身份、缓存、日志与待重传队列都在 `%LOCALAPPDATA%\OPC\`。

未验证项：

- 真实"新对话"接续：委派创建的 Codex 任务 `01a0aa96-664b-7450-b786-23e383c04b3a`（video 项目）两次都在第一次请求就失败——通过应用委派创建的任务会往新会话注入没有 `call_id` 的 `function_call_output`（`name: create_thread` / `send_message_to_thread`），DeepSeek `/v1/responses` 校验器直接返回 400 `missing field call_id`（已用最小请求复现：无 `call_id` → 400；带 `call_id` → 另一条校验错误）。普通会话里真实工具调用的 `function_call_output` 都带 `call_id`，所以只有委派创建的任务会失败。因此没有跑通"新会话自己恢复并接续"；改用界面正常新建任务即可绕过，最短验收指令见 STATUS 的「未验证」。