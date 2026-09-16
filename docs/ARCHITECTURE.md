# 代码架构与接口

## 实现结构

MYOPC 是 Next.js 单体应用：React / TypeScript 前端、Node.js 服务端、better-sqlite3 持久化。内容来自仓库外的知识仓库，运行数据留在本地数据库。

| 路径 | 用途 |
| --- | --- |
| app/page.tsx、app/globals.css | 页面与样式：总览、项目、工具、空间、图谱、条目详情、历史行动 |
| app/mermaid-diagram.tsx | 图谱详情页的 Mermaid 渲染（宽度自适应、查看大图、失败回退源码） |
| app/api/v1/[...segments]/route.ts | HTTP 请求分发 |
| lib/knowledge/yaml.ts | 知识仓库使用的少量 YAML 解析（`key: value`、内联列表、列表项） |
| lib/knowledge/repo.ts | 读取知识目录，解析 front matter、来源引用并计算内容哈希 |
| lib/knowledge/store.ts | 索引、同步状态、阅读说明结果的 SQLite 读写 |
| lib/knowledge/model.ts | 模型客户端（默认 DeepSeek，`chat/completions`） |
| lib/knowledge/reading-note.ts | “阅读说明”规程：提示词、输出校验、失败保留上一次结果 |
| lib/knowledge/service.ts | 对外服务：同步、列表、详情、生成与批量加工 |
| lib/knowledge/reuse.ts | 开发知识复用：按任务挑选历史知识、回流任务结果与阶段事件、候选经验与处置 |
| lib/knowledge/progress.ts | OPC V0.2：项目事件保存、恢复摘要组装、项目最近进展；这一层不调用模型 |
| bridge/opc.mjs、bridge/install.ps1 | 本地 OPC Bridge：`opc context` / `opc result` / `opc bootstrap` / `opc candidates`，安装后与项目仓库无关 |
| lib/business.ts、lib/db.ts | 历史业务读写与数据库结构 |
| scripts/knowledge-sync.ts | 命令行同步与加工（可定时执行） |

## 知识数据流

1. `MYOPC_KNOWLEDGE_DIR` 指向知识仓库检出目录。同步时会先尝试把检出更新到远端最新（`git fetch` + 只允许快进合并，分支由 `MYOPC_KNOWLEDGE_BRANCH` 指定，默认 `main`）；目录不是 Git 检出、没有 git、工作区有未提交改动或拉取失败时，只重建索引并在结果里说明原因。
2. 同步读取 `projects/`、`tools/`、`notes/`、`maps/` 下的 Markdown，校验 `id`、`kind` 与目录一致（`project` / `tool` / `note` / `map`），计算内容哈希。
3. 新增或内容变化的条目写入 `knowledge_entries`；从仓库消失的条目标记 `visible=0`，不再出现在页面，也不删除历史结果。
4. 需要加工的条目（新增、内容变化、规程变化或上次失败）进入待加工队列。
5. 加工按规程请求模型，输出经校验后写入 `knowledge_reading_notes`，记录来源哈希、规程版本、模型和生成时间。
6. 失败时保留上一次可用内容，只更新状态与错误信息；页面显示失败原因并允许重试。

一条内容重复同步不会重复写入；相同来源哈希 + 相同规程版本直接复用结果，不调用模型。

## 条目的分类字段

`notes/` 的条目在 front matter 里带 `category`（方法 / 经验 / 判断，词表在知识仓库 README），主题放在 tags 里；`maps/` 的条目带 `map_type`（architecture / workflow / decision / relationship）。这两个字段和其它未识别字段一起原样进入 `extra_json`，服务层再以 `category` / `mapType` 暴露给页面。分类或路径变化会刷新索引，但**不**改变内容哈希，因此不会触发重新加工；只有正文或标签等实质内容变化才重新生成阅读说明。

`related` 是唯一的关系来源，不引入图数据库：详情接口把「本条目声明的 related」与「声明了本条目的条目」合并后返回。因此只在 Map 一侧写 `related: [kill-doc]`，工具页也会出现「相关图谱」；页面按 kind 分组为相关项目 / 相关工具 / 相关方法 / 相关图谱，点击可继续跳转。

## 图谱（map）的加工与展示

Map 的结构主体属于知识事实：结构图以 Mermaid 源码保存在知识仓库里，模型只生成解释和辅助阅读（`summary`、`brief`、`card`、`facts`、`decisions`、`conditions`、`inferences`，`steps` 留空）。规程 `reading-note-v6` 起加入图谱规则并明确要求：不得修改 Mermaid、不得重设图结构、不得新增或删除节点、不得把推断写成图中事实。加工结果只写入 `knowledge_reading_notes`，不写回原文，所以模型不可能覆盖仓库里的 Mermaid。

