import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BusinessError, createCapture, createDraft, createProject, createTrial, getContext, getProjects, startTrial, updateTrial } from "../lib/business";
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
});
