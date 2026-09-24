# 当前状态

## 2026-09-25 对话背景最小读写链路（独立增量，待跨任务复验）

- 私有 workspace 新增个人主题 `personal-collaboration-preferences`。当前记录 `a4e8837b-cf7d-488b-975c-27001cda3e61` 为 `origin=user / assertion=reported`，来源为讨论 task `01a0d506-0f7a-7af0-9fd7-7a411f19d32f`，通过原有 `set_current` / `expected_current_id` 机制保存；初始记录 `719f61c5-a3b9-4c53-b5f4-3ca597043888` 保留在历史。
- “提醒时机”回答歧义单独留为历史 question `3967175a-29b1-414f-84c9-48e768c0c4c1`（`origin=agent / assertion=inferred`），不在当前头，不构成主动通知授权。
- 用户级全局规则按固定 subject ID 读取个人当前理解，不对偏好全文做任务关键词匹配；只有背景可能改变建议时触发，机械任务不读。另按实际谈论的项目恢复其自身 `opc bootstrap` / workspace 状态，知识选择结果不替代个人或项目状态。
- 本轮通过已配置 Bridge（`http://124.222.190.89:3010`）写入，创建及记录均返回 `saved=true / queued=false`。真实 CLI context 请求只带 `subject_ids`，响应 `scope.query=null`，返回完整个人 current、`origin/assertion/source_locator`、历史引用和记录 ID。
- 项目状态实测从 `D:\Projects\video` 运行 bootstrap：身份 `video-project`、branch `main`、commit `f5bcc22`，44 条记录；响应标记 `truncated=true` 且 33 条对应较早提交。可见近期事实包括“不做固定系列、普通技术分享（痛点→工具→拆解）”及 Q 版角色与真人拳击动作不搭配的用户反馈。本轮只验证状态可读，不将其扩写为新的内容策略。
- 未改 OPC 应用代码或部署；既有服务版本以最近一次已验证记录 `cfe1adf` 为准。仍待讨论任务用不附带偏好正文的新任务独立复验自动触发及回答是否因背景而变化；本轮不进入页面第二轮重组、反馈生成或阶段 4/5。

## 2026-09-19 阶段 3 后空间知识可用性增量（当前收口）

- 本轮是阶段 3 第一轮主任务验收通过后的用户授权增量，不改变阶段坐标；当前等待真实使用反馈，不启动下一阶段。
- 知识仓库 `c4057f0` 已推送并同步到生产：`updated=7、unchanged=27、total=34`，7/7 定向阅读说明完成，`pendingNotes=0`。首轮 16 条 notes 的实际修改 / 复查口径已在历史记录中校正，本次补强 4 条关键 notes。
- 应用 `cfe1adf` 已推送并部署。缓存按已返回候选内容 / 阅读说明版本失效，`no_relevant_knowledge` 按候选池 / 同步版本失效，选择理由保留；调用面板改为“返回条数”，效果分类标明模型或调用方提供且未独立验证。
- 生产 `release=cfe1adf`、health `ok`、容器重启数 0。部署前 / 后备份为 `/opt/backups/opc/pre-knowledge-cache-cfe1adf-20260919T051729Z/myopc.sqlite`、`/opt/backups/opc/post-knowledge-cache-cfe1adf-20260919T051840Z/myopc.sqlite`；两次完整性 `ok`、外键错误 0。
- 浏览器已核对空间指标和图谱详情；通用说明区已移除，列表摘要、图谱原图 / 原文 / 边界 / 相关知识 / 来源可读，控制台 errors/warnings 0。Easel `7860 -> 7861`、Karakeep `3020 -> 3021` 入口已只读确认，认证后内容未核对。

### 当前遗留与边界

- 生产仍有 31 条待整理候选、0 条已处置；不在本轮做候选处置或页面反馈生成。
- `task-20260919-009` 是一次接口验证，三条效果均为 `unknown`；`task-20260919-013` 是回流整理记录，不是第二次真实业务闭环。没有采用、有效性或效率对照。
- 本轮停在现有知识复用 / 图谱验收，不进入页面第二轮重组或阶段 4/5；其他机器登录态、Easel/Karakeep 认证后内容仍未核对。

