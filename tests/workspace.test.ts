import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDbForTests, getDb } from "../lib/db";
import { WorkspaceError, appendRecord, buildContext, createSubject, exportWorkspace, getRecord, getSubject, listSubjects, updateSubject } from "../lib/workspace/service";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "myopc-workspace-test-"));
  process.env.MYOPC_DATA_DIR = directory;
});

afterEach(() => {
  closeDbForTests();
  rmSync(directory, { recursive: true, force: true });
  delete process.env.MYOPC_DATA_DIR;
});

function subject(id: string, board = "media") {
  return createSubject({ id, board, title: `合成主题：${id}`, references: [] }, `${id}-create`).body as { id: string; revision: number };
}

function record(subjectId: string, mode: string, title: string, expected: string | null, requestId: string, extra: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = {
    subject_id: subjectId,
    mode,
    record: {
      kind: mode === "clear_current" ? "correction" : "observation",
      title,
      content: `synthetic：${title}`,
      origin: "agent",
      assertion: "reported",
      source_locator: "synthetic:test-case",
      observed_at: extra.observed_at || "2026-01-01T00:00:00Z",
    },
  };
  if (mode !== "history") {
    payload.slot = "stage";
    payload.expected_current_id = expected;
  }
  return appendRecord(payload, requestId).body as { record_id: string; current_id: string | null; mode: string };
}

