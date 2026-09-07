import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupDatabase, restoreDatabase } from "../lib/backup";
import { BusinessError, acceptVersion, createCapture, createDecision, createDraft, createFeedback, createProject, createProjectLocation, createTrial, createVersion, getContext, getProject, getProjects, startTrial, updateProject, updateTrial } from "../lib/business";
import { closeDbForTests } from "../lib/db";

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "myopc-test-")); process.env.MYOPC_DATA_DIR = directory; });
afterEach(() => { closeDbForTests(); rmSync(directory, { recursive: true, force: true }); delete process.env.MYOPC_DATA_DIR; });

describe("S0 business invariants", () => {
  it("replays an identical request without duplication", () => {
    const payload = { title: "test", content: "text" };
    const first = createCapture(payload, "same-key");
    const replay = createCapture(payload, "same-key");
    expect(replay.body.id).toBe(first.body.id);
  });

  it("rejects using an idempotency key for a different payload", () => {
    createCapture({ title: "a", content: "one" }, "same-key");
    expect(() => createCapture({ title: "b", content: "two" }, "same-key")).toThrowError(BusinessError);
  });

  it("rejects a stale mutable update", () => {
    const trial = createTrial({ title: "trial", goal: "goal" }, "trial-key").body;
    updateTrial(String(trial.id), { expected_revision: 1, status: "review" }, "update-key");
    expect(() => updateTrial(String(trial.id), { expected_revision: 1, status: "done" }, "stale-key")).toThrowError(/重新读取/);
  });

  it("starts directly from a need and keeps the original input linked", () => {
    const result = startTrial({ kind: "need", title: "写一篇产品说明", content: "让读者理解产品解决什么问题" }, "start-key");
    const context = getContext(String(result.body.id));
    expect(context.capture).toMatchObject({ kind: "need", title: "写一篇产品说明" });
    expect(context.method).toBeNull();
  });

  it("adds the first reviewable deliverable from the workspace", () => {
    const trial = startTrial({ kind: "need", title: "行动", content: "目标" }, "start-key").body;
    createDraft({ trial_id: trial.id, title: "第一版", content: "# 可审阅内容" }, "draft-key");
    const context = getContext(String(trial.id));
    expect((context.deliverables as Array<{ versions: unknown[] }>)[0].versions).toHaveLength(1);
  });

  it("registers a project with a planning category", () => {
    const result = createProject({ name: "Helm", category: "tool", path: "D:\\Projects\\helm" }, "project-key");
    expect(result.body).toMatchObject({ name: "Helm", category: "tool", path: "D:\\Projects\\helm" });
    expect(getProjects().categories.map((category) => category.id)).toEqual(["tool", "content", "business", "research"]);
    expect(getProjects().projects).toHaveLength(1);
    expect(() => createProject({ name: "Invalid", category: "other" }, "invalid-project-key")).toThrowError(/类别无效/);
  });

  it("continues arbitrary project work across locations and feedback-driven versions", () => {
    const project = createProject({ name: "真实工具", category: "tool", description: "用于接续验证", profile: { summary: "工具介绍", highlights: ["能力"], usage: ["使用"], stage: "验证", stack: "TypeScript" } }, "continuity-project").body;
    createProjectLocation(String(project.id), { label: "电脑 A", environment: "Windows", repository_url: "https://github.com/example/tool", branch: "main", commit_sha: "aaa111" }, "location-a");
    createProjectLocation(String(project.id), { label: "服务器", environment: "Linux", deploy_url: "https://example.com", commit_sha: "aaa111" }, "location-server");
    const trial = startTrial({ kind: "need", title: "真实工具接续", content: "让下一台电脑找到同一个目标", project_id: project.id, code_repository: "https://github.com/example/tool", code_branch: "main", code_commit: "aaa111", next_step: "读取反馈后继续" }, "continuity-start").body;
    const draft = createDraft({ trial_id: trial.id, title: "第一版真实成果", content: "第一版内容来自当前工作的实际材料。" }, "continuity-draft").body as { id: string; version: { id: string } };
    const feedbackV1 = createFeedback({ version_id: draft.version.id, content: "把第一句改成明确的使用结果。", kind: "revision", source: "user" }, "continuity-feedback-1").body as { id: string };
    const version2 = createVersion(String(draft.id), { content: "第二版内容：先说清楚使用结果，再说明实现方式。", expected_previous_version_id: draft.version.id, handles_feedback_ids: [feedbackV1.id] }, "continuity-version-2").body as { id: string };
    const feedbackV2 = createFeedback({ version_id: version2.id, content: "补充一个真实使用条件。", kind: "review", source: "user" }, "continuity-feedback-2").body as { id: string };
    createVersion(String(draft.id), { content: "第三版内容：说明结果、实现方式和真实使用条件。", expected_previous_version_id: version2.id, handles_feedback_ids: [feedbackV2.id] }, "continuity-version-3");

    const detail = getProject(String(project.id));
    expect(detail.locations).toHaveLength(2);
    expect(detail.latest_trial).toMatchObject({ project_id: project.id, code_commit: "aaa111" });
    expect(detail.latest_deliverable?.latest_version).toMatchObject({ ordinal: 3, content: expect.stringContaining("真实使用条件") });
    expect(detail.open_feedback).toHaveLength(0);
    expect(getContext(String(trial.id))).toMatchObject({ project_id: project.id, code_commit: "aaa111" });
  });

  it("backs up and restores a consistent isolated database", async () => {
    createCapture({ title: "可恢复记录", content: "保留关系" }, "backup-capture");
    const backup = join(directory, "backups", "myopc.sqlite");
    const restoredDirectory = join(directory, "restored");
    const report = await backupDatabase(backup);
    const restored = await restoreDatabase(backup, restoredDirectory);
    expect(report.ok).toBe(true);
    expect(restored.source.ok).toBe(true);
    expect(restored.restored.ok).toBe(true);
    expect(restored.restored.tables.captures).toBe(1);
  });

  it("rejects stale version and project writes with explicit bases", () => {
    const project = createProject({ name: "冲突项目", category: "tool" }, "conflict-project").body as { id: string; revision: number };
    const trial = startTrial({ kind: "need", title: "并发行动", content: "验证过期写入", project_id: project.id }, "conflict-start").body;
    const draft = createDraft({ trial_id: trial.id, title: "成果", content: "第一版" }, "conflict-draft").body as { id: string; version: { id: string } };
    const version2 = createVersion(draft.id, { content: "第二版", expected_previous_version_id: draft.version.id }, "conflict-version-2").body as { id: string };
    expect(() => createVersion(draft.id, { content: "过期客户端版本", expected_previous_version_id: draft.version.id }, "conflict-version-stale")).toThrowError(/重新读取当前版本/);
    expect(() => createVersion(draft.id, { content: "没有基线" }, "conflict-version-missing")).toThrowError(/previous_version_id/);
    const updated = updateProject(project.id, { expected_revision: project.revision, description: "第一次更新" }, "conflict-project-update").body as { revision: number };
    expect(updated.revision).toBe(2);
    expect(() => updateProject(project.id, { expected_revision: project.revision, description: "过期更新" }, "conflict-project-stale")).toThrowError(/重新读取/);
    expect(getContext(String(trial.id)).deliverables[0].versions[0]).toMatchObject({ id: version2.id, previous_version_id: draft.version.id });
  });

  it("selects the latest deliverable across actions and keeps review state explicit", () => {
    const project = createProject({ name: "成果状态项目", category: "tool" }, "state-project").body as { id: string };
    const firstTrial = startTrial({ kind: "need", title: "先有成果", content: "先记录成果", project_id: project.id }, "state-start-1").body;
    const firstDraft = createDraft({ trial_id: firstTrial.id, title: "已有成果", content: "已有成果内容" }, "state-draft-1").body as { id: string; version: { id: string } };
    acceptVersion(firstDraft.id, { version_id: firstDraft.version.id }, "state-accept-1");
    const secondTrial = startTrial({ kind: "need", title: "后来行动", content: "新行动暂时没有成果", project_id: project.id }, "state-start-2").body;
    const summary = getProjects().projects[0] as { latest_deliverable: { title: string; trial_id: string; review_status: string }; pending_review_count: number };
    expect(summary.latest_deliverable).toMatchObject({ title: "已有成果", trial_id: firstTrial.id, review_status: "accepted" });
    expect(summary.pending_review_count).toBe(0);
    createVersion(firstDraft.id, { content: "已有成果的新版本", expected_previous_version_id: firstDraft.version.id }, "state-version-2");
    const revisedAccepted = getProject(project.id);
    expect(revisedAccepted.latest_deliverable).toMatchObject({ trial_id: firstTrial.id, latest_version: { ordinal: 2 }, accepted_version_id: firstDraft.version.id });
    expect(revisedAccepted.pending_review_count).toBe(1);
    const secondDraft = createDraft({ trial_id: firstTrial.id, title: "新版本成果", content: "新版本内容" }, "state-draft-2").body as { id: string; version: { id: string } };
    const latest = getProject(project.id);
    expect(latest.latest_deliverable).toMatchObject({ title: "新版本成果", trial_id: firstTrial.id });
    expect(latest.pending_review_count).toBe(2);
    expect(latest.trials.find((trial) => trial.id === secondTrial.id)).toBeTruthy();
    const detail = getContext(String(firstTrial.id));
    expect(detail.deliverables.find((deliverable) => deliverable.id === secondDraft.id)).toMatchObject({ review_status: "pending_review" });
  });

  it("uses the latest decision as the shared next step", () => {
    const project = createProject({ name: "下一步项目", category: "tool" }, "next-project").body as { id: string };
    const trial = startTrial({ kind: "need", title: "下一步行动", content: "先做第一步", project_id: project.id, next_step: "旧下一步" }, "next-start").body;
    createDecision({ trial_id: trial.id, rationale: "新的判断依据", adjustment: "调整工作方向", next_step: "新的下一步", execution_status: "proposed" }, "next-decision");
    expect(getContext(String(trial.id))).toMatchObject({ next_step: "新的下一步" });
    expect(getProject(project.id).next_step).toBe("新的下一步");
  });
});
