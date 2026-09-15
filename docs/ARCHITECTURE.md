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

## 数据表

| 表 | 内容 |
| --- | --- |
| knowledge_entries | 条目索引：类型、标题、摘要、状态、标签、来源、正文、相对路径、内容哈希、可见性 |
| knowledge_reading_notes | 每个条目的阅读说明：规程版本、来源哈希、模型、状态、内容、错误、生成时间 |
| knowledge_sync_state | 最近一次同步的目录、仓库、分支、提交、计数和时间 |

前端不直接写库，全部经 HTTP 接口；模型只由服务端调用。

## API

| 方法 | 路径（前缀 /api/v1） | 说明 |
| --- | --- | --- |
| GET | /knowledge | 同步状态、模型配置、待加工数量与条目列表（可选 `kind`、`q`） |
| GET | /knowledge/entries/:id | 条目详情：阅读说明内容、原文、来源与关联条目 |
| POST | /knowledge/sync | 重新读取知识目录并更新索引 |
| POST | /knowledge/notes | 生成或重新生成单个条目的阅读说明（`entry_id`、`force`） |
| POST | /knowledge/process | 批量加工待处理条目（`limit`，单次最多 10 条） |
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
