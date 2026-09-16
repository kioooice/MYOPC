# 当前状态

## 2026-09-16 OPC V0.2（项目进展即时回流 + 新会话恢复）

日常开发不用再手动维护交接文件：有意义的阶段把关键进展回流到 OPC，新对话进入项目时先恢复一次项目状态，再核对本地事实继续。

### 已实现

- 阶段事件：`project_events`（migration 13）保存类型（plan / progress / decision / environment / finding / blocker）、内容、理由、状态、验证方式、证据、下一步、机器 / 分支 / 提交 / 未提交标记，以及 `supersedes_id / superseded_by` 更正关系。
- `opc result` 扩展：一次回流可以带多个 `--event`，也可以继续用原来的 `--task/--change/--validation/--finding/--knowledge-used`；`agent_task_results` 增加 `submission_id / machine / branch / commit_sha / dirty / event_count`，同一次回流重试按（submission_id, 序号）判重，不重复写入。
- 状态语义：`planned / reported / verified / blocked / superseded`。标记 `verified` 需要验证方式或证据，否则按执行方报告记录；服务器不会自动升级状态。
- `opc bootstrap`：新增 `POST /api/v1/agent/bootstrap`，按仓库 + 分支 + 机器 + 提交筛选并组装恢复摘要（阶段、最近记录、决定与理由、环境验证、阻塞、下一步、冲突、记录 ID），结果有长度上限；`GET /api/v1/agent/events/:id` 读取单条记录详情。
- 模型边界：只回流事件时不调用模型；客户端已提交总结或候选经验时不调用模型；知识阅读说明与知识相关性判断保持原样。恢复摘要在服务端是纯筛选与组装。
- 凭据边界：Bridge 与服务器两侧都做一次脱敏，上传载荷不出现 Token / 密码原文；不读取配置文件整体，不要求上传会话、日志或代码。
- 候选经验处置：`POST /api/v1/knowledge/candidates/:id/resolve` + `opc candidates`，状态为已合并 / 已新增 / 暂存 / 舍弃，记录理由、对应条目与知识仓库提交；处理后移出待整理列表，历史保留。
- Bridge：新增 `bootstrap` / `candidates` 命令、机器身份（`%LOCALAPPDATA%\OPC\machine.json`）、本机路径映射（config 的 `projects`）、待重传队列（`queue\pending.jsonl`，每条最多 20 次、每次命令最多补发 3 条）与本地脱敏。
- 页面：项目详情新增「最近进展」（阶段、更新时间、关键事件、环境验证、阻塞、下一步，证据可展开）；空间页的知识复用面板可以就地处置候选经验并查看已处理记录。
- 全局规则：`~/.codex/AGENTS.md` 的 OPC 段落加入「新会话先 `opc bootstrap` 恢复一次并核对本地事实」「关键阶段用 `opc result --event` 回流」「普通改动不回流」「同一会话不反复 bootstrap」。

### 已验证（本地，2026-09-16）

- `npm test` 79 项通过（新增 18 项：事件保存与去重、状态降级、脱敏、更正历史、bootstrap 分支 / 机器 / 提交筛选与冲突、事件-only 不调用模型、候选处置、Bridge 参数 / 脱敏 / 机器身份）。
- `npm run lint`、`npx tsc --noEmit`、`npm run build` 通过。
- 本地实例（127.0.0.1:3212，独立数据目录）实测：`opc bootstrap` 无记录时返回 `no_records`；`opc result` 写入 2 条事件（1 verified + 1 reported）后，`opc bootstrap` 返回阶段、决定、下一步与记录 ID；同一次 `submission_id` 重试不重复写入。

### 服务器部署与验收（2026-09-16）

