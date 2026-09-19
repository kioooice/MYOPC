export type WorkspaceRecordModel = {
  kind?: string | null;
  slot?: string | null;
  title?: string | null;
  content?: string | null;
  content_preview?: string | null;
  content_truncated?: boolean;
  current?: boolean;
};

export type WorkspaceRecordDisplay = {
  text: string;
  isPreview: boolean;
  needsMore: boolean;
};

export type WorkspaceContextModel = {
  truncated?: boolean;
  budget_exceeded?: boolean;
  omitted_count?: number;
  omitted_ids?: string[];
  missing_subject_ids?: string[];
  subjects?: Array<{
    subject?: { id?: string; current_count?: number };
    current?: WorkspaceRecordModel[];
    current_truncated?: boolean;
    history_truncated?: boolean;
    sources_truncated?: boolean;
    history_omitted_count?: number;
    sources_omitted_count?: number;
  }>;
};

export type WorkspaceWorkState = "in_progress" | "completed" | "blocked" | "unknown";

const WORK_STATE_SLOTS = new Set(["work_status", "work_state", "workflow_status"]);

function normalizedValue(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/[：:]/g, "");
}

/** Prefer full content, but make the API's minimal preview explicit instead of rendering a blank card. */
export function recordDisplayContent(record: WorkspaceRecordModel): WorkspaceRecordDisplay {
  const content = (record.content || "").trim();
  const preview = (record.content_preview || "").trim();
  if (content) return { text: content, isPreview: Boolean(record.content_truncated), needsMore: Boolean(record.content_truncated) };
  if (preview) return { text: preview, isPreview: true, needsMore: true };
  return { text: "", isPreview: Boolean(record.content_truncated), needsMore: true };
}

/** Only an explicit current marker can place a record in the decision panel. */
export function isExplicitUserDecision(record: WorkspaceRecordModel) {
  return record.current !== false && record.slot === "needs_user_decision" && record.kind !== "correction";
}

/** Event evidence and business work state are separate concepts. */
export function classifyWorkspaceWork(record: WorkspaceRecordModel): WorkspaceWorkState | null {
  if (record.current === false || !record.slot) return null;
  const value = normalizedValue(record.content);
  if (WORK_STATE_SLOTS.has(record.slot)) {
    if (["in_progress", "inprogress", "进行中", "进行"].includes(value)) return "in_progress";
    if (["completed", "complete", "done", "已完成", "完成"].includes(value)) return "completed";
    if (["blocked", "受阻", "阻塞"].includes(value)) return "blocked";
    return "unknown";
  }
  return record.kind === "observation" ? "unknown" : null;
}

export function workStateLabel(state: WorkspaceWorkState) {
  return ({ in_progress: "进行中", completed: "已完成", blocked: "受阻", unknown: "未明确" }[state]);
}

export function evidenceLabel(type: string | undefined, status: string | undefined) {
  if (type === "decision") return "已记录决定";
  if (type === "finding") return status === "verified" ? "已验证发现" : "已记录发现";
  if (type === "environment") return "环境记录";
  if (type === "blocker" || status === "blocked") return "受阻记录";
  if (type === "correction") return "已记录更正";
  if (status === "verified") return "已验证进展";
  if (status === "reported") return "已报告进展";
  if (status === "planned") return "已记录计划";
  if (status === "superseded") return "已替代记录";
  return type === "progress" ? "已记录进展" : "已记录事件";
}

export function contextHasIncompleteData(context: WorkspaceContextModel | null | undefined) {
  if (!context) return true;
  if (context.truncated || context.budget_exceeded || (context.omitted_count || 0) > 0 || (context.omitted_ids?.length || 0) > 0 || (context.missing_subject_ids?.length || 0) > 0) return true;
  return (context.subjects || []).some((item) => Boolean(item.current_truncated || item.current?.some((record) => record.content_truncated) || item.history_truncated || item.sources_truncated || (item.history_omitted_count || 0) > 0 || (item.sources_omitted_count || 0) > 0));
}

export function subjectContextHasIncompleteData(context: WorkspaceContextModel | null | undefined, subjectId: string) {
  if (!context) return true;
  if (context.omitted_ids?.includes(subjectId) || context.missing_subject_ids?.includes(subjectId)) return true;
  const item = (context.subjects || []).find((candidate) => candidate.subject?.id === subjectId);
  if (!item) return false;
  return Boolean(item.current_truncated || item.current?.some((record) => record.content_truncated) || item.history_truncated || item.sources_truncated || (item.history_omitted_count || 0) > 0 || (item.sources_omitted_count || 0) > 0);
}
