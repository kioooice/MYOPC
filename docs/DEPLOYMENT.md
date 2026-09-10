# 运行与部署

## 本地 Windows

Node.js 24+。根目录 `start.bat` 调用 `start.ps1`，首次安装依赖后启动并打开浏览器。

```powershell
.\start.ps1
.\start.ps1 -DataDir D:\private\myopc -Port 3100
.\start.ps1 -Production
```

默认地址 `http://127.0.0.1:3000`，默认数据目录 `%LOCALAPPDATA%\MYOPC\data`。

本地还需要在 `.env.local`（不进 Git）配置知识仓库与模型：

```ini
MYOPC_KNOWLEDGE_DIR=D:\Projects\MYOPC-Knowledge
MYOPC_MODEL=deepseek-flash
MYOPC_MODEL_BASE_URL=https://api.deepseek.com
MYOPC_MODEL_API_KEY=...
```

`start.ps1` 显式设置的 `MYOPC_DATA_DIR` 优先于 `.env.local` 中的同名变量。

## 手动运行

```sh
npm ci
npm run dev -- --hostname 127.0.0.1
npm run build && npm run start -- --hostname 127.0.0.1
```

## 知识同步

网页提供“同步知识仓库”和批量加工按钮。命令行等价：

```sh
npx tsx scripts/knowledge-sync.ts --limit 3        # 同步索引并加工最多 3 条
npx tsx scripts/knowledge-sync.ts --no-process     # 只更新索引
npx tsx scripts/knowledge-sync.ts --force-entry id # 强制重做某一条
```

放到计划任务里即可定时执行；重复执行不会重复写入，也不会重复调用模型。

## 服务器（124.222.190.89）

当前结构：

| 位置 | 内容 |
| --- | --- |
| /opt/apps/opc | 应用代码的 Git 检出，容器镜像从这里构建 |
| 容器 `myopc` | 监听 127.0.0.1:3011，数据卷 `/opt/data/opc:/data` |
| /opt/data/knowledge/myopc | 知识仓库检出（只读挂载进容器 `/knowledge`） |
| OpenResty | `:3010` 反向代理到 3011，带 Basic Auth |
| /opt/apps/opc/.env | 运行环境变量，含模型密钥，不进 Git |

部署步骤：

1. 本地确认改动已提交并推送，记录提交 SHA。
2. 服务器 `git -C /opt/apps/opc fetch` 并切到目标提交，工作区保持干净。
3. 备份 `/opt/data/opc/myopc.sqlite`（SQLite backup API，校验完整性与外键）。
4. `docker compose -f docker-compose.prod.yml up -d --build`。
5. 核对 `MYOPC_RELEASE`、`/api/v1/health`、`/api/v1/knowledge` 与 `:3010` 的实际返回。

知识内容与代码分开更新：只改知识仓库时不需要重新部署，同步一次即可；改代码或依赖才重建容器。

### 服务器上的知识同步

知识仓库是私有仓库，服务器用只读 Deploy Key 拉取，检出在 `/opt/data/knowledge/myopc`；同步脚本 `deploy/knowledge-sync.sh` 会拉取、记录来源版本、让 OPC 重新索引并按需加工。

```sh
sudo cp /opt/apps/opc/deploy/knowledge-sync.sh /usr/local/bin/opc-knowledge-sync
sudo chmod 755 /usr/local/bin/opc-knowledge-sync
sudo cp /opt/apps/opc/deploy/opc-knowledge-sync.service /etc/systemd/system/
sudo cp /opt/apps/opc/deploy/opc-knowledge-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now opc-knowledge-sync.timer
sudo systemctl start opc-knowledge-sync.service
systemctl list-timers opc-knowledge-sync.timer
```

容器里没有 git，所以来源版本通过挂载的 `/opt/data/knowledge/commit.txt` 传给应用；升级容器前要先创建该文件（`sudo touch /opt/data/knowledge/commit.txt`），否则 Docker 会把挂载点建成目录。

定时任务只改内容：代码或依赖变化仍需重新构建容器。
## 数据维护

```powershell
npm run db:backup -- --output D:\private\backups\myopc.sqlite
npm run db:verify -- --file D:\private\backups\myopc.sqlite
npm run db:restore -- --file D:\private\backups\myopc.sqlite --directory D:\private\restore-check
```

备份时使用与应用相同的 `MYOPC_DATA_DIR`；在线 SQLite 不能只复制主数据库文件。

## 历史文件

`Dockerfile`、`docker-compose.yml`、`deploy/`、`scripts/deploy-opc.sh` 保留供参考；`deploy-opc.sh` 依赖旧 systemd 服务与 Tailscale，不直接用于当前部署。