- 提交 `357917e` 部署到 124.222.190.89：备份 `/opt/backups/opc/pre-v02-357917e.sqlite`（integrity ok、无外键违规）→ 快进到该提交 → `MYOPC_RELEASE=357917e` → 重建容器；`/api/v1/health` 返回 `release=357917e`，migration 13 / 14 生效，`project_events` 已建。
- 本机 CLI 更新到 `opc-bridge 0.2.0`，并加了路径映射 `D:\Projects\video → video-project`（该项目没有 git remote）。
- 真实视频项目走完一遍：现场检查（hypit 0.1.9 / runtime profile / 三个自建 provider / ffprobe 成片 720x1280 30fps 8.000s）→ 一次回流 5 条事件（`skipped_events_only`，未调用模型）→ `opc bootstrap` 返回阶段、决定与理由、环境验证（本机）、阻塞、下一步与记录 ID → 按下一步新增并运行 `scripts/check-distribution.mjs`（112 个内部包 junction / 13 个外部依赖 / 字体齐全，退出码 0）→ 回流第 6 条事件。
- 边界实测：同 `submission_id` 重发 `deduped:true`；其他机器 / 分支 / 更早提交的记录被标注且 `verifiedOnThisMachine:false`；含密钥的载荷返回 `redactions:2` 且库内为脱敏文本；`OPC_SERVER` 不可达时 `queued:true` 并在下一次命令自动补发。
- 页面用 Playwright 实测：项目详情「最近进展」与空间页候选处置（保存后待整理 0 / 最近处理 1）。
- 业务仓库没有产生 OPC 文件；配置、机器身份、缓存、日志与队列都在 `%LOCALAPPDATA%\OPC\`。

### 未验证

- 真实"新对话"接续：Codex 任务 `01a0aa96-664b-7450-b786-23e383c04b3a` 两次都在本机 CC Switch 代理层失败（DeepSeek `/responses` HTTP 400 `missing field call_id`），因此"新会话自己恢复并接续"没有真正跑通。最短验收指令：在 video 项目新开一个 Codex 任务，输入「先 `opc bootstrap` 恢复项目状态，核对本地文件后继续记录里的下一步」。
- 多机器场景只验证了标记与筛选逻辑，没有第二台真实机器。
- 候选处置的其它状态（已新增 / 暂存 / 舍弃）只在测试里覆盖，页面只实测了"已合并"。
- 自动修复脚本（而不只是检查脚本）仍未写。


## 2026-09-15 开发知识复用 V0（context / result）

日常开发保持「打开项目 → 给 Codex 任务 → 正常开发」，在后台按需取用 OPC 历史知识并回流结果。

### 已实现

- 服务端：`lib/knowledge/reuse.ts` 提供 `selectReusableKnowledge` / `recordTaskResult` / `getReuseOverview`；新增 `POST /api/v1/agent/context`、`POST /api/v1/agent/result`、`GET /api/v1/knowledge/reuse`。
- 数据库（migration 12）：`agent_task_results`（任务、改动、验证、发现、用过的知识及效果、总结）与 `knowledge_candidates`（候选经验，默认 pending）。上下文调用记录复用通用 `events` 表（`entity_type='agent'`），用于近期重复调用 Gate 与页面观察数据。
- 检索：只用 notes 池的标题 / 分类 / 标签 / 一句话说明 / 摘要让模型挑 0~3 条，相关性低于 70 分不返回，命中后才读取正文；10 分钟内相同仓库 + 相同任务复用上次结果，失败结果不缓存。
- 本地 Bridge：`bridge/opc.mjs` + `bridge/install.ps1` 安装到 `%LOCALAPPDATA%\OPC\`（bin / config / cache / logs）并加入用户 PATH；命令只有 `opc context` / `opc result`（另有 `doctor`），仓库名从 git remote 解析，任何失败都返回可读 JSON 且退出码 0。
- 全局 `~/.codex/AGENTS.md` 加入短规则：值得复用才查、机械修改不查、有价值才回流、不往项目仓库写 OPC 文件。
- 页面：空间页顶部只读「知识复用」面板（最近调用 / 候选经验 / 知识使用情况）。

### 已验证（2026-09-15）

- `npm test` 61 项通过（新增 14 项：context Gate 与相关性、失败与重复调用、截断重试、结果回流与候选经验、Bridge 参数与仓库解析）；lint、`tsc --noEmit`、`next build` 通过。
- 三个真实仓库场景（本地 OPC + 真实模型）：
  - 简单任务（按钮文案类）：按 Gate 不调用，数据库没有对应记录。
  - 复杂但无历史经验（flow-skill：录音实时降噪）：`context` 正常返回 `no_relevant_knowledge`，开发不受影响。
  - 有历史经验（skill-runtime：执行期只记候选、任务后批量整理）：返回 3 条相关知识（含正文与理由）；`opc result` 保存 `task-20260915-001`，3 条知识判定「有效」，生成候选经验 1 条。
- `git status`：vibe / flow-skill / helm 没有出现任何 OPC 文件（vibe 中两个未跟踪文件是 9-11 与 5-8 的既有文件）。
- 页面实测：空间页显示 7 次调用 / 4 次命中 / 1 条结果 / 1 条候选，三个观察列表内容与 Bridge 日志一致。

### 服务器部署（2026-09-15）

- `/opt/apps/opc` 快进到 `7e50f89`，`.env` 的 `MYOPC_RELEASE=7e50f89`；部署前备份 `/opt/backups/opc/pre-reuse-7e50f89.sqlite`（完整性 ok、无外键违规），容器重建后 `restarts=0`。
- migration 12 已在服务器数据库生效（`schema_migrations` 到 12，新增 `agent_task_results`、`knowledge_candidates`）。
- 接口实测：`POST /api/v1/agent/context`（任务「[部署验证] 确认开发知识复用接口可用」）由真实模型返回 1 条相关知识（`safe-deploy`，含理由与正文）；`GET /api/v1/knowledge/reuse` 显示 1 次调用、1 次命中；`/api/v1/health` 返回 `release=7e50f89`；同步定时器保持 active。

### 未解决 / 未验证

- Bridge 仍指向本机 `http://127.0.0.1:3000`；要用部署实例需要在 `%LOCALAPPDATA%\OPC\config.json` 填 `serverUrl` 与 Basic Auth。
- 候选经验只在 OPC 中排队，还没有整理进知识仓库的流程。
- 相关性阈值（70）与「通用判断不算相关」的抑制效果只在小样本上观察过；notes 变多后需要重新评估检索方式。
- 目前只有 notes 参与复用，项目 / 工具 / 图谱暂不参与。
- Codex 自动调用对方案质量的实际影响尚未独立评估，目前验证的是命令链路、Gate 与不阻塞行为。

