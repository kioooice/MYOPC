# MYOPC 发布协议

MYOPC 的代码事实源是 GitHub `main`。服务器上的 `/opt/scripts/bin/deploy-opc` 只发布已提交到 `main` 的版本；运行数据和源码分离，重新拉取代码不会删除数据。

```text
本地开发 -> GitHub main -> 一致性备份 -> fetch target
  -> npm ci/test/lint/build -> systemd restart -> health/release
```

脚本在开始时检查 Git 工作区、分支、远程、Node/npm 和 `myopc.service`。工作区有手工修改时立即停止。部署前使用项目现有 SQLite backup API，将 `/opt/data/opc` 的运行数据备份到 `/opt/backups/opc`，并执行完整性与外键校验；运行中的 SQLite 不能用简单文件复制替代一致性备份。

只有依赖安装、测试、lint 和正式 build 全部通过后才重启服务。构建失败不会影响当前运行服务。重启后脚本通过 Tailscale IPv4 检查 `/api/v1/health` 和只读 `/api/v1/library`，并确认返回实际 release commit。健康检查失败时只回退代码和构建产物，不自动恢复数据库，因为 schema migration 后数据库回滚需要人工诊断。

当前 MYOPC 使用 Node + systemd，服务设为开机启动；应用端口只绑定 Tailscale 私网地址，公网不开放。Docker 可作为其他项目的实现方式，但当前 MYOPC 不依赖 Docker Hub。

```sh
ssh opc-cloud-private
deploy-opc
systemctl status myopc
journalctl -u myopc -n 100 --no-pager
curl http://$(tailscale ip -4):3010/api/v1/health
```

真实数据、密钥和运行配置不进入 Git；GitHub Deploy Key 只允许服务器读取仓库。