describe("workspace persistence and current-state contract", () => {
  it("applies migration 15 idempotently and preserves workspace rows after reopen", () => {
    subject("synthetic-migration");
    expect((getDb().prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version=15").get() as { count: number }).count).toBe(1);
    closeDbForTests();
    const reopened = getDb();
    expect((reopened.prepare("SELECT id FROM workspace_subjects WHERE id=?").get("synthetic-migration") as { id: string }).id).toBe("synthetic-migration");
    expect((reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version=15").get() as { count: number }).count).toBe(1);
  });

  it("creates and updates subjects with stable revision and explicit references", () => {
    subject("synthetic-media");
    subject("synthetic-personal", "personal");
    const updated = updateSubject("synthetic-media", {
      expected_revision: 1,
      title: "合成主题：更新",
      references: [{ kind: "subject", id: "synthetic-personal", label: "合成关联" }],
    }, "synthetic-media-update").body;
    expect(updated).toEqual({ id: "synthetic-media", revision: 2 });
    expect(listSubjects({ board: "media" }).subjects[0]).toMatchObject({ id: "synthetic-media", title: "合成主题：更新", revision: 2, current_count: 0 });
    expect(() => updateSubject("synthetic-media", { expected_revision: 1, title: "过期更新" }, "synthetic-media-stale")).toThrowError(WorkspaceError);
    expect(() => createSubject({ id: "synthetic-media", board: "media", title: "重复" }, "another-request")).toThrowError(WorkspaceError);
  });

  it("keeps history separate, moves heads atomically, rejects stale writes, and clear never restores old state", () => {
    subject("synthetic-media");
    const history = record("synthetic-media", "history", "早期历史", null, "history-1");
    expect(history.current_id).toBeNull();
    const first = record("synthetic-media", "set_current", "等待发布", null, "current-1", { observed_at: "2026-01-01T00:00:00Z" });
    const second = record("synthetic-media", "set_current", "发布完成", first.record_id, "current-2", { observed_at: "2026-01-02T00:00:00Z" });
    expect(second.current_id).toBe(second.record_id);
    expect(() => appendRecord({
      subject_id: "synthetic-media", mode: "set_current", slot: "stage", expected_current_id: first.record_id,
      record: { kind: "observation", title: "过期提交", content: "不应写入", observed_at: "2026-01-03T00:00:00Z" },
    }, "stale-head")).toThrowError(WorkspaceError);
    const detail = getSubject("synthetic-media", { includeHistory: true });
    expect(detail?.current).toHaveLength(1);
    expect(detail?.current[0]).toMatchObject({ id: second.record_id, title: "发布完成", slot: "stage" });
    expect(detail?.history.some((item: { id: string }) => item.id === first.record_id)).toBe(true);
    expect(detail?.history.some((item: { id: string }) => item.id === history.record_id)).toBe(true);

    const cleared = record("synthetic-media", "clear_current", "清除当前状态", second.record_id, "current-clear");
    expect(cleared.current_id).toBeNull();
    expect(getSubject("synthetic-media")?.current).toEqual([]);
    expect(getRecord(second.record_id)).toMatchObject({ current: false, replaced_by: [cleared.record_id] });
    expect(getSubject("synthetic-media", { includeHistory: true })?.current).toEqual([]);
  });

  it("replays identical record requests without moving a newer head backwards", () => {
    subject("synthetic-media");
    const first = record("synthetic-media", "set_current", "第一条", null, "same-request", { observed_at: "2026-01-01T00:00:00Z" });
    const replay = appendRecord({
      subject_id: "synthetic-media", mode: "set_current", slot: "stage", expected_current_id: null,
      record: { kind: "observation", title: "第一条", content: "synthetic：第一条", origin: "agent", assertion: "reported", source_locator: "synthetic:test-case", observed_at: "2026-01-01T00:00:00Z" },
    }, "same-request").body;
    expect(replay).toEqual({ record_id: first.record_id, current_id: first.record_id, mode: "set_current" });
    const newer = record("synthetic-media", "set_current", "第二条", first.record_id, "newer-request", { observed_at: "2026-01-02T00:00:00Z" });
    const replayOld = appendRecord({
      subject_id: "synthetic-media", mode: "set_current", slot: "stage", expected_current_id: null,
      record: { kind: "observation", title: "第一条", content: "synthetic：第一条", origin: "agent", assertion: "reported", source_locator: "synthetic:test-case", observed_at: "2026-01-01T00:00:00Z" },
    }, "same-request").body;
    expect(replayOld).toEqual({ record_id: first.record_id, current_id: first.record_id, mode: "set_current" });
    expect(getSubject("synthetic-media")?.current[0].id).toBe(newer.record_id);
  });

  it("requires a scope, returns current context only, and exports explicit data", () => {
    subject("synthetic-media", "media");
    subject("synthetic-personal", "personal");
    updateSubject("synthetic-media", { expected_revision: 1, references: [{ kind: "repository", id: "synthetic/repo", label: "合成仓库" }] }, "media-ref");
    const first = record("synthetic-media", "set_current", "等待发布", null, "context-1", { observed_at: "2026-01-01T00:00:00Z" });
    record("synthetic-media", "set_current", "发布完成", first.record_id, "context-2", { observed_at: "2026-01-02T00:00:00Z" });
    record("synthetic-media", "history", "旧历史", null, "context-history", { observed_at: "2025-01-01T00:00:00Z" });
    expect(buildContext({})).toMatchObject({ used: false, reason: "scope_required" });
    const context = buildContext({ subject_ids: ["synthetic-media"] });
    expect(context).toMatchObject({ used: true, truncated: false, subjects: [{ subject: { id: "synthetic-media" } }] });
    expect(context.items).toHaveLength(1);
    expect(context.items[0]).toMatchObject({ title: "发布完成", current: true });
    expect((context.items as Array<{ title: string }>).some((item) => item.title === "等待发布")).toBe(false);
    expect((context.subjects[0].history as Array<{ title: string }>).some((item) => item.title === "等待发布")).toBe(true);
    expect(buildContext({ board: "personal" })).toMatchObject({ used: false, reason: "no_records" });
    const exported = exportWorkspace({ subjectId: "synthetic-media" });
    expect(exported).toMatchObject({ schema_version: "workspace-v1", subjects: [{ id: "synthetic-media" }], heads: [{ slot: "stage" }] });
    expect(exported.records).toHaveLength(3);
    expect(() => exportWorkspace({})).toThrowError(WorkspaceError);
    expect(exportWorkspace({ all: true }).subjects).toHaveLength(2);
  });

  it("flags newer explicit repository material without making it current", () => {
    subject("synthetic-media");
    updateSubject("synthetic-media", { expected_revision: 1, references: [{ kind: "repository", id: "synthetic/repo" }] }, "repo-ref");
    record("synthetic-media", "set_current", "已核对状态", null, "repo-current", { observed_at: "2026-01-01T00:00:00Z" });
    getDb().prepare(`INSERT INTO project_events(id, repository, event_type, title, content, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("evt-synthetic-new", "synthetic/repo", "progress", "更新材料", "synthetic source", "2026-02-01T00:00:00Z", "2026-02-01T00:00:00Z");
    const context = buildContext({ repository: "synthetic/repo" });
    expect(context.subjects[0]).toMatchObject({ newer_material_available: true, newer_source_ids: ["evt-synthetic-new"] });
    expect(context.items[0].title).toBe("已核对状态");
  });
});
