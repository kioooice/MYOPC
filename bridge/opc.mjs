#!/usr/bin/env node
// OPC Bridge：Codex 在开发任务里自动调用的两个命令（context / result）。
// 只依赖 Node 内置模块；任何失败都返回可解析的 JSON 且退出码为 0，绝不阻塞开发任务。
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SERVER = "http://127.0.0.1:3000";
const HELP = `OPC Bridge

  opc context --task "任务描述"
  opc result  --task "任务描述" --outcome success --change "..." --validation "..." --finding "..." --knowledge-used id1,id2
  opc context --stdin        # 从 stdin 读取完整 JSON（{"repository":...,"task":...}）
  opc result  --stdin        # 从 stdin 读取完整 JSON
  opc doctor                 # 查看配置、仓库识别与服务器连通性

配置文件：%LOCALAPPDATA%\\OPC\\config.json；日志：%LOCALAPPDATA%\\OPC\\logs\\opc.jsonl。
环境变量 OPC_SERVER、OPC_USERNAME、OPC_PASSWORD、OPC_HOME、OPC_ENABLED 会覆盖配置文件。
`;

export function opcHome() {
  const override = process.env.OPC_HOME?.trim();
  if (override) return resolve(override);
  const local = process.env.LOCALAPPDATA?.trim();
  return local ? join(local, "OPC") : join(homedir(), ".opc");
}

export function configPath() {
  return join(opcHome(), "config.json");
}

export function loadConfig() {
  const defaults = { serverUrl: DEFAULT_SERVER, auth: { username: "", password: "" }, timeoutMs: 60000, cacheMinutes: 10, enabled: true };
  let stored = {};
  try { stored = JSON.parse(readFileSync(configPath(), "utf8")); } catch { stored = {}; }
  const config = { ...defaults, ...stored, auth: { ...defaults.auth, ...(stored.auth || {}) } };
  if (process.env.OPC_SERVER?.trim()) config.serverUrl = process.env.OPC_SERVER.trim();
  if (process.env.OPC_USERNAME?.trim()) config.auth.username = process.env.OPC_USERNAME.trim();
  if (process.env.OPC_PASSWORD !== undefined) config.auth.password = process.env.OPC_PASSWORD;
  if (process.env.OPC_ENABLED !== undefined) config.enabled = process.env.OPC_ENABLED !== "false" && process.env.OPC_ENABLED !== "0";
  return config;
}

export function repositoryFromRemote(remote) {
  const value = String(remote || "").trim();
  if (!value) return "";
  const patterns = [
    /^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/,
    /^ssh:\/\/git@[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/,
    /^https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match) return `${match[1]}/${match[2].replace(/\.git$/, "")}`;
  }
  return "";
}

export function resolveRepository(cwd = process.cwd()) {
  try {
    const remote = execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const repository = repositoryFromRemote(remote);
    if (repository) return repository;
  } catch { /* 没有 git 或没有 origin 时回落到目录名 */ }
  try {
    const top = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (top) return top.split(/[\\/]/).filter(Boolean).pop() || "";
  } catch { /* 不是 git 仓库 */ }
  return "";
}

export function parseArgs(argv) {
  const [command = "", ...rest] = argv;
  const flags = {};
  const multi = { change: [], validation: [], finding: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "stdin" || key === "force" || key === "help" || key === "version" || key === "json") { flags[key] = true; continue; }
    const next = rest[index + 1];
    const value = next !== undefined && !next.startsWith("--") ? rest[++index] : "";
    if (key === "change" || key === "validation" || key === "finding") multi[key].push(value);
    else flags[key] = value;
  }
  return { command, flags, multi };
}

function log(entry) {
  try {
    const directory = join(opcHome(), "logs");
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, "opc.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, "utf8");
  } catch { /* 日志失败不影响开发 */ }
}

function cacheFile() {
  const directory = join(opcHome(), "cache");
  mkdirSync(directory, { recursive: true });
  return join(directory, "context.json");
}

