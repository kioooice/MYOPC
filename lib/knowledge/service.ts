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

// 列表卡的内容由模型生成，偶尔会写超；这里按句号收边，保证页面上不会出现半句话。
const CARD_LIMIT = 110;
function shortenCard(value: string | null | undefined) {
  const content = (value || "").trim();
  if (!content || content.length <= CARD_LIMIT) return content || null;
  const sentences = content.split(/(?<=[。！？；])/).map((part) => part.trim()).filter(Boolean);
  let result = "";
  for (const sentence of sentences) {
    if (result && (result + sentence).length > CARD_LIMIT) break;
    result += sentence;
  }
  if (!result) result = content.slice(0, CARD_LIMIT - 1) + "。";
  return result;
}

export type KnowledgeNoteSummary = {
  status: "ready" | "stale" | "failed" | "missing";
  /** 原文或规程已变化，当前内容来自上一次加工。 */
  stale: boolean;
  model: string | null;
  generatedAt: string | null;
  error: string | null;
  summary: string | null;
  brief: string | null;
  card: string | null;
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
  /** notes 的分类（工作方式 / 产品设计 / 工程运维 / 流程记录 / 决策）。 */
  category: string | null;
  /** maps 的类型（architecture / workflow / decision / relationship）。 */
  mapType: string | null;
  note: KnowledgeNoteSummary;
};

export type KnowledgeDetail = KnowledgeListItem & {
  body: string;
  sources: Array<{ label: string; url: string | null }>;
  related: Array<{ id: string; title: string; kind: string; status: string }>;
  noteContent: ReadingNoteContent | null;
  /** 说明是否来自旧版本原文或旧规程。 */
  stale: boolean;
  promptVersion: string;
};

function sourceLabel(source: KnowledgeSourceRef) {
  return [source.repo, source.path].filter(Boolean).join(" / ") || source.url || "未标注来源";
}

function noteSummary(entryId: string, contentHash: string): KnowledgeNoteSummary {
  const note = getReadingNote(entryId);
  if (!note) return { status: "missing", stale: false, model: null, generatedAt: null, error: null, summary: null, brief: null, card: null };
  const stale = note.sourceHash !== contentHash || note.promptVersion !== PROMPT_VERSION;
  const status: KnowledgeNoteSummary["status"] = note.status === "failed" ? "failed" : stale ? "stale" : "ready";
  return {
    status,
    stale,
    model: note.model,
    generatedAt: note.generatedAt,
    error: note.error,
    summary: note.content?.summary ?? null,
    brief: shortenCard(note.content?.brief ?? null),
    card: shortenCard(note.content?.card),
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
  return entries.map((entry) => {
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
      category: typeof entry.extra?.category === "string" && entry.extra.category.trim() ? entry.extra.category.trim() : null,
      mapType: entry.kind === "map" && typeof entry.extra?.map_type === "string" && entry.extra.map_type.trim() ? entry.extra.map_type.trim() : null,
      note: noteSummary(entry.id, entry.contentHash),

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

// 一个方向写了 related 就当作双向关系：map 的作用是把已有条目串起来，
// 不让用户在每条相关知识里各写一遍。第一版仍然只使用 front matter 的 related 字段。
function relatedEntries(entry: KnowledgeEntryRecord): KnowledgeEntryRecord[] {
  const all = listKnowledgeEntries({});
  const byId = new Map(all.map((item) => [item.id, item]));
  const ids: string[] = [];
  const push = (id: string) => {
    if (id === entry.id || !byId.has(id) || ids.includes(id)) return;
    ids.push(id);
  };
  for (const id of entry.related) push(id);
  for (const item of all) if (item.related.includes(entry.id)) push(item.id);
  return ids.map((id) => byId.get(id) as KnowledgeEntryRecord);
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
    related: relatedEntries(entry).map((item) => ({ id: item.id, title: item.title, kind: item.kind, status: item.status })),
    noteContent: note?.content ?? null,
    stale,
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
