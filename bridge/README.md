# OPC Bridge

开发知识复用 V0 的本地 CLI。用户不需要使用它，Codex 在开发任务里按全局规则自动调用：

```sh
opc context --task "改善目标区域识别稳定性"
opc result  --task "改善目标区域识别稳定性" --outcome success --change "把阈值判断改成先做输入稳定性检查" --validation "pnpm test 通过" --knowledge-used "some-note-id"
```

## 安装（每台电脑一次）

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\myopc\bridge\install.ps1
```

安装内容：

- `%LOCALAPPDATA%\OPC\bin\opc.mjs` 与 `opc.cmd`（把 `%LOCALAPPDATA%\OPC\bin` 加入用户 PATH）；
- `%LOCALAPPDATA%\OPC\config.json`：`serverUrl`、可选 Basic Auth、超时、缓存分钟数、总开关；
- 日志 `%LOCALAPPDATA%\OPC\logs\opc.jsonl`，缓存 `%LOCALAPPDATA%\OPC\cache\context.json`。

任何项目仓库都不会产生 OPC 文件；仓库名从 `git remote get-url origin` 自动读取，读不到时回落到目录名。

## 行为

- 只依赖 Node 内置模块，不需要在项目里安装依赖。
- `context` 是“宁可不用”的：没有相关知识时返回 `{"used":false,"reason":"no_relevant_knowledge"}`。
- 网络失败、服务器不可用、模型未配置都不阻塞开发：命令始终以退出码 0 结束，并返回 `bridge_error` 之类的可读原因。
- 最近 10 分钟相同仓库 + 相同任务的查询会复用缓存（服务端也有同样的去重）。

## 指向部署实例

默认指向本机 `http://127.0.0.1:3000`。要用部署实例（OpenResty 上有 Basic Auth），编辑
`%LOCALAPPDATA%\OPC\config.json`：

```json
{
  "serverUrl": "http://124.222.190.89:3010",
  "auth": { "username": "放在这里", "password": "放在这里" }
}
```