## 2026-09-15 图谱（map）知识类型

知识仓库新增第四类条目 `map`（`maps/` 目录）。OPC 已端到端打通：同步读取 → 索引 → 模型加工 → API → 页面。首个真实条目「kill-doc 网页内容提取与重建结构」（`map_type: architecture`）已在本地同步并用真实模型生成 `reading-note-v6` 阅读说明。

### 已实现

- 类型与存储：`KNOWLEDGE_KINDS` 增加 `map`，目录映射 `maps/`；front matter 的 `map_type` 与其它未识别字段一样进入 `extra_json`，服务层以 `mapType` 返回；同步、更新、删除、内容哈希与失败保留等机制沿用原路径。
- 规程：`reading-note-v5` → `reading-note-v6`。Map 的加工目标为说明整体结构、关键关系与分界，只提取图与正文明确存在的内容；提示词明确禁止修改 Mermaid、重设图结构、增删节点和把推断写成事实。结果仍只写入 `knowledge_reading_notes`，不覆盖原文。
- 关系：仍只用 front matter 的 `related`，服务端在详情接口里把单向声明合并成双向。kill-doc 工具页因此会出现「相关图谱」，Map 页会出现「相关工具 / 相关方法」，按 kind 分组并可点击跳转。
- 页面：左侧导航新增「图谱」（不叫知识图谱），总览新增一列；列表卡显示 Map 类型、一句话说明、核心结构简述与标签，不渲染 Mermaid；详情页以主图为第一视觉主体，支持查看大图与放大/全屏，渲染失败时显示错误和源码回退（并清理 mermaid 遗留的临时节点）。
- 依赖：新增 `mermaid`（客户端按需加载），不引入图数据库或 Markdown 渲染框架重构。

