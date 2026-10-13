# OPC Bridge

开发知识复用与新会话恢复的本地 CLI。用户不需要直接使用它，Codex 按全局规则自动调用：

```sh
opc bootstrap                              # 新会话恢复：阶段、决定、环境验证、阻塞、下一步
opc context --task "改善目标区域识别稳定性"   # 取用历史知识
opc result  --task "改善目标区域识别稳定性" --outcome success --change "把阈值判断改成先做输入稳定性检查" --validation "pnpm test 通过" --knowledge-used "some-note-id"
opc result  --event decision --title "ASR 用 SenseAudio 承担" --content "WhisperX 对齐请求没有模型参数" --rationale "该请求是 provider-neutral request"
opc result  --event progress --title "中文短视频流水线打通" --content "TTS → 对齐 → 字幕 → 渲染 → 成片" --verification "输出 output/zh-short-final.mp4" --status verified --next "接入 H3 画面"
opc result  --task "整片交付后的状态更新" --outcome success --change "完成 76.96 秒影片" --validation "完整解码和有声播放通过" --summary "影片已交付，后续只待音频修订" --event progress --title "真人整片已交付" --content "实际成片已完整播放；音频修订尚未制作" --verification "浏览器从头播放至 ended=true" --status verified --next "制作最小音频修订" --supersedes evt-old-phase
opc result  --event environment --title "本机 runtime 已选择" --content "Runtime Profile 指向本地 profile" --verification "hypit paths 显示本地 profile" --status verified
opc result  --event blocker --title "渲染修复不可持久" --content "重装发行版后要重做修复" --next "补一个修复脚本"
opc candidates                             # 查看待整理候选经验
opc candidates --id cand-x --status merged --note "已合并到 safe-deploy" --entry safe-deploy --commit abc1234
opc workspace --action subjects [--board media]
opc workspace --action subject --id synthetic-media
opc workspace --action create --stdin --request-id request-1
opc workspace --action update --id synthetic-media --stdin --request-id request-2
opc workspace --action record --stdin --request-id request-3
opc workspace --action record-detail --id record-id
opc workspace --action context --stdin
opc workspace --action export --id synthetic-media
opc workspace --action export --all
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

其他机器不需要安装：查看直接开 `http://124.222.190.89:3010`（Basic Auth），页面读的是服务器上同一份状态；开发只在本机进行。

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
- `workspace` 直接对应阶段 2 的主题、记录、当前状态、上下文和导出 API；读操作不缓存，stdin 内容按 API body 发送，写操作自动生成或使用 `--request-id` 并通过 `X-Client-Request-Id` 保证幂等。
- `bootstrap` 结果默认缓存 10 分钟（同仓库 + 分支）；`opc result` 成功后清掉该仓库的缓存，需要刷新时加 `--force`。
- 回流或 workspace 写入失败时返回 `{"saved":false,"queued":true,...}` 并把完整 body、请求 ID 和 HTTP 方法放进待重传队列；下一次任意命令会补发最多 3 条，每条最多重试 20 次，不无限重试、不阻断开发。workspace 的 409 会直接返回冲突详情，不自动覆盖；队列补发遇到 409 会保留项目并标记为 blocked，不再自动重试。
- 网络失败、服务器不可用、模型未配置都不阻塞开发：命令始终以退出码 0 结束，并返回 `bridge_error` 之类的可读原因。
- 同一次回流重试带同一个 `submission_id`，服务端按（submission_id, 序号）判重，不会重复写入；更正用 `--supersedes <记录 id>`，旧记录保留历史。
- 任务结果和显式阶段事件可放在同一次 `opc result` 中：整次调用只发一个 `/agent/result` 请求，事件通过 `--event` 附加。普通 `outcome=success`、decision 或 finding 不自动改写当前阶段；只有明确的 `plan / progress` 事件参与阶段恢复。阶段变更时使用旧阶段 / 过期下一步对应的事件 ID 做 `--supersedes`，只替代已确认过时的记录，不顺带关闭其他阻塞。若同一阶段的多个旧事件都含过期下一步，可在同一请求里增加多个带 `--supersedes <id>` 的合法 `finding` 事件，逐条说明待办已经过时或完成；不要使用未定义的 `correction` 类型。
- 只有阶段事件的回流不调用模型；完整任务结果与事件共用原有结果提炼路径，最多一次模型提炼，不另发事件请求。已能给出可靠摘要且不需候选经验提炼时，可带 `--summary` 避免模型调用。

