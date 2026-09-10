import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { splitFrontMatter, type YamlValue } from "./yaml";

export const KNOWLEDGE_KINDS = ["project", "tool", "note"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export type KnowledgeSourceRef = { repo?: string; path?: string; url?: string; note?: string };

export type KnowledgeEntry = {
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
  extra: Record<string, YamlValue>;
  body: string;
  relPath: string;
  contentHash: string;
};

export type KnowledgeSnapshot = {
  directory: string;
  branch: string | null;
  commit: string | null;
  entries: KnowledgeEntry[];
  problems: Array<{ path: string; message: string }>;
};

export class KnowledgeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "KnowledgeError";
  }
}

const KIND_DIRECTORY: Record<KnowledgeKind, string> = { project: "projects", tool: "tools", note: "notes" };
const RESERVED_FIELDS = new Set(["id", "kind", "title", "summary", "status", "tags", "related", "link", "updated", "sources"]);

export function getKnowledgeDirectory() {
  return process.env.MYOPC_KNOWLEDGE_DIR?.trim() || join(homedir(), "MYOPC-Knowledge");
}

export function getKnowledgeRepository() {
  return process.env.MYOPC_KNOWLEDGE_REPO?.trim() || "kioooice/MYOPC-Knowledge";
}

function asText(value: YamlValue | undefined) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function asTextList(value: YamlValue | undefined) {
  if (Array.isArray(value)) return value.map((item) => asText(item)).filter(Boolean);
  const single = asText(value);
  return single ? [single] : [];
}

function asSources(value: YamlValue | undefined): KnowledgeSourceRef[] {
  if (!Array.isArray(value)) {
    const single = asText(value);
    return single ? [{ repo: single }] : [];
  }
  const refs: KnowledgeSourceRef[] = [];
  for (const item of value) {
    if (typeof item === "string") { const text = item.trim(); if (text) refs.push({ repo: text }); continue; }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, YamlValue>;
      const ref: KnowledgeSourceRef = {};
      const repo = asText(record.repo);
      const path = asText(record.path);
      const url = asText(record.url);
      const note = asText(record.note);
      if (repo) ref.repo = repo;
      if (path) ref.path = path;
      if (url) ref.url = url;
      if (note) ref.note = note;
      if (Object.keys(ref).length > 0) refs.push(ref);
    }
  }
  return refs;
}

function listMarkdownFiles(directory: string): string[] {
  const files: string[] = [];
  for (const item of readdirSync(/*turbopackIgnore: true*/ directory, { withFileTypes: true })) {
    const full = join(/*turbopackIgnore: true*/ directory, item.name);
    if (item.isDirectory()) { files.push(...listMarkdownFiles(/*turbopackIgnore: true*/ full)); continue; }
    if (!item.isFile() || !item.name.toLowerCase().endsWith(".md")) continue;
    if (item.name.toLowerCase() === "readme.md" || item.name.startsWith("_")) continue;
    files.push(full);
  }
  return files.sort();
}

function readGitValue(directory: string, args: string[]) {
  try {
    return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

export function knowledgeSourceUrl(ref: KnowledgeSourceRef, repository = getKnowledgeRepository(), branch = "main") {
  if (ref.url) return ref.url;
  if (ref.repo && ref.path) return `https://github.com/${ref.repo}/blob/${branch}/${ref.path}`;
  if (ref.repo) return `https://github.com/${ref.repo}`;
  return null;
}

function readCommitFile() {
  const file = process.env.MYOPC_KNOWLEDGE_COMMIT_FILE?.trim();
  if (!file) return null;
  try {
    const [commit, branch] = readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!commit) return null;
    return { commit, branch: branch || null };
  } catch {
    return null;
  }
}

export function readKnowledgeSnapshot(directory = getKnowledgeDirectory()): KnowledgeSnapshot {
  if (!existsSync(/*turbopackIgnore: true*/ directory) || !statSync(/*turbopackIgnore: true*/ directory).isDirectory()) {
    throw new KnowledgeError("knowledge_directory_missing", `知识目录不存在：${directory}`);
  }
  const entries: KnowledgeEntry[] = [];
  const problems: Array<{ path: string; message: string }> = [];
  const seen = new Map<string, string>();

  for (const kind of KNOWLEDGE_KINDS) {
    const kindDirectory = join(/*turbopackIgnore: true*/ directory, KIND_DIRECTORY[kind]);
    if (!existsSync(/*turbopackIgnore: true*/ kindDirectory)) continue;
    for (const file of listMarkdownFiles(kindDirectory)) {
      const relPath = relative(directory, file).split(sep).join("/");
      let content: string;
      try { content = readFileSync(/*turbopackIgnore: true*/ file, "utf8"); }
      catch (error) { problems.push({ path: relPath, message: error instanceof Error ? error.message : "读取失败" }); continue; }
      let parsed: { data: Record<string, YamlValue>; body: string };
      try { parsed = splitFrontMatter(content); }
      catch (error) { problems.push({ path: relPath, message: error instanceof Error ? error.message : "解析失败" }); continue; }

      const id = asText(parsed.data.id);
      if (!id) { problems.push({ path: relPath, message: "缺少 id" }); continue; }
      const declaredKind = asText(parsed.data.kind);
      if (declaredKind && declaredKind !== kind) { problems.push({ path: relPath, message: `kind 与目录不一致：${declaredKind} ≠ ${kind}` }); continue; }
      const previous = seen.get(id);
      if (previous) { problems.push({ path: relPath, message: `id 与 ${previous} 重复：${id}` }); continue; }
      seen.set(id, relPath);

      const title = asText(parsed.data.title) || id;
      const body = parsed.body.trim();
      const summary = asText(parsed.data.summary);
      const status = asText(parsed.data.status);
      const tags = asTextList(parsed.data.tags);
      const related = asTextList(parsed.data.related);
      const link = asText(parsed.data.link) || null;
      const updatedAt = asText(parsed.data.updated) || null;
      const sources = asSources(parsed.data.sources);
      const extra: Record<string, YamlValue> = {};
      for (const [key, value] of Object.entries(parsed.data)) if (!RESERVED_FIELDS.has(key)) extra[key] = value;

      const contentHash = createHash("sha256")
        .update(JSON.stringify({ id, kind, title, summary, status, tags, related, link, updatedAt, sources, body }))
        .digest("hex");

      entries.push({ id, kind, title, summary, status, tags, related, link, updatedAt, sources, extra, body, relPath, contentHash });
    }
  }

  // 容器里通常没有 git；此时用同步脚本写下的版本文件补上来源版本。
  const gitCommit = readGitValue(directory, ["rev-parse", "HEAD"]);
  const gitBranch = readGitValue(directory, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const recorded = gitCommit ? null : readCommitFile();
  return {
    directory,
    branch: gitBranch || recorded?.branch || null,
    commit: gitCommit || recorded?.commit || null,
    entries,
    problems,
  };
}
