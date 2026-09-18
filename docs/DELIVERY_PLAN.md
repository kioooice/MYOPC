# 开发计划入口：OPC 一人公司改造

更新：2026-09-18。本文是本轮统一执行方案，取代此前本机个人载体 v1/v2/v3 讨论稿的执行入口。旧稿用于理解讨论过程，不与本文并行维护。

## 交接坐标

- 总计 5 个阶段；阶段 1「产品与数据设计」与阶段 2「信息承接与当前状态」已完成，阶段 3「四板块页面」未开始。
- 用户决定另开对话，使用 Luna 执行，完成后回原讨论对话评估。不要自行创建新对话、启动其他 Agent 或改模型。
- 阶段 2 执行对话已完成本地交付；用户返回后明确要求服务器部署，现已完成（运行版本 `c6699a7`）。阶段 3、4 尚未开始，不自动扩大本轮范围。
- 用户主要通过服务器浏览 OPC；本机用于开发。后续可用增量及时部署到既有服务器并验证实际入口，部署不再统一延后到阶段 5。
- 原讨论对话：`01a0af98-3072-7d32-abcc-8673b9deda70`。这是返回讨论的定位信息，不要求自动向该对话发消息。
- 开始前：读取 AGENTS.md、本文、TASKS.md 和 STATUS.md 顶部；按全局规则运行一次 opc bootstrap，再核对当前工作区。本文的当前阶段优先于下方历史计划。
- 规划基线：main / 6c3a22e，远端 main 同步。已有 `.playwright-cli/`、`work/` 未跟踪目录，不能清理或纳入提交。执行时重新核对，不把此快照当成永久事实。

## 1. 产品方向与评审结论

OPC 是 AI 支持的一人公司载体。个人是经营主体，Codex 是沟通与执行入口，OPC 承接目标、工作、交付、反馈和判断变化。求职是可能的活动，不能再成为产品中心。

四个一级板块：

| 板块 | 范围 |
| --- | --- |
| 个人 | 处境、目标、责任、偏好、资源与判断变化；容纳尚未想清楚的内容 |
| 个人项目 | 自主探索、工具和产品建设，保留真实进展、用途、暂停与失败 |
| 企业项目 | 企业业务问题、本人职责、方案、交付和实际使用效果 |
| 自媒体 | 持续内容方向、作品、发布、受众反馈、运营选择与实际经营结果 |

按主要职责归属，交叉内容通过引用连接。video 制作技术属于个人项目，持续内容经营属于自媒体。工具、知识、方法与图谱作为支持材料保留。

用户明确的两项核心要求：信息及时承接，当前状态不被旧摘要误导；反馈帮助本人发现联系和新选择，不自动增加任务或替本人决定。

### 实施前评审

结论：**build_now，仅限阶段 2**。当前真实断点已明确：video 阶段日志已记载实际发布，知识条目和部分恢复下一步仍停留在首次验证；现有 repository 事件不能独立承接跨项目的个人及经营状态。

本阶段新增能力直接支持下一次创作或经营讨论读取有效状态及来源，不需要另造项目或积累固定数量样本。Codex + 一份 Markdown 是较小替代方案，但当前已有多来源状态冲突和跨板块关联需求；沿用 OPC 的存储和 Bridge，最小补足当前状态契约具有明确用途。

阶段 3—5 是后续方向，不构成本轮执行授权。反馈建议是否有帮助仍未验证，不预先宣称产品价值已成立。

## 2. 五阶段路线

| 阶段 | 交付 | 完成判断 |
| --- | --- | --- |
| 1 产品与数据设计 | 本文、产品方向、执行范围与样例 | 新执行对话可在无旧聊天全文的情况下开始 |
| 2 信息承接与当前状态 | 统一主题记录、明确的状态替换、来源和跨板块引用、API、CLI | 写入、纠正、读取和恢复准确；旧接口保持兼容 |
| 3 四板块页面 | 首页与各板块详情、来源与时效提示、相关资源入口 | 页面展示真实状态；桌面与窄屏可用；保留旧材料入口 |
| 4 反馈能力 | 有依据的联系、问题、少量可选尝试，及用户回应 | 不把建议当决定；反馈能被接受、改写、暂放或拒绝 |
| 5 真实使用与交付 | 实际工作接续、备份与迁移核对、整体验收；部署随前面阶段增量进行 | 能在正常使用中接续，维护负担可接受，数据与旧功能不丢失 |

