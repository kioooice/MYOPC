import { getDb } from "../db";
import type { KnowledgeEntry, KnowledgeKind, KnowledgeSnapshot, KnowledgeSourceRef } from "./repo";

export type KnowledgeEntryRecord = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  summary: string;
  status: string;
  tags: string[];
  related: string[];
  link: string | null;
  updatedAt: string | null;
  sources: KnowledgeSourceRef[];
  body: string;
  relPath: string;
  contentHash: string;
  visible: boolean;
  changedAt: string;
};

export type ReadingNoteContent = {
  summary: string;
  /** 首页用的一句话简介，控制在 24 字以内。 */
  brief: string;
  /** 列表卡用的介绍，控制在 120 字以内、完整成句、不分段。 */
  card: string;
  facts: string[];
  decisions: Array<{ title: string; detail: string }>;
  steps: string[];
  conditions: string[];
  open_questions: string[];
  inferences: string[];
};

export type ReadingNoteRecord = {
  entryId: string;
  promptVersion: string;
  sourceHash: string;
  model: string;
  status: "ready" | "failed";
  content: ReadingNoteContent | null;
  error: string | null;
  generatedAt: string | null;
  attemptedAt: string;
};

export type KnowledgeSyncState = {
  directory: string | null;
  repository: string | null;
  branch: string | null;
  commit: string | null;
  status: "ok" | "failed" | "never";
  message: string | null;
  entryCount: number;
  addedCount: number;
  updatedCount: number;
  removedCount: number;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ApplySummary = { added: number; updated: number; unchanged: number; removed: number; total: number };

type EntryRow = {
  id: string; kind: string; title: string; summary: string; status: string;
  tags_json: string; related_json: string; link: string | null; updated_at: string | null;
  sources_json: string; body: string; rel_path: string; content_hash: string;
  visible: number; changed_at: string;
};

type NoteRow = {
  entry_id: string; prompt_version: string; source_hash: string; model: string;
  status: string; content_json: string | null; error: string | null;
  generated_at: string | null; attempted_at: string;
};

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function toEntry(row: EntryRow): KnowledgeEntryRecord {
  return {
    id: row.id,
    kind: row.kind as KnowledgeKind,
    title: row.title,
    summary: row.summary,
    status: row.status,
    tags: parseJson<string[]>(row.tags_json, []),
    related: parseJson<string[]>(row.related_json, []),
    link: row.link,
    updatedAt: row.updated_at,
    sources: parseJson<KnowledgeSourceRef[]>(row.sources_json, []),
    body: row.body,
    relPath: row.rel_path,
    contentHash: row.content_hash,
    visible: row.visible === 1,
    changedAt: row.changed_at,
  };
}

function toNote(row: NoteRow): ReadingNoteRecord {
  return {
    entryId: row.entry_id,
    promptVersion: row.prompt_version,
    sourceHash: row.source_hash,
    model: row.model,
    status: row.status === "ready" ? "ready" : "failed",
    content: parseJson<ReadingNoteContent | null>(row.content_json, null),
    error: row.error,
    generatedAt: row.generated_at,
    attemptedAt: row.attempted_at,
  };
}

export function applyKnowledgeSnapshot(snapshot: KnowledgeSnapshot): ApplySummary {
  const db = getDb();
  const timestamp = new Date().toISOString();
  const existing = db.prepare("SELECT id, content_hash, visible FROM knowledge_entries").all() as Array<{ id: string; content_hash: string; visible: number }>;
  const known = new Map(existing.map((row) => [row.id, row]));
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  const insert = db.prepare(`INSERT INTO knowledge_entries(id, kind, title, summary, status, tags_json, related_json, link, updated_at, sources_json, extra_json, body, rel_path, content_hash, visible, first_seen_at, last_seen_at, changed_at)
    VALUES (@id, @kind, @title, @summary, @status, @tags, @related, @link, @updated_at, @sources, @extra, @body, @rel_path, @content_hash, 1, @now, @now, @now)`);
  const update = db.prepare(`UPDATE knowledge_entries SET kind=@kind, title=@title, summary=@summary, status=@status, tags_json=@tags, related_json=@related, link=@link, updated_at=@updated_at, sources_json=@sources, extra_json=@extra, body=@body, rel_path=@rel_path, content_hash=@content_hash, visible=1, last_seen_at=@now, changed_at=@now WHERE id=@id`);
  const touch = db.prepare("UPDATE knowledge_entries SET visible=1, last_seen_at=@now WHERE id=@id");
  const hide = db.prepare("UPDATE knowledge_entries SET visible=0, last_seen_at=@now, changed_at=@now WHERE id=@id");

  const run = db.transaction((entries: KnowledgeEntry[]) => {
    for (const entry of entries) {
      seen.add(entry.id);
      const previous = known.get(entry.id);
      const params = {
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        summary: entry.summary,
        status: entry.status,
        tags: JSON.stringify(entry.tags),
        related: JSON.stringify(entry.related),
        link: entry.link,
        updated_at: entry.updatedAt,
        sources: JSON.stringify(entry.sources),
        extra: JSON.stringify(entry.extra),
        body: entry.body,
        rel_path: entry.relPath,
        content_hash: entry.contentHash,
        now: timestamp,
      };
      if (!previous) { insert.run(params); added += 1; continue; }
      if (previous.content_hash !== entry.contentHash || previous.visible !== 1) { update.run(params); updated += 1; continue; }
      touch.run({ id: entry.id, now: timestamp });
      unchanged += 1;
    }
    for (const row of existing) {
      if (seen.has(row.id) || row.visible !== 1) continue;
      hide.run({ id: row.id, now: timestamp });
      updated += 1;
    }
  });
  run(snapshot.entries);

  const removed = existing.filter((row) => row.visible === 1 && !seen.has(row.id)).length;
  const total = db.prepare("SELECT COUNT(*) AS count FROM knowledge_entries WHERE visible=1").get() as { count: number };
  return { added, updated, unchanged, removed, total: total.count };
}

export function saveKnowledgeSyncState(state: KnowledgeSyncState) {
  const db = getDb();
  db.prepare(`INSERT INTO knowledge_sync_state(id, directory, repository, branch, commit_sha, status, message, entry_count, added_count, updated_count, removed_count, started_at, finished_at)
    VALUES (1, @directory, @repository, @branch, @commit, @status, @message, @entry_count, @added_count, @updated_count, @removed_count, @started_at, @finished_at)
    ON CONFLICT(id) DO UPDATE SET directory=@directory, repository=@repository, branch=@branch, commit_sha=@commit, status=@status, message=@message, entry_count=@entry_count, added_count=@added_count, updated_count=@updated_count, removed_count=@removed_count, started_at=@started_at, finished_at=@finished_at`)
    .run({
      directory: state.directory,
      repository: state.repository,
      branch: state.branch,
      commit: state.commit,
      status: state.status,
      message: state.message,
      entry_count: state.entryCount,
      added_count: state.addedCount,
      updated_count: state.updatedCount,
      removed_count: state.removedCount,
      started_at: state.startedAt,
      finished_at: state.finishedAt,
    });
}

export function getKnowledgeSyncState(): KnowledgeSyncState {
  const row = getDb().prepare("SELECT * FROM knowledge_sync_state WHERE id=1").get() as
    | { directory: string | null; repository: string | null; branch: string | null; commit_sha: string | null; status: string; message: string | null; entry_count: number; added_count: number; updated_count: number; removed_count: number; started_at: string | null; finished_at: string | null }
    | undefined;
  if (!row) {
    return { directory: null, repository: null, branch: null, commit: null, status: "never", message: null, entryCount: 0, addedCount: 0, updatedCount: 0, removedCount: 0, startedAt: null, finishedAt: null };
  }
  return {
    directory: row.directory,
    repository: row.repository,
    branch: row.branch,
    commit: row.commit_sha,
    status: row.status === "ok" ? "ok" : "failed",
    message: row.message,
    entryCount: row.entry_count,
    addedCount: row.added_count,
    updatedCount: row.updated_count,
    removedCount: row.removed_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function listKnowledgeEntries(options: { kind?: string; query?: string } = {}) {
  const clauses = ["visible=1"];
  const params: Array<string> = [];
  if (options.kind) { clauses.push("kind=?"); params.push(options.kind); }
  if (options.query) { clauses.push("(title LIKE ? OR summary LIKE ? OR body LIKE ?)"); const like = `%${options.query}%`; params.push(like, like, like); }
  const rows = getDb().prepare(`SELECT * FROM knowledge_entries WHERE ${clauses.join(" AND ")} ORDER BY CASE kind WHEN 'project' THEN 0 WHEN 'tool' THEN 1 ELSE 2 END, title`).all(...params) as EntryRow[];
  return rows.map(toEntry);
}

export function getKnowledgeEntry(id: string): KnowledgeEntryRecord | null {
  const row = getDb().prepare("SELECT * FROM knowledge_entries WHERE id=?").get(id) as EntryRow | undefined;
  return row ? toEntry(row) : null;
}

export function getReadingNote(entryId: string): ReadingNoteRecord | null {
  const row = getDb().prepare("SELECT * FROM knowledge_reading_notes WHERE entry_id=?").get(entryId) as NoteRow | undefined;
  return row ? toNote(row) : null;
}

export function listReadingNotes(entryIds: string[]) {
  const notes = new Map<string, ReadingNoteRecord>();
  if (entryIds.length === 0) return notes;
  const placeholders = entryIds.map(() => "?").join(",");
  const rows = getDb().prepare(`SELECT * FROM knowledge_reading_notes WHERE entry_id IN (${placeholders})`).all(...entryIds) as NoteRow[];
  for (const row of rows) notes.set(row.entry_id, toNote(row));
  return notes;
}

export function saveReadingNote(record: ReadingNoteRecord) {
  getDb().prepare(`INSERT INTO knowledge_reading_notes(entry_id, prompt_version, source_hash, model, status, content_json, error, generated_at, attempted_at)
    VALUES (@entry_id, @prompt_version, @source_hash, @model, @status, @content, @error, @generated_at, @attempted_at)
    ON CONFLICT(entry_id) DO UPDATE SET prompt_version=@prompt_version, source_hash=@source_hash, model=@model, status=@status, content_json=@content, error=@error, generated_at=@generated_at, attempted_at=@attempted_at`)
    .run({
      entry_id: record.entryId,
      prompt_version: record.promptVersion,
      source_hash: record.sourceHash,
      model: record.model,
      status: record.status,
      content: record.content ? JSON.stringify(record.content) : null,
      error: record.error,
      generated_at: record.generatedAt,
      attempted_at: record.attemptedAt,
    });
}

export function listEntriesNeedingNote(promptVersion: string, limit: number) {
  const rows = getDb().prepare(`SELECT e.* FROM knowledge_entries e
    LEFT JOIN knowledge_reading_notes n ON n.entry_id = e.id
    WHERE e.visible=1 AND (n.entry_id IS NULL OR n.source_hash <> e.content_hash OR n.prompt_version <> ? OR n.content_json IS NULL)
    ORDER BY CASE e.kind WHEN 'project' THEN 0 WHEN 'tool' THEN 1 ELSE 2 END, e.title
    LIMIT ?`).all(promptVersion, limit) as EntryRow[];
  return rows.map(toEntry);
}

export function countEntriesNeedingNote(promptVersion: string) {
  const row = getDb().prepare(`SELECT COUNT(*) AS count FROM knowledge_entries e
    LEFT JOIN knowledge_reading_notes n ON n.entry_id = e.id
    WHERE e.visible=1 AND (n.entry_id IS NULL OR n.source_hash <> e.content_hash OR n.prompt_version <> ? OR n.content_json IS NULL)`)
    .get(promptVersion) as { count: number };
  return row.count;
}
