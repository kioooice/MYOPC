# 当前状态

## 本轮改造（2026-09-10）

OPC 从“自建素材、行动与成果的工作台”改为**读取独立知识仓库、按规程生成阅读说明、再由页面展示**。内容源是私有仓库 `kioooice/MYOPC-Knowledge`，OPC 只读该仓库；素材收藏仍归 Karakeep，内容运营仍归 Easel。历史业务数据（素材、行动、成果版本、反馈）保留在数据库里，只是不再作为主要流程。

### 已实现

- 知识解析与索引：`lib/knowledge/`（YAML 子集解析、快照读取、SQLite 索引、同步状态）。
- 模型加工：“阅读说明”规程 `reading-note-v1`，输出分为原文事实、关键选择与依据、步骤、适用条件、仍未确定、模型推断；校验失败会带着更严格的提示重试一次，被截断时提高输出上限重试。
- 数据表：`knowledge_entries`、`knowledge_reading_notes`、`knowledge_sync_state`（migration 10）。
- 接口：`GET /api/v1/knowledge`、`GET /api/v1/knowledge/entries/:id`、`POST /api/v1/knowledge/sync|notes|process`。
- 页面：总览、项目、工具、空间改为知识条目视图；条目详情显示阅读说明、原文、来源、更新时间与加工状态；同步与加工在页面上手动触发。
- 命令行：`npx tsx scripts/knowledge-sync.ts`（同步 + 按需加工），可直接用于定时任务。

### 已验证（本地）

- `npm test`：30 项通过，其中 11 项覆盖知识解析、同步幂等、内容变化、删除不可见、模型失败保留上一次结果。
- `npm run lint`、`npx tsc --noEmit` 通过。
- 真实知识仓库实跑：同步 17 条（6 项目、7 工具、4 笔记），提交 `44bb709`；用 `deepseek-flash` 生成 17 份阅读说明，全部 `ready`，来源哈希与规程版本随结果保存。
- 浏览器实测：总览显示同步状态与最近更新；项目列表 6 条；MYOPC 详情页显示阅读说明（原文事实、关键选择等）、生成/重新生成按钮与入口链接。

### 未验证

- 服务器尚未部署本次改造，`:3010` 仍是上一版；知识仓库尚未在服务器上检出，也没有配置定时同步。
- 未从第二台设备访问服务器确认同一份内容。
- 尚未接入收集对话的实际产出（`sources.yaml` 里的 collected_commit 仍多为 pending）。
- 模型输出的质量只按结构校验，未逐条人工复核；`inferences` 是模型推断，不是已验证事实。

## 历史

旧服务器、域名与 Tailscale 记录不代表当前状态。`ACCEPTANCE_REVIEW.md`、`REACCEPTANCE.md`、`S0_EVIDENCE.md` 只对应当时。