## 2026-09-19 空间知识可用性与图谱复用（历史首轮，已由上方收口记录校正）

- 知识仓库已推送 `4309dfc`：16 条变更笔记已整理，14 个项目与 3 个工具完成有界核对，现有 `kill-doc-content-pipeline` 图谱保留；同步统计 `0/16/18/0/34`（added / updated / unchanged / removed / total），16/16 阅读说明重做完成，`pendingNotes=0`。
- 应用提交 `41f3bf5` 已推送并部署。生产 `release=41f3bf5`、health `ok`、容器重启数 0；真实 `POST /api/v1/agent/context` 命中 1 张图谱 + 2 条笔记并返回理由与原文，`task-20260919-009` 已回流且三条效果均为 `unknown`。规程回流另生成 `task-20260919-013` 和 2 条待处置候选经验，未把模型分类当成业务效果。
- 收尾后的生产复用概览为 `calls=20、usedCalls=17、results=76、pendingCandidates=31、resolvedCandidates=0`；候选仍未进入合并 / 暂存 / 舍弃处置。
- 空间和图谱入口已通过生产 SSH 隧道浏览器复验：使用提示、图谱列表、Mermaid 主图、关键分界、边界、相关知识、来源和原文入口均可读；控制台错误 / 警告 0。知识复用继续保留最多 3 条、缓存、阈值与正文截断规则。
- 部署前 / 后备份：`/opt/backups/opc/pre-knowledge-reuse-41f3bf5-20260919T123748/myopc.sqlite`、`/opt/backups/opc/post-knowledge-reuse-41f3bf5-20260919T124947/myopc.sqlite`；两次完整性均 `ok`，外键错误均为 0。

### 历史遗留与边界

- 命中不等于采用，采用不等于有效；应用层只有一次真实接口验证，没有效率、采用或业务结果对照，另生成的 2 条候选经验尚未处置。
- 本轮只做知识空间可用性和图谱复用收口，不进入页面第二轮重组、反馈生成或阶段 4/5；未新增图谱、编辑器、向量库或自动关系推理。
- 候选经验完整处置闭环、其他机器登录态以及 Easel / Karakeep 的实际使用入口仍待后续有真实需求时核对。

## 2026-09-19 阶段 3 第一轮用户体验调整（历史，主任务验收通过）

- 根据用户体验反馈完成局部调整：移除首页 / 详情页更正说明、复制提示、系统定位和逐条“定位更正”按钮；保留数据层更正、当前头、历史与来源能力，用户改为在 Codex 入口自然反馈。
- 首页顶部改为“需要你决定”和“AI 已替你做的决定”两块。AI 面板只接受当前、`kind=decision`、`slot=ai_decision`、`origin=agent`、`assertion=reported` 且带来源定位的记录；用户决定、普通执行观察和无显式标记的 agent 决定不提升。`slot=collaboration` 的旧协作机制记录与 MYOPC 的 `stage / next_step` 不进入首页当前理解或当前工作，只在主题详情 / 历史保留，未用中文关键词过滤，也未删除生产记录。截断 AI 决定显示部分摘要提示并提供主题入口。
- 应用提交 `144058a`、`874c434`、`d44bd00` 均已推送；生产运行 `d44bd00`，健康接口返回 `status=ok`，容器 `running / RestartCount=0`。本轮未写入或修改生产 workspace 记录，生产仍为 2 个主题、7 条记录、4 个 heads。
- 本机验证：模型回归 7/7，完整 `npm test` 102/102，`npm run lint`、`npx tsc --noEmit`、`npm run build` 通过；隔离浏览器合成数据验证用户 / AI 决定归类、截断摘要入口、内部阶段同时移出当前理解与当前工作、其他项目真实状态保留、详情与历史保留、390px 无横向溢出；生产隧道浏览器验证首页、主题详情、390px 和控制台错误为空。
- 部署前后备份分别为 `/opt/backups/opc/pre-stage3-ux-d44bd00-20260919T005100Z/myopc.sqlite` 与 `/opt/backups/opc/post-stage3-ux-d44bd00-20260919T005100Z/myopc.sqlite`，两次 SQLite backup/verify 均 `integrity=ok`、外键错误 0，哈希一致。
- 遗留与边界：主任务验收通过，等待用户体验反馈；不进入页面第二轮重组、反馈生成、阶段 4 或服务器以外的经营部署。