## 全局规则

已经在 OPC 里有实际工作的项目 / 工具（≥5 条记录，其中 ≥2 条是进展 / 环境 / 发现，且至少 1 条带验证依据），Codex 会自己检查知识仓库有没有对应条目；没有就起草一条最小条目（`projects/<id>.md` 或 `tools/<id>.md`，状态 `待核对`，`sources.repo` 写 OPC 身份）并提交推送，然后一句话告知——不需要用户在对话里手动要求。**只有想法、还没动手的不建条目**（留在对话里，或写成 `待验证` 的笔记）；工具要能真正用了才登记。内容只写已知事实，其余留给后续整理会话补充；长期没有新记录的空条目由整理会话标为已暂停或删除。

Codex 的全局 `~/.codex/AGENTS.md` 里已加入对应约定：新会话进入已识别项目时先 `opc bootstrap` 恢复一次并核对本地事实；有历史经验影响做法时调用 `opc context`；关键阶段（决定、完成、环境变化、发现、阻塞）用 `opc result --event ...` 回流；普通改字、重复测试和每次工具调用不回流；同一会话不反复 bootstrap。

## 可选 Hooks 隔离试点

`opc-hooks.mjs` 是本地适配器，不是后台 Agent。配置、状态、审查模板及原生轨迹放在 `%LOCALAPPDATA%\OPC\hooks`，不进入业务仓库。默认未激活；`prepare-hooks-pilot.mjs` 仅复制脚本并生成模板，不修改 Codex 用户配置、项目配置或持久信任。运行需要 Node 在 Windows PATH 中。

```powershell
node bridge/prepare-hooks-pilot.mjs --root D:\Projects\myopc --home "$env:LOCALAPPDATA\OPC\hooks\myopc-desktop-probe"
```

默认 `probe` 只记录事件字段名、工具名和响应哈希，返回空 JSON，不注入背景、不续行、不回流测试数据。`pilot.json` 按真实目录边界限定项目，可进一步限定 `sessions`。加 `--active` 才生成执行试点：

- `UserPromptSubmit` 通过既有 CLI 并行读取当前项目阶段与固定个人主题，单项超时 3.5 秒，正文限量并保留来源和截断标识。没有关键词分类、服务器模型选择或自动任务授权；知识方法仍由 Codex 判断是否调用 `opc context`。
- 上下文提示 Codex 识别方法局限、研究外部成熟方法、比较与小试，再按实际授权集成。Hook 不寻找工具或自动安装工具；新增能力试用记录也不证明模型权重或作品质量增长。
- 明确执行后，Codex 使用注入的 session / turn 登记 `arm` 契约。新消息使旧契约失效；停止、权限不足或范围改变时 `cancel`，原生 `Interrupt` 也取消。两项以内的检查使用绝对可执行程序与 argv，单项最多 8 秒。
- `Stop` 重新执行登记检查；只有非零退出且匹配声明的 `failureContains` 才可续行。缺程序、超时、信号、未匹配失败标识等均是未知。未知、讨论、无契约、取消或已补修时正常结束。原生 `stop_hook_active` 与任务级原子领取文件共同限制最多一次补修。相同任务重新登记不能重置额度；检查通过也不等于整体验收。
- `PostToolUse` 只观察原生已回调的工具，不解析结束语、不推断所有工具都受覆盖。失败 / 通过的每次本地验证独立保存，保留变化过程；不存用户原始消息、聊天全文或原生工具响应正文。

