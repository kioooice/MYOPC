import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending, isWithinDirectory, machineIdentity, parseArgs, readQueue, redactSecrets, repositoryFromRemote, resolveRepository, runBootstrap, runCandidates, runResult } from "../bridge/opc.mjs";

const originalOpcHome = process.env.OPC_HOME;
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalOpcHome === undefined) delete process.env.OPC_HOME;
  else process.env.OPC_HOME = originalOpcHome;
});

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), "opc-home-"));
  process.env.OPC_HOME = home;
  return home;
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

describe("OPC Bridge", () => {
  it("从常见 remote 形式解析 owner/repo", () => {
    expect(repositoryFromRemote("https://github.com/kioooice/agentVision.git")).toBe("kioooice/agentVision");
    expect(repositoryFromRemote("git@github.com:kioooice/MYOPC-Knowledge.git")).toBe("kioooice/MYOPC-Knowledge");
    expect(repositoryFromRemote("ssh://git@github.com/owner/repo.git")).toBe("owner/repo");
    expect(repositoryFromRemote("not-a-url")).toBe("");
    expect(repositoryFromRemote("")).toBe("");
  });

  it("解析 context / result 参数", () => {
    const context = parseArgs(["context", "--task", "改善识别稳定性", "--force"]);
    expect(context.command).toBe("context");
    expect(context.flags.task).toBe("改善识别稳定性");
    expect(context.flags.force).toBe(true);

    const result = parseArgs(["result", "--task", "任务", "--change", "a", "--change", "b", "--knowledge-used", "n1,n2"]);
    expect(result.multi.change).toEqual(["a", "b"]);
    expect(result.flags["knowledge-used"]).toBe("n1,n2");
  });

  it("在当前仓库能识别出 owner/repo", () => {
    expect(resolveRepository(process.cwd())).toBe("kioooice/MYOPC");
  });

  it("配置里的本机路径映射优先于 git remote", () => {
    const repository = resolveRepository(process.cwd(), { projects: { [process.cwd()]: "local/video-project" } });
    expect(repository).toBe("local/video-project");
  });

  it("解析阶段事件：按出现顺序归属到各自的 --event", () => {
    const parsed = parseArgs(["result", "--task", "T", "--event", "decision", "--title", "标题", "--content", "内容", "--rationale", "理由", "--evidence", "commit:abc1234", "--event", "blocker", "--content", "卡住", "--next", "需要人工确认"]);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toMatchObject({ type: "decision", title: "标题", content: "内容", rationale: "理由" });
    expect(parsed.events[0].evidence).toEqual(["commit:abc1234"]);
    expect(parsed.events[1]).toMatchObject({ type: "blocker", content: "卡住", next: "需要人工确认" });
    expect(parsed.flags.task).toBe("T");
  });

  it("凭据在本地就被替换掉，不进入上传载荷", () => {
    const result = redactSecrets("MYOPC_MODEL_API_KEY=sk-abcdefghijklmnopqrstuv 以及 Bearer abcdefghijklmnopqrstuv");
    expect(result.text).not.toContain("sk-abcdefghijklmnopqrstuv");
    expect(result.text).not.toContain("Bearer abcdefghijklmnopqrstuv");
    expect(result.redacted).toBeGreaterThanOrEqual(2);
  });

  it("机器身份写在全局 OPC 目录，重复调用保持一致", () => {
    const home = mkdtempSync(join(tmpdir(), "opc-home-"));
    process.env.OPC_HOME = home;
    try {
      const first = machineIdentity({});
      const second = machineIdentity({});
      expect(first).toBe(second);
      expect(first.length).toBeGreaterThan(0);
      const stored = JSON.parse(readFileSync(join(home, "machine.json"), "utf8"));
      expect(stored.id).toBe(first);
      expect(existsSync(join(home, "machine.json"))).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("config.machine 覆盖本机机器身份", () => {
    expect(machineIdentity({ machine: "custom-machine" })).toBe("custom-machine");
  });

  it("路径映射按目录边界匹配：video 命中，video-other 不命中", () => {
    const config = { projects: { "D:\\Projects\\video": "video-project" } };
    expect(resolveRepository("D:\\Projects\\video", config)).toBe("video-project");
    expect(resolveRepository("D:\\Projects\\video\\productions\\zh-short", config)).toBe("video-project");
    expect(resolveRepository("D:\\Projects\\video-other", config)).toBe("video-other");
    const nested = { projects: { "D:\\Projects": "projects-root", "D:\\Projects\\video": "video-project" } };
    expect(resolveRepository("D:\\Projects\\video\\x", nested)).toBe("video-project");
    expect(resolveRepository("D:\\Projects\\helm", nested)).toBe("projects-root");
    expect(isWithinDirectory("d:\\projects\\video", "d:\\projects")).toBe(true);
    expect(isWithinDirectory("d:\\projects\\video-other", "d:\\projects\\video")).toBe(false);
    expect(isWithinDirectory("d:\\projects", "d:\\projects\\video")).toBe(false);
  });

  it("总开关关闭时 result / candidates 不碰网络，也不新增待上传内容", async () => {
    const home = tempHome();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await runResult({ flags: { repo: "video-project", task: "x" }, multi: { change: ["a"], validation: [], finding: [] }, events: [{ type: "progress", title: "t", content: "c" }], config: { enabled: false }, cwd: process.cwd() });
      expect(result).toMatchObject({ saved: false, reason: "bridge_disabled", queued: false });
      const candidates = await runCandidates({ flags: { id: "cand-1", status: "merged", note: "理由" }, config: { enabled: false } });
      expect(candidates).toMatchObject({ reason: "bridge_disabled", resolved: false });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(readQueue()).toHaveLength(0);
      expect(existsSync(join(home, "queue", "pending.jsonl"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("提交变化后 bootstrap 重新取；补发成功后清掉该项目的恢复缓存", async () => {
    const home = tempHome();
    const config = { enabled: true, serverUrl: "http://127.0.0.1:1", timeoutMs: 1000, cacheMinutes: 10, auth: {} };
    try {
      const fetchMock = vi.fn(async (url, options) => {
        const body = JSON.parse(options.body);
        return jsonResponse({
          used: true, repository: body.repository, branch: body.branch, commit: body.commit, machine: body.machine,
          counts: { records: 1, sameBranch: 1, otherBranch: 0, otherMachine: 0, olderCommit: 0 },
          recent: [], decisions: [], environment: [], blockers: [], nextSteps: [], conflicts: [], notes: [], recordIds: [],
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const first = await runBootstrap({ flags: { repo: "video-project", branch: "main", commit: "aaa1111", machine: "TEST-PC" }, config, cwd: process.cwd() });
      expect(first.used).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const sameCommit = await runBootstrap({ flags: { repo: "video-project", branch: "main", commit: "aaa1111", machine: "TEST-PC" }, config, cwd: process.cwd() });
      expect(sameCommit.cached).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const newCommit = await runBootstrap({ flags: { repo: "video-project", branch: "main", commit: "bbb2222", machine: "TEST-PC" }, config, cwd: process.cwd() });
      expect(newCommit.cached).not.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const cacheFile = join(home, "cache", "bootstrap.json");
      expect(Object.keys(JSON.parse(readFileSync(cacheFile, "utf8"))).length).toBeGreaterThan(0);

      // 回流失败 → 进入待重传队列
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch failed"); }));
      const queued = await runResult({ flags: { repo: "video-project", task: "t" }, multi: { change: ["x"], validation: [], finding: [] }, events: [], config, cwd: process.cwd() });
      expect(queued).toMatchObject({ saved: false, queued: true });
      expect(readQueue()).toHaveLength(1);

      // 恢复网络后补发 → 该项目的恢复缓存被清掉
      vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ saved: true, resultId: "task-1" })));
      const flush = await flushPending(config);
      expect(flush).toMatchObject({ sent: 1, remaining: 0 });
      expect(readQueue()).toHaveLength(0);
      expect(JSON.parse(readFileSync(cacheFile, "utf8"))).toEqual({});
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
