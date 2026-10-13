#!/usr/bin/env node
// Native CLI conformance / paired fixtures. All artifacts live outside MYOPC.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { opcHome } from "./opc.mjs";
import { hookDefinitions } from "./opc-hooks.mjs";

const argv = process.argv.slice(2);
const option = name => argv[argv.indexOf(`--${name}`) + 1];
if (!argv.includes("--codex") || !argv.includes("--case")) throw new Error("--codex <executable> --case probe|discussion|fix|repair|knowledge|learn [--hooks] required");
const withHooks = argv.includes("--hooks");
const name = option("case");
const home = resolve(argv.includes("--home") ? option("home") : join(opcHome(), "hooks", "validation", `${Date.now()}-${name}-${withHooks ? "hooks" : "baseline"}`));
if (existsSync(home)) throw new Error("Validation requires a new empty directory");
const cwd = join(home, "fixture");
mkdirSync(cwd, { recursive: true });
const bin = join(home, "bin");
mkdirSync(bin);
for (const file of ["opc.mjs", "opc-hooks.mjs"]) copyFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), join(bin, file));
const script = join(bin, "opc-hooks.mjs");
writeFileSync(join(home, "pilot.json"), JSON.stringify({ scopes: [{ root: cwd, repository: "kioooice/MYOPC", mode: name === "probe" ? "probe" : "active" }] }, null, 2));
writeFileSync(join(cwd, "AGENTS.md"), "This is a synthetic MYOPC hook validation fixture. Do not write to production OPC or modify files outside this fixture except this fixture's hook runtime. No commits, deployment, messages, or subagents. If using historical OPC context, read only.\n");
writeFileSync(join(cwd, "normalize.mjs"), "export const normalize = value => value.toLowerCase();\n");
writeFileSync(join(cwd, "check.mjs"), "import assert from 'node:assert/strict'; import {normalize} from './normalize.mjs'; assert.equal(normalize(' Hello '), 'hello'); console.log('PASS');\n");
writeFileSync(join(cwd, "probe.mjs"), "console.log('OPC_HOOK_PROBE_OK');\n");
if (name === "learn") writeFileSync(join(cwd, "normalize.mjs"), "export const normalize = value => value.trim().toLowerCase();\n");
const check = { name: "normalize regression", program: process.execPath, args: ["check.mjs"], failureContains: "ERR_ASSERTION" };
const prompts = {
  probe: "只运行 node probe.mjs，报告真实输出与退出码，然后结束。不要修改文件。",
  discussion: "只讨论：代码测试失败之后，如何区分应该继续修复和需要停止的情况？不执行、不修改、不登记执行任务。",
  fix: "修复 normalize.mjs：normalize(' Hello ') 应返回 'hello'。运行 node check.mjs 验证，完成后报告结果。只改这个实现；不要写生产 OPC。",
  repair: `这是人工设置的原生 Stop 协议测试，不用于证明实际自主性提升。明确授权：首次回答登记获准执行任务，运行 node check.mjs 后报告失败并结束首次回答，首次不修代码；如果 Stop 提供一次续行，再修复 normalize.mjs 的 trim 缺失并运行同一检查。最多一次补修，不重新登记续行契约。用 Hook 上下文的 session/turn 调用 node "${script}" arm --home "${home}" --session <session> --turn <turn>，stdin JSON 为 ${JSON.stringify({ task: "TEST ONLY: native Stop once repair", mode: "execution", authorized: true, authorization_source: "native-conformance-fixture-user-prompt", allowRepair: true, checks: [check] })}。不要写生产 OPC。`,
  knowledge: "这是只读的历史方法复用检验：为 MYOPC 的有限自动补修方案取用现有 OPC 方法，说明具体条目 id，以及它会怎样改变一次实现选择和验证行动。需要区分检索命中、实际采用和效果未知。不改文件，不写生产记录。",
  learn: "完善这个夹具的可复用检验能力：现有 check.mjs 只有一个断言，不能单独显示多种输入的结果。自行判断能力缺口，研究外部成熟方法，核对官方来源，比较现有方法与候选方法，在此目录完成小规模试用，选择是否接入。小试限定3到5个用例、最多两份官方页面；保留故障诊断，不用复合命令最后一项的退出码替代每项验证。不要改 normalize.mjs，不需付费或修改全局环境。交付可运行的多用例验证和 trial.md，记录缺口、候选/来源、基线、试用结果、采用或暂缓理由、实际接入和未证明的价值。本轮是合成能力扩展检验，不是视频质量验收，不写生产 OPC；可使用 report 生成本地过程载荷。",
};
if (!prompts[name]) throw new Error("Unknown case");
const definitions = hookDefinitions(script, home);
const hooksToml = Object.entries(definitions.hooks).map(([event, groups]) => [`hooks.${event}=[{hooks=[{type="command",command=${JSON.stringify(groups[0].hooks[0].command)},commandWindows=${JSON.stringify(groups[0].hooks[0].commandWindows)},timeout=${groups[0].hooks[0].timeout}}]}]`]);
const args = ["exec", "--ephemeral", "--json", "--skip-git-repo-check", "--cd", cwd, "--sandbox", "danger-full-access", "-c", 'approval_policy="never"'];
if (withHooks) {
  // Explicitly reviewed per-invocation definitions, never persisted trust bypass.
  if (!argv.includes("--require-trust")) args.push("--dangerously-bypass-hook-trust");
  for (const [setting] of hooksToml) args.push("-c", setting);
} else args.push("--disable", "hooks");
args.push("-");
writeFileSync(join(home, "definitions.review.json"), JSON.stringify(definitions, null, 2));
const digest = createHash("sha256").update(readFileSync(script)).digest("hex");
writeFileSync(join(home, "run.json"), JSON.stringify({ case: name, hooks: withHooks, executable: option("codex"), version: execFileSync(option("codex"), ["--version"], { encoding: "utf8", windowsHide: true }).trim(), script_sha256: digest, fixture: cwd, test_only: true, prompt: prompts[name] }, null, 2));
console.log(JSON.stringify({ started: true, case: name, hooks: withHooks, home }));
const child = spawn(option("codex"), args, { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
let stdout = "", stderr = "", timedOut = false;
child.stdout.on("data", chunk => { stdout += chunk; });
child.stderr.on("data", chunk => { stderr += chunk; });
child.stdin.end(prompts[name]);
const timeout = setTimeout(() => { timedOut = true; child.kill(); }, name === "learn" ? 600000 : 240000);
child.on("error", error => { clearTimeout(timeout); console.error(error.message); process.exitCode = 1; });
child.on("close", code => {
  clearTimeout(timeout);
  writeFileSync(join(home, "native.jsonl"), stdout);
  writeFileSync(join(home, "native.stderr.txt"), stderr);
  const result = { code, timed_out: timedOut, case: name, hooks: withHooks, home, final_implementation: readFileSync(join(cwd, "normalize.mjs"), "utf8"), native_lines: stdout.split("\n").filter(Boolean).length };
  writeFileSync(join(home, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  process.exitCode = code ?? 1;
});
