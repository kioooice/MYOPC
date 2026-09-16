import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDbForTests } from "../lib/db";
import { buildRecoverySummary, getProjectEvent, getRepositoryProgress, listProjectEvents, normalizeProjectEvents, redactText, saveProjectEvents } from "../lib/knowledge/progress";
import { getReuseOverview, recordTaskResult, resolveKnowledgeCandidate } from "../lib/knowledge/reuse";

let dataDirectory: string;

const repository = "local/video-project";

function saveSample(events: Array<Record<string, unknown>>, submissionId: string) {
  return saveProjectEvents({
    repository,
    events: normalizeProjectEvents(events, {}).events,
    taskResultId: null,
    submissionId,
  });
}

beforeEach(() => {
  dataDirectory = mkdtempSync(join(tmpdir(), "myopc-progress-data-"));
  process.env.MYOPC_DATA_DIR = dataDirectory;
  process.env.MYOPC_MODEL_API_KEY = "test-key";
});

afterEach(() => {
  closeDbForTests();
  vi.unstubAllGlobals();
  rmSync(dataDirectory, { recursive: true, force: true });
  delete process.env.MYOPC_DATA_DIR;
  delete process.env.MYOPC_MODEL_API_KEY;
});

describe("进展事件 · 保存与去重", () => {
  it("同一次回流重试不会重复写入", () => {
    const first = saveSample([{ event_type: "progress", title: "接通三段链路", content: "TTS / 对齐 / 渲染各自验证" }], "sub-1");
    const retry = saveSample([{ event_type: "progress", title: "接通三段链路", content: "TTS / 对齐 / 渲染各自验证" }], "sub-1");
    expect(first.saved).toHaveLength(1);
    expect(retry.saved).toHaveLength(0);
    expect(retry.dedupedIds).toEqual([first.saved[0].id]);
    expect(listProjectEvents(repository)).toHaveLength(1);
  });

  it("机器、分支、提交与未提交标记随事件保存", () => {
    const result = saveProjectEvents({
      repository,
      events: normalizeProjectEvents([{
        event_type: "environment",
        title: "本地 runtime 已选择",
        content: "Runtime Profile 使用本地 profile",
        status: "verified",
        verification: "hypit paths 显示本地 profile",
        machine: "WIN-TEST",
        branch: "main",
        commit: "abc1234",
        dirty: true,
      }], {}).events,
      taskResultId: null,
      submissionId: "sub-env",
    });
    const record = result.saved[0];
    expect(record.machine).toBe("WIN-TEST");
    expect(record.branch).toBe("main");
    expect(record.commit).toBe("abc1234");
    expect(record.dirty).toBe(true);
    expect(record.status).toBe("verified");
  });

  it("没有验证方式或证据时不会被标成 verified", () => {
    const downgraded = normalizeProjectEvents([{ event_type: "progress", title: "完成", content: "已完成", status: "verified" }], {});
    expect(downgraded.events[0].status).toBe("reported");
    expect(downgraded.events[0].notes.join("")).toContain("按执行方报告记录");
    const kept = normalizeProjectEvents([{ event_type: "progress", title: "完成", content: "已完成", status: "verified", evidence: ["output/zh-short-final.mp4"] }], {});
    expect(kept.events[0].status).toBe("verified");
  });

  it("凭据原文在服务端也会被脱敏", () => {
    const result = redactText("配置 MYOPC_MODEL_API_KEY=sk-abcdefghijklmnopqrstuv 后开始");
    expect(result.text).not.toContain("sk-abcdefghijklmnopqrstuv");
    expect(result.redacted).toBeGreaterThan(0);
    const saved = saveProjectEvents({
      repository,
      events: normalizeProjectEvents([{ event_type: "environment", title: "模型配置", content: "token: abcdef1234567890" }], {}).events,
      taskResultId: null,
      submissionId: "sub-secret",
    });
    expect(saved.saved[0].content).not.toContain("abcdef1234567890");
    const record = getProjectEvent(saved.saved[0].id);
    expect(record?.content).toContain("已脱敏");
  });

  it("更正记录保留历史：旧记录标记 superseded，不会被删除", () => {
    const blocker = saveSample([{ event_type: "blocker", title: "渲染修复不可持久", content: "重装发行版后要重做修复", next_step: "补一个修复脚本" }], "sub-blocker");
    const fix = saveSample([{ event_type: "progress", title: "渲染修复", content: "已补脚本，重装后可重跑", supersedes: blocker.saved[0].id }], "sub-fix");
    expect(fix.supersededIds).toEqual([blocker.saved[0].id]);
    const old = getProjectEvent(blocker.saved[0].id);
    expect(old?.status).toBe("superseded");
    expect(old?.supersededBy).toBe(fix.saved[0].id);
    expect(listProjectEvents(repository)).toHaveLength(2);
  });
});