阶段 4 的反馈格式先约定为「观察及来源 → 与当前目标的关系 → 可选行动或问题 → 可观察结果」，具体触发与生成方式等阶段 2、3 完成后再设计。不以数量、分数或自动调度复杂度验收。

## 3. 阶段 2 范围

### 必须交付

1. 不依赖 Git 仓库的主题身份，归属于四个板块之一，可引用其他主题、知识条目与项目仓库。
2. 有来源的历史记录，以及与历史明确分开的当前状态。
3. 明确替换、清除当前状态的写入协议，防止重试、并发和延迟提交让旧信息重新变成当前事实。
4. 查询、上下文组装与导出；对来源时间、冲突和未审阅的新材料作明确说明。
5. 复用全局 OPC Bridge 的请求、脱敏、失败回退和待补传能力；旧命令保持原契约。
6. 不调用模型也能完成记录、状态更新和恢复。

### 本阶段不做

不改主界面、不生成个人画像或反馈建议、不接平台实时指标、不实现自主经营、不批量导入聊天、不全量重写知识库、不搬移 video/Easel。原阶段 2 执行仅在独立本地数据目录与 Bridge 目录验证；随后按用户要求部署服务器并更新已安装 Bridge，保留原配置。

不将本次对话中的家庭、收入、联系方式等内容写进代码、测试夹具或 Git。阶段 2 使用明确标注的合成样例；实际个人内容待具备相应读取与删除边界后再导入。

## 4. 数据契约

采用现有 SQLite 和 Node 服务。新增 `lib/workspace/`（types/store/service 可按实现合并），不引入通用图数据库或事件框架。

### 4.1 主题 subjects

建议表名 `workspace_subjects`，字段：

- `id`：稳定字符串；`board` 固定为 `personal | personal_project | enterprise_project | media`。
- `title`、`status`（active / paused / archived）、`revision`、创建/更新时间。
- `references_json`：指向已有材料的有限数组，每项 `{kind, id?, locator?, label?}`。kind 只允许 subject / knowledge / repository / file / url；限制字段长度与总数。

主题是生活关注事项、项目或持续经营方向的载体，不要求填写商业模式、收入或截止日期。一个主题只有一个主要板块，通过 subject 引用关联其他板块；关联不复制原内容。内部 subject 引用须存在，自引用和重复引用拒绝。

旧 knowledge_entries 与 project_events 保持为其原始材料。主题中仅保存显式绑定，不通过模型猜测企业/个人项目归属，也不把旧 projects 种子当作用户已经确认的当前状态。

### 4.2 记录 records

建议表名 `workspace_records`，字段：

- `id`（服务端生成）、`subject_id`、`kind`（statement / observation / decision / question / feedback / correction）。
- `title`、`content`、可选 `rationale`，以及关联材料 `references_json`。
- `origin`（user / agent / external）、`assertion`（reported / inferred）、`source_locator`（可为空但须说明来源）、`observed_at`、`recorded_at`。
- `slot`（可空）、`replaces_id`（可空）。

用户目标是本人陈述，AI 解释必须是 inferred；有来源引用不自动升级为「真实效果已验证」。个人内容不套用代码项目的 branch/commit 有效性规则，引用的项目材料仍保留原始版本信息。

正文以追加记录为主，纠正通过新记录引用旧记录。记录 ID 是查询与来源追踪依据。首版上限建议：标题 160 字、正文 4000 字、理由 1000 字、引用 12 项；数组/JSON/时间必须验证，无效输入给明确 400。

