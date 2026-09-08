# 代码架构与接口

## 实现结构

MYOPC 是 Next.js 单体应用：React / TypeScript 前端、Node.js 服务端、better-sqlite3 持久化。

| 路径 | 用途 |
| --- | --- |
| app/page.tsx、app/globals.css | 工作台页面与样式 |
| app/api/v1/[...segments]/route.ts | HTTP 请求分发 |
| lib/business.ts | 业务读写、校验与关联 |
| lib/db.ts | SQLite 连接与数据库结构 |
| lib/backup.ts | 一致性备份与校验 |
| scripts/continuity-client.ts | 可选 HTTP 脚本客户端 |
| start.bat、start.ps1 | Windows 本地启动 |
| tests/ | 业务与写入重试测试 |

当前默认本地单实例。网页和脚本客户端通过同一业务接口访问该实例；Git 只同步代码，不同步运行数据。

## 已有 API

以 route.ts 及 business.ts 为准，以下是当前入口概览：

| 方法 | 路径（前缀 /api/v1） |
| --- | --- |
| GET | /health、/dashboard、/library、/events |
| GET | /captures、/captures/:id、/captures/:id/file |
| GET | /methods、/methods/:id、/projects、/projects/:id |
| GET | /context?trial_id=... |
| POST | /captures、/methods、/projects、/projects/:id/locations |
| POST | /starts、/trials、/drafts、/deliverables |
| POST | /deliverables/:id/versions、/deliverables/:id/accept |
| POST | /feedback、/decisions |
| PATCH | /captures/:id、/projects/:id、/trials/:id |

请求载荷与约束参考业务函数和 tests/business.test.ts。不要将历史候选 API 当成已实现接口。

## 业务数据

素材、方法版本、项目、行动、成果版本、反馈、决策和事件通过稳定 ID 关联。
成果与方法修订创建新版本，历史引用保留。采用记录指向具体成果版本。

写入使用 X-Client-Request-Id；相同编号不同载荷拒绝写入。可变项目与行动使用 expected_revision；成果新版本使用 expected_previous_version_id。
这些机制是已有业务行为，文档精简不改变接口契约。

数据库和素材保存在运行数据目录，MYOPC_DATA_DIR 可指定位置。备份与运行方式见 DEPLOYMENT.md。
本地多实例各有数据，不自动同步。后续共享部署可让多个客户端访问同一服务。

## Easel 连接

Easel 独立运行。本仓库尚无完成的 Easel 自动任务适配器。
当前可手动交接素材、正文和产物引用，开发连接时依据实际安装版本核对接口。
双方分别管理自己的数据，避免直接修改对方数据库。

不要求为正常项目开发建设 MCP、模型路由、云端浏览器入口或通用任务编排。
