import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { idempotent } from "../business";
import { getDb } from "../db";
import {
  countRecordRows,
  currentSlotsForRecord,
  dbTransaction,
  findHead,
  findRecord,
  findSubject,
  listAllHeads,
  listAllRecords,
  listAllSubjects,
  listCurrentRecordRows,
  listRecordRows,
  listSubjectRows,
  parseJson,
  recordFromRow,
  replacedBy,
  subjectFromRow,
  type RecordRow,
  type SubjectRow,
} from "./store";
import {
  RECORD_ASSERTIONS,
  RECORD_KINDS,
  RECORD_MODES,
  RECORD_ORIGINS,
  REFERENCE_KINDS,
  SUBJECT_STATUSES,
  WORKSPACE_BOARDS,
  type RecordAssertion,
  type RecordKind,
  type RecordMode,
  type RecordOrigin,
  type WorkspaceReference,
  type WorkspaceReferenceSource,
} from "./types";

type Json = Record<string, unknown>;

const MAX_TITLE = 160;
const MAX_CONTENT = 4000;
const MAX_RATIONALE = 1000;
const MAX_REFERENCE_ITEMS = 12;
const MAX_REFERENCE_FIELD = 1000;
const MAX_SUBJECT_ID = 120;
const MAX_SLOT = 80;
const DEFAULT_CONTEXT_LIMIT = 5;
const MAX_CONTEXT_LIMIT = 10;
const DEFAULT_CONTEXT_CHARS = 6000;
const MAX_CONTEXT_CHARS = 24000;

export class WorkspaceError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "WorkspaceError";
  }
}

const now = () => new Date().toISOString();

function text(value: unknown, max: number, label: string): string {
  if (typeof value !== "string") throw new WorkspaceError(400, `${label}_invalid`, `${label}必须是文本`);
  const result = value.trim();
  if (result.length > max) throw new WorkspaceError(400, `${label}_too_long`, `${label}不能超过 ${max} 个字符`);
  return result;
}

function optionalText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const result = text(value, max, label);
  return result || null;
}

function requiredText(value: unknown, max: number, label: string): string {
  const result = text(value, max, label);
  if (!result) throw new WorkspaceError(400, `${label}_required`, `${label}不能为空`);
  return result;
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, code: string, label: string): T[number] {
  const result = typeof value === "string" ? value.trim() : "";
  if (!(values as readonly string[]).includes(result)) throw new WorkspaceError(400, code, `${label}无效`);
  return result as T[number];
}

function assertObject(value: unknown, code: string, message: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkspaceError(400, code, message);
  return value as Json;
}

function parseId(value: unknown, label: string): string {
  const result = requiredText(value, MAX_SUBJECT_ID, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(result)) throw new WorkspaceError(400, `${label}_invalid`, `${label}只能使用字母、数字、点、下划线、冒号和连字符`);
  return result;
}

function nullableId(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return parseId(value, label);
}

function timestamp(value: unknown, label: string, defaultToNow = true): string {
  if (value === undefined || value === null || value === "") {
    if (defaultToNow) return now();
    throw new WorkspaceError(400, `${label}_required`, `${label}不能为空`);
  }
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new WorkspaceError(400, `${label}_invalid`, `${label}必须是有效时间`);
  return new Date(value).toISOString();
}

function normalizeReferences(value: unknown, ownerSubjectId: string): WorkspaceReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new WorkspaceError(400, "references_invalid", "references必须是数组");
  if (value.length > MAX_REFERENCE_ITEMS) throw new WorkspaceError(400, "references_too_many", `references不能超过 ${MAX_REFERENCE_ITEMS} 项`);
  const references: WorkspaceReference[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const reference = assertObject(item, "reference_invalid", `第 ${index + 1} 个引用无效`);
    const kind = enumValue(reference.kind, REFERENCE_KINDS, "reference_kind_invalid", `第 ${index + 1} 个引用类型`);
    const id = optionalText(reference.id, MAX_REFERENCE_FIELD, "reference_id");
    const locator = optionalText(reference.locator, MAX_REFERENCE_FIELD, "reference_locator");
    const label = optionalText(reference.label, 160, "reference_label");
    if (!id && !locator) throw new WorkspaceError(400, "reference_target_required", `第 ${index + 1} 个引用需要 id 或 locator`);
    if (kind === "subject" && !id) throw new WorkspaceError(400, "subject_reference_id_required", "subject 引用必须提供 id");
    if (kind === "subject" && id === ownerSubjectId) throw new WorkspaceError(400, "subject_self_reference", "主题不能引用自己");
    const normalized = { kind, ...(id ? { id } : {}), ...(locator ? { locator } : {}), ...(label ? { label } : {}) } as WorkspaceReference;
    const key = JSON.stringify(normalized);
    if (seen.has(key)) throw new WorkspaceError(400, "reference_duplicate", "references不能重复");
    seen.add(key);
    references.push(normalized);
  }
  const subjectIds = references.filter((reference) => reference.kind === "subject").map((reference) => reference.id as string);
  for (const subjectId of subjectIds) {
    if (!findSubject(subjectId)) throw new WorkspaceError(400, "subject_reference_not_found", `引用的主题不存在：${subjectId}`);
  }
  return references;
}

