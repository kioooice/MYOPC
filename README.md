# MYOPC

个人项目、工具与知识资产的线上应用。OPC 读取独立知识仓库里的 Markdown 条目，建立索引，按固定规程调用模型生成“阅读说明”，再由页面展示原文、来源和加工结果。

它是这条流程里的一环：开发对话在项目仓库留下记录，收集步骤把它们整理成知识条目（不要求单独开对话），OPC 负责同步、加工和展示。资料收藏交给 Karakeep，内容制作与运营交给 Easel。

## 内容从哪来

- 知识仓库：[kioooice/MYOPC-Knowledge](https://github.com/kioooice/MYOPC-Knowledge)（私有）。`projects/`、`tools/`、`notes/` 存放条目，`sources.yaml` 记录来源项目和收集版本。
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

- **项目 / 工具 / 空间**：分别读取知识仓库中的 `project`、`tool`、`note` 条目，列表显示状态、摘要、标签和加工状态。
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

原有的 captures、methods、projects、trials、deliverables、feedback 等接口保持不变，供历史数据和脚本客户端继续使用。

## 定时同步

`npx tsx scripts/knowledge-sync.ts --limit 3` 可同步索引并加工待处理条目，适合放到计划任务里；服务器上的做法见 [运行与部署](docs/DEPLOYMENT.md)。

## 开发

```sh
npm test
npm run lint
npm run build
```

界面改动要实际打开页面；数据逻辑改动跑相关测试。文档见 [阶段记录](docs/PROJECT_LOG.md)、[当前状态](docs/STATUS.md)、[待办](TASKS.md)、[产品说明](docs/PRODUCT_SPEC.md)、[代码架构](docs/ARCHITECTURE.md)、[运行与部署](docs/DEPLOYMENT.md)。
