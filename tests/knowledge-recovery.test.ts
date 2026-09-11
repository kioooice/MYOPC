import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests } from "../lib/db";
import { generateKnowledgeNote, getKnowledgeDetail, getKnowledgeOverview, processKnowledgeNotes, syncKnowledge } from "../lib/knowledge/service";
import { getKnowledgeEntry, getReadingNote } from "../lib/knowledge/store";

let dataDirectory: string;
let knowledgeDirectory: string;

const entry = (body: string) => `---
id: demo
kind: note
title: 演示条目
status: 进行中
summary: 演示用条目
updated: 2026-09-11
---

${body}
`;

const noteJson = (summary: string) => JSON.stringify({
  summary,
  brief: `${summary}（简短）`,
  card: `${summary}（列表卡）`,
  facts: [], decisions: [], steps: [], conditions: [], open_questions: [], inferences: [],
});

const okResponse = (summary: string) => new Response(JSON.stringify({ choices: [{ message: { content: noteJson(summary) }, finish_reason: "stop" }] }), { status: 200 });

function writeEntry(body: string) {
  const file = join(knowledgeDirectory, "notes", "demo.md");
  mkdirSync(join(knowledgeDirectory, "notes"), { recursive: true });
  writeFileSync(file, entry(body), "utf8");
  return file;
}

beforeEach(() => {
  dataDirectory = mkdtempSync(join(tmpdir(), "myopc-recovery-data-"));
  knowledgeDirectory = mkdtempSync(join(tmpdir(), "myopc-recovery-repo-"));
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

describe("验收复现的问题", () => {
  it("原文更新后加工失败：保留旧结果与它的来源版本，并继续算作待加工", async () => {
    writeEntry("第一版正文。");
    syncKnowledge();
    vi.stubGlobal("fetch", vi.fn(async () => okResponse("第一版说明")));
    await generateKnowledgeNote("demo");
    const firstNote = getReadingNote("demo");
    expect(firstNote?.status).toBe("ready");

    writeEntry("第二版正文。");
    syncKnowledge();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503 })));
    const failed = await generateKnowledgeNote("demo");
    expect(failed.status).toBe("failed");

    const afterFailure = getReadingNote("demo");
    expect(afterFailure?.status).toBe("failed");
    expect(afterFailure?.content?.summary).toBe("第一版说明");
    expect(afterFailure?.sourceHash).toBe(firstNote?.sourceHash);
    expect(afterFailure?.sourceHash).not.toBe(getKnowledgeEntry("demo")?.contentHash);
    expect(afterFailure?.attemptedSourceHash).toBe(getKnowledgeEntry("demo")?.contentHash);

    const overview = getKnowledgeOverview();
    expect(overview.pendingNotes).toBe(1);
    expect(overview.entries[0].note.status).toBe("failed");

    // 接口恢复后，批量加工应该重新处理这一条
    vi.stubGlobal("fetch", vi.fn(async () => okResponse("第二版说明")));
    const batch = await processKnowledgeNotes(5);
    expect(batch.processed).toBe(1);
    expect(getReadingNote("demo")?.content?.summary).toBe("第二版说明");
    expect(getKnowledgeOverview().pendingNotes).toBe(0);
  });

  it("原文更新但还没重新加工时，列表是待更新而不是就绪，详情仍能看到上一次说明", async () => {
    writeEntry("第一版正文。");
    syncKnowledge();
    vi.stubGlobal("fetch", vi.fn(async () => okResponse("第一版说明")));
    await generateKnowledgeNote("demo");

    writeEntry("第二版正文。");
    syncKnowledge();
    const overview = getKnowledgeOverview();
    expect(overview.entries[0].note.status).toBe("stale");
    expect(overview.entries[0].note.stale).toBe(true);
    expect(overview.pendingNotes).toBe(1);

    const detail = getKnowledgeDetail("demo");
    expect(detail?.stale).toBe(true);
    expect(detail?.noteContent?.summary).toBe("第一版说明");
  });

  it("只移动文件时索引更新路径，且不触发重新加工", async () => {
    const file = writeEntry("正文不变。");
    syncKnowledge();
    vi.stubGlobal("fetch", vi.fn(async () => okResponse("说明")));
    await generateKnowledgeNote("demo");
    expect(getKnowledgeOverview().pendingNotes).toBe(0);

    const renamed = join(knowledgeDirectory, "notes", "renamed.md");
    renameSync(file, renamed);
    syncKnowledge();

    const detail = getKnowledgeDetail("demo");
    expect(detail?.relPath).toBe("notes/renamed.md");
    expect(getKnowledgeOverview().pendingNotes).toBe(0);
  });

  it("模型返回空内容且被截断时，会再试一次", async () => {
    writeEntry("正文。");
    syncKnowledge();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] }), { status: 200 }))
      .mockResolvedValueOnce(okResponse("第二次成功"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateKnowledgeNote("demo");
    expect(result.status).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getReadingNote("demo")?.content?.summary).toBe("第二次成功");
  });

  it("没有可用模型密钥时，失败信息记录在案，旧说明保持不动", async () => {
    writeEntry("正文。");
    syncKnowledge();
    vi.stubGlobal("fetch", vi.fn(async () => okResponse("已有说明")));
    await generateKnowledgeNote("demo");
    const before = getReadingNote("demo");
    expect(before?.status).toBe("ready");

    delete process.env.MYOPC_MODEL_API_KEY;
    const failed = await generateKnowledgeNote("demo", { force: true });
    expect(failed.status).toBe("failed");
    const after = getReadingNote("demo");
    expect(after?.content?.summary).toBe("已有说明");
    expect(after?.sourceHash).toBe(before?.sourceHash);
  });
});
