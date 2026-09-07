# MYOPC

个人能力应用与 OPC（One-Person Company，一人公司）经营工作台。

MYOPC 承载一个持续循环：发现需求或可能性 → 结合个人知识、能力与资源 → 形成尝试并行动 → 获得成果和外部反馈 → 更新方法与判断 → 影响下一次选择和行动。入口不固定，可以从一篇帖子、一个需求、已有能力或一次失败开始。副业经营是当前最明确的应用主线，个人能力和信息积累让下一轮拥有不同的起点。Codex 负责主要的规划、执行与分析，MYOPC 提供持续可用的业务界面与记录。

**当前状态：S0 最小应用已可在本机运行，并已部署到 `https://seizemoment.xyz` 作为两台电脑共用的单一数据服务。**

**当前阶段：共享状态与真实接续。** 从 [当前目标](docs/DELIVERY_PLAN.md) 与 [实际状态](docs/STATUS.md) 开始。固定样例只作为测试夹具；真实反馈、线上接续和第二台实机仍分别记录证据。

## 产品期望（不代表全部已实现）

- 随手收集链接、技能、工作流或自己的能力记录，不必先建项目。
- 查看一项能力能做什么、适用条件、待补缺口和实际验证证据。
- 将能力用于新项目或已有工作，并从结果回看具体使用的方法版本。
- 总览待培养能力、正在尝试的方向、待审核成果和最近变化。
- 进入项目，理解目标、阶段，直接查看稿件、视频和工具成果。
- 比较版本、留下意见、选定采用版本。
- 记录发布、投入和反馈，判断继续、调整或暂停。
- 让 Codex 读取当前工作上下文、写入产物并处理反馈，减少重复录入。

经营记录是事实来源；展示完成不代表发布完成，软件验收通过不代表商业验证成立。

## 产品边界

- 这是业务应用，不是 Agent、聊天客户端或多 Agent 调度平台。
- Codex 仍是主要工作入口；面板不需要模型才能运行。
- 文档、表格、看板、画布是可选视图，不能取代完整的业务交互。
- 第一版面向单个经营者，中文、桌面浏览器优先。
- 第一版不自动发布到流量平台，不接管账号，不建设 GPU 调度系统。
- 现有 Observer、Helm、Knowledge Engine 按明确需求接入，不预先合并。

## 规划与开发入口

1. [产品规格](docs/PRODUCT_SPEC.md)：业务对象、页面与关键交互。
2. [架构与联动约定](docs/ARCHITECTURE.md)：Codex 如何读写，以及持久化边界。
3. [阶段计划与验收](docs/DELIVERY_PLAN.md)：阶段目标、验证要求与停止扩张条件。
4. [当前状态与交接](docs/STATUS.md)：实际完成情况和下一步。
5. [执行规则](AGENTS.md)：开发模型必须遵循的仓库工作约定。

## 循环验证场景

能力循环检验“能否做出来、如何改进”；价值循环检验“对谁有用、是否值得继续”。两者互相校正，不要求每次学习立即变现，也不能用不断建设替代外部价值检验。

第一轮用低成本样例验证输入、行动、成果和反馈往返；第二轮必须实际读取上一轮积累，依据具体反馈改变方法、选题、适用范围或投入，再留下实际执行结果。只增加一篇复盘或复制旧记录，不算循环成立。

图文、视频、小工具是同一循环的不同载体。H3 帖子仍是需求示例，不是已收集或已验证资料；首阶段不要求购买 GPU 算力。

## 文档如何演变

当前为可修订规划 v0.4。已明确的是用户目标、Codex 与工作台的分工及记录真实性；页面、业务对象、接口和阶段顺序是当前方案，允许被场景验证修正。
只有文档时可以直接整体改写；已有代码、真实数据或外部承诺时，先检查依赖和影响，再同步调整。无需等想法稳定才写文档，也不因文档存在就冻结设计。
临近实现的部分细化，远期能力保留方向。变化应合并、替换并清理过时内容，而非不断追加模块。

示例数据必须明确标记。未真实生成、发布、收费的数据不得写成经营成果。

## 复用决策