function normalizeSubjectPayload(payload: Json, idFromPath?: string) {
  const id = idFromPath || parseId(payload.id, "id");
  if (idFromPath && payload.id !== undefined && parseId(payload.id, "id") !== idFromPath) throw new WorkspaceError(400, "subject_id_mismatch", "路径中的主题 ID 与请求体不一致");
  const board = enumValue(payload.board, WORKSPACE_BOARDS, "board_invalid", "board");
  const title = requiredText(payload.title, MAX_TITLE, "title");
  const status = payload.status === undefined ? "active" : enumValue(payload.status, SUBJECT_STATUSES, "subject_status_invalid", "status");
  const references = normalizeReferences(payload.references, id);
  return { id, board, title, status, references };
}

function validateExpectedRevision(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new WorkspaceError(400, "expected_revision_invalid", "expected_revision必须是正整数");
  return Number(value);
}

function subjectMeta(row: SubjectRow) {
  const subject = subjectFromRow(row);
  const currentCount = listCurrentRecordRows(row.id).length;
  const source = sourceBundle(subject, []);
  return {
    ...subject,
    source_time: source.sourceTime,
    current_count: currentCount,
    source_count: source.sources.length,
    missing_source_count: source.warnings.length,
  };
}

function normalizeRecord(recordValue: unknown, subjectId: string, mode: RecordMode) {
  const record = assertObject(recordValue, "record_invalid", "record必须是对象");
  if (record.id !== undefined || record.recorded_at !== undefined || record.replaces_id !== undefined) {
    throw new WorkspaceError(400, "record_server_fields_forbidden", "record的 id、recorded_at、replaces_id由服务端生成");
  }
  if (record.slot !== undefined) throw new WorkspaceError(400, "record_slot_forbidden", "slot必须放在请求顶层");
  const kind = enumValue(record.kind, RECORD_KINDS, "record_kind_invalid", "record.kind");
  if (mode === "clear_current" && kind !== "correction") throw new WorkspaceError(400, "clear_record_kind_invalid", "clear_current必须使用 correction 记录");
  const title = requiredText(record.title, MAX_TITLE, "record.title");
  const content = requiredText(record.content, MAX_CONTENT, "record.content");
  const rationale = optionalText(record.rationale, MAX_RATIONALE, "record.rationale");
  const references = normalizeReferences(record.references, subjectId);
  const origin = record.origin === undefined ? "user" : enumValue(record.origin, RECORD_ORIGINS, "record_origin_invalid", "record.origin");
  const assertion = record.assertion === undefined ? "reported" : enumValue(record.assertion, RECORD_ASSERTIONS, "record_assertion_invalid", "record.assertion");
  const sourceLocator = optionalText(record.source_locator ?? record.sourceLocator, MAX_REFERENCE_FIELD, "record.source_locator");
  const observedAt = timestamp(record.observed_at ?? record.observedAt, "record.observed_at");
  return { kind, title, content, rationale, references, origin, assertion, sourceLocator, observedAt };
}

function normalizeSlot(value: unknown): string {
  const slot = requiredText(value, MAX_SLOT, "slot");
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$/.test(slot)) throw new WorkspaceError(400, "slot_invalid", "slot只能使用字母、数字、冒号、点、下划线和连字符");
  return slot;
}