### 本地验证（2026-09-15）

- `npm test` 47 项通过（新增 8 项覆盖 map 解析、目录与 kind 校验、同步增删改、内容哈希、规程版本、加工约束与双向 related）；`npm run lint`、`npx tsc --noEmit`、`npm run build` 通过。
- 知识仓库同步到 `70cadcda`：新增 4 条（含 kill-doc 工具、两条笔记与首个 Map），25 条索引，无未索引文件。
- 真实模型加工 kill-doc Map 成功；`GET /api/v1/knowledge?kind=map` 与条目详情返回 `kind=map`、`mapType=architecture`，工具条目详情返回相关图谱。
- 浏览器走查：图谱入口 → kill-doc Map 列表 → 详情 Mermaid 正常渲染（含「查看大图」放大到 150%）→ 相关工具跳转 → 工具页相关图谱跳回 → 返回图谱列表；另用故意写坏的临时 Mermaid 验证失败回退后已还原知识仓库（工作区干净）。
- 规程版本变化会让所有条目重新进入待加工：本地只重新加工了 kill-doc Map 一条；其余 24 条在 2026-09-15 部署时已用 v6 全部重做。

### 服务器部署（2026-09-15）

- `/opt/apps/opc` 快进到 `6efa94b`，`.env` 中 `MYOPC_RELEASE=6efa94b`；`sudo docker compose -f deploy/opc-server.compose.yml up -d --build` 重建并重启容器，`restarts=0`。
- 部署前备份 `/opt/backups/opc/pre-maps-6efa94b.sqlite`（SQLite backup API；`integrity_check=ok`，无外键违规）。
- 容器内同步知识仓库到 `70cadcda`：25 条可见条目、0 个未索引文件、`promptVersion=reading-note-v6`。
- 真实模型加工：先做 kill-doc Map，随后批量重做全部条目，25/25 为 v6 `ready`、0 待加工、无失败状态。
- 接口：`127.0.0.1:3011/api/v1/health` 返回 `release=6efa94b`；`GET /api/v1/knowledge?kind=map` 返回 1 条 `kind=map` / `mapType=architecture`；`kill-doc` 详情包含相关图谱；外部 `http://124.222.190.89:3010/` 返回 401（Basic Auth 生效）。
- 页面：从本机经 SSH 隧道访问服务器实例（绕过 OpenResty 网关）走查图谱入口 → 列表 → 详情，2 张 Mermaid 正常渲染，「关键分界 / 内容能力边界 / 可迁移理解」与「相关工具 / 相关方法」分组正确。

### 未解决 / 未验证

- `:3010` 的登录态页面未在浏览器实测（Basic Auth 口令不在服务器 `.env` 中），只确认了 401 与内部实例渲染；用户登录后可自行确认。
- 目前只有一条真实 Map，列表与详情在更多图谱下的效果未验证；Map 只渲染原文 Mermaid，不提供在线编辑。

## 2026-09-12 加工规程更新（代码已修改，服务器未部署核对）

v5 按项目用途与阶段、工具场景与能力、笔记观点与条件分别生成摘要，保留证据限定和具体版本来源。输出字段与加工机制不变。语法与提示构造检查通过，未调用真实模型。需要部署应用新版后重新加工；仅同步知识仓库不会更新规程。独立页面方案见 `docs/PAGE_REVISION_PLAN.md`，尚未实施。以下部署与验证数字保留为历史记录。

## 本轮改造（2026-09-10）

OPC 从“自建素材、行动与成果的工作台”改为**读取独立知识仓库、按规程生成阅读说明、再由页面展示**。内容源是私有仓库 `kioooice/MYOPC-Knowledge`，OPC 只读该仓库；素材收藏仍归 Karakeep，内容运营仍归 Easel。历史业务数据（素材、行动、成果版本、反馈）保留在数据库里，只是不再作为主要流程。

### 已实现