已考察 Agent 调度平台、任务看板、数据库工作台和创作画布。决定自建业务界面与联动，复用成熟的编辑器、媒体播放、存储和 UI 组件。

[infinite-canvas](https://github.com/tigerowo/infinite-canvas) 仅作为素材、版本及来源关系的交互参考，不作为整体经营底座，不默认引入其内置 Agent 或生成服务。参考资料和选择依据见产品规格。

## 运行与数据

Node.js 24+、npm 11+。

Windows 直接双击根目录的 `start.bat`，它会自动安装首次运行所需依赖、启动服务，并在就绪后打开浏览器，不需要输入命令。

需要自定义时也可以使用 PowerShell 启动脚本：

```powershell
.\start.ps1
```

默认数据保存在 `%LOCALAPPDATA%\MYOPC\data`，服务地址为 `http://127.0.0.1:3000`。可用 `-DataDir D:\private\myopc -Port 3100` 自定义；`-Production` 会先构建再启动生产服务，`-Check` 只检查环境而不启动。

多台电脑共用时使用服务器上的 Docker 部署：`Dockerfile` 构建 Next.js 服务，`docker-compose.yml` 将 SQLite 数据保存到持久化卷，由 OpenResty 通过 HTTPS 域名反向代理。不要让每台电脑各自启动一份数据库，否则数据不会同步。

Codex 脚本客户端连接共享服务时设置 `MYOPC_BASE_URL=https://seizemoment.xyz`、`MYOPC_USERNAME` 和 `MYOPC_PASSWORD`；本机开发时省略这三个远程配置即可继续使用本地服务。写入操作可设置 `MYOPC_REQUEST_ID` 或传 `--request-id`，网络结果不确定时用同一个请求 ID 重试，不会重复创建。

也可以手动启动：

```powershell
npm install
$env:MYOPC_DATA_DIR="C:\path\to\private\myopc-data"
npm run dev
```

打开 `http://127.0.0.1:3000` 后，MYOPC 作为行动、成果、反馈和下一步的面板使用；需求、资料或失败等具体输入与执行在 Codex 中完成，再由 Codex 写入这里。面板会定时刷新共享状态，也可以手动刷新；网络失败会保留当前页面并提供重连。`npm run s0:start` 与 `npm run s0:resume` 仅保留为历史接口验收脚本。

已实现的最小 API 位于 `/api/v1`：`GET /health`、`GET /dashboard`、`GET /events?after=...`、`GET /projects`、`GET /projects/:id`、`GET /context?trial_id=...`、`POST /starts`、`POST /drafts`、`POST /captures`、`POST /methods`、`POST /trials`、`POST /projects`、`PATCH /projects/:id`、`POST /projects/:id/locations`、`POST /deliverables`、`POST /deliverables/:id/versions`、`POST /feedback`、`POST /decisions`、`POST /deliverables/:id/accept`。所有写入请求必须带 `X-Client-Request-Id`；可变尝试更新还必须带 `expected_revision`。

接续客户端支持任意实际内容，不绑定固定演示文案：

```powershell
npm run continuity -- context --trial-id <id>
npm run continuity -- start --title "行动标题" --goal "实际目标" --project-id <project-id> --code-commit <commit>
npm run continuity -- draft --trial-id <id> --title "成果标题" --content-file .\draft.md
npm run continuity -- feedback --version-id <version-id> --kind revision --content "具体修改意见" --request-id feedback-001
npm run continuity -- revise --deliverable-id <deliverable-id> --feedback-id <feedback-id> --content-file .\v2.md
```

SQLite 使用 WAL，不能只复制运行中的 `myopc.sqlite`。一致性备份与隔离恢复命令：

```powershell
npm run db:backup -- --output D:\private\myopc-backups\myopc.sqlite
npm run db:verify -- --file D:\private\myopc-backups\myopc.sqlite
npm run db:restore -- --file D:\private\myopc-backups\myopc.sqlite --directory D:\private\myopc-restore-check
```

备份和恢复会运行 SQLite 完整性、外键和表计数检查；恢复目标已有数据库时会拒绝覆盖。

本仓库为公开代码仓库。真实稿件、未发布素材、收入明细、账号凭据及运行数据库放在私有运行存储中，不能随代码提交。