## 2026-09-19 阶段 3 第一轮技术验收通过（历史基线）

- 原讨论任务已独立复验阶段 3 第一轮技术验收通过；当前等待用户体验反馈，第二轮接续尚未启动。本轮只补 `content_preview / content_truncated` 的明确展示、已知显式待决保留、当前工作区部分加载提示和首页前 8 条当前理解的继续查看提示。
- 应用提交 `0019f1a` 已推送并部署；生产 `/opt/apps/opc` 与远端 `main` 均为 `0019f1a`，健康接口返回 `status=ok、release=0019f1a`，容器 `running / RestartCount=0`。
- 本机验证：`npm test` 10 个文件 / 100 个测试全部通过，`npm run lint`、`npx tsc --noEmit`、`npm run build` 通过；隔离浏览器合成响应验证预览可见且有截断标注、已知待决保留、工作状态提示、8 条上限提示、主题详情入口，390px 无横向溢出、控制台错误 0。
- 生产部署前后备份分别为 `/opt/backups/opc/pre-stage3-preview-repair-0019f1a-20260919T000401Z/myopc.sqlite` 与 `/opt/backups/opc/post-stage3-preview-repair-0019f1a-20260919T000538Z/myopc.sqlite`，两次 `integrity=ok`、外键错误 0；未写入生产测试记录。Bridge `opc doctor` 可达，待补传队列 0。
- 生产 `myopc-stage2` 已通过既有 workspace/Bridge 幂等追加并复读确认：`stage` 当前记录 `b4be1c64-7ce8-4c19-b618-525e8e020b19`，`next_step` 当前记录 `a8fdf5a6-d3de-4fbd-b35f-c31733ddf950`；分别替换旧 head，来源与历史保留，未创建个人内容或待审批记录。
- 遗留与边界：等待用户体验反馈；不进入阶段 3 第二轮、反馈生成或阶段 4。

## 2026-09-19 阶段 3 第一轮验收补修（历史）

- 原讨论任务已将首轮页面交付 `b185992` 退回补修；当前只记录“首轮已交付、正在验收补修”，不宣称原讨论任务已经验收通过，也不进入第二轮接续或阶段 4。
- 本轮修复默认入口与导航语义、事件证据状态和业务工作状态的分离、显式待决判定、摘要省略 / 截断提示、主题详情历史分页、剪贴板失败兜底及用户文案；新增纯函数回归覆盖这些边界，并补充 `icon.svg`。
- 本机验证：`npm test` 99/99、`npm run lint`、`npx tsc --noEmit`、`npm run build` 通过；隔离本地实例浏览器验证默认 OPC 总览、主题跳转、跨板块关联、106 条历史继续读取、HTTP 剪贴板兜底和 390px 无横向溢出，页面错误为空。
- 生产已切换到应用提交 `72a0ff7`，健康接口返回 `release=72a0ff7`，容器 `running / RestartCount=0`；部署前备份 `/opt/backups/opc/pre-stage3-repair-72a0ff7-20260919T074100Z/myopc.sqlite`，部署后备份 `/opt/backups/opc/post-stage3-repair-72a0ff7-20260919T074500Z/myopc.sqlite`，两次均 `integrity=ok`、外键错误 0。
- 生产 `myopc-stage2` 的 `stage` head 已用 `585a8656-6b8c-47fe-91a1-bc627e80fa26` 追加更正，明确“第一轮已交付、正在验收补修”，保留旧记录和 `opc:event:evt-20260918-79795c` 来源；当前数据库为 2 个主题、5 条记录、4 个 heads。Bridge `opc doctor` 可达且待补传队列为 0。
- 服务器隔离回归（`NODE_ENV=test`）排除既有 Linux 环境不适配的 `tests/bridge.test.mjs` 后为 88/88；完整套件为 97/99，剩余 2 个失败均为 Bridge 在 Linux `/app` 下解析 Windows 仓库路径的既有断言。服务器通过 SSH 隧道浏览器复验默认入口、补正主题详情和 390px 无横向溢出，页面错误为空。

