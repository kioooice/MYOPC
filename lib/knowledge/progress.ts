import { randomBytes } from "node:crypto";
import { getDb } from "../db";

// OPC V0.2：项目关键进展即时回流 + 新会话恢复。
// 这一层只做「接收 + 保存 + 筛选 + 组装」，不调用任何模型：
// 计划、执行方报告和验证证据由提交方给出；服务器不把报告提升成验证事实，也不改写现场记录。

export const PROJECT_EVENT_TYPES = ["plan", "progress", "decision", "environment", "finding", "blocker", "correction"] as const;
export type ProjectEventType = (typeof PROJECT_EVENT_TYPES)[number];
export const PROJECT_EVENT_STATUSES = ["planned", "reported", "verified", "blocked", "superseded"] as const;
export type ProjectEventStatus = (typeof PROJECT_EVENT_STATUSES)[number];

const MAX_TITLE = 160;
const MAX_CONTENT = 2000;
const MAX_RATIONALE = 800;
const MAX_VERIFICATION = 800;
const MAX_NEXT_STEP = 400;
const MAX_EVIDENCE_ITEMS = 6;
const MAX_EVIDENCE_CHARS = 300;
const MAX_TOPIC = 120;

/** bootstrap 返回的字段长度上限：宁可少给，也不把整段记录塞回去。 */
const SUMMARY_CONTENT = 400;
const SUMMARY_RATIONALE = 260;
const SUMMARY_VERIFICATION = 240;
const SUMMARY_EVIDENCE_ITEMS = 4;

export type ProjectEventRecord = {
  id: string;
  repository: string;
  taskResultId: string | null;
  eventType: ProjectEventType;
  topic: string;
  title: string;
  content: string;
  rationale: string;
  status: ProjectEventStatus;
  verification: string;
  evidence: string[];
  nextStep: string;
  machine: string | null;
  branch: string | null;
  commit: string | null;
  dirty: boolean;
  source: string;
  supersedesId: string | null;
  supersededBy: string | null;
  occurredAt: string;
  createdAt: string;
};

export type ProjectEventInput = {
  repository?: unknown;
  task?: unknown;
  taskResultId?: string | null;
  submissionId?: string | null;
  eventIndex?: number;
  eventType?: unknown;
  topic?: unknown;
  title?: unknown;
  content?: unknown;
  rationale?: unknown;
  status?: unknown;
  verification?: unknown;
  evidence?: unknown;
  nextStep?: unknown;
  machine?: unknown;
  branch?: unknown;
  commit?: unknown;
  dirty?: unknown;
  source?: unknown;
  supersedesId?: unknown;
  occurredAt?: unknown;
};