每个检查应直接调用一项验证程序；首版拒绝 cmd / PowerShell / Bash 等 shell 包装，防止复合命令后面的成功遮蔽前面的失败。验证程序本身仍须正确传播退出码。Hook 只能核对登记的检查，不能独立保证 Codex 对授权和验收范围的判断正确，也不能证明未登记的事项已经完成。

登记示例（session / turn 来自真实 Hook 上下文；只为明确获准任务登记）：

```json
{
  "task": "明确的任务",
  "mode": "execution",
  "authorized": true,
  "authorization_source": "当前用户消息定位",
  "allowRepair": true,
  "checks": [{
    "name": "相关回归检查",
    "program": "C:/Program Files/nodejs/node.exe",
    "args": ["check.mjs"],
    "failureContains": "ERR_ASSERTION"
  }]
}
```

将 JSON 通过 stdin 传给 `node <安装目录>/bin/opc-hooks.mjs arm --home <试点目录> --session <id> --turn <id>`。取消用同样参数调用 `cancel`，stdin 为 `{"reason":"..."}`。授权字段是 Codex 对当前授权的明确声明，不是脚本独立验证人类意图的结果；Hook 信任与业务授权不同。

经验与能力过程复用原有 `opc result`，不新增数据库 / 页面 / 工具市场。`report` 默认只生成本地载荷，`--submit true` 才调用既有 CLI。需要 task、outcome、调用方 summary；相同载荷使用相同 submission_id，修改载荷使用新 ID，保留已有幂等契约。已有验证只是局部技术证据，任务 outcome 与 summary 仍是调用方声明。

`adoptions` 每项必须有 `id / changed_choice / changed_action / evidence`，效果首版统一 `unknown`，拒绝用“命中”替代采用证据。可选 `capability_trials` 每项必须有 `gap / candidate / sources / baseline / trial_result / decision(adopt|defer|reject) / integration / evidence`；可附 `value_evidence`，缺少实际价值证据时明确未知。采用、暂缓、放弃与实际安装 / 工作流接入分开；这些均以调用方报告保存，不自动宣称独立验收。

原生 CLI 验证器 `check-hooks-live.mjs` 在 OPC 私有目录新建合成夹具，冻结本次脚本并记录 SHA256 / CLI 版本、提示词、原生 JSONL 与事件。只读生产 OPC，不写测试结果到生产。

```powershell
node bridge/check-hooks-live.mjs --codex (Get-Command codex).Source --case probe --hooks
node bridge/check-hooks-live.mjs --codex (Get-Command codex).Source --case probe --hooks --require-trust
node bridge/check-hooks-live.mjs --codex (Get-Command codex).Source --case fix
node bridge/check-hooks-live.mjs --codex (Get-Command codex).Source --case fix --hooks
```

支持 probe / discussion / fix / repair / knowledge / learn。`learn` 用明确的检验能力缺口观察 Codex 是否自行研究成熟方法、比较试用并留下可运行的多用例检查与过程载荷，不指定新工具；这是合成场景，不能冒充 Video 创作验收。带 `--hooks` 的自动测试默认使用官方一次性 `--dangerously-bypass-hook-trust`，仅用于已审查的本次脚本；不改变持久信任，也不绕过正常桌面审核。`--require-trust` 不使用这个参数，可核对未审核定义是否被跳过。`repair` 是人工设置的协议试验，不能作为自主性收益对照。基线与 Hook 的相同任务不改模型和工具条件；双方都完成时记录未证明增益，不据此推广。

桌面端必须单独完成信任和真实事件验证。生成的 `codex-hooks.review.json` / TOML 模板可审查，但未写入用户默认层；不能把 CLI 的通过或手工调用处理器当作桌面通过。按[官方 Hooks 文档](https://learn.chatgpt.com/docs/hooks)审查并信任实际配置层的精确定义（CLI `/hooks`），定义变化须重新审查。先运行 MYOPC 的 probe，分别核对三个事件及原生输出，再进入少量 active 任务；通过实际行为对照后才考虑其他项目。当前状态与证据见项目日志。
