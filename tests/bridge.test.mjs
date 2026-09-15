import { describe, expect, it } from "vitest";
import { parseArgs, repositoryFromRemote, resolveRepository } from "../bridge/opc.mjs";

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
});
