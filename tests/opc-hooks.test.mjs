import { mkdtempSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contains, createPilot, execute, hookDefinitions } from "../bridge/opc-hooks.mjs";

function fixture(mode = "active") {
  const home = mkdtempSync(join(tmpdir(), "opc-hook-test-"));
  const root = join(home, "project");
  mkdirSync(root);
  writeFileSync(join(home, "pilot.json"), JSON.stringify({ scopes: [{ root, repository: "TEST_ONLY", mode }] }));
  const pilot = createPilot(home);
  const event = (name, fields = {}) => ({ session_id: "test-session", turn_id: "turn-one", cwd: root, hook_event_name: name, ...fields });
  const prompt = () => pilot.handle(event("UserPromptSubmit", { prompt: "Explicit fixture task" }), async () => ({ test_only: true }));
  const arm = (checks = [{ name: "failing test", program: process.execPath, args: ["-e", "console.error('OPC_CHECK_FAILED'); process.exit(1)"], failureContains: "OPC_CHECK_FAILED" }]) => pilot.control("arm", "test-session", "turn-one", { task: "TEST ONLY", mode: "execution", authorized: true, authorization_source: "test-fixture", allowRepair: true, checks: checks.map(check => ({ failureContains: "OPC_CHECK_FAILED", ...check })) });
  return { home, root, pilot, event, prompt, arm };
}

