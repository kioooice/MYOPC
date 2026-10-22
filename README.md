# MYOPC

## Project overview

MYOPC is a local-first operating layer for personal growth and one-person companies. It keeps sourced project state, history, and reusable knowledge connected to the work where they matter, so an AI collaborator can recover context, reuse proven methods, and return evidence-bound results instead of treating every task as a blank chat.

The value is the feedback loop between AI execution and human judgment: the system records what was decided, what was actually verified, what remains uncertain, and what should change next. The working surface includes workspace continuity, knowledge-repository sync and reading notes, task-based knowledge reuse, and an OPC Bridge for structured task and phase results. Autonomous exploration, business automation, and capability evaluation remain explicitly under validation.

For an implementation map, start with [Product Spec](docs/PRODUCT_SPEC.md), [Architecture](docs/ARCHITECTURE.md), and [Current Status](docs/STATUS.md). The repository is a working project with inspectable evidence, not a claim that autonomous behavior or business outcomes have already been achieved.

支持个人发展与一人公司实践的线上应用。OPC 承接有来源的当前状态、历史与可复用知识，支持 AI 生产能力和人的理解、探索、判断共同积累。实际能力增长需要真实反馈验证，定位与边界见 [产品说明](docs/PRODUCT_SPEC.md)。

当前已提供私有 workspace 状态承接与读取，以及独立知识仓库的索引、阅读说明和按任务取用；持续自主探索、自动经营与能力评测仍是待验证方向。

## 当前进展（2026-10-22）

- `main` 已推送至 `cf68a09`；最近一轮代码记录了有界的 OPC Hooks 验证：Video 已获准使用 active，MYOPC 仍保持 probe。
- 已验证的能力包括 workspace 状态恢复、知识仓库同步与阅读说明、按任务复用历史方法，以及任务结果 / 阶段事件回流。
- Hooks 的实际创作收益、持续自主探索、自动经营和能力评测仍未证明；当前以真实任务中的反馈继续核对。项目状态与证据见 [当前状态](docs/STATUS.md) 和 [阶段记录](docs/PROJECT_LOG.md)。

它是这条流程里的一环：开发对话在项目仓库留下记录，收集步骤把它们整理成知识条目（不要求单独开对话），OPC 负责同步、加工和展示。资料收藏交给 Karakeep，内容制作与运营交给 Easel。

## 内容从哪来

