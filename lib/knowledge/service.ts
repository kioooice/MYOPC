import { getKnowledgeDirectory, getKnowledgeRepository, knowledgeSourceUrl, readKnowledgeSnapshot, type KnowledgeSourceRef } from "./repo";
import { pullKnowledgeRepository } from "./git";
import { describeModelConfig, getModelConfig } from "./model";
import { PROMPT_VERSION, generateReadingNote, processPendingReadingNotes } from "./reading-note";
import {
  applyKnowledgeSnapshot,
  countEntriesNeedingNote,
  getKnowledgeEntry,
  getKnowledgeSyncState,
  getReadingNote,
  listKnowledgeEntries,
  listReadingNotes,
  saveKnowledgeSyncState,
  type KnowledgeEntryRecord,
  type ReadingNoteContent,
} from "./store";

export type KnowledgeNoteSummary = {
  status: "ready" | "failed" | "missing";
  model: string | null;
  generatedAt: string | null;
  error: string | null;
  summary: string | null;
  brief: string | null;
};

export type KnowledgeListItem = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  status: string;
  tags: string[];
  updatedAt: string | null;
  link: string | null;
  relPath: string;
  sourceUrls: string[];
  note: KnowledgeNoteSummary;
};

export type KnowledgeDetail = KnowledgeListItem & {
  body: string;
  sources: Array<{ label: string; url: string | null }>;
  related: Array<{ id: string; title: string; kind: string; status: string }>;
  noteContent: ReadingNoteContent | null;
  promptVersion: string;
};

function sourceLabel(source: KnowledgeSourceRef) {
  return [source.repo, source.path].filter(Boolean).join(" / ") || source.url || "未标注来源";
}

function noteSummary(entryId: string, contentHash: string): KnowledgeNoteSummary {
  const note = getReadingNote(entryId);
  if (!note) return { status: "missing", model: null, generatedAt: null, error: null, summary: null, brief: null };
  const stale = note.sourceHash !== contentHash || note.promptVersion !== PROMPT_VERSION;
  const status = note.status === "ready" && !stale ? "ready" : note.content ? "ready" : "failed";
  return {
    status,
    model: note.model,
    generatedAt: note.generatedAt,
    error: note.error,
    summary: note.content?.summary ?? null,
    brief: note.content?.brief ?? null,
  };
}

export function syncKnowledge() {
  const directory = getKnowledgeDirectory();
  const repository = getKnowledgeRepository();
  const startedAt = new Date().toISOString();
  // 先尝试把检出更新到远端最新；拉不动（没有 git、工作区有改动、网络失败）时仍然重建索引。
  const pull = pullKnowledgeRepository(directory);
  try {
    const snapshot = readKnowledgeSnapshot(directory);
    const summary = applyKnowledgeSnapshot(snapshot);
    saveKnowledgeSyncState({
      directory,
      repository,
      branch: snapshot.branch,
      commit: snapshot.commit,
      status: "ok",
      message: snapshot.problems.length > 0 ? `${snapshot.problems.length} 个文件未索引` : null,
      entryCount: summary.total,
      addedCount: summary.added,
      updatedCount: summary.updated,
      removedCount: summary.removed,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    return { summary, problems: snapshot.problems, state: getKnowledgeSyncState(), pull };
  } catch (error) {
    const message = error instanceof Error ? error.message : "知识同步失败";
    saveKnowledgeSyncState({
      directory,
      repository,
      branch: null,
      commit: null,
      status: "failed",
      message,
      entryCount: getKnowledgeSyncState().entryCount,
      addedCount: 0,
      updatedCount: 0,
      removedCount: 0,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    throw error;
  }
}

export function getKnowledgeList(options: { kind?: string; query?: string } = {}): KnowledgeListItem[] {
  const repository = getKnowledgeRepository();
  const branch = getKnowledgeSyncState().branch || "main";
  const entries = listKnowledgeEntries(options);
  const notes = listReadingNotes(entries.map((entry) => entry.id));
  return entries.map((entry) => {
    const note = notes.get(entry.id);
    const stale = note ? note.sourceHash !== entry.contentHash || note.promptVersion !== PROMPT_VERSION : false;
    return {
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      summary: entry.summary,
      status: entry.status,
      tags: entry.tags,
      updatedAt: entry.updatedAt,
      link: entry.link,
      relPath: entry.relPath,
      sourceUrls: entry.sources.map((source) => knowledgeSourceUrl(source, repository, branch)).filter((url): url is string => Boolean(url)),
      note: note
        ? {
            status: note.status === "ready" && !stale ? "ready" : note.content ? "ready" : "failed",
            model: note.model,
            generatedAt: note.generatedAt,
            error: note.error,
            summary: note.content?.summary ?? null,
            brief: note.content?.brief ?? null,
          }
        : { status: "missing", model: null, generatedAt: null, error: null, summary: null, brief: null },
    };
  });
}

export function getKnowledgeOverview(options: { kind?: string; query?: string } = {}) {
  const sync = getKnowledgeSyncState();
  return {
    sync,
    model: describeModelConfig(getModelConfig()),
    promptVersion: PROMPT_VERSION,
    repository: getKnowledgeRepository(),
    directory: getKnowledgeDirectory(),
    pendingNotes: countEntriesNeedingNote(PROMPT_VERSION),
    entries: getKnowledgeList(options),
  };
}

export function getKnowledgeDetail(id: string, options: { kind?: string; query?: string } = {}): KnowledgeDetail | null {
  const entry = getKnowledgeEntry(id);
  if (!entry || !entry.visible) return null;
  const listItem = getKnowledgeList({ ...options, kind: undefined, query: undefined }).find((item) => item.id === id);
  if (!listItem) return null;
  const note = getReadingNote(id);
  const stale = note ? note.sourceHash !== entry.contentHash || note.promptVersion !== PROMPT_VERSION : false;
  const repository = getKnowledgeRepository();
  const branch = getKnowledgeSyncState().branch || "main";
  return {
    ...listItem,
    body: entry.body,
    sources: entry.sources.map((source) => ({ label: sourceLabel(source), url: knowledgeSourceUrl(source, repository, branch) })),
    related: entry.related
      .map((relatedId) => getKnowledgeEntry(relatedId))
      .filter((item): item is KnowledgeEntryRecord => item !== null && item.visible)
      .map((item) => ({ id: item.id, title: item.title, kind: item.kind, status: item.status })),
    noteContent: note && !stale ? note.content : null,
    promptVersion: PROMPT_VERSION,
  };
}

export async function generateKnowledgeNote(entryId: string, options: { force?: boolean } = {}) {
  const result = await generateReadingNote(entryId, options);
  return { ...result, pendingNotes: countEntriesNeedingNote(PROMPT_VERSION) };
}

export async function processKnowledgeNotes(limit = 3) {
  return processPendingReadingNotes(limit);
}
