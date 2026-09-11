# 当前状态

## 本轮改造（2026-09-10）

OPC 从“自建素材、行动与成果的工作台”改为**读取独立知识仓库、按规程生成阅读说明、再由页面展示**。内容源是私有仓库 `kioooice/MYOPC-Knowledge`，OPC 只读该仓库；素材收藏仍归 Karakeep，内容运营仍归 Easel。历史业务数据（素材、行动、成果版本、反馈）保留在数据库里，只是不再作为主要流程。

### 已实现

- 知识解析与索引：`lib/knowledge/`（YAML 子集解析、快照读取、SQLite 索引、同步状态）。
- 模型加工：“阅读说明”规程当前为 `reading-note-v4`（版本以 `lib/knowledge/reading-note.ts` 为准），输出完整说明、列表卡 `card`、首页 `brief` 三档；模型调用与结果解析在同一套重试里，截断、空内容和格式错误都会再试一次。
- 数据表：`knowledge_entries`、`knowledge_reading_notes`、`knowledge_sync_state`（migration 10）。
- 接口：`GET /api/v1/knowledge`、`GET /api/v1/knowledge/entries/:id`、`POST /api/v1/knowledge/sync|notes|process`；`sync` 会先把知识仓库快进到远端最新（拉不动时说明原因并只重建索引）。条目状态分为 ready / stale（待更新）/ failed / missing；加工失败会保留上一次可用说明，并继续算作待加工。
- 页面：总览、项目、工具、空间改为知识条目视图；条目详情显示阅读说明、原文、来源、更新时间与加工状态；同步与加工在页面上手动触发。
- 命令行与定时任务：`npx tsx scripts/knowledge-sync.ts`，服务器用 `deploy/knowledge-sync.sh` + systemd timer。

### 本地验证

- `npm test`：30 项通过，其中 11 项覆盖知识解析、同步幂等、内容变化、删除不可见、模型失败保留上一次结果。
- `npm run lint`、`npx tsc --noEmit`、`npm run build` 通过。
- 首次接入时（历史记录）同步 17 条、生成 17 份说明；当前知识仓库为 **16 条**（6 项目、2 工具、8 条笔记）。
- 浏览器实测：总览显示同步状态与最近更新；项目列表 6 条；MYOPC 详情页显示阅读说明、生成/重新生成按钮与入口链接。

## 服务器部署（2026-09-10）

- 应用提交 `df248f8` 已部署到 `124.222.190.89`，容器 `myopc` 由本仓库 `deploy/opc-server.compose.yml` 构建（`name: opc`），健康检查返回 `status=ok`、`release=df248f8`。
- 挂载：`/opt/data/opc → /data`（数据）、`/opt/data/knowledge/myopc → /knowledge`（只读知识仓库）、`/opt/data/knowledge/commit.txt → /knowledge-commit.txt`（来源版本，容器内没有 git）。
- 代码与知识仓库都改用只读 Deploy Key：`/root/.ssh/myopc-deploy`、`/root/.ssh/myopc-knowledge`；服务器可自行 `git fetch`，不再依赖本地传输。
- 服务器同步结果：16 条索引、0 条待加工、16 份阅读说明 `ready`。
- 定时任务 `opc-knowledge-sync.timer` 每 30 分钟拉取知识仓库并调用同步与加工接口；无更新时一次运行约 5 秒，几乎全部是到 GitHub 的网络往返，加工只在内容变化时发生。
- 部署前备份 `/opt/backups/opc/pre-knowledge-51443d9.sqlite`，完整性检查与外键检查通过；容器重启后条目、阅读说明与来源版本仍可读取。
- 从本机（另一台设备）访问 `http://124.222.190.89:3010/` 返回 401（Basic Auth 生效）；`3011` 只监听本机回环，未对外暴露。

### 未验证

- 未用 Basic Auth 凭据从第二台设备完整走一遍页面（只验证了可达性与认证拦截）。
- 收集对话尚未按 `sources.yaml` 产出新条目；`collected_commit` 多为 `pending`。
- 模型输出只做结构校验，未逐条人工复核；`inferences` 是模型推断，不是已验证事实。
- Easel、Karakeep 与 OPC 之间仍是人工交接，没有自动同步。

## 历史

旧服务器、域名与 Tailscale 记录不代表当前状态。`ACCEPTANCE_REVIEW.md`、`REACCEPTANCE.md`、`S0_EVIDENCE.md` 只对应当时。
