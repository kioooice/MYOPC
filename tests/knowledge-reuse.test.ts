import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests } from "../lib/db";
import { KnowledgeError } from "../lib/knowledge/repo";
import { getReuseOverview, recordTaskResult, selectReusableKnowledge } from "../lib/knowledge/reuse";
import { syncKnowledge } from "../lib/knowledge/service";

let dataDirectory: string;
let knowledgeDirectory: string;

function entryFile(relativePath: string, content: string) {
  const full = join(knowledgeDirectory, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
}

const noteEntry = (id: string, title: string, body: string, category = "方法") => `---
id: ${id}
kind: note
category: ${category}
title: ${title}
status: 当前采用
summary: ${title} 的一句话说明
updated: 2026-09-15
tags: [测试]
---

${body}
`;

const mapEntry = (id: string, title: string, body: string) => `---
id: ${id}
kind: map
map_type: architecture
title: ${title}
status: 当前理解
summary: ${title} 的结构与边界
updated: 2026-09-15
tags: [测试, 图谱]
related: []
---

${body}
`;

const modelResponse = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  dataDirectory = mkdtempSync(join(tmpdir(), "myopc-reuse-data-"));
  knowledgeDirectory = mkdtempSync(join(tmpdir(), "myopc-reuse-repo-"));
  process.env.MYOPC_DATA_DIR = dataDirectory;
  process.env.MYOPC_KNOWLEDGE_DIR = knowledgeDirectory;
  process.env.MYOPC_MODEL_API_KEY = "test-key";
});

afterEach(() => {
  closeDbForTests();
  vi.unstubAllGlobals();
  rmSync(dataDirectory, { recursive: true, force: true });
  rmSync(knowledgeDirectory, { recursive: true, force: true });
  delete process.env.MYOPC_DATA_DIR;
  delete process.env.MYOPC_KNOWLEDGE_DIR;
  delete process.env.MYOPC_MODEL_API_KEY;
});

