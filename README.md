# MYOPC

个人能力应用与 OPC（一人公司）经营工作台。

MYOPC 连接发现、个人积累、行动、成果和反馈，使下一次行动用上前一次的经验。Codex 承担主要规划、执行与分析，工作台提供持续可用的素材、方法、项目和成果视图。

**当前状态：主服务已迁移到新的私人云端工作节点并完成日常使用验收；GitHub `main` 为代码事实源，运行数据集中保存在服务器，PC1/PC2 通过 Tailscale 访问同一套服务。**  
**当前业务阶段：能力素材库和方法版本首个切片已实现；下一阶段围绕真实 Easel/H3 接入、内容生产复用与部署流程固化继续推进。**

## 从这里接手

- [阶段目标与验收](docs/DELIVERY_PLAN.md)：当前要做成什么，实现方案由执行模型独立承担。
- [当前事实与待验项](docs/STATUS.md)：进度、生产部署和验证边界。
- [独立验收记录](docs/REACCEPTANCE.md)：失败反例和复验结果。
- [产品规格](docs/PRODUCT_SPEC.md)、[架构与联动](docs/ARCHITECTURE.md)、[执行约定](AGENTS.md)。

## 当前运行方式

MYOPC 当前按“本地开发 → GitHub → 私人云端运行”使用：

```text
PC1 / PC2
  ├─ 本地开发与交互
  └─ Tailscale 访问
        │
        ▼
     GitHub main
   代码唯一事实源
        │
        ▼
     opc-cloud
  Node.js + systemd
      + SQLite
```

- 生产源码：`/opt/apps/src/opc`
- 持久化数据：`/opt/data/opc`
- 备份：`/opt/backups/opc`
- 服务：`myopc.service`，已启用开机自动恢复
- 访问：仅绑定 Tailscale 私网地址的 `3010` 端口，不开放公网应用端口
- 旧服务器：保留为 `LEGACY / FALLBACK`，不作为代码事实源，也不应与新实例同时产生新的业务写入

当前生产部署使用宿主机 Node.js + systemd，而不是 Docker Compose。原因是新服务器访问 Docker Hub 不稳定；项目已在 Node.js `v22.23.2` 上完成正式构建、运行、写入持久化和服务器重启恢复验证。Docker 仍保留为服务器基础能力，但不是当前 MYOPC 的运行依赖。

代码与运行数据明确分离：服务器源码可从 GitHub 重新获取，SQLite 和私有素材不能依赖源码目录保存。运行中的 SQLite WAL 数据不得只复制主数据库文件，迁移与备份应使用项目提供的维护入口或一致性快照。

## 当前生产方向

| 部分 | 分工 |
| --- | --- |
| MYOPC | 素材收纳、方法版本、项目行动、成品和结果关联 |
| Codex | 理解积累，提出有依据的内容角度，组织创作任务和分析反馈 |
| Easel | 账号定位、图文制作、平台适配、审阅、发布及运营 |
| AutoDL H3 | 按用户现有工作流承担视频生成，具体输入输出与连接需核对 |

能力板块同时包含素材库、方法与工具。链接、文本或文件即可收下，不强制项目、分类或完整档案；网页与 Codex 使用同一业务服务。支持多素材创作、原始来源、类型适配预览和使用记录。已使用不等于用完，脚本、图片和成片也可以回收再用。

Easel 的参考实现见 [ZJU-REAL/Easel](https://github.com/ZJU-REAL/Easel)。允许使用其自带 Agent，MYOPC 不复制聊天、账号管理或内容编辑器；也不建设 GPU 调度系统。

第一轮产出真实内容，第二轮实际使用前一轮素材、方法或判断并产出新成品。只归档或写复盘不算复用。图文、视频、工具实践和生活发现都可进入，不强制所有选题来自开发项目。

## 已有使用基础

已有行动、项目、成果版本、反馈、决策、共享接口、幂等和冲突保护。能力页可保存链接、文本和不超过 2 MB 的私有文件，浏览/搜索/预览并标记读取状态；方法以不可变版本保存，可选多份素材与一个方法版本发起行动。SQLite 备份会在同名 `.assets` 目录包含素材文件。

开发环境可直接使用项目当前支持的 Node.js 版本。当前生产已验证 Node.js `v22.23.2`；此前开发基线使用 Node.js 24+。Windows 可使用 `start.bat` 或 `start.ps1`。手动开发可运行：

~~~sh
npm install
npm run dev
~~~

使用 `MYOPC_DATA_DIR` 指定私有数据目录。共享服务连接通过私有配置提供 `MYOPC_BASE_URL`、`MYOPC_USERNAME` 和 `MYOPC_PASSWORD`；不将真实连接地址和凭据写入仓库说明。

通用客户端支持 context、start、draft、feedback、revise、decision，内容支持文件输入。写入用稳定的 `--request-id`，结果不确定时复用原请求编号和载荷；修订必须声明所基于的版本。能力接口示例：

~~~sh
curl http://127.0.0.1:3000/api/v1/library
curl -X POST http://127.0.0.1:3000/api/v1/captures -H "content-type: application/json" -H "x-client-request-id: capture-001" -d '{"title":"一条想法","content":"先写下事实","kind":"text"}'
curl -X POST http://127.0.0.1:3000/api/v1/methods -H "content-type: application/json" -H "x-client-request-id: method-001" -d '{"title":"实践转内容","purpose":"用事实形成内容角度","steps":["核对事实","确定受众"]}'
curl -X POST http://127.0.0.1:3000/api/v1/trials -H "content-type: application/json" -H "x-client-request-id: action-001" -d '{"title":"内容行动","goal":"为目标受众解释事实","method_id":"<method_id>","capture_ids":["<capture_id>"]}'
~~~

具体已实现接口与示例见 `scripts/continuity-client.ts` 和应用路由；架构文档的候选接口不等于全部实现。

~~~sh
npm test
npm run lint
npm run build
~~~

备份、校验、隔离恢复入口为 `npm run db:backup`、`npm run db:verify`、`npm run db:restore`，参数见 `scripts/db-maintenance.ts`。备份若包含素材文件，会同时创建 `<备份文件>.assets`；恢复时需保持该目录与数据库备份同名同目录。SQLite WAL 下不能只复制运行中的主数据库文件。多端通过同一共享业务服务读写，不把各端独立数据库当作自动同步。

## 真实性与范围

收藏不等于方法验证；生成不等于采用或发布；接口成功不代表已核实平台上线；内部反馈不冒充市场结果。授权发布和收费资源按实际范围执行，不从新规划推导任意发布或购买权限。

当前为可修订规划 v0.5。近阶段围绕真实使用展开，远期按证据扩展，不靠长提示词逐项指挥，也不把全部想法一次性做成平台模块。

仓库只保存代码、通用方法与脱敏交接。真实稿件、未发布媒体、账号信息、经营数据、服务器地址和运行凭据保存在私有存储。