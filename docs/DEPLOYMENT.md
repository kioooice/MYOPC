# 运行与部署

## 本地 Windows

Node.js 24+，npm 随 Node 安装。根目录 start.bat 会调用 start.ps1，首次安装依赖后启动并打开浏览器。

```powershell
.\start.ps1
.\start.ps1 -DataDir D:\private\myopc -Port 3100
.\start.ps1 -Production
```

默认地址 http://127.0.0.1:3000，默认数据目录 %LOCALAPPDATA%\MYOPC\data。
-Check 只检查启动环境（首次仍可能安装依赖）。

## 手动运行

```sh
npm ci
npm run dev -- --hostname 127.0.0.1
```

正式运行使用 npm run build 后执行 npm run start -- --hostname 127.0.0.1。
可通过 MYOPC_DATA_DIR 指定独立数据目录。具体端口以启动参数为准。

## 可选脚本客户端

网页以外的工具可调用 /api/v1；不使用客户端也可以正常使用网页。

```sh
npm run continuity -- context --trial-id <id>
npm run continuity -- draft --trial-id <id> --title "成果标题" --content-file ./draft.md
```

远程服务可设置 MYOPC_BASE_URL；需要 Basic Auth 时再设置 MYOPC_USERNAME / MYOPC_PASSWORD。
写入使用 X-Client-Request-Id，客户端支持 --request-id 或 MYOPC_REQUEST_ID。结果不确定时用相同编号和载荷重试。

## 数据维护

运行数据独立于 Git。已有 SQLite 一致性备份工具：

```powershell
npm run db:backup -- --output D:\private\backups\myopc.sqlite
npm run db:verify -- --file D:\private\backups\myopc.sqlite
npm run db:restore -- --file D:\private\backups\myopc.sqlite --directory D:\private\restore-check
```

备份时使用与应用相同的 MYOPC_DATA_DIR。恢复使用新目录；在线 SQLite 不能只复制主数据库文件。

## 历史服务器文件

Dockerfile、docker-compose.yml、deploy/main-site.conf、scripts/deploy-opc.sh 保留，便于后续按需适配。
其中 deploy-opc.sh 依赖旧 systemd 服务、服务器目录和 Tailscale；main-site.conf 也包含旧站点配置。
这些文件不是当前本地启动步骤，不直接拿来部署新环境。代码未因本次文档整理而修改。

OPC 和 Easel 分别运行；本仓库的启动脚本只启动 OPC。