### 4.3 当前状态 heads

建议表名 `workspace_heads`：`subject_id + slot` 联合主键，`record_id` 指向当前有效记录。

slot 是主题内稳定的小范围问题，例如 `intent`、`stage`、`next_step`、`publication:sample:douyin`。不是把整段个人档案作为一个可覆盖的字符串。slot 使用限制长度的字母数字、冒号、点、下划线或连字符。

**写入模式：**

- `history`：只增加历史记录，不改变当前状态；不允许携带 slot 更新或 current 参数。
- `set_current`：增加记录并移动对应 head；请求必须包含 slot 和 `expected_current_id`，第一次为 null，后续为调用方刚读取的记录 ID。
- `clear_current`：增加说明清除理由的 correction 记录并删除对应 head；同样校验 expected_current_id。旧记录仍可查，但不能自动恢复为当前状态。

修改记录和 head 必须在同一数据库事务内。expected_current_id 不匹配返回 409，包含当前 ID 和冲突字段，不写半条记录，不自动重试覆盖。replaces_id 由服务端依据旧 head 设置，禁止跨主题/跨 slot 替换。

客户端保存重试载荷时要保存完整请求和请求 ID，不能在补传时偷偷改 expected_current_id。补传遇到 409 应保留可处理的冲突信息并停止该项自动重试，其他独立项不受阻。

较晚收到的旧观察可以写 history，不能仅凭入库时间覆盖当前状态。明确写 set_current 时，如果 observed_at 早于该 head 对应观察时间，应返回时间冲突，让执行方改为历史记录或基于新核对信息重新提交；不能由服务端猜测哪条更真实。

### 4.4 幂等与错误

复用 `lib/business.ts` 导出的 idempotent 与现有 idempotency 表；写请求要求 `X-Client-Request-Id`。相同 ID 同载荷返回原响应，不重复记录；同 ID 不同内容返回 409。新 API 返回成功写入的 ID/revision/mode，不把完整敏感正文写入重复的幂等响应或通用事件日志。重放返回的是原写入回执，不能把其中的 current_id 当成此刻仍有效的状态；客户端后续读取 state/context 取得当前 head。

记录变更可向现有 events 表发送只含 ID 与版本的事件，不能全量复制正文。API 的 invalid/not_found/conflict 对应 400/404/409，服务端异常为 500；不得套用现有 KnowledgeError 默认 502 来处理用户输入错误。

迁移在 lib/db.ts 沿用现有机制，版本号以实施时数据库最大值为准（规划时为 14）。新增表和索引可重复执行，旧表与记录保持完整；不修改历史迁移的业务含义。

## 5. API 与 CLI 契约

以下均为待实现接口，前缀 `/api/v1`。

| API | 输入与输出 |
| --- | --- |
| POST /workspace/subjects | `{id, board, title, status?, references?}`；创建，201 + `{id, revision}`；已有 ID 用 PATCH，不能静默覆盖 |
| PATCH /workspace/subjects/:id | `{expected_revision, title?, status?, references?}`；乐观锁更新，200 + `{id, revision}`；板块归属本阶段创建后不变 |
| POST /workspace/records | `{subject_id, mode, record, slot?, expected_current_id?}`；原子追加及状态更新，201 + `{record_id, current_id, mode}` |
| GET /workspace/subjects | board/status/q 可选；返回主题元数据与来源时间，不默认返回所有私有正文 |
| GET /workspace/subjects/:id | 主题详情与当前各 slot、最近记录 ID、引用和时效信息；历史按需分页 |
| GET /workspace/records/:id | 单条历史记录、来源、当前是否仍被 head 引用 |
| POST /workspace/context | `{subject_ids?, board?, repository?, query?, limit?}`；确定性组装相关当前状态与依据，不调用模型 |
| GET /workspace/export | subject_id 或 board 过滤；无过滤须显式 `all=true`；导出 JSON，含 schema_version、主题、记录、heads、来源时间 |