function ensureExpectedCurrent(payload: Json): string | null {
  if (!Object.prototype.hasOwnProperty.call(payload, "expected_current_id")) throw new WorkspaceError(400, "expected_current_id_required", "set_current / clear_current必须提供 expected_current_id");
  return nullableId(payload.expected_current_id, "expected_current_id");
}

function recordView(row: RecordRow, extra: Json = {}) {
  return { ...recordFromRow(row), ...extra };
}

function sourceReferenceKey(reference: WorkspaceReference) {
  return JSON.stringify(reference);
}

function sourceForReference(reference: WorkspaceReference): WorkspaceReferenceSource {
  const db = getDb();
  if (reference.kind === "subject") {
    const row = reference.id ? findSubject(reference.id) : undefined;
    return row
      ? { reference, status: "available", source_type: "subject", id: row.id, label: row.title, updated_at: row.updated_at }
      : { reference, status: "missing", source_type: "subject", id: reference.id, label: reference.label || null };
  }
  if (reference.kind === "knowledge") {
    const id = reference.id || reference.locator || "";
    const row = id ? db.prepare("SELECT id, title, updated_at, changed_at, status, visible FROM knowledge_entries WHERE id=?").get(id) as { id: string; title: string; updated_at: string | null; changed_at: string | null; status: string; visible: number } | undefined : undefined;
    return row
      ? { reference, status: row.visible === 0 ? "unresolved" : "available", source_type: "knowledge", id: row.id, label: row.title, updated_at: row.updated_at || row.changed_at, details: { status: row.status, visible: row.visible === 1 } }
      : { reference, status: "missing", source_type: "knowledge", id: id || null, label: reference.label || null };
  }
  if (reference.kind === "repository") {
    const repository = reference.id || reference.locator || "";
    const row = repository ? db.prepare(`SELECT id, repository, title, event_type, occurred_at, branch, commit_sha, created_at
      FROM project_events WHERE repository=? OR repository LIKE ? ORDER BY occurred_at DESC, created_at DESC LIMIT 1`).get(repository, `${repository}/%`) as { id: string; repository: string; title: string; event_type: string; occurred_at: string; branch: string | null; commit_sha: string | null; created_at: string } | undefined : undefined;
    return row
      ? { reference, status: "available", source_type: "repository", id: row.id, label: row.title || row.repository, observed_at: row.occurred_at, updated_at: row.created_at, branch: row.branch, commit_sha: row.commit_sha, details: { repository: row.repository, event_type: row.event_type } }
      : { reference, status: "missing", source_type: "repository", id: repository || null, label: reference.label || null };
  }
  if (reference.kind === "file") {
    const locator = reference.locator || reference.id || "";
    let available = false;
    let updatedAt: string | null = null;
    try {
      available = Boolean(locator && existsSync(/*turbopackIgnore: true*/ locator));
      if (available) updatedAt = statSync(/*turbopackIgnore: true*/ locator).mtime.toISOString();
    } catch { available = false; }
    return available
      ? { reference, status: "available", source_type: "file", id: reference.id || null, label: reference.label || locator, updated_at: updatedAt }
      : { reference, status: "missing", source_type: "file", id: reference.id || null, label: reference.label || locator || null };
  }
  return { reference, status: "unresolved", source_type: "url", id: reference.id || null, label: reference.label || reference.locator || null, details: { fetch: false } };
}

function sourceBundle(subject: ReturnType<typeof subjectFromRow>, records: RecordRow[]) {
  const references = [...subject.references, ...records.flatMap((record) => parseJson<WorkspaceReference[]>(record.references_json, []))];
  const unique: WorkspaceReference[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    const key = sourceReferenceKey(reference);
    if (!seen.has(key)) { seen.add(key); unique.push(reference); }
  }
  const sources = unique.map(sourceForReference);
  const warnings = sources.filter((source) => source.status !== "available").map((source) => ({ code: `${source.status}_reference`, reference: source.reference, source_type: source.source_type }));
  const sourceTimes = sources.flatMap((source) => [source.updated_at, source.observed_at]).filter((value): value is string => Boolean(value));
  const recordTimes = records.map((record) => record.observed_at).filter(Boolean);
  const sourceTime = [...sourceTimes, ...recordTimes, subject.updated_at].sort().at(-1) || subject.updated_at;
  const newestSourceIds = sources.filter((source) => source.updated_at && records.some((record) => record.observed_at < (source.updated_at as string))).map((source) => source.id || source.reference.locator || source.source_type).filter(Boolean) as string[];
  return { sources, warnings, sourceTime, newestSourceIds };
}