## 2026-09-19 阶段 3 第一轮页面交付

- 阶段 3 第一轮已交付但等待原讨论任务验收，应用提交为 `b185992`，服务器运行版本为 `b185992`。新增只读工作区页面：变化总览、个人 / 个人项目 / 企业项目 / 自媒体四个板块、主题详情、来源时间与状态、当前头 / 历史技术记录、跨板块引用和 Codex 更正定位；旧项目、工具、空间、图谱入口保留。
- 首轮实现曾把项目事件状态直接放入业务工作列；已在上方验收补修中改为分离证据状态和显式业务状态。待决语义也以显式当前标记为准。
- 生产通过既有 workspace API / Bridge 写入两条非敏感主题：`personal-opc-direction`、`myopc-stage2`；共 4 条当前记录、4 个 heads。企业项目、自媒体保持 0 个主题，没有导入聊天全文、家庭、财务、联系方式或完整个人记忆。主题内容只记录已确认的 OPC 方向、协作约定、阶段 2 复验和阶段 3 第一轮回原讨论任务验收。

### 验证与部署

- 本机 `npm test`：95/95；`npm run lint`、`npx tsc --noEmit`、`npm run build` 通过。隔离 `MYOPC_DATA_DIR` 的页面数据走查覆盖桌面与 390×844 窄屏；变化总览、个人项目主题详情、企业项目 / 自媒体空状态均可见。workspace subjects、四个 context、bootstrap、主题详情请求均 HTTP 200，浏览器控制台无页面错误。
- 服务器部署：从 `c127653` 快进到 `b185992`，容器 `myopc` running、`RestartCount=0`，认证 `opc doctor` 返回 `release=b185992`；旧 dashboard、knowledge、workspace subjects/context 与页面均可读。部署前备份 `/opt/backups/opc/pre-stage3-b185992-20260918T192520Z/myopc.sqlite`，写入后备份 `/opt/backups/opc/post-stage3-20260918T192936Z/myopc.sqlite`；两次完整性检查均 `integrity=ok`、外键错误 0。回退镜像保留为 `opc-myopc:rollback-c127653-20260918`。
- 远端 Linux 全套测试为 94/95，唯一失败是既有 `tests/bridge.test.mjs` 对 Windows 路径 `D:\Projects\video-other` 的平台假设；排除该文件后 84/84，lint、build 通过。本轮未为无关 Bridge 平台差异改业务代码。

### 遗留与范围边界

- 生产记录中 `opc:event:*` locator 由来源解析器标为待解析，页面明确显示来源警告，不能把它当成已验证链接；仓库与主题引用本身可追溯。
- 阶段 3 第二轮跨对话接续验证、阶段 4 反馈生成、阶段 5 真实使用验收均未开始；本轮停在阶段 3 第一轮，不进入页面重组第二轮、反馈生成或服务器以外的经营部署。

## 2026-09-19 阶段 2 验收补修完成

- 阶段 2/5（S2.1—S2.5）已完成并部署服务器，修复提交为 `c127653`，运行版本同步为 `c127653`；阶段 3 页面重组、阶段 4 反馈生成、阶段 5 真实使用验收未开始，主页面未改动。
- `buildContext` 现在优先保证 `subjects[].current`：`items` 改为当前记录的紧凑索引，避免正文重复占用预算；历史与来源按剩余字符预算附加，并分别返回 `history_omitted_count` / `sources_omitted_count` 与截断标记。
- 超预算时保留可接续的最小当前状态并标记 `current_truncated` / `budget_exceeded`，已有当前记录不再误报为 `reason=no_records`。`omitted_ids` 只包含因 limit 或字符预算省略的已存在主题，`missing_subject_ids` / `missing_count` 单独报告缺失主题，`omitted_count` 与去重 ID 一致。
- 新 API、旧 API、Bridge 写入幂等、current/history、clear 和冲突语义保持不变；返回契约说明已同步到 [DELIVERY_PLAN.md](DELIVERY_PLAN.md)。

### 本地验证

