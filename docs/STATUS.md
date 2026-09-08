# 当前状态与交接

本次更新：2026-09-08（UTC+08:00）。

## 可复用部署能力

`scripts/deploy-opc.sh` 已固化 MYOPC 的 GitHub main → SQLite 一致性备份 → 测试/lint/build → systemd → Tailscale health/release 发布协议；服务器入口为 `/opt/scripts/bin/deploy-opc`。脚本使用并发锁，发现工作区漂移会停止，构建或健康检查失败不会自动恢复数据库。详细协议见 [DEPLOYMENT.md](DEPLOYMENT.md)。

服务器当前使用 Node + systemd + SQLite + Tailscale；本轮部署方法已在 `opc-cloud` 实际跑通。Docker Hub 不稳定是当前环境事实，不代表 Docker 部署方法已经验证。

本轮正式发布实测：GitHub `main` 的 `6392ec66962f438e7d83f3248f2f3e9af7ba3c25` 已由服务器 Deploy Key 独立 fetch；`deploy-opc` 创建并校验 `/opt/backups/opc/myopc-20260908T114140Z-6392ec66962f438e7d83f3248f2f3e9af7ba3c25.sqlite`，18 项测试、lint、build、systemd restart、health/release 和 `/api/v1/library` 均通过。首次 fresh clone 缺少 `tsx` 的脚本缺口已修复并重新验证；不影响业务数据。

能力库已记录两份真实素材与方法版本 r1：

- `opc-cloud 私人云工作节点实测`：素材 `13849be0-8b46-42e7-97d8-fcc137660ef5`；方法 `私人云工作节点初始化`，方法 ID `3ede3c89-3696-4ad4-a1b2-88636aac9c15`。
- `MYOPC opc-cloud 迁移与发布实测`：素材 `68234d2c-6bb6-419f-9d5b-b3f5cd287e28`；方法 `GitHub → 私人云服务安全部署`，方法 ID `a133ab4f-2c59-404e-b1cc-897d18f60354`。

生产页面已通过 Tailscale 浏览器打开，工作台能力计数显示为 4；这些记录没有写入公网地址、私钥或凭证。

## 本轮收口结论

独立验收记录在 `d1614ac` 发现的 R1–R5 已完成最小修复，修复提交为 `d02291b`（`fix: close continuity acceptance gaps`），已推送到 `origin/main` 并部署到服务器。原阶段的技术收口完成；第二台真实电脑、真实用户反馈和 S1/S2 仍是现场边界，不因技术样例提前关闭。

独立验收记录见 [ACCEPTANCE_REVIEW.md](ACCEPTANCE_REVIEW.md)。它保留了失败复现和原始基线，不改写成历史上已经通过。

| 验收问题 | 收口方式与证据 |
| --- | --- |
| R1 过期版本/项目写入 | 新版本必须带 `expected_previous_version_id`，服务校验当前父版本并返回明确冲突；项目更新新增 `revision` 和 `expected_revision`。11 项业务测试包含过期版本与项目写入复现。 |
| R2 最新成果选择 | 最新成果按成果版本时间跨所有行动选择，和最新行动独立；项目摘要返回所属行动，新增“无成果的新行动”测试。 |
| R3 新版待审阅 | `deliverable_versions.review_status` 与成果状态明确区分 `待审阅/需要修改/已采用`；旧版采用记录保留，新版自动进入待审阅，不再要求先写“请审阅”反馈。项目卡、项目详情、待处理和行动页均显示该状态。 |
| R4 下一步一致性 | 当前行动的最新决策优先于启动时的旧 `next_step`；上下文、项目详情和行动页读取同一有效值，并由测试验证。 |
| R5 不确定写入重试 | 连续客户端在发送前输出 request id，网络失败时把同一编号写入错误提示；网页保留同一请求编号和载荷，显示“重试上次写入”。CLI 断连验证和本地网页断线验证均通过。 |

## 当前运行状态

- 当前实现提交：`d02291b`；GitHub `main` 已核验指向该提交。
- 服务器运行版本：`d02291b`；健康检查返回 `status=ok`、`persistence=sqlite`。
- 服务器仍使用 Docker 持久卷 `myopc_myopc-data`，部署前旧库备份为 `/data/backups/pre-d02291b.sqlite`。
- 备份使用 SQLite backup API，完整性和外键检查通过；部署后仍能读取原有 2 个项目、2 个环境位置、版本和反馈记录。
- 旧服务器代码保留在 `/opt/myopc-before-d02291b`，用于必要回退；未删除正式数据。

## 验证证据

- `npm test`：11/11 通过。
- `npm run lint`：通过。
- `npm run build`：通过；服务器 Docker 构建也通过。
- 隔离业务测试：过期父版本、项目 revision 冲突、跨行动最新成果、已采用旧版 + 待审阅新版、决策下一步、备份恢复均通过。
- 连续客户端断连：请求未确认时先输出可复用 request id，并提示使用同一编号重试。
- 本地浏览器（隔离数据库）：总览显示待处理数量；项目卡显示最新 v2/待审阅；项目详情保留 v1“采用版本”、v2“待审阅”、待审阅事项和下一步；行动页状态一致。
- 本地浏览器断线：停止隔离服务后提交反馈，页面显示 `Failed to fetch` 和“重试上次写入”，表单内容保留；服务恢复后隔离数据仍可读取，失败请求没有被误报成功。
- Playwright CLI 已按技能检查，但本机 `ms-playwright` 路径是失效目录连接，启动时报 `ENOTDIR`；未修改系统缓存，页面验收使用已连接的内置浏览器完成。

## 线上脱敏记录

服务器保留原有的 Helm、Snipaste OCR 两个项目。Helm 的技术验收样例仍明确标记为系统测试，不是用户反馈、发布结果或经营成果；其 v1→系统反馈→v2 关系和开放审阅记录保留。

## 未验证项与边界

- 尚未由真实第二台电脑完成一次人工接续；本地隔离浏览器是替代验证，不宣称两台实机通过。
- 尚未产生真实用户/市场反馈，S1 的第二次真实行动和 S2 外部反馈不属于本轮收尾结果。
- 应用级用户身份和细粒度权限尚未建立，线上访问边界仍依赖 OpenResty Basic Auth。
- 未自动发布内容、未运行上传的软件、未把运行数据库或凭据提交到 GitHub。

## 下一步入口

用户在另一台电脑访问 [seizemoment.xyz](https://seizemoment.xyz/) 后，确认能看到同一组项目、Helm 最新 v2 和开放反馈；再从 Codex 发起下一次真实行动，把结果写回共享服务。此后才进入 S1 的真实循环验收，不扩展到 S2 或其他规划阶段。