type EventRow = {
  id: string; repository: string; task_result_id: string | null; submission_id: string | null; event_index: number;
  event_type: string; topic: string; title: string; content: string; rationale: string; status: string;
  verification: string; evidence_json: string; next_step: string; machine: string | null; branch: string | null;
  commit_sha: string | null; dirty: number; source: string; supersedes_id: string | null; superseded_by: string | null;
  occurred_at: string; created_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function textList(value: unknown, limit: number, max: number) {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((item) => text(item, max)).filter(Boolean).slice(0, limit);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function isEventType(value: string): value is ProjectEventType {
  return (PROJECT_EVENT_TYPES as readonly string[]).includes(value);
}

function isEventStatus(value: string): value is ProjectEventStatus {
  return (PROJECT_EVENT_STATUSES as readonly string[]).includes(value);
}

/**
 * 凭据只保留「引用名称」，不保留原文。客户端和服务端都跑一遍：
 * 客户端保证上传载荷本身干净，服务端作为兜底并报告脱敏次数。
 */
export function redactText(value: string): { text: string; redacted: number } {
  let redacted = 0;
  const run = (pattern: RegExp, build: (match: string, groups: string[]) => string) => {
    text = text.replace(pattern, (...args: unknown[]) => {
      const match = String(args[0] ?? "");
      const groups = args.slice(1, Math.max(1, args.length - 2)).map((item) => String(item ?? ""));
      redacted += 1;
      return build(match, groups);
    });
  };
  let text = typeof value === "string" ? value : "";
  run(/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, () => "[已脱敏:私钥]");
  run(/\bsk-[A-Za-z0-9_-]{12,}\b/g, () => "[已脱敏:密钥]");
  run(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, () => "[已脱敏:令牌]");
  run(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, () => "Bearer [已脱敏]");
  run(/(^|[^A-Za-z0-9_])([A-Za-z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?KEY|SECRET[_-]?KEY|CLIENT[_-]?SECRET|PASSWORD|PASSWD|TOKEN)[A-Za-z0-9_]*)\s*[:=]\s*["']?([^\s"'，。；;]{6,})/gi,
    (match, groups) => `${groups[0] ?? ""}${groups[1] ?? ""}=[已脱敏]`);
  run(/\bhttps?:\/\/[^\s/:@]+:[^\s/@]+@[^\s]+/gi, () => "[已脱敏:带凭据链接]");
  return { text, redacted };
}

function redacted(value: unknown, max: number) {
  const raw = text(value, max * 2);
  const result = redactText(raw);
  return { value: result.text.slice(0, max), redacted: result.redacted };
}

export type NormalizedEvent = {
  eventType: ProjectEventType;
  topic: string;
  title: string;
  content: string;
  rationale: string;
  status: ProjectEventStatus;
  verification: string;
  evidence: string[];
  nextStep: string;
  machine: string | null;
  branch: string | null;
  commit: string | null;
  dirty: boolean;
  source: string;
  supersedesId: string | null;
  occurredAt: string;
  notes: string[];
  redacted: number;
};

export type NormalizeResult = { events: NormalizedEvent[]; redacted: number; notes: string[] };

function normalizeOne(raw: Record<string, unknown>, fallbackOccurredAt: string): NormalizedEvent | null {
  let redactedCount = 0;
  const notes: string[] = [];
  const take = (key: string, max: number) => {
    const result = redacted(raw[key], max);
    redactedCount += result.redacted;
    return result.value;
  };
  const content = take("content", MAX_CONTENT) || take("title", MAX_TITLE);
  const title = take("title", MAX_TITLE) || content.slice(0, 60);
  if (!content && !title) return null;
  const rawType = text(raw.event_type ?? raw.eventType, 40);
  const eventType: ProjectEventType = rawType === "completed" ? "progress" : rawType === "config" ? "environment" : isEventType(rawType) ? rawType : "progress";
  if (rawType && rawType !== eventType) notes.push(`事件类型 ${rawType} 按 ${eventType} 记录`);
  let status = text(raw.status, 20);
  const verification = take("verification", MAX_VERIFICATION);
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.map((item) => redacted(item, MAX_EVIDENCE_CHARS).value).filter(Boolean).slice(0, MAX_EVIDENCE_ITEMS)
    : [];
  for (const item of Array.isArray(raw.evidence) ? raw.evidence : []) redactedCount += redacted(item, MAX_EVIDENCE_CHARS).redacted;
  let eventStatus: ProjectEventStatus = isEventStatus(status) ? status : eventType === "plan" ? "planned" : eventType === "blocker" ? "blocked" : "reported";
  if (!isEventStatus(status) && status) notes.push(`事件状态 ${status} 按 ${eventStatus} 记录`);
  // 只有带验证方式或证据的提交才能标成 verified；服务器不会替执行方升级状态。
  if (eventStatus === "verified" && !verification && evidence.length === 0) {
    eventStatus = "reported";
    notes.push("缺少验证方式与证据，已按执行方报告记录");
  }
  const occurredAt = text(raw.occurred_at ?? raw.occurredAt, 40) || fallbackOccurredAt;
  return {
    eventType,
    topic: take("topic", MAX_TOPIC),
    title,
    content,
    rationale: take("rationale", MAX_RATIONALE),
    status: eventStatus,
    verification,
    evidence,
    nextStep: take("next_step", MAX_NEXT_STEP) || take("nextStep", MAX_NEXT_STEP),
    machine: text(raw.machine, 120) || null,
    branch: text(raw.branch, 200) || null,
    commit: text(raw.commit ?? raw.commit_sha, 64) || null,
    dirty: raw.dirty === true || raw.dirty === 1 || raw.dirty === "true",
    source: text(raw.source, 40) || "codex",
    supersedesId: text(raw.supersedes ?? raw.supersedesId ?? raw.supersedes_id, 120) || null,
    occurredAt,
    notes,
    redacted: redactedCount,
  };
}

export function normalizeProjectEvents(value: unknown, defaults: { occurredAt?: string } = {}): NormalizeResult {
  if (!Array.isArray(value)) return { events: [], redacted: 0, notes: [] };
  const occurredAt = defaults.occurredAt || nowIso();
  const events: NormalizedEvent[] = [];
  const notes: string[] = [];
  let redactedCount = 0;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const normalized = normalizeOne(item as Record<string, unknown>, occurredAt);
    if (!normalized) continue;
    redactedCount += normalized.redacted;
    notes.push(...normalized.notes);
    events.push(normalized);
    if (events.length >= 20) break;
  }
  return { events, redacted: redactedCount, notes };
}

function toEvent(row: EventRow): ProjectEventRecord {
  return {
    id: row.id,
    repository: row.repository,
    taskResultId: row.task_result_id,
    eventType: (PROJECT_EVENT_TYPES as readonly string[]).includes(row.event_type) ? row.event_type as ProjectEventType : "progress",
    topic: row.topic,
    title: row.title,
    content: row.content,
    rationale: row.rationale,
    status: (PROJECT_EVENT_STATUSES as readonly string[]).includes(row.status) ? row.status as ProjectEventStatus : "reported",
    verification: row.verification,
    evidence: parseJson<string[]>(row.evidence_json, []),
    nextStep: row.next_step,
    machine: row.machine,
    branch: row.branch,
    commit: row.commit_sha,
    dirty: row.dirty === 1,
    source: row.source,
    supersedesId: row.supersedes_id,
    supersededBy: row.superseded_by,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

function eventId(occurredAt: string) {
  const day = occurredAt.slice(0, 10).replace(/-/g, "") || nowIso().slice(0, 10).replace(/-/g, "");
  return `evt-${day}-${randomBytes(3).toString("hex")}`;
}

export type SaveEventsResult = { saved: ProjectEventRecord[]; dedupedIds: string[]; supersededIds: string[]; notes: string[]; redacted: number };

/**
 * 保存一次回流里的多个事件。同一次回流重试（submission_id + 序号相同）不会重复写入；
 * 更正记录用 supersedes 指向旧记录：旧记录标记为 superseded，仍然保留历史。
 */
export function saveProjectEvents(input: {
  repository: string;
  events: NormalizedEvent[];
  taskResultId?: string | null;
  submissionId?: string | null;
  task?: string;
  redacted?: number;
}): SaveEventsResult {
  const db = getDb();
  const saved: ProjectEventRecord[] = [];
  const dedupedIds: string[] = [];
  const supersededIds: string[] = [];
  const notes: string[] = [];
  const createdAt = nowIso();
  const insert = db.prepare(`INSERT INTO project_events(id, repository, task_result_id, submission_id, event_index, event_type, topic, title, content, rationale, status, verification, evidence_json, next_step, machine, branch, commit_sha, dirty, source, supersedes_id, superseded_by, occurred_at, created_at)
    VALUES (@id, @repository, @task_result_id, @submission_id, @event_index, @event_type, @topic, @title, @content, @rationale, @status, @verification, @evidence, @next_step, @machine, @branch, @commit, @dirty, @source, @supersedes_id, NULL, @occurred_at, @created_at)`);
  const existingBySubmission = input.submissionId
    ? db.prepare("SELECT * FROM project_events WHERE submission_id=?").all(input.submissionId) as EventRow[]
    : [];
  input.events.forEach((event, index) => {
    const duplicate = existingBySubmission.find((row) => row.event_index === index);
    if (duplicate) { dedupedIds.push(duplicate.id); return; }
    const id = eventId(event.occurredAt);
    insert.run({
      id,
      repository: input.repository,
      task_result_id: input.taskResultId ?? null,
      submission_id: input.submissionId ?? null,
      event_index: index,
      event_type: event.eventType,
      topic: event.topic,
      title: event.title,
      content: event.content,
      rationale: event.rationale,
      status: event.status,
      verification: event.verification,
      evidence: JSON.stringify(event.evidence),
      next_step: event.nextStep,
      machine: event.machine,
      branch: event.branch,
      commit: event.commit,
      dirty: event.dirty ? 1 : 0,
      source: event.source,
      supersedes_id: event.supersedesId,
      occurred_at: event.occurredAt,
      created_at: createdAt,
    });
    if (event.supersedesId) {
      const target = db.prepare("SELECT id, title FROM project_events WHERE id=? AND repository=?").get(event.supersedesId, input.repository) as { id: string; title: string } | undefined;
      if (target) {
        db.prepare("UPDATE project_events SET status='superseded', superseded_by=? WHERE id=? AND repository=?").run(id, target.id, input.repository);
        supersededIds.push(target.id);
      } else {
        notes.push(`supersedes 指向的记录不存在：${event.supersedesId}`);
      }
    }
    const row = db.prepare("SELECT * FROM project_events WHERE id=?").get(id) as EventRow;
    saved.push(toEvent(row));
  });
  return { saved, dedupedIds, supersededIds, notes, redacted: input.redacted ?? 0 };
}

export function listProjectEvents(repository: string, limit = 60) {
  if (!repository) return [] as ProjectEventRecord[];
  const rows = getDb().prepare("SELECT * FROM project_events WHERE repository=? ORDER BY occurred_at DESC, rowid DESC LIMIT ?")
    .all(repository, Math.max(1, Math.min(limit, 400))) as EventRow[];
  return rows.map(toEvent);
}

export function getProjectEvent(id: string) {
  const row = getDb().prepare("SELECT * FROM project_events WHERE id=?").get(id) as EventRow | undefined;
  return row ? toEvent(row) : null;
}

export function countProjectEvents(repository: string) {
  if (!repository) return 0;
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM project_events WHERE repository=?").get(repository) as { count: number };
  return row.count;
}

function trim(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
export type ProgressRecord = {
  id: string;
  type: ProjectEventType;
  title: string;
  content: string;
  rationale: string;
  status: ProjectEventStatus;
  verification: string;
  evidence: string[];
  nextStep: string;
  machine: string | null;
  branch: string | null;
  commit: string | null;
  dirty: boolean;
  occurredAt: string;
  recordedAt: string;
  sameBranch: boolean | null;
  sameMachine: boolean | null;
  sameCommit: boolean | null;
  note: string | null;
  taskResultId: string | null;
  supersedesId: string | null;
  supersededBy: string | null;
};

export type EnvironmentProgress = ProgressRecord & {
  /** 只有本机验证过才算本机已就绪；其他机器的验证结果保持原样并显式标注。 */
  verifiedOnThisMachine: boolean;
};

export type BootstrapConflict = { topic: string; note: string; records: ProgressRecord[] };

export type BootstrapCounts = {
  records: number;
  sameBranch: number;
  otherBranch: number;
  otherMachine: number;
  olderCommit: number;
};

export type BootstrapResult = {
  used: boolean;
  reason: string | null;
  message?: string;
  repository: string;
  branch: string | null;
  commit: string | null;
  machine: string | null;
  generatedAt: string;
  counts: BootstrapCounts;
  goal: { text: string; recordId: string | null; at: string | null } | null;
  phase: ProgressRecord | null;
  updatedAt: string | null;
  recent: ProgressRecord[];
  decisions: ProgressRecord[];
  environment: EnvironmentProgress[];
  blockers: ProgressRecord[];
  nextSteps: Array<{ text: string; recordId: string }>;
  conflicts: BootstrapConflict[];
  notes: string[];
  truncated: boolean;
  recordIds: string[];
};

type Context = { branch?: string | null; commit?: string | null; machine?: string | null };

function shortCommit(value: string | null) {
  return value ? value.slice(0, 8) : null;
}

function toProgressRecord(event: ProjectEventRecord, context: Context): ProgressRecord {
  const sameBranch = event.branch && context.branch ? event.branch === context.branch : null;
  const sameMachine = event.machine && context.machine ? event.machine === context.machine : null;
  const sameCommit = event.commit && context.commit ? event.commit === context.commit : null;
  const notes: string[] = [];
  if (sameMachine === false) notes.push(`记录来自机器 ${event.machine}`);
  if (sameBranch === false) notes.push(`记录来自分支 ${event.branch}`);
  if (sameCommit === false) notes.push(`记录对应提交 ${shortCommit(event.commit)}，请核对相关变化`);
  return {
    id: event.id,
    type: event.eventType,
    title: trim(event.title, MAX_TITLE),
    content: trim(event.content, SUMMARY_CONTENT),
    rationale: trim(event.rationale, SUMMARY_RATIONALE),
    status: event.status,
    verification: trim(event.verification, SUMMARY_VERIFICATION),
    evidence: event.evidence.slice(0, SUMMARY_EVIDENCE_ITEMS).map((item) => trim(item, MAX_EVIDENCE_CHARS)),
    nextStep: trim(event.nextStep, MAX_NEXT_STEP),
    machine: event.machine,
    branch: event.branch,
    commit: event.commit,
    dirty: event.dirty,
    occurredAt: event.occurredAt,
    recordedAt: event.createdAt,
    sameBranch,
    sameMachine,
    sameCommit,
    note: notes.length > 0 ? notes.join("；") : null,
    taskResultId: event.taskResultId,
    supersedesId: event.supersedesId,
    supersededBy: event.supersededBy,
  };
}

function relevance(record: ProgressRecord) {
  // 先按分支相关性分层，再按时间排序：不把其他分支的最新记录直接拼到本分支状态里。
  return record.sameBranch === false ? 1 : 0;
}

function sortRelevant(records: ProgressRecord[]) {
  return [...records].sort((left, right) => relevance(left) - relevance(right) || right.occurredAt.localeCompare(left.occurredAt));
}

function emptyResult(repository: string, context: Context, generatedAt: string, reason: string, notes: string[]): BootstrapResult {
  return {
    used: false,
    reason,
    repository,
    branch: context.branch ?? null,
    commit: context.commit ?? null,
    machine: context.machine ?? null,
    generatedAt,
    counts: { records: 0, sameBranch: 0, otherBranch: 0, otherMachine: 0, olderCommit: 0 },
    goal: null,
    phase: null,
    updatedAt: null,
    recent: [],
    decisions: [],
    environment: [],
    blockers: [],
    nextSteps: [],
    conflicts: [],
    notes,
    truncated: false,
    recordIds: [],
  };
}

/** 组装新会话的恢复摘要：只筛选和排序，不调用模型，也不改写记录。 */
export function buildRecoverySummary(input: { repository?: unknown; branch?: unknown; commit?: unknown; machine?: unknown; task?: unknown; limit?: unknown } = {}): BootstrapResult {
  const repository = text(input.repository, 200);
  const generatedAt = nowIso();
  const context: Context = {
    branch: text(input.branch, 200) || null,
    commit: text(input.commit, 64) || null,
    machine: text(input.machine, 120) || null,
  };
  const limit = Math.max(4, Math.min(Number(input.limit) || 8, 20));
  if (!repository) return emptyResult("", context, generatedAt, "repository_unresolved", ["调用方没有提供仓库标识，无法恢复项目状态"]);
  const rows = listProjectEvents(repository, 300);
  if (rows.length === 0) return emptyResult(repository, context, generatedAt, "no_records", ["这个仓库还没有回流记录，按当前任务正常开始即可"]);

  const annotated = sortRelevant(rows.map((row) => toProgressRecord(row, context)));
  const active = annotated.filter((record) => record.status !== "superseded");
  const recent = annotated.slice(0, limit);
  const decisions = active.filter((record) => record.type === "decision").slice(0, 6);
  const environment: EnvironmentProgress[] = active
    .filter((record) => record.type === "environment")
    .slice(0, 6)
    .map((record) => ({ ...record, verifiedOnThisMachine: record.status === "verified" && record.sameMachine === true }));
  const blockers = active.filter((record) => record.type === "blocker").slice(0, 5);
  const phase = active.find((record) => record.type === "progress" || record.type === "plan") ?? null;
  const goalRecord = active.find((record) => record.type === "plan") ?? null;

  const nextSteps: Array<{ text: string; recordId: string }> = [];
  const seenSteps = new Set<string>();
  // 只取有效记录：被替代的记录里的"下一步"已经不作数了。
  for (const record of active.slice(0, 10)) {
    const step = record.nextStep.trim();
    if (!step || seenSteps.has(step)) continue;
    seenSteps.add(step);
    nextSteps.push({ text: trim(step, MAX_NEXT_STEP), recordId: record.id });
    if (nextSteps.length >= 5) break;
  }

  const conflicts: BootstrapConflict[] = [];
  const byTopic = new Map<string, ProgressRecord[]>();
  for (const record of active) {
    if (!record.title) continue;
    const topic = record.title.slice(0, 60);
    const list = byTopic.get(topic) ?? [];
    list.push(record);
    byTopic.set(topic, list);
  }
  for (const [topic, list] of byTopic) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
    const [newest, previous] = sorted;
    if (newest.content === previous.content) continue;
    if (newest.supersedesId === previous.id || previous.supersededBy === newest.id) continue;
    conflicts.push({ topic, note: "同一主题下存在内容不同的记录，且没有声明替代关系；需要人工确认哪一条仍然有效", records: [newest, previous] });
    if (conflicts.length >= 4) break;
  }

  const otherBranch = annotated.filter((record) => record.sameBranch === false).length;
  const otherMachine = annotated.filter((record) => record.sameMachine === false).length;
  const olderCommit = annotated.filter((record) => record.sameCommit === false).length;
  const sameBranch = annotated.length - otherBranch;
  const notes: string[] = [];
  if (otherBranch > 0) notes.push(`${otherBranch} 条记录来自其他分支，已在记录上标注分支`);
  if (otherMachine > 0) notes.push(`${otherMachine} 条记录来自其他机器；其他机器验证过的配置不代表本机已就绪`);
  if (olderCommit > 0) notes.push(`${olderCommit} 条记录对应更早的提交，请核对相关变化后再沿用`);
  if (blockers.length > 0) notes.push(`有 ${blockers.length} 条未解除的阻塞记录`);
  if (conflicts.length > 0) notes.push("存在互相冲突的记录，服务器不会自动裁决，请人工确认");
  const recordIds = [...new Set([...recent, ...decisions, ...environment, ...blockers].map((record) => record.id))].slice(0, 40);

  return {
    used: true,
    reason: null,
    repository,
    branch: context.branch ?? null,
    commit: context.commit ?? null,
    machine: context.machine ?? null,
    generatedAt,
    counts: { records: rows.length, sameBranch, otherBranch, otherMachine, olderCommit },
    goal: goalRecord ? { text: trim(goalRecord.content || goalRecord.title, SUMMARY_CONTENT), recordId: goalRecord.id, at: goalRecord.occurredAt } : null,
    phase,
    updatedAt: active[0]?.occurredAt ?? null,
    recent,
    decisions,
    environment,
    blockers,
    nextSteps,
    conflicts,
    notes,
    truncated: active.length > limit + decisions.length + environment.length + blockers.length,
    recordIds,
  };
}

export type EntryProgress = {
  repositories: string[];
  stage: { title: string; status: ProjectEventStatus; occurredAt: string } | null;
  updatedAt: string | null;
  events: ProgressRecord[];
  environment: Array<ProgressRecord & { verifiedOnThisMachine: boolean }>;
  blockers: ProgressRecord[];
  nextSteps: string[];
  total: number;
};

/** 项目详情页用的最近进展：按知识条目关联的仓库取，没有记录时返回 null，不显示空区块。 */
export function getRepositoryProgress(repositories: string[], limit = 6): EntryProgress | null {
  const repos = [...new Set(repositories.map((item) => text(item, 200)).filter(Boolean))];
  if (repos.length === 0) return null;
  const all = repos.flatMap((repo) => listProjectEvents(repo, 60)).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  if (all.length === 0) return null;
  const active = all.filter((record) => record.status !== "superseded");
  const annotated = all.map((record) => toProgressRecord(record, {}));
  const activeRecords = annotated.filter((record) => record.status !== "superseded");
  const stage = active.find((record) => record.eventType === "progress" || record.eventType === "plan") ?? null;
  const nextSteps: string[] = [];
  for (const record of activeRecords.slice(0, 10)) {
    const step = record.nextStep.trim();
    if (!step || nextSteps.includes(step)) continue;
    nextSteps.push(trim(step, MAX_NEXT_STEP));
    if (nextSteps.length >= 3) break;
  }
  return {
    repositories: repos,
    stage: stage ? { title: stage.title, status: stage.status, occurredAt: stage.occurredAt } : null,
    updatedAt: activeRecords[0]?.occurredAt ?? null,
    events: activeRecords.slice(0, limit),
    environment: activeRecords.filter((record) => record.type === "environment").slice(0, 3)
      .map((record) => ({ ...record, verifiedOnThisMachine: record.status === "verified" })),
    blockers: activeRecords.filter((record) => record.type === "blocker").slice(0, 3),
    nextSteps,
    total: all.length,
  };
}