- `npm test`：95 项通过（新增长当前记录、历史 / 来源较多、最小预算、limit 省略及缺失主题回归）。`npm run lint`、`npx tsc --noEmit`、`npm run build` 均通过。
- 独立临时 `MYOPC_DATA_DIR` + HTTP + CLI 实测：3000 字 synthetic 当前记录默认 `used=true`、正文完整、响应约 4758 字；6 个同板块主题 `limit=2` 返回 2 个主题、`omitted_count=4` 和 4 个省略主题 ID；`opc workspace` CLI 返回同样语义。测试数据未写入生产。

### 服务器增量部署与限制

- 服务器 `http://124.222.190.89:3010` 已切换到 `c127653`；切换前 SQLite backup API 备份为 `/opt/backups/opc/pre-workspace-fix-20260918T182748Z/myopc.sqlite`，完整性 `ok`、外键错误 0；原运行镜像保留回退标签 `opc-myopc:rollback-c6699a7-20260918`。
- 容器构建、启动和健康检查通过：`restarts=0`，认证 `opc doctor` 返回 `release=c127653`；认证旧知识接口 HTTP 200，新 workspace subjects/context 接口可读且当前生产 workspace 仍为 0 个主题；未认证公网请求返回 401，Basic Auth 仍生效；生产数据库 migration 15、workspace 三张表均保持 0 条记录。
- 服务器镜像仍排除 `.env` / `.env.local`，运行配置未打印、未提交；本地未跟踪 `.playwright-cli/`、`work/` 和服务器原有 `docker-compose.prod.yml` 均保留。
- Linux 隔离测试为 93/95：失败的 2 个既有 Bridge 用例都依赖 Windows 工作目录 / `D:\Projects\...` 路径；本机 Windows 95/95 全通过，未为平台差异扩大业务改造。
- 来源读取仍是确定性提示；页面没有接入 workspace，阶段 3 才讨论首页与四板块页面；阶段 4 反馈和服务器部署以外的真实经营价值未验证。

## 2026-09-18 阶段 2 执行前的设计交接（历史）

- 用户确认产品以个人借助 AI 实现目标为中心，一级板块为个人、个人项目、企业项目、自媒体。
- 统一执行入口为 [DELIVERY_PLAN.md](DELIVERY_PLAN.md)；本节保留阶段 2 执行前的设计交接背景，当前完成坐标以上方阶段 2 记录为准。
- 本轮只更新方案和交接文档，没有修改应用代码、数据库、已安装 Bridge 或服务器。运行功能仍以以下 V0.2 记录和现场状态为准。
- 已核对本地与远端 main 在规划开始时均为 6c3a22e；既有未跟踪 `.playwright-cli/`、`work/` 保留。文档核查不等同于应用测试。
- 文档中不包含本次对话的私人财务、联系方式或简历内容。阶段 2 使用合成样例与独立本地运行目录。

## 2026-09-16 OPC V0.2（项目进展即时回流 + 新会话恢复）

日常开发不用再手动维护交接文件：有意义的阶段把关键进展回流到 OPC，新对话进入项目时先恢复一次项目状态，再核对本地事实继续。

### 已实现

