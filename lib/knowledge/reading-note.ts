import { KnowledgeError } from "./repo";
import { countEntriesNeedingNote, getKnowledgeEntry, getReadingNote, listEntriesNeedingNote, saveReadingNote, type KnowledgeEntryRecord, type ReadingNoteContent, type ReadingNoteRecord } from "./store";
import { callChatModel, getModelConfig } from "./model";

export const PROMPT_VERSION = "reading-note-v2";
const MAX_BODY_CHARS = 12000;

const SYSTEM_PROMPT = [
  "你在整理个人知识仓库的条目，供页面直接阅读。",
  "只依据给定的条目原文和来源信息，不补充材料以外的历史、结论或数据。",
  "区分原文事实与你的推断：原文写明的放 facts，你自己推出的放 inferences。",
  "没有内容的栏目返回空数组，不要为了凑满而编造。",
  "brief 要短：不超过 24 个汉字，能独立看懂，不要用省略号或断句。",
  "只输出 JSON，不要输出解释、Markdown 代码块或多余文字。",
].join("\n");

function schemaHint() {
  return [
    "输出 JSON 结构：",
    "{",
    '  "summary": "一段话说明这个条目在讲什么（详细页用）",',
    '  "brief": "首页用的一句话简介，不超过 24 个字，必须是完整句子，不要省略号",',
    '  "facts": ["原文明确写出的事实"],',
    '  "decisions": [{"title": "关键选择", "detail": "选择内容与依据"}],',
    '  "steps": ["操作步骤"],',
    '  "conditions": ["适用条件或前置条件"],',
    '  "open_questions": ["仍未确定的内容"],',
    '  "inferences": ["属于推断、原文未直接写明的理解"]',
    "}",
  ].join("\n");
}

function buildUserPrompt(entry: KnowledgeEntryRecord, related: Array<{ title: string; kind: string }>) {
  const sourceLines = entry.sources.map((source) => {
    const parts = [source.repo, source.path].filter(Boolean).join(" / ");
    return `- ${parts || source.url || "未标注来源"}${source.note ? `（${source.note}）` : ""}`;
  });
  const body = entry.body.length > MAX_BODY_CHARS ? `${entry.body.slice(0, MAX_BODY_CHARS)}\n（正文过长，已截断）` : entry.body;
  return [
    `条目标题：${entry.title}`,
    `条目类型：${entry.kind}`,
    entry.status ? `条目状态：${entry.status}` : "",
    entry.summary ? `条目摘要：${entry.summary}` : "",
    entry.updatedAt ? `条目更新时间：${entry.updatedAt}` : "",
    entry.tags.length > 0 ? `标签：${entry.tags.join("、")}` : "",
    sourceLines.length > 0 ? `来源：\n${sourceLines.join("\n")}` : "来源：未标注",
    related.length > 0 ? `相关知识条目：${related.map((item) => `${item.title}（${item.kind}）`).join("、")}` : "",
    "",
    "条目原文：",
    body,
    "",
    schemaHint(),
  ].filter((line) => line !== "").join("\n");
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function textList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.map(text).filter(Boolean);
}

export function parseReadingNoteContent(raw: string): ReadingNoteContent {
  const cleaned = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new KnowledgeError("model_response_invalid", "模型返回中没有 JSON 对象");
  let payload: unknown;
  try { payload = JSON.parse(cleaned.slice(start, end + 1)); }
  catch { throw new KnowledgeError("model_response_invalid", "模型返回的 JSON 无法解析"); }
  if (!payload || typeof payload !== "object") throw new KnowledgeError("model_response_invalid", "模型返回结构不是对象");
  const record = payload as Record<string, unknown>;
  const summary = text(record.summary);
  if (!summary) throw new KnowledgeError("model_response_invalid", "模型返回缺少 summary");
  const decisions = Array.isArray(record.decisions)
    ? record.decisions
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const entry = item as Record<string, unknown>;
          const title = text(entry.title);
          const detail = text(entry.detail);
          return title ? { title, detail } : null;
        })
        .filter((item): item is { title: string; detail: string } => item !== null)
    : [];
  return {
    summary,
    brief: text(record.brief) || summary,
    facts: textList(record.facts),
    decisions,
    steps: textList(record.steps),
    conditions: textList(record.conditions),
    open_questions: textList(record.open_questions),
    inferences: textList(record.inferences),
  };
}