describe("optional OPC hooks pilot", () => {
  it("isolates paths and probe mode, stores schema metadata without prompt/output bodies", async () => {
    const f = fixture("probe");
    expect(contains(f.root, f.root + "-other")).toBe(false);
    expect(await f.pilot.handle(f.event("UserPromptSubmit", { cwd: tmpdir(), prompt: "secret" }))).toEqual({});
    expect(await f.prompt()).toEqual({});
    await f.pilot.handle(f.event("PostToolUse", { tool_name: "Bash", tool_response: { output: "PRIVATE_RAW_BODY" } }));
    const log = readFileSync(join(f.home, "events.jsonl"), "utf8");
    expect(log).not.toContain("PRIVATE_RAW_BODY");
    expect(log).not.toContain("Explicit fixture task");
    expect(log).toContain("response_hash");
  });

  it("keeps discussion unarmed and labels provenance rather than interpreting keywords", async () => {
    const f = fixture();
    const result = await f.prompt();
    expect(result.hookSpecificOutput.additionalContext).toContain("自行判断");
    expect(await f.pilot.handle(f.event("Stop"))).toEqual({});
    expect(() => f.pilot.control("arm", "test-session", "turn-one", { mode: "discussion" })).toThrow();
    expect(() => f.pilot.control("arm", "test-session", "stale-turn", {})).toThrow();
  });

  it("uses fresh executable failure evidence and consumes at most one repair", async () => {
    const f = fixture();
    await f.prompt(); f.arm();
    const result = await f.pilot.handle(f.event("Stop", { last_assistant_message: "All done!" }));
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("exit=1");
    expect(await f.pilot.handle(f.event("Stop"))).toEqual({});
    const dir = join(f.home, "state", readdirSync(join(f.home, "state"))[0]);
    expect(readdirSync(dir).filter(file => file.includes(".verification-")).length).toBe(2);
    expect(() => f.arm()).toThrow("Repair already consumed");
  });

  it("reruns checks so old PostToolUse success cannot mask a failure", async () => {
    const f = fixture(); await f.prompt(); f.arm();
    await f.pilot.handle(f.event("PostToolUse", { tool_response: { exit_code: 0 } }));
    expect((await f.pilot.handle(f.event("Stop"))).decision).toBe("block");
  });

  it("passes successful checks but does not infer overall acceptance", async () => {
    const f = fixture(); await f.prompt();
    f.arm([{ name: "pass", program: process.execPath, args: ["-e", "process.exit(0)"] }]);
    expect(await f.pilot.handle(f.event("Stop"))).toEqual({});
  });

  it("does not continue on interruption, cancellation, changed prompt, or native stop_hook_active", async () => {
    for (const kind of ["interrupt", "cancel", "new-prompt", "native-active"]) {
      const f = fixture(); await f.prompt(); f.arm();
      if (kind === "interrupt") await f.pilot.handle(f.event("Interrupt"));
      if (kind === "cancel") f.pilot.control("cancel", "test-session", "turn-one", { reason: "missing authorization" });
      if (kind === "new-prompt") await f.pilot.handle(f.event("UserPromptSubmit", { turn_id: "new", prompt: "Stop now" }), async () => ({}));
      expect(await f.pilot.handle(f.event("Stop", { stop_hook_active: kind === "native-active" }))).toEqual({});
    }
  });

  it("treats absent executable, timeout and signal as unknown rather than unfinished evidence", async () => {
    const f = fixture(); await f.prompt();
    f.arm([{ name: "missing", program: join(f.home, "missing.exe"), args: [] }]);
    expect(await f.pilot.handle(f.event("Stop"))).toEqual({});
    const result = await execute(process.execPath, ["-e", "setTimeout(()=>{},10000)"], f.root, "", 100);
    expect(result.status).toBe("unknown");
  });

  it("does not reuse a prior contract when an automatic continuation starts a new prompt", async () => {
    const f = fixture(); await f.prompt(); f.arm();
    expect((await f.pilot.handle(f.event("Stop"))).decision).toBe("block");
    await f.pilot.handle(f.event("UserPromptSubmit", { turn_id: "continuation" }), async () => ({}));
    expect(await f.pilot.handle(f.event("Stop", { turn_id: "continuation" }))).toEqual({});
    expect(() => f.pilot.control("arm", "test-session", "continuation", { task: "TEST ONLY", mode: "execution", authorized: true, authorization_source: "test-fixture", allowRepair: true, checks: [{ name: "fail", program: process.execPath, args: ["-e", "process.exit(1)"], failureContains: "OPC_CHECK_FAILED" }] })).toThrow("Repair already consumed");
  });

  it("requires choice/action/evidence for adoption, forces unknown and deterministic result id", async () => {
    const f = fixture(); await f.prompt();
    const payload = { task: "TEST ONLY", summary: "Caller reports a method changed an action", outcome: "success", adoptions: [{ id: "method", changed_choice: "Use finite repair", changed_action: "Bound retry", evidence: "fixture check", effect: "effective" }] };
    const a = f.pilot.control("report", "test-session", "turn-one", payload);
    const b = f.pilot.control("report", "test-session", "turn-one", payload);
    expect(a.report.knowledge_effectiveness[0].effect).toBe("unknown");
    expect(a.report.submission_id).toBe(b.report.submission_id);
    expect(f.pilot.control("report", "test-session", "turn-one", { ...payload, summary: "Changed report" }).report.submission_id).not.toBe(a.report.submission_id);
    expect(a.report.findings[0]).toContain("调用方报告");
    expect(() => f.pilot.control("report", "test-session", "turn-one", { ...payload, adoptions: [{ id: "method" }] })).toThrow();
    expect(() => f.pilot.control("report", "test-session", "turn-one", { ...payload, adoptions: [{ ...payload.adoptions[0], evidence: { not: "text evidence" } }] })).toThrow();
  });

  it("renders valid official events, including fast Interrupt cancellation", () => {
    const definitions = hookDefinitions("C:/private/opc-hooks.mjs", "C:/private/hooks");
    expect(Object.keys(definitions.hooks)).toEqual(["UserPromptSubmit", "PostToolUse", "Stop", "Interrupt"]);
    expect(definitions.hooks.Interrupt[0].hooks[0].timeout).toBe(3);
  });

  it("roundtrips adoption through the existing result CLI without writing production or inferring effective", async () => {
    const f = fixture(); await f.prompt();
    let received;
    const server = createServer(async (req, res) => {
      let body = ""; for await (const chunk of req) body += chunk;
      received = { url: req.url, body: JSON.parse(body) };
      res.writeHead(200, { "content-type": "application/json" }); res.end('{"saved":true,"extraction":"provided"}');
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    writeFileSync(join(f.home, "config.json"), JSON.stringify({ serverUrl: `http://127.0.0.1:${server.address().port}`, enabled: true }));
    const previous = process.env.OPC_HOME;
    process.env.OPC_HOME = f.home;
    try {
      const result = await execute(process.execPath, [fileURLToPath(new URL("../bridge/opc-hooks.mjs", import.meta.url)), "report", "--home", f.home, "--session", "test-session", "--turn", "turn-one", "--submit", "true"], f.root, JSON.stringify({ task: "TEST ONLY result roundtrip", summary: "Caller provided adoption; effect unknown", outcome: "partial", adoptions: [{ id: "method-id", changed_choice: "bounded repair", changed_action: "single retry", evidence: "synthetic fixture" }] }), 3000, true);
      expect(result.status).toBe("passed");
      expect(JSON.parse(result.jsonOutput).saved).toBe(true);
      expect(received.url).toBe("/api/v1/agent/result");
      expect(received.body.summary).toContain("effect unknown");
      expect(received.body.knowledge_effectiveness[0].effect).toBe("unknown");
      expect(received.body.events).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.OPC_HOME; else process.env.OPC_HOME = previous;
      await new Promise(resolve => server.close(resolve));
    }
  });

  it("records capability discovery through trial and actual integration, without treating candidates as installed", async () => {
    const f = fixture(); const context = await f.prompt();
    expect(context.hookSpecificOutput.additionalContext).toContain("成熟作品");
    const payload = { task: "TEST ONLY capability trial", summary: "Compared two methods", outcome: "partial", capability_trials: [{ gap: "Current hook command does not launch", candidate: "Windows command override", sources: ["https://learn.chatgpt.com/docs/hooks"], baseline: "No observed callback", trial_result: "Three callbacks observed", decision: "adopt", integration: "Isolated fixture only", evidence: "events.jsonl" }] };
    const result = f.pilot.control("report", "test-session", "turn-one", payload);
    expect(result.report.findings[0]).toContain("缺口");
    expect(result.report.findings[0]).toContain("实际价值：未知");
    expect(result.report.knowledge_used).toEqual([]);
    expect(() => f.pilot.control("report", "test-session", "turn-one", { ...payload, capability_trials: [{ candidate: "Untried tool" }] })).toThrow();
  });

  it("does not retry a generic error that lacks the declared regression failure marker", async () => {
    const f = fixture(); await f.prompt();
    f.arm([{ name: "dependency absent", program: process.execPath, args: ["-e", "console.error('module unavailable'); process.exit(1)"] }]);
    expect(await f.pilot.handle(f.event("Stop"))).toEqual({});
  });

  it("rejects shell wrappers that could hide earlier failures behind a later exit code", async () => {
    const f = fixture(); await f.prompt();
    expect(() => f.arm([{ name: "masked failure", program: join(f.home, "pwsh.exe"), args: ["-Command", "bad-check; good-check"] }])).toThrow("validator directly");
  });
});
