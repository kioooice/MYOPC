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

服务器是用户日常浏览 OPC 的主要入口，本机用于开发；完成可用增量后及时部署，不统一等到整个改造结束。当前运行版本为 `c6699a7`（2026-09-18，阶段 2 接口已上线，四板块页面尚未实现）。

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
4. 先 `docker compose -f deploy/opc-server.compose.yml build`，通过后更新 `.env` 的 `MYOPC_RELEASE` 并 `up -d --no-build`（项目名固定为 `opc`，构建参数带 `DEBIAN_MIRROR`）。`.dockerignore` 排除 `.env` 与 `.env.*`，运行配置由 Compose 注入。
5. 核对 `MYOPC_RELEASE`、`/api/v1/health`、`/api/v1/knowledge` 与 `:3010` 的实际返回。
6. 核对通过后清理本次构建残留：`sudo docker image prune -f && sudo docker builder prune -f`（只删悬空镜像与构建缓存，运行中的容器和带标签镜像不受影响）。

知识内容与代码分开更新：只改知识仓库时不需要重新部署，同步一次即可；改代码或依赖才重建容器。

### 镜像与磁盘维护

系统盘 40G，每次 `up -d --build` 都会留下一个悬空镜像（唯一层约 40–130M）和对应构建缓存，不清理时两周就能占满。2026-09-24 实测：根盘 37G/40G（98%），其中 `/var/lib/docker` 19G——44 个未使用镜像的唯一层合计 5.2G、构建缓存 4.53G；清理后 24G/40G（63%）。

- 每次部署按第 6 步执行：`sudo docker image prune -f && sudo docker builder prune -f`。
- 回退镜像按需保留：`sudo docker images opc-myopc`，删除多余的 `rollback-*` 标签与不再使用的 `deploy-myopc`。
- 必要时清系统缓存：`sudo apt-get clean`、`sudo journalctl --vacuum-size=100M`、`sudo -u ubuntu python3 -m pip cache purge`、`sudo npm cache clean --force`。
- 不要动：`/opt/data`（运行数据与知识仓库检出）、`/opt/backups`（SQLite 备份）、`/home/ubuntu/.cache/ms-playwright` 与 `/opt/apps/easel/.venv`（Easel 发布依赖）。
- 排查顺序：`df -h /` → `docker system df` → `sudo du -x -h -d1 /var/lib/docker`。服务器上的知识同步定时任务（30 分钟一次）只拉知识仓库、只调同步与加工接口，不构建镜像，与磁盘增长无关。

### 服务器上的知识同步

知识仓库是私有仓库，检出在 `/opt/data/knowledge/myopc`，用只读 Deploy Key 拉取。**页面上的「同步」会自己拉取并快进到最新**（容器里装了 git，以只读方式挂载了 Deploy Key 和 known_hosts）；定时任务 `opc-knowledge-sync.timer` 是兜底，保证没人点按钮时内容也会更新。

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

容器内有 git，来源版本直接读检出；`/opt/data/knowledge/commit.txt` 仍作为没有 git 时的回退。升级容器前要确保该文件存在（`sudo touch /opt/data/knowledge/commit.txt`），否则 Docker 会把挂载点建成目录。

定时任务只改内容：代码或依赖变化仍需重新构建容器。
## 数据维护

```powershell
npm run db:backup -- --output D:\private\backups\myopc.sqlite
npm run db:verify -- --file D:\private\backups\myopc.sqlite
npm run db:restore -- --file D:\private\backups\myopc.sqlite --directory D:\private\restore-check
```

备份时使用与应用相同的 `MYOPC_DATA_DIR`；在线 SQLite 不能只复制主数据库文件。

## 历史文件

`Dockerfile` 与 `deploy/opc-server.compose.yml`、`deploy/opc-server.conf` 是当前使用的部署文件；`docker-compose.yml`、旧 `deploy/main-site.conf`、`scripts/deploy-opc.sh` 只作历史参考，`deploy-opc.sh` 依赖旧 systemd 服务与 Tailscale，不用于当前部署。
