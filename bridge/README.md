# OPC Bridge

开发知识复用与新会话恢复的本地 CLI。用户不需要直接使用它，Codex 按全局规则自动调用：

```sh
opc bootstrap                              # 新会话恢复：阶段、决定、环境验证、阻塞、下一步
opc context --task "改善目标区域识别稳定性"   # 取用历史知识
opc result  --task "改善目标区域识别稳定性" --outcome success --change "把阈值判断改成先做输入稳定性检查" --validation "pnpm test 通过" --knowledge-used "some-note-id"
opc result  --event decision --title "ASR 用 SenseAudio 承担" --content "WhisperX 对齐请求没有模型参数" --rationale "该请求是 provider-neutral request"
opc result  --event progress --title "中文短视频流水线打通" --content "TTS → 对齐 → 字幕 → 渲染 → 成片" --verification "输出 output/zh-short-final.mp4" --status verified --next "接入 H3 画面"
opc result  --event environment --title "本机 runtime 已选择" --content "Runtime Profile 指向本地 profile" --verification "hypit paths 显示本地 profile" --status verified
opc result  --event blocker --title "渲染修复不可持久" --content "重装发行版后要重做修复" --next "补一个修复脚本"
opc candidates                             # 查看待整理候选经验
opc candidates --id cand-x --status merged --note "已合并到 safe-deploy" --entry safe-deploy --commit abc1234
opc doctor
```

事件类型：`plan` / `progress` / `decision` / `environment` / `finding` / `blocker`。
事件状态：`planned` / `reported` / `verified` / `blocked`；不写时按类型推断，`verified` 需要 `--verification` 或 `--evidence`，否则按执行方报告记录。
候选处置：`merged`（已合并）/ `added`（已新增）/ `hold`（暂存）/ `discarded`（舍弃），`--note` 必填。

## 安装（本机一次）

```powershell
powershell -ExecutionPolicy Bypass -File D:\Projects\myopc\bridge\install.ps1
```

安装内容：

- `%LOCALAPPDATA%\OPC\bin\opc.mjs` 与 `opc.cmd`（把 `%LOCALAPPDATA%\OPC\bin` 加入用户 PATH）；
- `%LOCALAPPDATA%\OPC\config.json`：`serverUrl`、可选 Basic Auth、超时、缓存分钟数、总开关，可选 `machine` 与 `projects`；
- `%LOCALAPPDATA%\OPC\machine.json`：机器标识（首次调用时生成，只用于标注记录来自哪台机器）；
- 日志 `%LOCALAPPDATA%\OPC\logs\opc.jsonl`；缓存 `%LOCALAPPDATA%\OPC\cache\`；待重传队列 `%LOCALAPPDATA%\OPC\queue\pending.jsonl`。

任何项目仓库都不会产生 OPC 文件；仓库名从 `git remote get-url origin` 自动读取，读不到时回落到目录名。

## 配置

```json
{
  "serverUrl": "http://124.222.190.89:3010",
  "auth": { "username": "opc", "password": "..." },
  "machine": "",
  "projects": {
    "D:\\Projects\\video": "video-project"
  }
}
```

- `projects` 是本机路径 → 仓库标识的映射，用于没有 git remote 的项目（最长匹配优先）。
- `machine` 留空时使用 `machine.json` 里的标识；它只标注记录来源，不做跨机器同步或验证。
- 凭据只放在这个文件里，不进入任何仓库；回流内容里出现的 Token / 密码会在本地先脱敏再上传。

## 行为

- 只依赖 Node 内置模块，不需要在项目里安装依赖。
- `context` 与 `bootstrap` 都是“宁可不用”的：没有相关知识时返回 `{"used":false,"reason":"no_relevant_knowledge"}`，没有记录时返回 `reason:"no_records"`。
- `bootstrap` 结果默认缓存 10 分钟（同仓库 + 分支）；`opc result` 成功后清掉该仓库的缓存，需要刷新时加 `--force`。
- 回流失败时返回 `{"saved":false,"queued":true,...}` 并把这次提交放进待重传队列；下一次任意命令会补发最多 3 条，每条最多重试 20 次，不无限重试、不阻断开发。
- 网络失败、服务器不可用、模型未配置都不阻塞开发：命令始终以退出码 0 结束，并返回 `bridge_error` 之类的可读原因。
- 同一次回流重试带同一个 `submission_id`，服务端按（submission_id, 序号）判重，不会重复写入；更正用 `--supersedes <记录 id>`，旧记录保留历史。

## 全局规则

Codex 的全局 `~/.codex/AGENTS.md` 里已加入对应约定：新会话进入已识别项目时先 `opc bootstrap` 恢复一次并核对本地事实；有历史经验影响做法时调用 `opc context`；关键阶段（决定、完成、环境变化、发现、阻塞）用 `opc result --event ...` 回流；普通改字、重复测试和每次工具调用不回流；同一会话不反复 bootstrap。