import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests } from "../lib/db";
import { readKnowledgeSnapshot, KnowledgeError } from "../lib/knowledge/repo";
import { PROMPT_VERSION, parseReadingNoteContent } from "../lib/knowledge/reading-note";
import { generateKnowledgeNote, getKnowledgeDetail, getKnowledgeOverview, syncKnowledge } from "../lib/knowledge/service";
import { getKnowledgeEntry, saveReadingNoteSuccess } from "../lib/knowledge/store";
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

const mapBody = `## 结构图

\`\`\`mermaid
flowchart TD
    A[新网页] --> B[Adapter 适配器]
    B --> C[Loader 加载器]
\`\`\`

## 关键分界

Adapter 与通用层分开。

## 可迁移理解

适配层与通用层的判断可以迁移。
`;

const sampleMap = (id: string, body = mapBody, title = "kill-doc 网页内容提取与重建结构") => `---
id: ${id}
kind: map
map_type: architecture
title: ${title}
status: 当前理解
summary: 用五层理解 kill-doc，并区分网站适配部分与可复用导出管线
updated: 2026-09-15
tags: [浏览器, 网页提取]
related: [kill-doc]
sources:
  - repo: systemmin/kill-doc
    path: script/index.js
---

${body}
`;

const readyNoteContent = {
  summary: "说明",
  brief: "一句话说明",
  card: "核心结构与分界",
  facts: ["图中明确写出的内容"],
  decisions: [],
  steps: [],
  conditions: ["只适用于已获得内容"],
  open_questions: [],
  inferences: ["可以迁移到别的场景"],
};

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

describe("图谱条目解析", () => {
  it("maps 目录按 kind=map 读取，并保留 map_type 与 Mermaid 正文", () => {
    entryFile("maps/kill-doc-content-pipeline.md", sampleMap("kill-doc-content-pipeline"));
    const snapshot = readKnowledgeSnapshot(knowledgeDirectory);
    expect(snapshot.problems).toHaveLength(0);
    expect(snapshot.entries).toHaveLength(1);
    const map = snapshot.entries[0];
    expect(map.kind).toBe("map");
    expect(map.extra.map_type).toBe("architecture");
    expect(map.body).toContain("flowchart TD");
    expect(map.relPath).toBe("maps/kill-doc-content-pipeline.md");
  });

  it("maps 目录声明其它 kind、或 map 放错目录时都会被拒绝", () => {
    entryFile("maps/wrong-kind.md", sampleEntry("wrong-kind", "note", "Wrong"));
    entryFile("notes/wrong-place.md", sampleMap("wrong-place"));
    const snapshot = readKnowledgeSnapshot(knowledgeDirectory);
    expect(snapshot.entries).toHaveLength(0);
    expect(snapshot.problems.map((problem) => problem.path).sort()).toEqual(["maps/wrong-kind.md", "notes/wrong-place.md"]);
  });
});

describe("图谱同步与索引", () => {
  it("Map 的新增、更新、删除都会被识别，内容哈希随正文变化", () => {
    const file = entryFile("maps/kill-doc-content-pipeline.md", sampleMap("kill-doc-content-pipeline"));
    const added = syncKnowledge();
    expect(added.summary.added).toBe(1);
    const firstHash = getKnowledgeEntry("kill-doc-content-pipeline")?.contentHash;
    expect(firstHash).toBeTruthy();

    writeFileSync(file, sampleMap("kill-doc-content-pipeline", mapBody.replace("Adapter 与通用层分开。", "Adapter、Loader 与通用层分开。")), "utf8");
    const updated = syncKnowledge();
    expect(updated.summary.updated).toBe(1);
    const secondHash = getKnowledgeEntry("kill-doc-content-pipeline")?.contentHash;
    expect(secondHash).not.toBe(firstHash);
    expect(getKnowledgeDetail("kill-doc-content-pipeline")?.body).toContain("Adapter、Loader 与通用层分开");

    rmSync(file);
    const removed = syncKnowledge();
    expect(removed.summary.removed).toBe(1);
    expect(getKnowledgeOverview().entries).toHaveLength(0);
  });

  it("overview 与 detail 都能返回 map，project / tool / note 行为不变", () => {
    entryFile("projects/myopc.md", sampleEntry("myopc", "project", "MYOPC"));
    entryFile("tools/kill-doc.md", sampleEntry("kill-doc", "tool", "kill-doc"));
    entryFile("notes/one.md", sampleEntry("one", "note", "一条笔记"));
    entryFile("maps/kill-doc-content-pipeline.md", sampleMap("kill-doc-content-pipeline"));
    syncKnowledge();

    const overview = getKnowledgeOverview({ kind: "map" });
    expect(overview.entries.map((item) => item.id)).toEqual(["kill-doc-content-pipeline"]);
    expect(overview.entries[0].mapType).toBe("architecture");
    expect(overview.entries[0].kind).toBe("map");

    const detail = getKnowledgeDetail("kill-doc-content-pipeline");
    expect(detail?.kind).toBe("map");
    expect(detail?.body).toContain("```mermaid");

    expect(getKnowledgeOverview({ kind: "project" }).entries.map((item) => item.id)).toEqual(["myopc"]);
    expect(getKnowledgeOverview({ kind: "tool" }).entries.map((item) => item.id)).toEqual(["kill-doc"]);
    expect(getKnowledgeOverview({ kind: "note" }).entries.map((item) => item.id)).toEqual(["one"]);
  });
});