function conflictDetails(subjectId: string, slot: string, expected: string | null, current: RecordRow | undefined, code: string) {
  return {
    conflict: code,
    subject_id: subjectId,
    slot,
    expected_current_id: expected,
    current_id: current?.id || null,
    current_observed_at: current?.observed_at || null,
  };
}

export function createSubject(payload: Json, requestId?: string) {
  return idempotent("POST /workspace/subjects", requestId, payload, () => {
    const normalized = normalizeSubjectPayload(payload);
    if (findSubject(normalized.id)) throw new WorkspaceError(409, "subject_exists", "主题 ID 已存在，请使用 PATCH 更新", { id: normalized.id });
    const createdAt = now();
    getDb().prepare(`INSERT INTO workspace_subjects(id, board, title, status, revision, references_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)`).run(normalized.id, normalized.board, normalized.title, normalized.status, JSON.stringify(normalized.references), createdAt, createdAt);
    return { status: 201, body: { id: normalized.id, revision: 1 } };
  });
}

export function updateSubject(id: string, payload: Json, requestId?: string) {
  return idempotent(`PATCH /workspace/subjects/${id}`, requestId, payload, () => {
    const subjectId = parseId(id, "id");
    const row = findSubject(subjectId);
    if (!row) throw new WorkspaceError(404, "subject_not_found", "主题不存在", { id: subjectId });
    const expectedRevision = validateExpectedRevision(payload.expected_revision);
    if (row.revision !== expectedRevision) throw new WorkspaceError(409, "subject_revision_conflict", "主题已被更新，请重新读取后再修改", { id: subjectId, expected_revision: expectedRevision, current_revision: row.revision });
    if (payload.board !== undefined) throw new WorkspaceError(400, "board_immutable", "主题创建后不能修改 board");
    if (payload.title === undefined && payload.status === undefined && payload.references === undefined) throw new WorkspaceError(400, "subject_update_empty", "至少提供 title、status 或 references 之一");
    const current = subjectFromRow(row);
    const title = payload.title === undefined ? current.title : requiredText(payload.title, MAX_TITLE, "title");
    const status = payload.status === undefined ? current.status : enumValue(payload.status, SUBJECT_STATUSES, "subject_status_invalid", "status");
    const references = payload.references === undefined ? current.references : normalizeReferences(payload.references, subjectId);
    const revision = row.revision + 1;
    const updatedAt = now();
    getDb().prepare(`UPDATE workspace_subjects SET title=?, status=?, references_json=?, revision=?, updated_at=? WHERE id=? AND revision=?`).run(title, status, JSON.stringify(references), revision, updatedAt, subjectId, expectedRevision);
    return { status: 200, body: { id: subjectId, revision } };
  });
}