function cacheKey(repository, task) {
  return createHash("sha256").update(`${repository}|${String(task).replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 24);
}

function readCache(repository, task, ttlMinutes) {
  if (!(ttlMinutes > 0)) return null;
  try {
    const store = JSON.parse(readFileSync(cacheFile(), "utf8"));
    const entry = store[cacheKey(repository, task)];
    if (!entry) return null;
    if (Date.now() - new Date(entry.at).getTime() > ttlMinutes * 60 * 1000) return null;
    return entry.result;
  } catch { return null; }
}

function writeCache(repository, task, result) {
  try {
    const file = cacheFile();
    const store = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) || {} : {};
    store[cacheKey(repository, task)] = { at: new Date().toISOString(), result };
    writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(store).slice(-50))), "utf8");
  } catch { /* 缓存失败不影响开发 */ }
}

async function postJson(config, path, body) {
  const url = `${String(config.serverUrl).replace(/\/+$/, "")}${path}`;
  const headers = { "content-type": "application/json" };
  if (config.auth?.username) headers.authorization = `Basic ${Buffer.from(`${config.auth.username}:${config.auth.password ?? ""}`).toString("base64")}`;
  const timeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : 60000;
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.message || `OPC 返回 HTTP ${response.status}`);
  if (!payload) throw new Error("OPC 返回的不是 JSON");
  return payload;
}

function readStdin() {
  return new Promise((resolvePromise, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => {
      try { resolvePromise(data.trim() ? JSON.parse(data) : {}); }
      catch { reject(new Error("stdin 不是有效 JSON")); }
    });
    process.stdin.on("error", reject);
  });
}

export async function runContext({ flags, config, cwd = process.cwd() }) {
  const payload = flags.stdin ? await readStdin() : {};
  const repository = flags.repo || payload.repository || resolveRepository(cwd);
  const task = flags.task || payload.task || "";
  if (!config.enabled) return { used: false, reason: "bridge_disabled" };
  if (!task) return { used: false, reason: "task_required" };
  if (flags.force !== true) {
    const cached = readCache(repository, task, Number(config.cacheMinutes));
    if (cached) return { ...cached, cached: true };
  }
  const result = await postJson(config, "/api/v1/agent/context", { repository, task, force: flags.force === true });
  writeCache(repository, task, result);
  return result;
}

export async function runResult({ flags, multi, config, cwd = process.cwd() }) {
  const payload = flags.stdin ? await readStdin() : {};
  const body = {
    repository: flags.repo || payload.repository || resolveRepository(cwd),
    task: flags.task || payload.task || "",
    outcome: flags.outcome || payload.outcome || "success",
    changes: multi.change.length > 0 ? multi.change : payload.changes || [],
    validation: multi.validation.length > 0 ? multi.validation : payload.validation || [],
    findings: multi.finding.length > 0 ? multi.finding : payload.findings || [],
    knowledge_used: flags["knowledge-used"] ? String(flags["knowledge-used"]).split(",").map((item) => item.trim()).filter(Boolean) : payload.knowledge_used || [],
    knowledge_effectiveness: payload.knowledge_effectiveness || [],
  };
  if (!body.task) return { saved: false, reason: "task_required" };
  const result = await postJson(config, "/api/v1/agent/result", body);
  if (body.repository && body.task) writeCache(body.repository, body.task, { used: false, reason: "result_submitted" });
  return result;
}

async function runDoctor(config) {
  const repository = resolveRepository(process.cwd());
  let reachable = false;
  let detail = "";
  try {
    const headers = {};
    if (config.auth?.username) headers.authorization = `Basic ${Buffer.from(`${config.auth.username}:${config.auth.password ?? ""}`).toString("base64")}`;
    const response = await fetch(`${String(config.serverUrl).replace(/\/+$/, "")}/api/v1/health`, { headers, signal: AbortSignal.timeout(5000) });
    reachable = response.ok;
    detail = reachable ? await response.text() : `HTTP ${response.status}`;
  } catch (error) {
    detail = error instanceof Error ? error.message : "请求失败";
  }
  return { home: opcHome(), config: configPath(), serverUrl: config.serverUrl, auth: config.auth?.username ? "username+password" : "none", enabled: config.enabled, repository, reachable, detail };
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const { command, flags, multi } = parseArgs(argv);
  if (!command || command === "help" || flags.help) { process.stdout.write(HELP); return 0; }
  if (command === "version" || flags.version) { process.stdout.write("opc-bridge 0.1.0\n"); return 0; }
  const config = loadConfig();
  const started = Date.now();
  const contextFallback = (reason, message) => ({ used: false, reason, ...(message ? { message } : {}) });
  try {
    if (command === "context") {
      const result = await runContext({ flags, config, cwd });
      log({ command, ok: true, repository: resolveRepository(cwd), used: result.used === true, reason: result.reason ?? null, items: Array.isArray(result.items) ? result.items.length : 0, cached: result.cached === true, durationMs: Date.now() - started, id: randomUUID() });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (command === "result") {
      const result = await runResult({ flags, multi, config, cwd });
      log({ command, ok: result.saved === true, repository: resolveRepository(cwd), saved: result.saved === true, candidates: Array.isArray(result.candidates) ? result.candidates.length : 0, durationMs: Date.now() - started, id: randomUUID() });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (command === "doctor") {
      process.stdout.write(`${JSON.stringify(await runDoctor(config))}\n`);
      return 0;
    }
    process.stdout.write(`${JSON.stringify(contextFallback("unknown_command", `未知命令：${command}`))}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "OPC Bridge 调用失败";
    log({ command, ok: false, message, durationMs: Date.now() - started, id: randomUUID() });
    const fallback = command === "result" ? { saved: false, reason: "bridge_error", message } : contextFallback("bridge_error", message);
    process.stdout.write(`${JSON.stringify(fallback)}\n`);
    return 0;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; });
}
