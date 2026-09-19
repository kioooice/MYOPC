import { describe, expect, it } from "vitest";
import { classifyWorkspaceWork, contextHasIncompleteData, evidenceLabel, isExplicitAgentDecision, isExplicitUserDecision, isOverviewUnderstandingRecord, recordDisplayContent, subjectContextHasIncompleteData, workspaceRecordSummary } from "../app/workspace-view-model";

describe("workspace view state semantics", () => {
  it("only promotes an explicitly marked current record to the decision panel", () => {
    expect(isExplicitUserDecision({ kind: "question", slot: "open_question", current: true })).toBe(false);
    expect(isExplicitUserDecision({ kind: "question", slot: "needs_user_decision", current: true })).toBe(true);
    expect(isExplicitUserDecision({ kind: "correction", slot: "needs_user_decision", current: true })).toBe(false);
    expect(isExplicitUserDecision({ kind: "question", slot: "needs_user_decision", current: false })).toBe(false);
  });

  it("only promotes a sourced, reported agent decision to the AI decision panel", () => {
    expect(isExplicitAgentDecision({ kind: "decision", slot: "ai_decision", origin: "agent", assertion: "reported", source_locator: "opc:task:test", current: true })).toBe(true);
    expect(isExplicitAgentDecision({ kind: "decision", slot: "ai_decision", origin: "user", assertion: "reported", source_locator: "opc:task:test", current: true })).toBe(false);
    expect(isExplicitAgentDecision({ kind: "decision", slot: "ai_decision", origin: "agent", assertion: "inferred", source_locator: "opc:task:test", current: true })).toBe(false);
    expect(isExplicitAgentDecision({ kind: "decision", slot: "ai_decision", origin: "agent", assertion: "reported", current: true })).toBe(false);
    expect(isExplicitAgentDecision({ kind: "observation", slot: "stage", origin: "agent", assertion: "reported", source_locator: "opc:task:test", current: true })).toBe(false);
  });

  it("keeps MYOPC delivery status in project detail and summarizes it by title in work columns", () => {
    expect(isOverviewUnderstandingRecord({ subject_id: "myopc-stage2", kind: "observation", slot: "stage", current: true })).toBe(false);
    expect(isOverviewUnderstandingRecord({ subject_id: "myopc-stage2", kind: "observation", slot: "next_step", current: true })).toBe(false);
    expect(isOverviewUnderstandingRecord({ subject_id: "personal-opc-direction", kind: "statement", slot: "collaboration", current: true })).toBe(false);
    expect(isOverviewUnderstandingRecord({ subject_id: "another-project", kind: "observation", slot: "stage", current: true })).toBe(true);
    expect(isOverviewUnderstandingRecord({ subject_id: "myopc-stage2", kind: "question", slot: "open_question", current: true })).toBe(false);
    expect(workspaceRecordSummary({ subject_id: "myopc-stage2", kind: "observation", slot: "stage", title: "用户可读阶段", content: "内部验收报告", current: true })).toBe("用户可读阶段");
    expect(workspaceRecordSummary({ subject_id: "myopc-stage2", kind: "observation", slot: "work_status", title: "进行中", content: "业务状态说明", current: true })).toBe("业务状态说明");
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

  it("shows a marked preview when minimal context omits full content", () => {
    expect(recordDisplayContent({ content: "完整正文" })).toEqual({ text: "完整正文", isPreview: false, needsMore: false });
    expect(recordDisplayContent({ content_preview: "预览正文", content_truncated: true })).toEqual({ text: "预览正文", isPreview: true, needsMore: true });
    expect(recordDisplayContent({ content: "部分正文", content_truncated: true })).toEqual({ text: "部分正文", isPreview: true, needsMore: true });
    expect(recordDisplayContent({ content_truncated: true })).toEqual({ text: "", isPreview: true, needsMore: true });
  });

  it("marks omitted and truncated context as incomplete", () => {
    expect(contextHasIncompleteData({ truncated: false, omitted_count: 0, subjects: [] })).toBe(false);
    const context = { truncated: true, omitted_count: 1, omitted_ids: ["omitted"], subjects: [{ subject: { id: "shown", current_count: 1 }, current: [{ title: "摘要", content: "..." }], current_truncated: true }] };
    expect(contextHasIncompleteData(context)).toBe(true);
    expect(subjectContextHasIncompleteData(context, "omitted")).toBe(true);
    expect(subjectContextHasIncompleteData(context, "shown")).toBe(true);
    expect(subjectContextHasIncompleteData({ truncated: true, omitted_count: 1, omitted_ids: ["other"], subjects: [{ subject: { id: "shown", current_count: 1 }, current: [{ title: "完整", content: "..." }] }] }, "shown")).toBe(false);
    expect(subjectContextHasIncompleteData({ truncated: false, omitted_count: 0, subjects: [{ subject: { id: "preview", current_count: 1 }, current: [{ title: "预览", content_preview: "...", content_truncated: true }] }] }, "preview")).toBe(true);
  });
});