export function appendRecord(payload: Json, requestId?: string) {
  return idempotent("POST /workspace/records", requestId, payload, () => {
    const subjectId = parseId(payload.subject_id, "subject_id");
    if (!findSubject(subjectId)) throw new WorkspaceError(404, "subject_not_found", "主题不存在", { id: subjectId });
    const mode = enumValue(payload.mode, RECORD_MODES, "record_mode_invalid", "mode") as RecordMode;
    const hasSlot = Object.prototype.hasOwnProperty.call(payload, "slot");
    const hasExpected = Object.prototype.hasOwnProperty.call(payload, "expected_current_id");
    if (mode === "history" && (hasSlot || hasExpected)) throw new WorkspaceError(400, "history_state_fields_forbidden", "history不能携带 slot 或 expected_current_id");
    const slot = mode === "history" ? null : normalizeSlot(payload.slot);
    const expected = mode === "history" ? null : ensureExpectedCurrent(payload);
    const normalized = normalizeRecord(payload.record, subjectId, mode);
    const result = dbTransaction((db) => {
      const currentHead = slot ? findHead(subjectId, slot) : undefined;
      const current = currentHead ? findRecord(currentHead.record_id) : undefined;
      if (mode !== "history" && (current?.id || null) !== expected) {
        throw new WorkspaceError(409, "current_head_conflict", "当前状态已变化，请重新读取后再提交", conflictDetails(subjectId, slot as string, expected, current, "current_head"));
      }
      if (mode === "set_current" && current && normalized.observedAt < current.observed_at) {
        throw new WorkspaceError(409, "observed_at_conflict", "新的当前记录不能早于当前记录的观察时间", conflictDetails(subjectId, slot as string, expected, current, "observed_at"));
      }
      const id = randomUUID();
      const recordedAt = now();
      const replacesId = mode === "history" ? null : current?.id || null;
      db.prepare(`INSERT INTO workspace_records(id, subject_id, kind, title, content, rationale, references_json, origin, assertion, source_locator, observed_at, recorded_at, slot, replaces_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        subjectId,
        normalized.kind,
        normalized.title,
        normalized.content,
        normalized.rationale,
        JSON.stringify(normalized.references),
        normalized.origin,
        normalized.assertion,
        normalized.sourceLocator,
        normalized.observedAt,
        recordedAt,
        slot,
        replacesId,
      );
      if (mode === "set_current") {
        if (currentHead) db.prepare("UPDATE workspace_heads SET record_id=? WHERE subject_id=? AND slot=?").run(id, subjectId, slot);
        else db.prepare("INSERT INTO workspace_heads(subject_id,slot,record_id) VALUES (?,?,?)").run(subjectId, slot, id);
      } else if (mode === "clear_current") {
        db.prepare("DELETE FROM workspace_heads WHERE subject_id=? AND slot=?").run(subjectId, slot);
      }
      db.prepare("UPDATE workspace_subjects SET updated_at=? WHERE id=?").run(recordedAt, subjectId);
      db.prepare("INSERT INTO events(entity_type,entity_id,kind,payload_json,created_at) VALUES (?,?,?,?,?)")
        .run("workspace_record", id, "workspace.record.created", JSON.stringify({ record_id: id, subject_id: subjectId, mode, slot, replaces_id: replacesId }), recordedAt);
      return { record_id: id, current_id: mode === "set_current" ? id : null, mode };
    });
    return { status: 201, body: result };
  });
}

export function listSubjects(options: { board?: unknown; status?: unknown; query?: unknown } = {}) {
  const board = options.board ? enumValue(options.board, WORKSPACE_BOARDS, "board_invalid", "board") : undefined;
  const status = options.status ? enumValue(options.status, SUBJECT_STATUSES, "subject_status_invalid", "status") : undefined;
  const query = options.query === undefined ? undefined : text(options.query, 200, "q");
  return { subjects: listSubjectRows({ board, status, query }).map(subjectMeta) };
}

function historyItem(row: RecordRow) {
  return recordView(row, { current: currentSlotsForRecord(row.id).length > 0, replaced_by: replacedBy(row.id) });
}

export function getSubject(id: string, options: { includeHistory?: boolean; limit?: unknown; offset?: unknown } = {}) {
  const subjectId = parseId(id, "id");
  const row = findSubject(subjectId);
  if (!row) return null;
  const subject = subjectFromRow(row);
  const currentRows = listCurrentRecordRows(subjectId);
  const current = currentRows.map((currentRow) => recordView(currentRow, { slot: currentRow.head_slot, current: true }));
  const includeHistory = options.includeHistory === true;
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
  const offset = Math.max(0, Number(options.offset) || 0);
  const historyRows = includeHistory ? listRecordRows(subjectId, { limit, offset }) : [];
  const historyTotal = countRecordRows(subjectId);
  const source = sourceBundle(subject, currentRows);
  return {
    ...subject,
    source_time: source.sourceTime,
    sources: source.sources,
    source_warnings: source.warnings,
    current,
    heads: currentRows.map((currentRow) => ({ subject_id: subjectId, slot: currentRow.head_slot, record_id: currentRow.id })),
    recent_record_ids: listRecordRows(subjectId, { limit: 10, offset: 0 }).map((record) => record.id),
    history: historyRows.map(historyItem),
    history_included: includeHistory,
    history_total: historyTotal,
    history_next_offset: includeHistory && offset + historyRows.length < historyTotal ? offset + historyRows.length : null,
  };
}

export function getRecord(id: string) {
  const recordId = parseId(id, "id");
  const row = findRecord(recordId);
  if (!row) return null;
  const slots = currentSlotsForRecord(recordId);
  const subject = findSubject(row.subject_id);
  const source = subject ? sourceBundle(subjectFromRow(subject), [row]) : { sources: [], warnings: [], sourceTime: row.observed_at, newestSourceIds: [] };
  return {
    ...recordView(row, { current: slots.length > 0, current_slots: slots, replaced_by: replacedBy(recordId) }),
    subject: subject ? subjectMeta(subject) : null,
    sources: source.sources,
    source_warnings: source.warnings,
  };
}

function subjectMatchesRepository(subject: ReturnType<typeof subjectFromRow>, repository: string) {
  const normalized = repository.trim().toLowerCase();
  return subject.references.some((reference) => reference.kind === "repository" && [reference.id, reference.locator].filter(Boolean).some((value) => String(value).trim().toLowerCase() === normalized));
}

function subjectMatchesQuery(subject: ReturnType<typeof subjectFromRow>, records: RecordRow[], query: string) {
  const needle = query.toLowerCase();
  const haystack = [subject.id, subject.title, subject.board, ...subject.references.flatMap((reference) => [reference.id, reference.locator, reference.label]), ...records.flatMap((record) => [record.title, record.content, record.rationale, record.source_locator])].filter(Boolean).join("\n").toLowerCase();
  return haystack.includes(needle);
}

function contextScope(body: Json) {
  let subjectIds: string[] | undefined;
  if (Object.prototype.hasOwnProperty.call(body, "subject_ids")) {
    if (!Array.isArray(body.subject_ids)) throw new WorkspaceError(400, "subject_ids_invalid", "subject_ids必须是数组");
    subjectIds = body.subject_ids.map((value) => parseId(value, "subject_id"));
    if (new Set(subjectIds).size !== subjectIds.length) throw new WorkspaceError(400, "subject_ids_duplicate", "subject_ids不能重复");
  }
  const board = body.board ? enumValue(body.board, WORKSPACE_BOARDS, "board_invalid", "board") : undefined;
  const repository = body.repository === undefined ? undefined : requiredText(body.repository, 240, "repository");
  const query = body.query === undefined ? undefined : text(body.query, 200, "query");
  return { subjectIds, board, repository, query };
}

function historyReference(row: RecordRow, currentIds: Set<string>) {
  return { id: row.id, subject_id: row.subject_id, kind: row.kind, title: row.title, slot: row.slot, observed_at: row.observed_at, recorded_at: row.recorded_at, replaces_id: row.replaces_id, current: currentIds.has(row.id) };
}

export function buildContext(body: Json = {}) {
  const scope = contextScope(body);
  if (!scope.subjectIds && !scope.board && !scope.repository) return { used: false, reason: "scope_required", scope, subjects: [], items: [], warnings: [] };
  const requestedLimit = body.limit === undefined ? DEFAULT_CONTEXT_LIMIT : Number(body.limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new WorkspaceError(400, "limit_invalid", "limit必须是正整数");
  const limit = Math.min(MAX_CONTEXT_LIMIT, requestedLimit);
  const requestedChars = body.max_chars === undefined ? DEFAULT_CONTEXT_CHARS : Number(body.max_chars);
  if (!Number.isInteger(requestedChars) || requestedChars < 500) throw new WorkspaceError(400, "max_chars_invalid", "max_chars必须是不小于 500 的整数");
  const maxChars = Math.min(MAX_CONTEXT_CHARS, requestedChars);
  const missingSubjectIds: string[] = [];
  let rows: SubjectRow[];
  if (scope.subjectIds) {
    rows = [];
    for (const subjectId of scope.subjectIds) {
      const row = findSubject(subjectId);
      if (row) rows.push(row); else missingSubjectIds.push(subjectId);
    }
  } else {
    rows = listSubjectRows({ board: scope.board });
    if (scope.repository) rows = rows.filter((row) => subjectMatchesRepository(subjectFromRow(row), scope.repository as string));
  }
  const matchingRows = rows.map((row) => ({ row, subject: subjectFromRow(row), records: listCurrentRecordRows(row.id).map((currentRow) => currentRow as RecordRow) }))
    .filter(({ subject, records }) => !scope.query || subjectMatchesQuery(subject, records, scope.query));
  const candidates = matchingRows.slice(0, limit);
  const subjectPayloads: Json[] = [];
  const omittedIds: string[] = [];
  const itemRecords: Json[] = [];
  const warnings: Json[] = [];
  const allCandidateIds = matchingRows.map(({ subject }) => subject.id);
  const outputScope = { ...scope, subject_ids: scope.subjectIds || null, limit, max_chars: maxChars };
  for (const candidate of candidates) {
    const { subject, records } = candidate;
    const currentIds = new Set(records.map((record) => record.id));
    const source = sourceBundle(subject, records);
    const allHistory = listRecordRows(subject.id, { limit: 100, offset: 0 }).filter((record) => !currentIds.has(record.id)).map((record) => historyReference(record, currentIds));
    const payload: Json = {
      subject: subjectMeta(candidate.row),
      current: records.map((record) => recordView(record, { slot: (record as RecordRow & { head_slot?: string }).head_slot || record.slot, current: true })),
      history: allHistory,
      sources: source.sources,
      source_time: source.sourceTime,
      newer_material_available: source.newestSourceIds.length > 0,
      newer_source_ids: source.newestSourceIds,
      warnings: source.warnings,
    };
    const candidateItems = records.map((record) => ({ ...recordView(record, { slot: (record as RecordRow & { head_slot?: string }).head_slot || record.slot, current: true }), subject_id: subject.id, subject_title: subject.title, board: subject.board }));
    const projectedSize = JSON.stringify({ used: true, reason: null, scope: outputScope, subjects: [...subjectPayloads, payload], items: [...itemRecords, ...candidateItems], warnings: [...warnings, ...source.warnings] }).length;
    if (projectedSize > maxChars) {
      omittedIds.push(subject.id);
      continue;
    }
    subjectPayloads.push(payload);
    warnings.push(...source.warnings as Json[]);
    itemRecords.push(...candidateItems);
  }
  const used = subjectPayloads.length > 0 && itemRecords.length > 0;
  if (!used) {
    return {
      used: false,
      reason: "no_records",
      scope: outputScope,
      subjects: [],
      items: [],
      warnings,
      missing_subject_ids: missingSubjectIds,
      truncated: omittedIds.length > 0,
      omitted_count: omittedIds.length,
      omitted_ids: omittedIds,
    };
  }
  const omitted = Math.max(0, allCandidateIds.length - subjectPayloads.length) + missingSubjectIds.length;
  return {
    used: true,
    reason: null,
    scope: outputScope,
    subjects: subjectPayloads,
    items: itemRecords,
    warnings,
    missing_subject_ids: missingSubjectIds,
    truncated: omitted > 0,
    omitted_count: omitted,
    omitted_ids: [...omittedIds, ...missingSubjectIds],
    record_ids: itemRecords.map((item) => String(item.id)),
  };
}

export function exportWorkspace(options: { subjectId?: unknown; board?: unknown; all?: unknown } = {}) {
  const subjectId = options.subjectId === undefined || options.subjectId === null || options.subjectId === "" ? undefined : parseId(options.subjectId, "subject_id");
  const board = options.board ? enumValue(options.board, WORKSPACE_BOARDS, "board_invalid", "board") : undefined;
  const all = options.all === true || options.all === "true" || options.all === 1 || options.all === "1";
  if (!subjectId && !board && !all) throw new WorkspaceError(400, "scope_required", "导出全部数据必须显式提供 all=true，或指定 subject_id / board");
  if (subjectId && !findSubject(subjectId)) throw new WorkspaceError(404, "subject_not_found", "主题不存在", { id: subjectId });
  const subjects = listAllSubjects().filter((row) => (!subjectId || row.id === subjectId) && (!board || row.board === board)).map(subjectFromRow);
  const subjectIds = new Set(subjects.map((subject) => subject.id));
  const records = listAllRecords().filter((row) => subjectIds.has(row.subject_id)).map(recordFromRow);
  const recordIds = new Set(records.map((record) => record.id));
  const heads = listAllHeads().filter((head) => subjectIds.has(head.subject_id) && recordIds.has(head.record_id));
  const sources = subjects.map((subject) => {
    const subjectRecords = records.filter((record) => record.subject_id === subject.id).map((record) => ({ ...record, references_json: JSON.stringify(record.references) } as unknown as RecordRow));
    const source = sourceBundle(subject, subjectRecords);
    return { subject_id: subject.id, source_time: source.sourceTime, sources: source.sources, warnings: source.warnings };
  });
  return {
    schema_version: "workspace-v1",
    exported_at: now(),
    filter: { subject_id: subjectId || null, board: board || null, all },
    subjects,
    records,
    heads,
    sources,
  };
}
