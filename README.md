# MYOPC

个人能力与一人公司经营工作台，用于整理素材和方法、管理项目与行动、保存成果版本及反馈。

当前以本地开发和运行为主，OPC 与 Easel 分别部署。Easel 用于内容制作和运营；MYOPC 保存可复用素材、方法和项目成果。两者的自动交接尚未完成，不要求先建设服务器或模型协作平台。

## 本地启动

使用 Node.js 24+。Windows 启动脚本会检查该版本要求。

Windows 双击 `start.bat`：首次安装依赖，启动服务并打开浏览器。
也可以在 PowerShell 中执行：

```powershell
.\start.ps1
```

默认地址：`http://127.0.0.1:3000`。
默认数据目录：`%LOCALAPPDATA%\MYOPC\data`。

自定义目录和端口：

```powershell
.\start.ps1 -DataDir D:\private\myopc -Port 3100
```

正式构建后在本机运行：

```powershell
.\start.ps1 -Production
```

手动开发：

```sh
npm ci
npm run dev -- --hostname 127.0.0.1
```

需要指定数据位置时设置 `MYOPC_DATA_DIR`。本地部署情况以实际启动结果为准，历史服务器记录不代表当前可访问。

## 已有功能

- 素材与方法：链接、文本和文件收纳，检索、方法版本与关联。
- 项目与行动：项目说明、位置记录、目标、结果和下一步。
- 成果与反馈：成果版本、修改意见、采用版本和决策记录。
- HTTP API 与脚本客户端：供网页和外部工具读写相同业务记录。
- SQLite 持久化及备份、校验、隔离恢复命令。

已实现入口以 `app/api/v1/[...segments]/route.ts` 为准；产品设想与当前功能分别见规格和状态文档。

## 开发

按具体需求修改、验证、提交。普通修复不需要阶段审批、独立规划模型或额外的交接仪式。

```sh
npm test
npm run lint
npm run build
```

按改动影响选择检查；仅文档修改检查内容和链接即可。界面改动实际打开对应页面，数据逻辑改动运行相关测试。

## 文档

- [开发约定](AGENTS.md)
- [当前状态](docs/STATUS.md)
- [待办](TASKS.md)
- [产品说明](docs/PRODUCT_SPEC.md)
- [代码架构与接口](docs/ARCHITECTURE.md)
- [运行与部署](docs/DEPLOYMENT.md)

当前信息集中维护在这些文件中，避免多份进度和协作说明互相覆盖。

## 数据与外部工具

运行数据库、素材和凭证不提交 Git。多台电脑各自运行时数据彼此独立，Git 只同步代码。

Easel 是独立项目：[ZJU-REAL/Easel](https://github.com/ZJU-REAL/Easel)。当前可以手动交接素材和产物，按真实使用需要再完善连接。视频与其他外部工具按具体任务接入。

备份命令和可选脚本客户端用法见 [运行与部署](docs/DEPLOYMENT.md)。