上下文读取规则：

1. 优先显式 subject_ids；无显式 ID 时，按 board 或显式绑定的 repository 筛选。query 仅在这一范围内做普通文本筛选，不使用语义召回。
2. 未给范围时返回 `used:false / scope_required`，不能因为处于某仓库就自动返回个人生活资料；无匹配返回 no_records。
3. 默认最多 5 个主题，硬上限 10；返回字数受限（默认约 6000 字），包含 truncated、遗漏数量和可继续读取的 ID，不能静默裁切后伪装完整。`subjects[].current` 优先占用预算，`items` 只返回当前记录的紧凑索引；历史和来源按剩余预算附加，并用各自的 omitted count / truncated 标记说明。
4. 当前内容只从 heads 读取；历史和已被替换内容放在明确标注的 history/source 中，不参与当前下一步。预算不足时保留最小当前状态并标记 `current_truncated` / `budget_exceeded`，不能把已有当前记录误报为 `no_records`。
5. `omitted_ids` 只表示因 limit 或字符预算未返回的已存在主题，`missing_subject_ids` 单独表示请求中找不到的主题；`omitted_count` 与去重后的 `omitted_ids` 一致。
6. 通过显式 references 读取项目新事件及知识状态。比较最后观察时间和原材料时间：如果出现后续事件或知识摘要 stale，显示 `newer_material_available` 和来源 ID；不调用模型把不同材料合成新的确定结论。
7. 未整理的新项目事件可以及时被看见，但不能谎称语义状态已更新。Codex 读到提示后核对来源，并在同一正常任务中按需 set_current。服务端不按自然语言自动判断任务已经完成。
8. 引用找不到或跨分支时保留缺失/范围提示，不让一个来源不可用导致整个当前状态读取失败。

Bridge 使用现有单层参数习惯，新增一个命令族即可：

```text
opc workspace --action subjects [--board media]
opc workspace --action subject --id <id>
opc workspace --action create --stdin
opc workspace --action update --id <id> --stdin
opc workspace --action record --stdin
opc workspace --action record-detail --id <record-id>
opc workspace --action context --stdin
opc workspace --action export --id <id>
```

stdin 直接对应 API body；写入支持显式 --request-id，未提供时首次生成并保存在队列项中。GET/POST context 第一版不缓存，避免引入新的过期问题；失败非阻塞但明确返回 used/saved/queued 与 reason。enabled:false 时不请求、不补传、不写队列；仍沿用 global OPC_HOME，业务项目不生成配置文件。

阶段 2 不更新全局 AGENTS.md 或已安装的 Bridge。交付时给出局部测试命令与后续安装步骤；新执行对话可直接用 `node bridge/opc.mjs`，并指定独立 OPC_HOME 和 OPC_SERVER。默认命令不应误连生产服务。

## 6. 合成样例与语义验证

测试数据必须标注 synthetic，以下 ID 和标题仅用于隔离测试，不能导入真实经营数据。

```json
{
  "subject_id": "synthetic-media",
  "mode": "set_current",
  "slot": "publication:sample",
  "expected_current_id": null,
  "record": {
    "kind": "observation",
    "title": "合成样例：等待发布",
    "content": "这是一条测试记录，不是真实作品。",
    "origin": "agent",
    "assertion": "reported",
    "source_locator": "synthetic:test-case",
    "observed_at": "2026-01-01T00:00:00Z"
  }
}
```

创建记录得到 A 后：

- 用 expected_current_id=A 写入较晚的「合成样例：发布完成」，得到 B；读取 context 只能把 B 当作当前状态，A 仍可单独查阅。
- 将 A 的同一请求重放，不能让 head 从 B 回退到 A。
- 用过期 expected_current_id=A 再提交 C，返回 409，数据和 head 不变。
- 对 B 执行 clear_current 后，再读该 slot 为空，不回退到 A；历史说明保留。
- 单独写入一条更早时间的历史记录，不能改变当前 head。
- 用合成个人主题记录一项愿望，和合成 media 主题关联；读 media 默认不泄露个人正文，显式选择两个主题时才返回各自有来源的内容。
- 绑定合成仓库后新增项目事件，只提示存在待核对新材料；context 不把新事件内的推测覆盖为当前事实。