- 阶段事件：`project_events`（migration 13）保存类型（plan / progress / decision / environment / finding / blocker）、内容、理由、状态、验证方式、证据、下一步、机器 / 分支 / 提交 / 未提交标记，以及 `supersedes_id / superseded_by` 更正关系。
- `opc result` 扩展：一次回流可以带多个 `--event`，也可以继续用原来的 `--task/--change/--validation/--finding/--knowledge-used`；`agent_task_results` 增加 `submission_id / machine / branch / commit_sha / dirty / event_count`，同一次回流重试按（submission_id, 序号）判重，不重复写入。
- 状态语义：`planned / reported / verified / blocked / superseded`。标记 `verified` 需要验证方式或证据，否则按执行方报告记录；服务器不会自动升级状态。
- `opc bootstrap`：新增 `POST /api/v1/agent/bootstrap`，按仓库 + 分支 + 提交筛选并组装恢复摘要（阶段、最近记录、决定与理由、环境验证、阻塞、下一步、冲突、记录 ID；`machine` 只作来源标注），结果有长度上限；`GET /api/v1/agent/events/:id` 读取单条记录详情。
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
- 本机 CLI 更新到 `opc-bridge 0.2.0`（验收修复后为 0.2.1），并加了路径映射 `D:\Projects\video → video-project`（该项目没有 git remote）。
- 真实视频项目走完一遍：现场检查（hypit 0.1.9 / runtime profile / 三个自建 provider / ffprobe 成片 720x1280 30fps 8.000s）→ 一次回流 5 条事件（`skipped_events_only`，未调用模型）→ `opc bootstrap` 返回阶段、决定与理由、环境验证（本机）、阻塞、下一步与记录 ID → 按下一步新增并运行 `scripts/check-distribution.mjs`（112 个内部包 junction / 13 个外部依赖 / 字体齐全，退出码 0）→ 回流第 6 条事件。
- 边界实测：同 `submission_id` 重发 `deduped:true`；其他分支 / 更早提交的记录被标注；含密钥的载荷返回 `redactions:2` 且库内为脱敏文本；`OPC_SERVER` 不可达时 `queued:true` 并在下一次命令自动补发。
- 页面用 Playwright 实测：项目详情「最近进展」与空间页候选处置（保存后待整理 0 / 最近处理 1）。
- 业务仓库没有产生 OPC 文件；配置、缓存、日志与队列都在 `%LOCALAPPDATA%\OPC\`。

### 验收修复（2026-09-17，提交 2aa4274 / bridge 0.2.1）

- Bridge 总开关统一覆盖所有网络操作：`enabled:false` 时 `result` / `candidates` / 队列补发 / `doctor` 健康检查都不访问服务器，回流也不会新增待上传内容，返回明确的 `bridge_disabled`（本机实测：待重传项的 attempts 保持 1，说明没有发起补发）。
- bootstrap 缓存键纳入当前提交与 `limit`：同分支换提交会重新获取并重算版本提示；待重传队列成功补发 result 后清掉该项目的恢复缓存（实测：补发 sent=1 后 `cache/bootstrap.json` 变为 `{}`）。
- 路径映射改为目录边界匹配：`D:\Projects\video` 及其子目录命中，`D:\Projects\video-other` 不命中，最长有效目录优先。
- 恢复摘要按分支范围筛选：当前阶段 / 阻塞 / 下一步只取当前分支范围（无分支记录仍算当前范围，video 照常恢复）；其他分支记录保留在 recent 并带来源标注，nextSteps 现在带 `branch` 与 `scope`（current-branch / unversioned / branch-unknown）。
- 提交 `2aa4274`；`npm test` 85 项、lint、tsc、build 通过；本机 CLI 已重装为 0.2.1（与仓库副本哈希一致），服务器已部署到 2aa4274（`release=2aa4274`，部署前备份 integrity ok）。

### 未验证

- 真实"新对话"接续：委派创建的任务 `01a0aa96-664b-7450-b786-23e383c04b3a` 两次都在第一次请求就失败——通过应用委派创建的任务会往新会话注入没有 `call_id` 的 `function_call_output`（`name: create_thread` / `send_message_to_thread`），DeepSeek `/v1/responses` 校验器直接返回 400 `missing field call_id`（已用最小请求复现：无 `call_id` → 400；带 `call_id` → 另一条校验错误）。普通会话里真实工具调用的 `function_call_output` 都带 `call_id`，所以只有委派创建的任务会失败。这不是 OPC 的问题。最短验收指令：在 video 项目**用界面正常新建任务**（不要用委派），输入「先 `opc bootstrap` 恢复项目状态，核对本地文件后继续记录里的下一步」。
- 开发只在本机（用户 2026-09-16 明确）：其他机器只在浏览器里查看 OPC 页面，不安装 bridge、不 bootstrap、不回流；`machine` 字段保留为记录来源标注（单机开发下它是同一个值），不做多机同步。
- 候选处置的其它状态（已新增 / 暂存 / 舍弃）只在测试里覆盖，页面只实测了"已合并"。
- 视频项目的发行版修复已从只读检查扩成 `--repair`（在干净 TEMP 重装场景验证过），原阻塞记录用新记录 `supersedes` 关闭；恢复摘要在这次也随之修正为"被替代的记录不再贡献下一步、更新时间取最新有效记录"。


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