- 知识解析与索引：`lib/knowledge/`（YAML 子集解析、快照读取、SQLite 索引、同步状态）。
- 模型加工：“阅读说明”规程当前为 `reading-note-v5`（版本以 `lib/knowledge/reading-note.ts` 为准），输出完整说明、列表卡 `card`、首页 `brief` 三档；模型调用与结果解析在同一套重试里，截断、空内容和格式错误都会再试一次。
- 数据表：`knowledge_entries`、`knowledge_reading_notes`、`knowledge_sync_state`（migration 10）。
- 接口：`GET /api/v1/knowledge`、`GET /api/v1/knowledge/entries/:id`、`POST /api/v1/knowledge/sync|notes|process`；`sync` 会先把知识仓库快进到远端最新（拉不动时说明原因并只重建索引）。条目状态分为 ready / stale（待更新）/ failed / missing；加工失败会保留上一次可用说明，并继续算作待加工。
- 页面：总览、项目、工具、空间改为知识条目视图；空间按 `category`（方法 / 经验 / 判断）分组并提供筛选按钮；项目按状态排序（进行中在前、已暂停在后）；卡片先给内容、路径与来源收入详情折叠区，顶栏显示“上次同步”并可展开看来源版本；条目详情显示阅读说明、原文、来源、更新时间与加工状态；同步与加工在页面上手动触发。
- 命令行与定时任务：`npx tsx scripts/knowledge-sync.ts`，服务器用 `deploy/knowledge-sync.sh` + systemd timer。

### 本地验证

- `npm test`：30 项通过，其中 11 项覆盖知识解析、同步幂等、内容变化、删除不可见、模型失败保留上一次结果。
- `npm run lint`、`npx tsc --noEmit`、`npm run build` 通过。
- 首次接入时（历史记录）同步 17 条、生成 17 份说明；当前知识仓库为 **29 条**（8 项目、2 工具、19 条笔记）。
- 浏览器实测：总览显示同步状态与最近更新；项目列表 6 条；MYOPC 详情页显示阅读说明、生成/重新生成按钮与入口链接。

## 服务器部署（2026-09-10）

- 应用提交 `df248f8` 已部署到 `124.222.190.89`，容器 `myopc` 由本仓库 `deploy/opc-server.compose.yml` 构建（`name: opc`），健康检查返回 `status=ok`、`release=df248f8`。
- 挂载：`/opt/data/opc → /data`（数据）、`/opt/data/knowledge/myopc → /knowledge`（只读知识仓库）、`/opt/data/knowledge/commit.txt → /knowledge-commit.txt`（来源版本，容器内没有 git）。
- 代码与知识仓库都改用只读 Deploy Key：`/root/.ssh/myopc-deploy`、`/root/.ssh/myopc-knowledge`；服务器可自行 `git fetch`，不再依赖本地传输。
- 服务器同步结果：29 条索引、0 条待加工、29 份阅读说明 `ready`（Skill Runtime 与 Brain Desktop 两次全量收集共新增 11 条）。
- 定时任务 `opc-knowledge-sync.timer` 每 30 分钟拉取知识仓库并调用同步与加工接口；无更新时一次运行约 5 秒，几乎全部是到 GitHub 的网络往返，加工只在内容变化时发生。
- 部署前备份 `/opt/backups/opc/pre-knowledge-51443d9.sqlite`，完整性检查与外键检查通过；容器重启后条目、阅读说明与来源版本仍可读取。
- 从本机（另一台设备）访问 `http://124.222.190.89:3010/` 返回 401（Basic Auth 生效）；`3011` 只监听本机回环，未对外暴露。

### 未验证

- 用户已在本机浏览器登录确认页面数字与内容；第二台设备仍未实测。
- 收集不要求单独对话；`sources.yaml` 里仍有来源的 `collected_commit` 是 `pending`。
- 模型输出只做结构校验，未逐条人工复核；`inferences` 是模型推断，不是已验证事实。
- Easel、Karakeep 与 OPC 之间仍是人工交接，没有自动同步。

## 历史

旧服务器、域名与 Tailscale 记录不代表当前状态。`ACCEPTANCE_REVIEW.md`、`REACCEPTANCE.md`、`S0_EVIDENCE.md` 只对应当时。
