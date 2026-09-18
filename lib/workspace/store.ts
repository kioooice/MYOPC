import type Database from "better-sqlite3";
import { getDb } from "../db";
import type { WorkspaceRecord, WorkspaceReference, WorkspaceSubject } from "./types";

export type SubjectRow = {
  id: string;
  board: string;
  title: string;
  status: string;
  revision: number;
  references_json: string;
  created_at: string;
  updated_at: string;
};

export type RecordRow = {
  id: string;
  subject_id: string;
  kind: string;
  title: string;
  content: string;
  rationale: string | null;
  references_json: string;
  origin: string;
  assertion: string;
  source_locator: string | null;
  observed_at: string;
  recorded_at: string;
  slot: string | null;
  replaces_id: string | null;
};

export type HeadRow = { subject_id: string; slot: string; record_id: string };

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

export function subjectFromRow(row: SubjectRow): WorkspaceSubject {
  return {
    id: row.id,
    board: row.board as WorkspaceSubject["board"],
    title: row.title,
    status: row.status as WorkspaceSubject["status"],
    revision: Number(row.revision),
    references: parseJson<WorkspaceReference[]>(row.references_json, []),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function recordFromRow(row: RecordRow): WorkspaceRecord {
  return {
    id: row.id,
    subject_id: row.subject_id,
    kind: row.kind as WorkspaceRecord["kind"],
    title: row.title,
    content: row.content,
    rationale: row.rationale,
    references: parseJson<WorkspaceReference[]>(row.references_json, []),
    origin: row.origin as WorkspaceRecord["origin"],
    assertion: row.assertion as WorkspaceRecord["assertion"],
    source_locator: row.source_locator,
    observed_at: row.observed_at,
    recorded_at: row.recorded_at,
    slot: row.slot,
    replaces_id: row.replaces_id,
  };
}

export function getWorkspaceDb() {
  return getDb();
}

export function findSubject(id: string): SubjectRow | undefined {
  return getDb().prepare("SELECT * FROM workspace_subjects WHERE id=?").get(id) as SubjectRow | undefined;
}

export function findRecord(id: string): RecordRow | undefined {
  return getDb().prepare("SELECT * FROM workspace_records WHERE id=?").get(id) as RecordRow | undefined;
}

export function findHead(subjectId: string, slot: string): HeadRow | undefined {
  return getDb().prepare("SELECT * FROM workspace_heads WHERE subject_id=? AND slot=?").get(subjectId, slot) as HeadRow | undefined;
}

export function listHeads(subjectId?: string): HeadRow[] {
  if (subjectId) return getDb().prepare("SELECT * FROM workspace_heads WHERE subject_id=? ORDER BY slot").all(subjectId) as HeadRow[];
  return getDb().prepare("SELECT * FROM workspace_heads ORDER BY subject_id, slot").all() as HeadRow[];
}

export function listSubjectRows(options: { board?: string; status?: string; query?: string } = {}): SubjectRow[] {
  const clauses: string[] = [];
  const values: string[] = [];
  if (options.board) { clauses.push("board=?"); values.push(options.board); }
  if (options.status) { clauses.push("status=?"); values.push(options.status); }
  if (options.query) {
    clauses.push("(id LIKE ? OR title LIKE ? OR references_json LIKE ?)");
    const query = `%${options.query}%`;
    values.push(query, query, query);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  return getDb().prepare(`SELECT * FROM workspace_subjects${where} ORDER BY updated_at DESC, id`).all(...values) as SubjectRow[];
}

export function listRecordRows(subjectId: string, options: { limit?: number; offset?: number } = {}): RecordRow[] {
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
  const offset = Math.max(0, Number(options.offset) || 0);
  return getDb().prepare("SELECT * FROM workspace_records WHERE subject_id=? ORDER BY observed_at DESC, recorded_at DESC, id DESC LIMIT ? OFFSET ?")
    .all(subjectId, limit, offset) as RecordRow[];
}

export function listCurrentRecordRows(subjectId: string): Array<RecordRow & { head_slot: string }> {
  return getDb().prepare(`SELECT r.*, h.slot AS head_slot
    FROM workspace_heads h JOIN workspace_records r ON r.id=h.record_id
    WHERE h.subject_id=? ORDER BY h.slot`).all(subjectId) as Array<RecordRow & { head_slot: string }>;
}

export function countRecordRows(subjectId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM workspace_records WHERE subject_id=?").get(subjectId) as { count: number };
  return Number(row.count);
}

export function currentSlotsForRecord(recordId: string): string[] {
  return (getDb().prepare("SELECT slot FROM workspace_heads WHERE record_id=? ORDER BY slot").all(recordId) as Array<{ slot: string }>).map((row) => row.slot);
}

export function replacedBy(recordId: string): string[] {
  return (getDb().prepare("SELECT id FROM workspace_records WHERE replaces_id=? ORDER BY recorded_at, id").all(recordId) as Array<{ id: string }>).map((row) => row.id);
}

export function listAllSubjects(): SubjectRow[] {
  return getDb().prepare("SELECT * FROM workspace_subjects ORDER BY id").all() as SubjectRow[];
}

export function listAllRecords(): RecordRow[] {
  return getDb().prepare("SELECT * FROM workspace_records ORDER BY subject_id, recorded_at, id").all() as RecordRow[];
}

export function listAllHeads(): HeadRow[] {
  return listHeads();
}

export function countCurrentHeads(subjectId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM workspace_heads WHERE subject_id=?").get(subjectId) as { count: number };
  return Number(row.count);
}

export function dbTransaction<T>(operation: (db: Database.Database) => T): T {
  return getDb().transaction(() => operation(getDb()))();
}

