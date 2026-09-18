import { describe, expect, it } from "vitest";
import { classifyWorkspaceWork, contextHasIncompleteData, evidenceLabel, isExplicitUserDecision, subjectContextHasIncompleteData } from "../app/workspace-view-model";

describe("workspace view state semantics", () => {
  it("only promotes an explicitly marked current record to the decision panel", () => {
    expect(isExplicitUserDecision({ kind: "question", slot: "open_question", current: true })).toBe(false);
    expect(isExplicitUserDecision({ kind: "question", slot: "needs_user_decision", current: true })).toBe(true);
    expect(isExplicitUserDecision({ kind: "correction", slot: "needs_user_decision", current: true })).toBe(false);
    expect(isExplicitUserDecision({ kind: "question", slot: "needs_user_decision", current: false })).toBe(false);
  });

  it("does not infer business work state from event evidence", () => {
    expect(classifyWorkspaceWork({ kind: "finding", title: "已验证", content: "验证完成", current: true })).toBeNull();
    expect(classifyWorkspaceWork({ kind: "progress", slot: "stage", content: "reported", current: true })).toBeNull();
    expect(classifyWorkspaceWork({ kind: "observation", slot: "stage", content: "已交付但未标明工作状态", current: true })).toBe("unknown");
    expect(classifyWorkspaceWork({ kind: "observation", slot: "work_status", content: "进行中", current: true })).toBe("in_progress");
    expect(classifyWorkspaceWork({ kind: "observation", slot: "work_status", content: "无法判断", current: true })).toBe("unknown");
  });

  it("keeps evidence labels separate from work labels", () => {
    expect(evidenceLabel("progress", "reported")).toBe("已报告进展");
    expect(evidenceLabel("finding", "verified")).toBe("已验证发现");
    expect(evidenceLabel("decision", "verified")).toBe("已记录决定");
  });

  it("marks omitted and truncated context as incomplete", () => {
    expect(contextHasIncompleteData({ truncated: false, omitted_count: 0, subjects: [] })).toBe(false);
    const context = { truncated: true, omitted_count: 1, omitted_ids: ["omitted"], subjects: [{ subject: { id: "shown", current_count: 1 }, current: [{ title: "摘要", content: "..." }], current_truncated: true }] };
    expect(contextHasIncompleteData(context)).toBe(true);
    expect(subjectContextHasIncompleteData(context, "omitted")).toBe(true);
    expect(subjectContextHasIncompleteData(context, "shown")).toBe(true);
    expect(subjectContextHasIncompleteData({ truncated: true, omitted_count: 1, omitted_ids: ["other"], subjects: [{ subject: { id: "shown", current_count: 1 }, current: [{ title: "完整", content: "..." }] }] }, "shown")).toBe(false);
  });
});