详情页把正文第一个 Mermaid 块作为主图放在标题下方，其余章节按原文顺序渲染，章节里的其它 Mermaid 块同样渲染成图（主图不重复出现）。渲染由客户端依赖 `mermaid` 完成，宽度自适应，支持「查看大图」放大与全屏；渲染失败时显示错误信息和源码回退，并清理 mermaid 遗留的临时节点。列表页不渲染 Mermaid，只显示标题、Map 类型、一句话说明、核心结构简述和标签。

## 开发知识复用（V0.2）

目标是让日常开发保持「打开项目 → 给 Codex 任务 → 正常开发」，由全局 AGENTS.md 约定调用本地 CLI。V0.2 在原有 context / result 上增加阶段回流与新会话恢复，不改变 V0 的调用方式。

1. `opc bootstrap`：POST 到 `/api/v1/agent/bootstrap`，带上仓库、分支、提交与未提交标记（机器字段存在，但只作为来源标注）。服务端只做筛选与组装——按分支相关性分层、再按时间排序，标注其他分支 / 更早提交的记录，列出未解除的阻塞与下一步，同一主题出现不同记录时显式列出冲突而不裁决。返回有长度上限，记录 ID 可用 `GET /api/v1/agent/events/:id` 继续读取。这一步不调用模型。适用范围：开发只在本机；其他机器只用浏览器查看 OPC 页面（不装 bridge、不在那里 bootstrap 或回流）。
2. `opc context --task "..."`：Bridge 从 `git remote get-url origin` 解析 `owner/repo`（读不到时回落到目录名，也可用 config 的 `projects` 做本机路径映射），POST 到 `/api/v1/agent/context`。服务端先过两道 Gate——仓库能否识别、近期是否重复调用——再把全部 visible notes 的标题 / 分类 / 标签 / 一句话说明 / 摘要交给模型挑 0~3 条，相关性分数低于阈值直接丢弃；命中后才读取正文（最多 4000 字）返回。任何失败都返回 `used:false` 加可读 reason，不阻塞开发。
3. `opc result`：POST 到 `/api/v1/agent/result`，一次回流可以只带阶段事件（`--event decision|progress|environment|finding|blocker|plan`），也可以带完整的任务结果（`--change / --validation / --finding / --knowledge-used`）。事件写入 `project_events`，批次写入 `agent_task_results`。
   - 状态语义：`planned`（计划）、`reported`（执行方报告）、`verified`（附验证依据）、`blocked`、`superseded`；`verified` 必须有验证方式或证据，否则按报告记录，服务器不会替执行方升级状态。
   - 去重与更正：同一次回流重试带同一个 `submission_id`，服务端按（submission_id, 序号）判重，不重复写入；更正用 `--supersedes <记录 id>`，旧记录标记为 `superseded` 但保留历史。
   - 模型边界：只回流事件时不调用模型；客户端已经提交总结或候选经验时也不调用模型；只有没有自带总结的任务结果才会让模型整理并提取 0~2 条候选经验。
   - 凭据：事件与任务字段在 Bridge 侧和服务器侧都会做一次脱敏，上传载荷里不出现 Token / 密码原文。
4. 候选经验处置：`POST /api/v1/knowledge/candidates/:id/resolve`，状态为 `merged / added / hold / discarded`，记录理由、对应知识条目与适用的知识仓库提交；处理过的候选不再进入待整理列表，但保留历史。CLI 入口是 `opc candidates`。
5. V0.2 仍然不自动改知识仓库、不做 embedding / 向量库 / MCP / 知识图谱。