describe("开发知识复用 · context", () => {
  it("仓库无法识别时直接拒绝，不调用模型", async () => {
    entryFile("notes/a.md", noteEntry("note-a", "先确认输入稳定性", "正文 A"));
    syncKnowledge();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await selectReusableKnowledge({ repository: "", task: "调整视觉判据" });
    expect(result.used).toBe(false);
    expect(result.reason).toBe("repository_unresolved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("模型挑中的知识会带出完整正文与分类", async () => {
    entryFile("notes/a.md", noteEntry("note-a", "先确认输入稳定性", "稳定输入之后再调判据。", "经验"));
    entryFile("notes/b.md", noteEntry("note-b", "无关知识", "完全无关的正文。"));
    syncKnowledge();
    const fetchMock = vi.fn(async () => modelResponse({ selected: [{ id: "note-a", reason: "当前任务需要先排除输入抖动" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await selectReusableKnowledge({ repository: "kioooice/agentVision", task: "改善目标区域识别稳定性" });
    expect(result.used).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("note-a");
    expect(result.items[0].category).toBe("经验");
    expect(result.items[0].content).toContain("稳定输入之后再调判据");
    expect(result.items[0].reason).toContain("输入抖动");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("图谱进入同一候选池，并返回可读正文与截断信号", async () => {
    const body = `## 结构图\n\n图谱入口与通用层的关系。\n\n${"边界说明。".repeat(1000)}`;
    entryFile("maps/pipeline.md", mapEntry("map-pipeline", "内容处理管线", body));
    entryFile("notes/unrelated.md", noteEntry("note-unrelated", "无关笔记", "不应被选择。"));
    syncKnowledge();
    const fetchMock = vi.fn(async () => modelResponse({ selected: [{ id: "map-pipeline", reason: "当前任务需要按处理层定位复用边界", confidence: 96 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await selectReusableKnowledge({ repository: "kioooice/MYOPC", task: "判断网页内容处理应该接入哪一层" });
    expect(result.used).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: "map-pipeline", kind: "map" });
    expect(result.items[0].content).toContain("## 结构图");
    expect(result.items[0].content).toContain("（正文过长，已截断）");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("没有相关知识时返回 no_relevant_knowledge，不阻塞开发", async () => {
    entryFile("notes/a.md", noteEntry("note-a", "无关知识", "完全无关。"));
    syncKnowledge();
    vi.stubGlobal("fetch", vi.fn(async () => modelResponse({ selected: [] })));
    const result = await selectReusableKnowledge({ repository: "kioooice/forge", task: "把导出格式从 CSV 改成 TSV" });
    expect(result.used).toBe(false);
    expect(result.reason).toBe("no_relevant_knowledge");
    expect(result.items).toHaveLength(0);
  });

  it("知识库为空时不调用模型", async () => {
    syncKnowledge();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await selectReusableKnowledge({ repository: "kioooice/forge", task: "任意任务" });
    expect(result.reason).toBe("no_relevant_knowledge");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("未配置模型时不阻塞，返回 model_not_configured", async () => {
    entryFile("notes/a.md", noteEntry("note-a", "输入稳定性", "正文"));
    syncKnowledge();
    delete process.env.MYOPC_MODEL_API_KEY;
    const result = await selectReusableKnowledge({ repository: "kioooice/agentVision", task: "改善识别稳定性" });
    expect(result.used).toBe(false);
    expect(result.reason).toBe("model_not_configured");
  });

  it("短时间内相同仓库 + 相同任务复用结果，不重复请求模型", async () => {
    entryFile("notes/a.md", noteEntry("note-a", "输入稳定性", "正文"));
    syncKnowledge();
    const fetchMock = vi.fn(async () => modelResponse({ selected: [{ id: "note-a", reason: "相关" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await selectReusableKnowledge({ repository: "kioooice/agentVision", task: "改善目标区域识别稳定性" });
    const second = await selectReusableKnowledge({ repository: "kioooice/agentVision", task: "改善目标区域识别稳定性" });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(["note-a"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("推理模型第一次把预算用在推理上导致内容被截断时，会放大预算重试", async () => {
    entryFile("notes/a.md", noteEntry("note-a", "输入稳定性", "正文"));
    syncKnowledge();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }], usage: { completion_tokens: 8000 } }), { status: 200 }))
      .mockResolvedValueOnce(modelResponse({ selected: [{ id: "note-a", reason: "相关", confidence: 90 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await selectReusableKnowledge({ repository: "kioooice/agentVision", task: "改善识别稳定性" });
    expect(result.used).toBe(true);
    expect(result.items[0].id).toBe("note-a");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("相关性低于阈值的选择会被丢掉", async () => {
    entryFile("notes/a.md", noteEntry("note-a", "输入稳定性", "正文"));
    syncKnowledge();
    vi.stubGlobal("fetch", vi.fn(async () => modelResponse({ selected: [{ id: "note-a", reason: "可能有点关系", confidence: 40 }] })));
    const result = await selectReusableKnowledge({ repository: "kioooice/flow-skill", task: "增加实时降噪处理" });
    expect(result.used).toBe(false);
    expect(result.reason).toBe("no_relevant_knowledge");
  });
});

describe("开发知识复用 · result", () => {
  it("保存任务结果、判定知识效果并生成候选经验", async () => {
    entryFile("notes/a.md", noteEntry("note-a", "先确认输入稳定性", "稳定输入之后再调判据。", "经验"));
    syncKnowledge();
    vi.stubGlobal("fetch", vi.fn(async () => modelResponse({
      summary: "确认了先做输入稳定性检查再调判据",
      effectiveness: [{ id: "note-a", effect: "effective", note: "先做稳定性检查后判据不再抖动" }],
      candidates: [{ title: "先确认输入稳定性再调视觉判据", summary: "固定输入条件后再调判据，方差明显下降。", evidence: "同一批样本的测试方差下降", suggestion: "合并到「先确认输入稳定性」这条经验", related_entry_ids: ["note-a"] }],
    })));

    const result = await recordTaskResult({
      repository: "kioooice/agentVision",
      task: "改善目标区域识别稳定性",
      outcome: "success",
      changes: ["把阈值判断改成先检查输入稳定性"],
      validation: ["本地测试通过"],
      findings: ["输入抖动是主要原因"],
      knowledge_used: ["note-a"],
    });
    expect(result.saved).toBe(true);
    expect(result.resultId).toMatch(/^task-\d{8}-\d{3}$/);
    expect(result.knowledgeUsed[0].effect).toBe("effective");
    expect(result.candidates).toHaveLength(1);
    expect(result.extraction).toBe("model");

    const overview = getReuseOverview();
    expect(overview.counts.results).toBe(1);
    expect(overview.counts.pendingCandidates).toBe(1);
    expect(overview.usage[0]).toMatchObject({ id: "note-a", usedCount: 1, effective: 1 });
    expect(overview.candidates[0].suggestion).toContain("合并到");
  });

  it("缺少 task 时抛错", async () => {
    await expect(recordTaskResult({ repository: "kioooice/agentVision" })).rejects.toBeInstanceOf(KnowledgeError);
  });

  it("没有模型时仍然保存结果，只是不生成候选经验", async () => {
    delete process.env.MYOPC_MODEL_API_KEY;
    const result = await recordTaskResult({ repository: "kioooice/forge", task: "记录一次纯机械修改", outcome: "success" });
    expect(result.saved).toBe(true);
    expect(result.extraction).toBe("skipped_no_model");
    expect(result.candidates).toHaveLength(0);
    expect(getReuseOverview().counts.results).toBe(1);
  });
});
