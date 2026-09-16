import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { machineIdentity, parseArgs, redactSecrets, repositoryFromRemote, resolveRepository } from "../bridge/opc.mjs";

const originalOpcHome = process.env.OPC_HOME;
afterEach(() => {
  if (originalOpcHome === undefined) delete process.env.OPC_HOME;
  else process.env.OPC_HOME = originalOpcHome;
});

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
});