export type NoteGenerationResult = {
  entryId: string;
  status: "ready" | "failed" | "skipped";
  model?: string;
  note?: ReadingNoteRecord;
  reason?: string;
};

async function generate(entry: KnowledgeEntryRecord, previous: ReadingNoteRecord | null): Promise<NoteGenerationResult> {
  const config = getModelConfig();
  const attemptedAt = new Date().toISOString();
  if (!config) {
    const note: ReadingNoteRecord = {
      entryId: entry.id, promptVersion: PROMPT_VERSION, sourceHash: entry.contentHash, model: "未配置",
      status: "failed", content: previous?.content ?? null, error: "未设置 MYOPC_MODEL_API_KEY，模型加工未运行",
      generatedAt: previous?.generatedAt ?? null, attemptedAt,
    };
    saveReadingNote(note);
    return { entryId: entry.id, status: "failed", note, reason: note.error ?? undefined };
  }
  const related = entry.related.map((id) => getKnowledgeEntry(id)).filter((item): item is KnowledgeEntryRecord => item !== null);
  try {
    let content = "";
    let model = config.model;
    let parsed: ReadingNoteContent | null = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      const messages = attempt === 0
        ? [{ role: "system" as const, content: SYSTEM_PROMPT }, { role: "user" as const, content: buildUserPrompt(entry, related) }]
        : [
            { role: "system" as const, content: SYSTEM_PROMPT },
            { role: "system" as const, content: "上一次回复被截断或不是有效 JSON。只输出一个 JSON 对象，不要解释、不要代码块。" },
            { role: "user" as const, content: buildUserPrompt(entry, related) },
          ];
      const budget = attempt === 0 ? config.maxTokens : Math.min(config.maxTokens * 2, 16000);
      const response = await callChatModel(config, messages, budget);
      content = response.content;
      model = response.model;
      try { parsed = parseReadingNoteContent(content); }
      catch (error) {
        const retryable = error instanceof KnowledgeError && (error.code === "model_response_invalid" || error.code === "model_response_truncated") && attempt === 0;
        if (retryable) continue;
        throw error;
      }
    }
    if (!parsed) throw new KnowledgeError("model_response_invalid", "模型两次都没有返回可解析的 JSON");
    const note: ReadingNoteRecord = {
      entryId: entry.id, promptVersion: PROMPT_VERSION, sourceHash: entry.contentHash, model,
      status: "ready", content: parsed, error: null, generatedAt: attemptedAt, attemptedAt,
    };
    saveReadingNote(note);
    return { entryId: entry.id, status: "ready", model, note };
  } catch (error) {
    const message = error instanceof Error ? error.message : "模型加工失败";
    const note: ReadingNoteRecord = {
      entryId: entry.id, promptVersion: PROMPT_VERSION, sourceHash: entry.contentHash, model: config.model,
      status: "failed", content: previous?.content ?? null, error: message,
      generatedAt: previous?.generatedAt ?? null, attemptedAt,
    };
    saveReadingNote(note);
    return { entryId: entry.id, status: "failed", model: config.model, note, reason: message };
  }
}

export async function generateReadingNote(entryId: string, options: { force?: boolean } = {}): Promise<NoteGenerationResult> {
  const entry = getKnowledgeEntry(entryId);
  if (!entry || !entry.visible) throw new KnowledgeError("knowledge_entry_not_found", `知识条目不存在：${entryId}`);
  const previous = getReadingNote(entryId);
  const reusable = previous && previous.status === "ready" && previous.sourceHash === entry.contentHash && previous.promptVersion === PROMPT_VERSION;
  if (reusable && !options.force) return { entryId, status: "skipped", model: previous.model, note: previous, reason: "来源与规程未变化，复用已有结果" };
  return generate(entry, previous);
}

export async function processPendingReadingNotes(limit = 3) {
  const pending = listEntriesNeedingNote(PROMPT_VERSION, Math.max(1, Math.min(limit, 10)));
  const results: NoteGenerationResult[] = [];
  for (const entry of pending) {
    const previous = getReadingNote(entry.id);
    results.push(await generate(entry, previous));
  }
  return { processed: results.length, remaining: countEntriesNeedingNote(PROMPT_VERSION), results };
}

export function needsReadingNote(entryId: string, contentHash: string) {
  const note = getReadingNote(entryId);
  if (!note) return true;
  return note.sourceHash !== contentHash || note.promptVersion !== PROMPT_VERSION || note.status !== "ready";
}