- 知识仓库：[kioooice/MYOPC-Knowledge](https://github.com/kioooice/MYOPC-Knowledge)（私有）。`projects/`、`tools/`、`notes/`、`maps/` 分别存放项目、工具、方法经验和结构图条目，`sources.yaml` 记录来源项目和收集版本。
- OPC 只读该仓库：同步时识别新增、修改和删除，重建索引；页面展示结果保存在本地 SQLite，可随时按来源重新生成。
- 修改内容在知识仓库里做，OPC 不提供网页编辑和 Git 双向同步。

## 本地启动

使用 Node.js 24+。Windows 双击 `start.bat`，或在 PowerShell 中执行：

```powershell
.\start.ps1
```

默认地址 `http://127.0.0.1:3000`，默认数据目录 `%LOCALAPPDATA%\MYOPC\data`。

需要在代码目录直接开发时：

```sh
npm ci
npm run dev -- --hostname 127.0.0.1
```

本地配置写在 `.env.local`（不进 Git）：知识仓库目录、模型地址与密钥。可参考 [.env.example](.env.example)。

## 页面

- **项目 / 工具 / 空间 / 图谱**：分别读取知识仓库中的 `project`、`tool`、`note`、`map` 条目，列表显示状态、摘要、标签和加工状态。
- **图谱**：地图类条目以知识仓库原文里的 Mermaid 结构图为准，详情页先显示主图（可放大、全屏），再显示关键分界、可迁移理解、模型辅助阅读和相关知识；渲染失败时回退显示源码和错误。
- **条目详情**：阅读说明（原文事实、关键选择、步骤、适用条件、仍未确定、模型推断）、原文、来源链接和仓库/应用入口。
- **总览**：最近更新的条目、三块入口计数、知识同步状态和待加工数量。
- 同步与加工都在页面上手动触发；打开页面不会自动调用模型。来源或规程未变化时复用已有结果。

历史数据（素材、行动、成果版本、反馈）仍保留在数据库和“最近行动”里，不再作为主要流程。

## API

| 方法 | 路径（前缀 /api/v1） | 用途 |
| --- | --- | --- |
| GET | /knowledge | 索引概览：同步状态、模型配置、待加工数量、条目列表 |
| GET | /knowledge/entries/:id | 条目详情：阅读说明、原文、来源与关联 |
| POST | /knowledge/sync | 重新读取知识目录并更新索引 |
| POST | /knowledge/notes | 为单个条目生成或重新生成阅读说明（`entry_id`、可选 `force`） |
| POST | /knowledge/process | 批量加工待处理条目（可选 `limit`，一次最多 10 条） |
| POST | /agent/context | 开发知识复用：按任务取 0~3 条历史知识（`repository`、`task`、可选 `force`） |
| POST | /agent/result | 回流任务结果与阶段事件（决定 / 进展 / 环境 / 发现 / 阻塞），必要时形成候选经验 |
| POST | /agent/bootstrap | 新会话恢复：按仓库、分支、提交组装项目状态摘要（不调用模型；机器只作来源标注） |
| GET | /agent/events/:id | 单条项目事件详情 |
| GET | /knowledge/reuse | 知识复用观察数据：最近调用、待整理与已处理候选经验、知识使用情况 |
| POST | /knowledge/candidates/:id/resolve | 候选经验处置：已合并 / 已新增 / 暂存 / 舍弃 |

原有的 captures、methods、projects、trials、deliverables、feedback 等接口保持不变，供历史数据和脚本客户端继续使用。

## 开发知识复用（V0.2）

日常开发保持原样：**打开项目 → 给 Codex 任务 → 正常开发**。每台电脑安装一次 OPC Bridge 后，Codex 按全局规则调用：

```sh
opc bootstrap                          # 新会话进入已识别项目时恢复一次：阶段、决定、环境验证、阻塞、下一步
opc context --task "<当前任务>"         # 需要历史经验时；没有相关知识就返回 no_relevant_knowledge
opc result --event decision --title "..." --content "..." --rationale "..."          # 阶段回流
opc result --event progress --title "..." --content "..." --verification "..." --status verified --next "..."
opc result --task "<当前任务>" --outcome success --change "..." --validation "..." --knowledge-used "id1,id2"
opc candidates                         # 整理候选经验
```

- 安装：`powershell -ExecutionPolicy Bypass -File bridge/install.ps1`（程序、配置、日志、待重传队列都在 `%LOCALAPPDATA%\OPC\`，项目仓库里不产生任何 OPC 文件）。
- 恢复：`bootstrap` 只做筛选与组装，不调用模型；按分支相关性分层再按时间排序，环境记录带验证方式与来源标注，记录对应更早提交时会提示核对，同一主题互相冲突时显式列出。恢复后仍要自己核对工作区。适用范围：开发只在本机；其他机器只用浏览器查看 OPC 页面，不装 bridge、不在那里 bootstrap 或回流。
- 回流：`--event` 一次可以写多条（决定 / 进展 / 环境 / 发现 / 阻塞 / 计划），带分支、提交与未提交标记（机器作为来源标注）；重试带同一个 `submission_id` 不会重复写入；更正用 `--supersedes <记录 id>`，旧记录保留历史。只回流事件时不调用服务器模型。
- 状态：`planned`（计划）/ `reported`（执行方报告）/ `verified`（附验证依据）/ `blocked`（未解决）/ `superseded`（已被替代）。标 verified 必须有验证方式或证据。
- 取用：先用模型在 notes 池里挑选，相关性低于阈值就不返回；命中后才读取正文，最多 3 条；10 分钟内相同仓库 + 相同任务直接复用上次结果。
- 接入新项目 / 新工具：已经有实际工作之后（≥5 条记录，其中 ≥2 条是进展 / 环境 / 发现，且至少 1 条带验证依据），Codex 自动起草一条最小知识条目（状态 `待核对`，`sources.repo` 写 OPC 身份）并提交推送，项目就会出现在页面上；只有想法、还没动手的不登记；条目正文由后续整理会话充实，不需要手动要求。
- 候选：结果写入 `agent_task_results`，事件写入 `project_events`；值得长期保留的内容进入 `knowledge_candidates`，用 `opc candidates` 或页面标记为已合并 / 已新增 / 暂存 / 舍弃，OPC 不自动改 `MYOPC-Knowledge`。
- 观察：空间页顶部有「知识复用」面板（最近调用 / 待整理候选 / 已处理记录 / 知识使用情况）；项目详情页有「最近进展」（阶段、关键事件、环境验证、阻塞、下一步，证据可展开）。
- 边界：不使用 embedding、向量库、MCP、知识图谱；凭据只保存引用名称，不保存原文。

## 定时同步

`npx tsx scripts/knowledge-sync.ts --limit 3` 可同步索引并加工待处理条目，适合放到计划任务里；服务器上的做法见 [运行与部署](docs/DEPLOYMENT.md)。

## 开发

```sh
npm test
npm run lint
npm run build
```

界面改动要实际打开页面；数据逻辑改动跑相关测试。文档见 [阶段记录](docs/PROJECT_LOG.md)、[当前状态](docs/STATUS.md)、[待办](TASKS.md)、[产品说明](docs/PRODUCT_SPEC.md)、[代码架构](docs/ARCHITECTURE.md)、[运行与部署](docs/DEPLOYMENT.md)。