## 7. Luna 第一轮任务拆分

按依赖顺序完成，不要求用户逐项确认：

- **S2.1 类型与持久化**：新增表、输入校验、主题创建/更新、记录追加、heads 原子更新与 clear。先验证替换、冲突与重试语义。
- **S2.2 读取与来源**：主题列表/详情/历史、上下文范围与大小限制、旧知识/项目来源引用、时效提示、JSON 导出。
- **S2.3 API**：接入现有 catch-all 路由，保持旧 API，不改 dashboard/UI 返回契约。
- **S2.4 Bridge**：新增 workspace action 分发，复用传输/脱敏/队列；实现 409 可见且不自动覆盖。若需抽取通用队列字段，只做必要重构并保留旧命令行为。
- **S2.5 本地完整流程与交付**：隔离数据库启动本地实例，用 CLI 完成创建→记录→更新→读取→清除→导出，再提交推送并回报。

相关文件：lib/db.ts、lib/workspace/*、app/api/v1/[...segments]/route.ts、bridge/opc.mjs、bridge/README.md，及相应测试。app/page.tsx 与主视觉不在本轮范围。常规内部命名可以调整；变更上述外部接口、信息权限范围或历史保留语义时先记录理由并报告，不自行扩大方向。

## 8. 验收与回退

必要验证：

- 数据迁移重复运行不重复写入；使用独立数据目录，旧表数据不受影响。
- 幂等、过期 head、跨 subject/slot 替换、clear 后不恢复旧值、history 不改当前值。
- 四板块筛选、显式关联、默认不读取个人正文、引用缺失/新材料提示、导出字段完整。
- API 400/404/409、事务失败不半写；Bridge 重试沿用请求 ID，禁用与离线处理保持原有行为，409 不无限重试。
- 既有 knowledge-progress、reuse、bridge 与 business 的相关回归通过；交付前 npm test、npm run lint、npx tsc --noEmit、npm run build。
- CLI 走真实本地 HTTP 与 SQLite 验证；不以直接调用服务函数的测试代替完整流程。

失败时先定位相关环节，不额外设计发布演练或多机器开发。记录实际检查与未验证内容。阶段 2 不改主页面，所以不要求为此阶段跑全量浏览器视觉验收。

不导入真实个人信息、不替换生产数据库、不部署、不执行自媒体发布或其他付费操作。新数据结构采用增量迁移；代码回退时不删除新表与历史，迁移与备份策略在实际部署前再核对。

## 9. 完成后如何回到原对话

复用本项目现有文档，不额外建立 HANDOFF.md、DECISIONS.md 或重复报告：

- TASKS.md：更新 S2 状态，下一步写「返回原对话评估；阶段 3 未开始」。
- docs/STATUS.md：更新实际可用接口、CLI、验证结果与限制。
- docs/ARCHITECTURE.md、bridge/README.md：只补实际实现的结构和用法。
- docs/PROJECT_LOG.md：唯一阶段原始记录，记新增进展、理由、证据和问题；按规则 opc result 回流概要。
- 执行对话最终回复给出：提交与推送结果、完成范围、如何读取本地演示、检查结果、遗留问题、需要原对话讨论的产品问题。不要把需要用户观察的价值效果写成测试通过。

用户返回原对话时，凭提交号和上述记录即可评估，不要求复制整个执行过程。本轮到阶段 2 交付结束；后续阶段在讨论后再继续规划。

---

# 历史计划：OPC V0.2（项目进展即时回流 + 新会话恢复）

状态：历史记录，实际交付与剩余问题见 STATUS.md。这是现有 OPC 的增量升级，不新建项目；目标、边界、任务与最终验证结果都维护在本文件。

## 目标

让日常开发保持「打开项目 → 给 Codex 任务 → 正常开发」，不需要手动维护交接文件：

1. 有意义的阶段把关键进展回流：关键决定、阶段完成、环境变化、重要发现、阻塞。
2. 新对话进入已识别项目时恢复：项目目标与阶段、最近完成、关键决定与理由、环境验证、未完成事项与阻塞、下一步与证据。
3. 恢复后先核对当前工作区（分支、提交、相关文件），再继续任务。
4. 事件接收与保存、恢复筛选与组装、客户端已提交的候选经验保存都**不调用服务器模型**；模型只保留在知识阅读说明与知识相关性判断。
5. 计划、执行方报告、附验证依据三种状态分开，不把模型或执行方报告自动提升为验证事实。

## 边界

- 不建 MCP、Semble、长期会话互聊、完整 Observer、图数据库或新的 Agent 框架。
- 不在业务仓库创建 OPC 专用文件；路径映射、待重传队列只在全局 OPC 目录。
- 上传载荷不包含密码、Token、API Key、完整 `.env`；不整包上传配置文件。
- 原始会话、日志、代码不整体上传，只保存提交号、测试摘要、文件或会话定位等证据引用。
- 同一仓库不同分支互不覆盖；更正保留历史；同一次回流重试去重。
- 开发只在本机：其他机器只用浏览器查看 OPC 页面（不装 bridge、不 bootstrap、不回流）；`machine` 只作为记录来源标注保留，不做多机同步、不按机器区分验证结论。
- 服务不可用、项目未识别、没有记录时正常继续开发，回流失败只提示并保留待重传记录，不无限重试。

## 任务

| # | 任务 | 状态 |
| --- | --- | --- |
| 1 | 扩展 `opc result`：阶段事件（decision / progress / environment / finding / blocker / plan）、一次多个事件、提交去重、机器 / 分支 / 提交 / 未提交标记 | 已完成 |
| 2 | 新增 `opc bootstrap`：按仓库 + 分支 + 提交筛选并组装恢复摘要（机器只作来源标注），长度有上限，记录 ID 可单独读取 | 已完成 |
| 3 | 候选经验处置：已合并 / 已新增 / 暂存 / 舍弃，记录理由、条目与知识仓库提交，处理后移出待整理列表 | 已完成 |
| 4 | 页面：项目详情最近进展（阶段、更新时间、关键事件、环境验证、阻塞、下一步、证据可展开）与候选处置入口 | 已完成 |
| 5 | 全局规则最小增补：新会话恢复一次、恢复后核对本地事实、关键阶段回流、普通改动不回流 | 已完成 |
| 6 | 真实视频项目验收：现场检查 → 阶段回流 → 新对话恢复 → 核对本地 → 接续任务 | 见「验证结果」 |
| 7 | 提交、推送、部署与文档更新 | 见「验证结果」 |

## 设计要点

- 数据：新增 `project_events`（项目事件：类型、内容、理由、状态、验证、证据、下一步、机器 / 分支 / 提交 / 脏标记、父子更正关系）；`agent_task_results` 增加 `submission_id / machine / branch / commit_sha / dirty / event_count`；`knowledge_candidates` 增加处置字段（`resolution_note / resolved_entry_id / knowledge_commit / resolved_at`）。
- 状态语义：`planned`（计划）、`reported`（执行方报告）、`verified`（附验证依据）、`blocked`（未解决）、`superseded`（已被替代）。`verified` 必须有验证方式或证据，否则按报告记录。
- 恢复排序：先按分支相关性分层，再按时间；环境记录带验证方式与来源标注；记录对应更早提交时显式提示核对。
- 冲突不做自动裁决：同一主题下内容不同的未替代记录显式列出，交人工确认。

## 验证结果

提交与部署：

- 提交 `357917e` 已推送并部署到 124.222.190.89（`/opt/apps/opc` 快进到该提交，`MYOPC_RELEASE=357917e`，容器 `myopc` 重建后 `/api/v1/health` 返回 `release=357917e`）。
- 部署前备份 `/opt/backups/opc/pre-v02-357917e.sqlite`（integrity ok、无外键违规）；migration 13 / 14 在该实例生效，`project_events` 已建。
- 本机 CLI 更新到 `opc-bridge 0.2.0`（验收修复后为 0.2.1），并在 `%LOCALAPPDATA%\OPC\config.json` 增加路径映射 `D:\Projects\video → video-project`（视频项目没有 git remote）。

真实视频项目验收（video，`D:\Projects\video`）：

1. 现场检查：`hypit --version` = 0.1.9；`.hypit/runtime` 指向 `hypit.runtime.json`（endpoints：autodl.h3 / senseaudio.tts / senseaudio.asr / media.local / hyperframes.local）；`packages/` 下三个自建 provider；`ffprobe output\zh-short-final.mp4` = h264 720x1280 30fps / 8.000s / AAC / 182,494 字节。
2. 阶段回流：一次 `opc result` 写入 5 条事件——progress（verified，证据 `file:output/zh-short-final.mp4`）、decision（WhisperX 对齐由 SenseAudio ASR 承担，附理由）、environment（本地 runtime 已选择，凭据只写槽名）、blocker（发行版修复不可持久）、finding（产物复用，8 → 3 个请求）。返回 `extraction: skipped_events_only`，服务器没有调用模型。
3. 新会话恢复：`opc bootstrap` 返回阶段、决定（含理由）、环境验证、未解除阻塞、下一步与 5 个 record ID。
4. 核对本地：用 ffprobe、`hypit --version`、`.hypit/runtime`、`packages/` 逐项核对，与恢复摘要一致。
5. 接续实际任务：按记录里的下一步新增 `scripts/check-distribution.mjs`（只读检查发行版修复是否还在），运行结果 112 个内部包 junction / 13 个外部依赖 / 字体依赖齐全、退出码 0，并回流为第 6 条事件；再次 `bootstrap --force` 能看到新的阶段与下一步。

边界与失败路径（部署实例实测）：

- 幂等：同 `submission_id` 重发返回 `deduped:true`，结果 id 与事件 id 不变。
- 分支 / 提交边界：`feature-x / cafebabe` 的记录在 bootstrap 里标成 `sameBranch/sameCommit = false` 并提示核对更早提交；机器维度仍会标注，但跨机器不再是验收项。
- 凭据：含 `sk-…` 与 `API_KEY=…` 的载荷返回 `redactions: 2`，库内保存为 `DEEPSEEK_API_KEY=[已脱敏]`。
- 服务不可用：把 `OPC_SERVER` 指向不可达地址时 `opc result` 返回 `queued:true`，下一次命令自动补发（doctor `flush.sent = 1`），事件最终落库。
- 页面：本地实例用 Playwright 实测项目详情「最近进展」（阶段、关键事件、环境验证、下一步）与空间页候选处置（保存后待整理 0、最近处理 1）。
- 业务仓库没有产生任何 OPC 文件；配置、缓存、日志与待重传队列都在 `%LOCALAPPDATA%\OPC\`。

未验证项：

- 真实"新对话"接续：委派创建的 Codex 任务 `01a0aa96-664b-7450-b786-23e383c04b3a`（video 项目）两次都在第一次请求就失败——通过应用委派创建的任务会往新会话注入没有 `call_id` 的 `function_call_output`（`name: create_thread` / `send_message_to_thread`），DeepSeek `/v1/responses` 校验器直接返回 400 `missing field call_id`（已用最小请求复现：无 `call_id` → 400；带 `call_id` → 另一条校验错误）。普通会话里真实工具调用的 `function_call_output` 都带 `call_id`，所以只有委派创建的任务会失败。因此没有跑通"新会话自己恢复并接续"；改用界面正常新建任务即可绕过，最短验收指令见 STATUS 的「未验证」。