describe("bootstrap · 恢复摘要", () => {
  it("没有仓库或没有记录时正常返回，不调用模型", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(buildRecoverySummary({}).reason).toBe("repository_unresolved");
    const empty = buildRecoverySummary({ repository: "kioooice/unknown-repo", branch: "main", machine: "WIN-TEST" });
    expect(empty.used).toBe(false);
    expect(empty.reason).toBe("no_records");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("按分支、机器、提交筛选并标注，不把最新记录直接拼起来", () => {
    saveProjectEvents({
      repository,
      events: normalizeProjectEvents([{
        event_type: "environment", title: "SenseAudio ASR 已配置", content: "凭据槽 senseaudio.asr.token 已入系统凭据库",
        status: "verified", verification: "本机跑通一次词级对齐", machine: "OTHER-PC", branch: "main", commit: "old1234",
      }], {}).events,
      taskResultId: null,
      submissionId: "sub-env-other",
    });
    saveProjectEvents({
      repository,
      events: normalizeProjectEvents([{
        event_type: "decision", title: "ASR 用 SenseAudio 承担", content: "WhisperX 对齐请求无模型参数，第三方实现合规",
        rationale: "该能力是 provider-neutral request", machine: "WIN-TEST", branch: "main", commit: "new9999",
      }], {}).events,
      taskResultId: null,
      submissionId: "sub-decision",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const summary = buildRecoverySummary({ repository, branch: "main", commit: "new9999", machine: "WIN-TEST" });
    expect(summary.used).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(summary.decisions).toHaveLength(1);
    expect(summary.decisions[0].sameMachine).toBe(true);
    const environment = summary.environment[0];
    expect(environment.verifiedOnThisMachine).toBe(false);
    expect(environment.note).toContain("OTHER-PC");
    expect(summary.notes.join("")).toContain("其他机器验证过的配置不代表本机已就绪");
    expect(summary.recordIds).toContain(summary.decisions[0].id);
  });

  it("同一主题出现不同记录时显式列出冲突，不做裁决", () => {
    saveSample([{ event_type: "decision", title: "字幕方案", content: "用 Caption 逐字高亮", machine: "WIN-TEST", branch: "main" }], "sub-topic-1");
    saveSample([{ event_type: "decision", title: "字幕方案", content: "改用纯文本叠图", machine: "WIN-TEST", branch: "main" }], "sub-topic-2");
    const summary = buildRecoverySummary({ repository, branch: "main", machine: "WIN-TEST" });
    expect(summary.conflicts).toHaveLength(1);
    expect(summary.conflicts[0].records).toHaveLength(2);
    expect(summary.conflicts[0].note).toContain("人工确认");
  });

  it("被替代的记录不再贡献下一步，更新时间取最新有效记录", () => {
    const blocker = saveSample([{ event_type: "blocker", title: "修复不可持久", content: "重装要重做", next_step: "补一个修复脚本" }], "sub-super-1");
    expect(buildRecoverySummary({ repository, branch: "main", machine: "WIN-TEST" }).blockers).toHaveLength(1);
    saveSample([{ event_type: "progress", title: "修复可重跑", content: "脚本补齐", status: "reported", next_step: "接入画面", supersedes: blocker.saved[0].id }], "sub-super-2");
    const summary = buildRecoverySummary({ repository, branch: "main", machine: "WIN-TEST" });
    expect(summary.blockers).toHaveLength(0);
    expect(summary.nextSteps.map((item) => item.text)).toEqual(["接入画面"]);
    expect(summary.updatedAt).toBe(summary.recent[0].occurredAt);
    expect(summary.recent.some((record) => record.status === "superseded")).toBe(true);
  });

  it("当前阶段、阻塞和下一步只取当前分支，其他分支只作参考", () => {
    saveSample([{ event_type: "blocker", title: "main 上的阻塞", content: "main 卡住", next_step: "先修 main 的问题", machine: "WIN-TEST", branch: "main" }], "sub-scope-main");
    saveSample([
      { event_type: "progress", title: "feature 上的进展", content: "feature 做完了", next_step: "继续 feature 的活", machine: "WIN-TEST", branch: "feature-x" },
      { event_type: "blocker", title: "feature 上的阻塞", content: "feature 卡住", machine: "WIN-TEST", branch: "feature-x" },
    ], "sub-scope-other");

    const summary = buildRecoverySummary({ repository, branch: "main", machine: "WIN-TEST" });
    expect(summary.blockers.map((item) => item.title)).toEqual(["main 上的阻塞"]);
    expect(summary.nextSteps.map((item) => item.text)).toEqual(["先修 main 的问题"]);
    expect(summary.nextSteps[0].scope).toBe("current-branch");
    expect(summary.nextSteps[0].branch).toBe("main");
    // 其他分支的阶段不能顶替当前阶段
    expect(summary.phase).toBeNull();
    expect(summary.notes.join("")).toContain("只作参考");
    const other = summary.recent.find((item) => item.title === "feature 上的进展");
    expect(other?.sameBranch).toBe(false);
    expect(other?.note).toContain("feature-x");
  });

  it("没有分支的项目仍然正常恢复阶段、阻塞与下一步", () => {
    saveSample([
      { event_type: "progress", title: "成片已完成", content: "本地渲染通过", next_step: "接入 H3 画面", machine: "WIN-TEST" },
      { event_type: "blocker", title: "缺 CJK 字体", content: "noto-sans-sc 未安装", machine: "WIN-TEST" },
    ], "sub-scope-nobranch");

    const summary = buildRecoverySummary({ repository, machine: "WIN-TEST" });
    expect(summary.phase?.title).toBe("成片已完成");
    expect(summary.blockers.map((item) => item.title)).toEqual(["缺 CJK 字体"]);
    expect(summary.nextSteps.map((item) => item.text)).toEqual(["接入 H3 画面"]);
    expect(summary.nextSteps[0].scope).toBe("unversioned");
    expect(summary.nextSteps[0].branch).toBeNull();
  });

  it("阶段与下一步都来自记录本身", () => {
    saveSample([{
      event_type: "progress", title: "中文短视频流水线打通", content: "TTS → 对齐 → 字幕 → 渲染 → 成片",
      status: "verified", verification: "输出 output/zh-short-final.mp4", next_step: "接入 H3 生成画面", machine: "WIN-TEST", branch: "main",
    }], "sub-phase");
    const summary = buildRecoverySummary({ repository, branch: "main", machine: "WIN-TEST" });
    expect(summary.phase?.title).toBe("中文短视频流水线打通");
    expect(summary.phase?.verification).toContain("zh-short-final.mp4");
    expect(summary.nextSteps[0].text).toBe("接入 H3 生成画面");
  });
});

describe("回流与候选处置", () => {
  it("客户端自带总结与候选经验时，服务器不调用模型", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await recordTaskResult({
      repository,
      task: "接通中文短视频流水线",
      outcome: "success",
      summary: "中文短视频流水线打通",
      candidates: [{ title: "SenseAudio 可承担 WhisperX 对齐", summary: "请求无模型参数，第三方实现合规", evidence: "一次真实对齐通过", suggestion: "合并到视频环境说明" }],
      events: [{ event_type: "progress", title: "流水线打通", content: "成片已生成", status: "reported" }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.extraction).toBe("provided");
    expect(result.candidates).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(getReuseOverview().counts.pendingCandidates).toBe(1);
  });

  it("只回流阶段事件时不调用服务器模型", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await recordTaskResult({
      repository,
      task: "阶段回流",
      outcome: "progress",
      events: [{ event_type: "decision", title: "方案", content: "选择本地渲染", rationale: "先跑通再优化" }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.extraction).toBe("skipped_events_only");
    expect(result.events).toHaveLength(1);
    expect(result.notes.join("")).toContain("未调用服务器模型");
  });

  it("候选经验处置后不再出现在待整理列表，历史保留", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const result = await recordTaskResult({
      repository,
      task: "整理候选",
      summary: "总结",
      candidates: [{ title: "候选 A", summary: "内容", evidence: "证据", suggestion: "建议" }],
    });
    const candidateId = result.candidates[0].id;
    expect(() => resolveKnowledgeCandidate({ id: candidateId, status: "merged" })).toThrow();
    const resolved = resolveKnowledgeCandidate({ id: candidateId, status: "merged", note: "已合并到 video-pipeline 笔记", entryId: "video-pipeline", knowledgeCommit: "abc1234" });
    expect(resolved.resolved).toBe(true);
    const overview = getReuseOverview();
    expect(overview.counts.pendingCandidates).toBe(0);
    expect(overview.counts.resolvedCandidates).toBe(1);
    expect(overview.resolvedCandidates[0]).toMatchObject({ id: candidateId, status: "merged", entryId: "video-pipeline", knowledgeCommit: "abc1234" });
  });

  it("项目详情的最近进展按仓库聚合，没有记录时返回 null", () => {
    expect(getRepositoryProgress(["kioooice/unknown-repo"])).toBeNull();
    saveSample([{ event_type: "finding", title: "发现", content: "机器包需要补齐", machine: "WIN-TEST", branch: "main" }], "sub-entry");
    const progress = getRepositoryProgress([repository]);
    expect(progress?.events).toHaveLength(1);
    expect(progress?.stage).toBeNull();
    expect(progress?.total).toBe(1);
  });
});