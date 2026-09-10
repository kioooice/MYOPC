import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests } from "../lib/db";
import { readKnowledgeSnapshot, KnowledgeError } from "../lib/knowledge/repo";
import { parseReadingNoteContent } from "../lib/knowledge/reading-note";
import { generateKnowledgeNote, getKnowledgeDetail, getKnowledgeOverview, syncKnowledge } from "../lib/knowledge/service";
import { splitFrontMatter } from "../lib/knowledge/yaml";

let dataDirectory: string;
let knowledgeDirectory: string;

function entryFile(relativePath: string, content: string) {
  const full = join(knowledgeDirectory, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

const sampleEntry = (id: string, kind: "project" | "tool" | "note", title: string, body = "正文内容。") => `---
id: ${id}
kind: ${kind}
title: ${title}
status: 进行中
summary: ${title} 的一句话说明
updated: 2026-09-10
tags: [标签一, 标签二]
sources:
  - repo: kioooice/MYOPC
    path: docs/STATUS.md
---

${body}
`;

beforeEach(() => {
  dataDirectory = mkdtempSync(join(tmpdir(), "myopc-knowledge-data-"));
  knowledgeDirectory = mkdtempSync(join(tmpdir(), "myopc-knowledge-repo-"));
  process.env.MYOPC_DATA_DIR = dataDirectory;
  process.env.MYOPC_KNOWLEDGE_DIR = knowledgeDirectory;
  delete process.env.MYOPC_MODEL_API_KEY;
});

afterEach(() => {
  closeDbForTests();
  vi.unstubAllGlobals();
  rmSync(dataDirectory, { recursive: true, force: true });
  rmSync(knowledgeDirectory, { recursive: true, force: true });
  delete process.env.MYOPC_DATA_DIR;
  delete process.env.MYOPC_KNOWLEDGE_DIR;
  delete process.env.MYOPC_MODEL_API_KEY;
  delete process.env.MYOPC_MODEL;
});

describe("知识条目解析", () => {
  it("解析 front matter 与来源引用", () => {
    const { data, body } = splitFrontMatter(sampleEntry("myopc", "project", "MYOPC"));
    expect(data.id).toBe("myopc");
    expect(data.tags).toEqual(["标签一", "标签二"]);
    expect(data.sources).toEqual([{ repo: "kioooice/MYOPC", path: "docs/STATUS.md" }]);
    expect(body).toBe("正文内容。");
  });

  it("忽略 README 并按目录识别类型", () => {
    entryFile("projects/myopc.md", sampleEntry("myopc", "project", "MYOPC"));
    entryFile("tools/codex.md", sampleEntry("codex", "tool", "Codex"));
    entryFile("projects/README.md", "# 说明");
    const snapshot = readKnowledgeSnapshot(knowledgeDirectory);
    expect(snapshot.entries.map((entry) => entry.id).sort()).toEqual(["codex", "myopc"]);
    expect(snapshot.entries.find((entry) => entry.id === "codex")?.kind).toBe("tool");
    expect(snapshot.problems).toHaveLength(0);
  });

  it("重复 id 和类型不符的文件只报告问题，不写入索引", () => {
    entryFile("projects/one.md", sampleEntry("same", "project", "One"));
    entryFile("notes/two.md", sampleEntry("same", "note", "Two"));
    entryFile("tools/wrong.md", sampleEntry("wrong", "project", "Wrong"));
    const snapshot = readKnowledgeSnapshot(knowledgeDirectory);
    expect(snapshot.entries.map((entry) => entry.id)).toEqual(["same"]);
    expect(snapshot.problems).toHaveLength(2);
  });

  it("知识目录不存在时给出可读错误", () => {
    expect(() => readKnowledgeSnapshot(join(knowledgeDirectory, "missing"))).toThrowError(KnowledgeError);
  });
});

describe("知识索引同步", () => {
  it("同一份内容重复同步不产生重复条目", () => {
    entryFile("projects/myopc.md", sampleEntry("myopc", "project", "MYOPC"));
    const first = syncKnowledge();
    expect(first.summary.added).toBe(1);
    expect(first.state.entryCount).toBe(1);
    const second = syncKnowledge();
    expect(second.summary.added).toBe(0);
    expect(second.summary.updated).toBe(0);
    expect(second.summary.unchanged).toBe(1);
    expect(getKnowledgeOverview().entries).toHaveLength(1);
  });

  it("内容修改后标记需要重新加工，删除后不再出现在列表", () => {
    const file = entryFile("projects/myopc.md", sampleEntry("myopc", "project", "MYOPC"));
    syncKnowledge();
    expect(getKnowledgeOverview().pendingNotes).toBe(1);

    writeFileSync(file, sampleEntry("myopc", "project", "MYOPC", "正文改过了。"), "utf8");
    const updated = syncKnowledge();
    expect(updated.summary.updated).toBe(1);
    expect(getKnowledgeDetail("myopc")?.body).toContain("正文改过了");

    rmSync(file);
    const removed = syncKnowledge();
    expect(removed.summary.removed).toBe(1);
    expect(getKnowledgeOverview().entries).toHaveLength(0);
  });

  it("列表带出来源链接和原文路径", () => {
    entryFile("tools/codex.md", sampleEntry("codex", "tool", "Codex"));
    syncKnowledge();
    const item = getKnowledgeOverview({ kind: "tool" }).entries[0];
    expect(item.relPath).toBe("tools/codex.md");
    expect(item.sourceUrls[0]).toBe("https://github.com/kioooice/MYOPC/blob/main/docs/STATUS.md");
    expect(item.note.status).toBe("missing");
  });
});

describe("阅读说明加工", () => {
  it("未配置模型时保留条目并记录失败原因", async () => {
    entryFile("projects/myopc.md", sampleEntry("myopc", "project", "MYOPC"));
    syncKnowledge();
    const result = await generateKnowledgeNote("myopc");
    expect(result.status).toBe("failed");
    expect(result.note?.error).toContain("MYOPC_MODEL_API_KEY");
    expect(getKnowledgeDetail("myopc")?.body).toContain("正文内容");
    expect(getKnowledgeOverview().entries[0].note.status).toBe("failed");
  });

  it("相同来源与规程复用结果，不重复调用模型", async () => {
    entryFile("projects/myopc.md", sampleEntry("myopc", "project", "MYOPC"));
    syncKnowledge();
    process.env.MYOPC_MODEL_API_KEY = "test-key";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ summary: "一句话说明", facts: ["事实"], decisions: [{ title: "选择", detail: "依据" }], steps: ["步骤"], conditions: [], open_questions: [], inferences: ["推断"] }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await generateKnowledgeNote("myopc");
    expect(first.status).toBe("ready");
    expect(first.note?.content?.facts).toEqual(["事实"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await generateKnowledgeNote("myopc");
    expect(second.status).toBe("skipped");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getKnowledgeOverview().pendingNotes).toBe(0);

    const forced = await generateKnowledgeNote("myopc", { force: true });
    expect(forced.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("模型失败时保留上一次可用结果", async () => {
    entryFile("projects/myopc.md", sampleEntry("myopc", "project", "MYOPC"));
    syncKnowledge();
    process.env.MYOPC_MODEL_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "上一次结果", facts: [], decisions: [], steps: [], conditions: [], open_questions: [], inferences: [] }) } }] }), { status: 200 })));
    await generateKnowledgeNote("myopc");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream error", { status: 500 })));
    const failed = await generateKnowledgeNote("myopc", { force: true });
    expect(failed.status).toBe("failed");
    expect(getKnowledgeDetail("myopc")?.noteContent?.summary).toBe("上一次结果");
    expect(getKnowledgeOverview().entries[0].note.error).toContain("500");
  });

  it("解析模型输出时剥离代码块并拒绝缺少 summary 的结果", () => {
    const parsed = parseReadingNoteContent("```json\n{\"summary\":\"说明\",\"facts\":[\"a\"],\"decisions\":[],\"steps\":[],\"conditions\":[],\"open_questions\":[],\"inferences\":[]}\n```");
    expect(parsed.summary).toBe("说明");
    expect(() => parseReadingNoteContent("{\"facts\":[]}")).toThrowError(KnowledgeError);
  });
});