上下文调用记录写在通用 `events` 表（`entity_type='agent'`、`kind='agent.context.queried'`），既用于近期重复调用 Gate，也是空间页「知识复用」面板的数据来源；候选处置另写 `agent.candidate.resolved` 事件。Bridge 侧另有 `%LOCALAPPDATA%\OPC\` 下的缓存、日志与待重传队列，项目仓库不产生任何 OPC 文件。项目详情页的「最近进展」读取同仓库的 `project_events`，没有记录时不显示该区块。

## 数据表

| 表 | 内容 |
| --- | --- |
| knowledge_entries | 条目索引：类型、标题、摘要、状态、标签、来源、正文、相对路径、内容哈希、可见性 |
| knowledge_reading_notes | 每个条目的阅读说明：规程版本、来源哈希、模型、状态、内容、错误、生成时间 |
| knowledge_sync_state | 最近一次同步的目录、仓库、分支、提交、计数和时间 |
| agent_task_results | 回流批次：仓库、任务、改动 / 验证 / 发现、用到的知识与效果、一句话总结，加 `submission_id / machine / branch / commit_sha / dirty / event_count` |
| project_events | 项目事件（V0.2）：类型、内容、理由、状态、验证方式、证据、下一步、机器 / 分支 / 提交 / 脏标记、`supersedes_id / superseded_by`（更正历史） |
| knowledge_candidates | 候选经验：标题、内容、依据、建议、来源仓库与任务、状态（pending / merged / added / hold / discarded）与处置信息 |

前端不直接写库，全部经 HTTP 接口；模型只由服务端调用。

## API

| 方法 | 路径（前缀 /api/v1） | 说明 |
| --- | --- | --- |
| GET | /knowledge | 同步状态、模型配置、待加工数量与条目列表（可选 `kind`、`q`） |
| GET | /knowledge/entries/:id | 条目详情：阅读说明内容、原文、来源与关联条目 |
| POST | /knowledge/sync | 重新读取知识目录并更新索引 |
| POST | /knowledge/notes | 生成或重新生成单个条目的阅读说明（`entry_id`、`force`） |
| POST | /knowledge/process | 批量加工待处理条目（`limit`，单次最多 10 条） |
| POST | /agent/context | 开发知识复用：按任务取 0~3 条历史知识（`repository`、`task`、可选 `force`） |
| POST | /agent/result | 回流任务结果与阶段事件（`submission_id`、`machine / branch / commit / dirty`、`events`、可选 `summary / candidates`） |
| POST | /agent/bootstrap | 新会话恢复：按仓库 / 分支 / 提交筛选并组装恢复摘要（不调用模型；机器只作来源标注） |
| GET | /agent/events/:id | 单条项目事件详情 |
| GET | /knowledge/reuse | 知识复用观察数据（最近调用、待整理与已处理候选经验、知识使用情况） |
| POST | /knowledge/candidates/:id/resolve | 候选经验处置：merged / added / hold / discarded + 理由、条目与知识仓库提交 |
| GET | /health、/dashboard、/library、/events | 运行与历史数据概览 |
| GET | /captures、/captures/:id、/captures/:id/file | 历史素材读取 |
| GET | /methods、/methods/:id、/projects、/projects/:id | 历史方法、项目读取 |
| GET | /context?trial_id= | 行动上下文 |
| POST | /captures、/methods、/projects、/projects/:id/locations、/trials、/deliverables、/drafts、/feedback、/decisions | 历史业务写入 |
| PATCH | /captures/:id、/projects/:id、/trials/:id | 历史业务更新 |

历史接口的幂等与版本冲突规则保持不变（`X-Client-Request-Id`、`expected_revision`、`expected_previous_version_id`）。

## 依赖约束

`better-sqlite3` 必须是 13.x（首个 N-API 版本）。12.x 在 Node 24 下会在语句对象被回收时触发 Node 的清理钩子回归（nodejs/node#65446），随机 abort 整个进程；13.x 不再使用该钩子，也就不再依赖本机编译。升级前先在容器内跑一次压测：创建两万次语句并强制 GC，确认不中断。

## 配置

| 变量 | 说明 |
| --- | --- |
| MYOPC_DATA_DIR | 运行数据目录（数据库、备份）；服务器上指向持久卷 |
| MYOPC_KNOWLEDGE_DIR | 知识仓库检出目录；需可读可写才能自动快进 |
| MYOPC_KNOWLEDGE_REPO | 知识仓库标识，用于生成原文链接（默认 `kioooice/MYOPC-Knowledge`） |
| MYOPC_KNOWLEDGE_BRANCH | 同步时跟踪的分支（默认 `main`） |
| MYOPC_MODEL、MYOPC_MODEL_BASE_URL、MYOPC_MODEL_API_KEY | 模型与凭据；未配置密钥时同步与浏览仍可用 |
| MYOPC_MODEL_TIMEOUT_MS、MYOPC_MODEL_MAX_TOKENS | 请求超时与输出上限（默认 60000ms / 4000） |

密钥只放运行环境，不进入 Git，也不写入知识仓库。

## 已不再使用的部分

素材收纳、行动、成果版本与反馈的页面入口已从主要流程移除，代码与数据保留以便查阅历史。`lib/business.ts` 中的相关实现仍在服务端可用，未被前端调用。