describe("图谱阅读说明", () => {
  it("规程版本为 v6，Map 加工时带上图谱类型与不修改 Mermaid 的约束", async () => {
    entryFile("maps/kill-doc-content-pipeline.md", sampleMap("kill-doc-content-pipeline"));
    syncKnowledge();
    expect(PROMPT_VERSION).toBe("reading-note-v6");
    process.env.MYOPC_MODEL_API_KEY = "test-key";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(readyNoteContent) } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateKnowledgeNote("kill-doc-content-pipeline");
    expect(result.status).toBe("ready");
    expect(getKnowledgeDetail("kill-doc-content-pipeline")?.noteContent?.inferences).toEqual(["可以迁移到别的场景"]);

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { messages: Array<{ role: string; content: string }> };
    const prompt = request.messages.map((message) => message.content).join("\n");
    expect(prompt).toContain("图谱类型：architecture");
    expect(prompt).toContain("不得修改 Mermaid 源码");
    expect(prompt).toContain("不得新增原图中不存在的节点");
    expect(prompt).toContain("flowchart TD");
  });

  it("模型结果不会覆盖原文，Mermaid 与正文完整保留", async () => {
    entryFile("maps/demo-map.md", sampleMap("demo-map"));
    syncKnowledge();
    process.env.MYOPC_MODEL_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ ...readyNoteContent, summary: "模型自己重画了一张图：flowchart LR" }) } }],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const result = await generateKnowledgeNote("demo-map");
    expect(result.status).toBe("ready");
    const detail = getKnowledgeDetail("demo-map");
    expect(detail?.body).toContain("A[新网页] --> B[Adapter 适配器]");
    expect(detail?.body).toContain("## 可迁移理解");
    expect(detail?.body).not.toContain("flowchart LR");
    expect(getKnowledgeEntry("demo-map")?.body).toContain("B --> C[Loader 加载器]");
    expect(getKnowledgeEntry("demo-map")?.summary).toBe("用五层理解 kill-doc，并区分网站适配部分与可复用导出管线");
  });

  it("规程版本更新后，已有 Map 说明会重新进入待加工", async () => {
    entryFile("maps/demo-map.md", sampleMap("demo-map"));
    syncKnowledge();
    process.env.MYOPC_MODEL_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(readyNoteContent) } }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    await generateKnowledgeNote("demo-map");
    expect(getKnowledgeOverview().pendingNotes).toBe(0);

    const entry = getKnowledgeEntry("demo-map");
    if (!entry) throw new Error("缺少测试条目");
    saveReadingNoteSuccess({
      entryId: "demo-map", promptVersion: "reading-note-v5", sourceHash: entry.contentHash, model: "test-model",
      status: "ready", content: readyNoteContent, error: null,
      generatedAt: new Date().toISOString(), attemptedAt: new Date().toISOString(), attemptedSourceHash: entry.contentHash,
    });

    expect(getKnowledgeOverview().pendingNotes).toBe(1);
    expect(getKnowledgeOverview().entries[0].note.status).toBe("stale");
  });
});

describe("相关知识双向关联", () => {
  it("Map 写在自己的 related 上，打开工具条目也能看到相关图谱", () => {
    entryFile("tools/kill-doc.md", sampleEntry("kill-doc", "tool", "kill-doc"));
    entryFile("maps/kill-doc-content-pipeline.md", sampleMap("kill-doc-content-pipeline"));
    syncKnowledge();

    const mapDetail = getKnowledgeDetail("kill-doc-content-pipeline");
    expect(mapDetail?.related.map((item) => item.id)).toEqual(["kill-doc"]);
    expect(mapDetail?.related[0].kind).toBe("tool");

    const toolDetail = getKnowledgeDetail("kill-doc");
    expect(toolDetail?.related.map((item) => item.id)).toEqual(["kill-doc-content-pipeline"]);
    expect(toolDetail?.related[0].kind).toBe("map");
    expect(toolDetail?.related[0].title).toBe("kill-doc 网页内容提取与重建结构");
  });
});
