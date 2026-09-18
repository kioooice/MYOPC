#!/usr/bin/env node
// OPC Bridge：Codex 在开发任务里自动调用的命令（context / result / bootstrap / candidates / workspace）。
// 只依赖 Node 内置模块；任何失败都返回可解析的 JSON 且退出码为 0，绝不阻塞开发任务。
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir, hostname } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SERVER = "http://127.0.0.1:3000";
/** 待重传队列：每条最多重试 20 次，每次命令最多补发 3 条，不无限重试也不阻断当前任务。 */
const MAX_QUEUE_ATTEMPTS = 20;
const QUEUE_FLUSH_LIMIT = 3;
const HELP = `OPC Bridge

  opc context --task "任务描述"
  opc bootstrap [--task "当前任务"] [--force]
  opc result  --task "任务描述" --outcome success --change "..." --validation "..." --finding "..." --knowledge-used id1,id2
  opc result  --task "任务描述" --event decision --title "..." --content "..." --rationale "..." --evidence "commit:abc1234"
  opc result  --event progress --title "..." --content "..." --verification "pnpm test 通过" --status verified --next "下一步"
  opc result  --event environment --title "..." --content "本机 runtime 已选择" --verification "hypit paths 显示本地 profile" --status verified
  opc result  --event blocker --title "..." --content "..." --next "需要人工确认"
  opc candidates                                  # 查看待整理候选经验
  opc candidates --id cand-x --status merged --note "已合并到 safe-deploy" --entry safe-deploy --commit abc1234
  opc workspace --action subjects [--board media]
  opc workspace --action subject --id <subject-id>
  opc workspace --action create|update|record|context --stdin [--request-id <id>]
  opc workspace --action record-detail --id <record-id>
  opc workspace --action export --id <subject-id>|--all
  opc context --stdin / opc result --stdin / opc bootstrap --stdin   # 从 stdin 读取完整 JSON
  opc doctor

事件类型：plan / progress / decision / environment / finding / blocker
事件状态：planned / reported / verified / blocked（不写时按类型推断；verified 需要 --verification 或 --evidence）
候选处置：merged（已合并）/ added（已新增）/ hold（暂存）/ discarded（舍弃）
配置文件：%LOCALAPPDATA%\\OPC\\config.json；日志：%LOCALAPPDATA%\\OPC\\logs\\opc.jsonl；待重传队列：%LOCALAPPDATA%\\OPC\\queue\\pending.jsonl。
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
  const defaults = { serverUrl: DEFAULT_SERVER, auth: { username: "", password: "" }, timeoutMs: 60000, cacheMinutes: 10, enabled: true, machine: "", projects: {} };
  let stored = {};
  try { stored = JSON.parse(readFileSync(configPath(), "utf8")); } catch { stored = {}; }
  const config = { ...defaults, ...stored, auth: { ...defaults.auth, ...(stored.auth || {}) }, projects: { ...(stored.projects || {}) } };
  if (process.env.OPC_SERVER?.trim()) config.serverUrl = process.env.OPC_SERVER.trim();
  if (process.env.OPC_USERNAME?.trim()) config.auth.username = process.env.OPC_USERNAME.trim();
  if (process.env.OPC_PASSWORD !== undefined) config.auth.password = process.env.OPC_PASSWORD;
  if (process.env.OPC_ENABLED !== undefined) config.enabled = process.env.OPC_ENABLED !== "false" && process.env.OPC_ENABLED !== "0";
  return config;
}

/** 机器身份只放在全局 OPC 目录，不写进业务仓库；同一台机器重复调用得到同一个 id。 */
export function machineIdentity(config = {}) {
  const configured = String(config.machine || "").trim();
  if (configured) return configured;
  const file = join(opcHome(), "machine.json");
  try {
    const stored = JSON.parse(readFileSync(file, "utf8"));
    if (stored?.id) return String(stored.id);
  } catch { /* 首次运行时没有 machine.json */ }
  const id = hostname().trim() || "unknown-machine";
  try {
    mkdirSync(opcHome(), { recursive: true });
    writeFileSync(file, JSON.stringify({ id, hostname: hostname(), createdAt: new Date().toISOString() }, null, 2), "utf8");
  } catch { /* 写不了也不影响调用 */ }
  return id;
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

/** 目录归一化：解析成绝对路径、去掉结尾分隔符、Windows 下大小写不敏感。 */
function normalizeDirectory(value) {
  const resolved = resolve(String(value)).replace(/[\\/]+$/, "");
  return resolved.toLowerCase();
}

/** 目录边界判断：等于该目录，或位于它下面；D:\a\video-other 不算 D:\a\video 的子目录。 */
export function isWithinDirectory(target, base) {
  if (!target || !base) return false;
  if (target === base) return true;
  return target.startsWith(base + "\\") || target.startsWith(base + "/");
}

function configuredRepository(cwd, config) {
  const projects = config?.projects && typeof config.projects === "object" ? config.projects : {};
  const target = normalizeDirectory(cwd);
  let best = "";
  let bestLength = -1;
  for (const [path, repository] of Object.entries(projects)) {
    const candidate = normalizeDirectory(path);
    if (!isWithinDirectory(target, candidate)) continue;
    if (candidate.length > bestLength) { best = String(repository); bestLength = candidate.length; }
  }
  return best;
}

/** 仓库标识：先看 config.projects 里的本机路径映射，再读 git remote，最后回落到目录名。 */
export function resolveRepository(cwd = process.cwd(), config = {}) {
  const mapped = configuredRepository(cwd, config);
  if (mapped) return mapped;
  try {
    const remote = execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const repository = repositoryFromRemote(remote);
    if (repository) return repository;
  } catch { /* 没有 git 或没有 origin 时继续回落 */ }
  try {
    const top = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (top) return top.split(/[\\/]/).filter(Boolean).pop() || "";
  } catch { /* 不是 git 仓库 */ }
  return basename(resolve(cwd)) || "";
}

function gitValue(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return ""; }
}

/** 分支、提交和未提交改动只作为标记上传，不传 diff 内容。 */
export function gitContext(cwd = process.cwd()) {
  const branch = gitValue(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = gitValue(cwd, ["rev-parse", "HEAD"]);
  const status = gitValue(cwd, ["status", "--porcelain"]);
  return {
    branch: branch && branch !== "HEAD" ? branch : "",
    commit: commit || "",
    dirty: Boolean(status),
  };
}

const SECRET_RULES = [
  [/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, () => "[已脱敏:私钥]"],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, () => "[已脱敏:密钥]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, () => "[已脱敏:令牌]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, () => "Bearer [已脱敏]"],
  [/(^|[^A-Za-z0-9_])([A-Za-z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?KEY|SECRET[_-]?KEY|CLIENT[_-]?SECRET|PASSWORD|PASSWD|TOKEN)[A-Za-z0-9_]*)\s*[:=]\s*["']?([^\s"'，。；;]{6,})/gi,
    (match, ...groups) => `${groups[0] ?? ""}${groups[1] ?? ""}=[已脱敏]`],
  [/\bhttps?:\/\/[^\s/:@]+:[^\s/@]+@[^\s]+/gi, () => "[已脱敏:带凭据链接]"],
];

/** 疑似凭据在本地就替换掉：上传载荷里不出现密钥、令牌和密码原文。 */
export function redactSecrets(value) {
  let text = typeof value === "string" ? value : "";
  let redacted = 0;
  for (const [pattern, build] of SECRET_RULES) {
    text = text.replace(pattern, (...args) => {
      redacted += 1;
      return build(...args);
    });
  }
  return { text, redacted };
}

function redactEvent(event) {
  const output = { ...event };
  let redacted = 0;
  for (const field of ["topic", "title", "content", "rationale", "verification", "next_step"]) {
    const result = redactSecrets(String(output[field] ?? ""));
    redacted += result.redacted;
    output[field] = result.text;
  }
  output.evidence = (Array.isArray(event.evidence) ? event.evidence : []).map((item) => {
    const result = redactSecrets(String(item));
    redacted += result.redacted;
    return result.text;
  });
  return { event: output, redacted };
}

const EVENT_FIELDS = new Set(["topic", "title", "content", "rationale", "status", "verification", "evidence", "next", "supersedes", "occurred-at"]);

export function parseArgs(argv) {
  const [command = "", ...rest] = argv;
  const flags = {};
  const multi = { change: [], validation: [], finding: [] };
  const events = [];
  let currentEvent = null;
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "stdin" || key === "force" || key === "help" || key === "version" || key === "json" || key === "dirty") { flags[key] = true; continue; }
    const next = rest[index + 1];
    const value = next !== undefined && !next.startsWith("--") ? rest[++index] : "";
    if (key === "event") {
      currentEvent = { type: value || "progress", evidence: [] };
      events.push(currentEvent);
      continue;
    }
    if (currentEvent && EVENT_FIELDS.has(key)) {
      if (key === "evidence") currentEvent.evidence.push(value);
      else if (key === "next") currentEvent.next = value;
      else if (key === "occurred-at") currentEvent.occurredAt = value;
      else currentEvent[key] = value;
      continue;
    }
    if (key === "change" || key === "validation" || key === "finding") multi[key].push(value);
    else flags[key] = value;
  }
  return { command, flags, multi, events };
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

function bootstrapCacheFile() {
  const directory = join(opcHome(), "cache");
  mkdirSync(directory, { recursive: true });
  return join(directory, "bootstrap.json");
}

function bootstrapCacheKey(repository, branch, machine, commit, limit) {
  // 当前提交与 limit 会改变返回结果（版本提示、最近记录条数），必须参与缓存键，
  // 否则分支不变、提交变了的时候会拿到旧的恢复摘要。
  return createHash("sha256").update(`${repository}|${branch || ""}|${machine || ""}|${commit || ""}|${limit || ""}`).digest("hex").slice(0, 24);
}

function readBootstrapCache(repository, branch, machine, commit, limit, ttlMinutes) {
  if (!(ttlMinutes > 0)) return null;
  try {
    const store = JSON.parse(readFileSync(bootstrapCacheFile(), "utf8"));
    const entry = store[bootstrapCacheKey(repository, branch, machine, commit, limit)];
    if (!entry) return null;
    if (Date.now() - new Date(entry.at).getTime() > ttlMinutes * 60 * 1000) return null;
    return entry.result;
  } catch { return null; }
}

function writeBootstrapCache(repository, branch, machine, commit, limit, result) {
  try {
    const file = bootstrapCacheFile();
    const store = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) || {} : {};
    store[bootstrapCacheKey(repository, branch, machine, commit, limit)] = { at: new Date().toISOString(), repository, commit: commit || null, result };
    writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(store).slice(-20))), "utf8");
  } catch { /* 缓存失败不影响开发 */ }
}

/** 回流之后清掉这个仓库的恢复缓存，下一次 bootstrap 读到的不是旧状态。 */
export function clearBootstrapCache(repository) {
  try {
    const file = bootstrapCacheFile();
    if (!existsSync(file)) return;
    const store = JSON.parse(readFileSync(file, "utf8")) || {};
    const kept = Object.fromEntries(Object.entries(store).filter(([, entry]) => entry?.repository !== repository));
    writeFileSync(file, JSON.stringify(kept), "utf8");
  } catch { /* 缓存失败不影响开发 */ }
}

function authHeaders(config, extra = {}) {
  const headers = { "content-type": "application/json" };
  if (config.auth?.username) headers.authorization = `Basic ${Buffer.from(`${config.auth.username}:${config.auth.password ?? ""}`).toString("base64")}`;
  return { ...headers, ...extra };
}

export class BridgeHttpError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "BridgeHttpError";
    this.status = status;
    this.payload = payload;
  }
}

async function requestJson(config, method, path, body, options = {}) {
  const url = `${String(config.serverUrl).replace(/\/+$/, "")}${path}`;
  const timeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : 60000;
  const headers = { ...(options.requestId ? { "x-client-request-id": String(options.requestId) } : {}), ...(options.headers || {}) };
  const response = await fetch(url, { method, headers: authHeaders(config, headers), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = null; }
  if (!response.ok) throw new BridgeHttpError(payload?.message || `OPC 返回 HTTP ${response.status}`, response.status, payload);
  if (!payload) throw new Error("OPC 返回的不是 JSON");
  return payload;
}

function postJson(config, path, body, options = {}) {
  return requestJson(config, "POST", path, body, options);
}

function getJson(config, path) {
  return requestJson(config, "GET", path, undefined);
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

function queueFile() {
  const directory = join(opcHome(), "queue");
  mkdirSync(directory, { recursive: true });
  return join(directory, "pending.jsonl");
}

export function readQueue() {
  try {
    return readFileSync(queueFile(), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch { return []; }
}

function writeQueue(items) {
  try {
    writeFileSync(queueFile(), items.length > 0 ? `${items.map((item) => JSON.stringify(item)).join("\n")}\n` : "", "utf8");
  } catch { /* 队列写不了也不影响当前任务 */ }
}

function enqueuePending(item) {
  const items = readQueue().filter((existing) => existing.submissionId !== item.submissionId);
  items.push(item);
  writeQueue(items.slice(-50));
  return items.length;
}

/** 补发失败的待重传记录：每次最多 3 条，超过 20 次的不再重试，也不阻断当前任务。 */
export async function flushPending(config) {
  const items = readQueue();
  if (items.length === 0) return { sent: 0, remaining: 0, skipped: 0 };
  const remaining = [];
  let sent = 0;
  let attempted = 0;
  let skipped = 0;
  for (const item of items) {
    if (item.blocked || (item.attempts || 0) >= MAX_QUEUE_ATTEMPTS || attempted >= QUEUE_FLUSH_LIMIT) {
      remaining.push(item);
      if (item.blocked || (item.attempts || 0) >= MAX_QUEUE_ATTEMPTS) skipped += 1;
      continue;
    }
    attempted += 1;
    try {
      await requestJson(config, item.method || "POST", item.path, item.body, { requestId: item.requestId });
      sent += 1;
      // 补发成功后，这个项目的恢复摘要已经过期，清掉缓存让下一次 bootstrap 重新取。
      if (item.path === "/api/v1/agent/result" && item.body?.repository) clearBootstrapCache(String(item.body.repository));
      log({ command: "queue.flush", ok: true, submissionId: item.submissionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "重传失败";
      if (error instanceof BridgeHttpError && error.status === 409) {
        remaining.push({ ...item, blocked: true, conflict: error.payload || null, lastError: message });
        skipped += 1;
      } else {
        remaining.push({ ...item, attempts: (item.attempts || 0) + 1, lastError: message });
      }
      log({ command: "queue.flush", ok: false, submissionId: item.submissionId, message });
    }
  }
  writeQueue(remaining);
  return { sent, remaining: remaining.length, skipped };
}

function redactWorkspaceValue(value) {
  if (typeof value === "string") return redactSecrets(value).text;
  if (Array.isArray(value)) return value.map(redactWorkspaceValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactWorkspaceValue(item)]));
  return value;
}

function workspaceErrorResult(error, requestId) {
  if (error instanceof BridgeHttpError) {
    const conflict = error.status === 409;
    return {
      saved: false,
      queued: false,
      reason: conflict ? "conflict" : "http_error",
      status: error.status,
      error: error.payload?.error || (conflict ? "conflict" : "bridge_http_error"),
      message: error.message,
      details: error.payload?.details,
      requestId,
    };
  }
  return { saved: false, queued: true, reason: "bridge_error", requestId, message: error instanceof Error ? error.message : "OPC Bridge 调用失败" };
}

async function workspaceWrite(config, method, path, body, requestId) {
  const id = String(requestId || randomUUID());
  const safeBody = redactWorkspaceValue(body);
  try {
    const result = await requestJson(config, method, path, safeBody, { requestId: id });
    return { ...result, saved: true, queued: false, requestId: id };
  } catch (error) {
    if (error instanceof BridgeHttpError && error.status >= 400 && error.status < 500) return workspaceErrorResult(error, id);
    const message = error instanceof Error ? error.message : "OPC Bridge 调用失败";
    enqueuePending({ submissionId: id, requestId: id, method, path, body: safeBody, attempts: 1, queuedAt: new Date().toISOString(), lastError: message });
    return { saved: false, queued: true, reason: "bridge_error", requestId: id, message };
  }
}

async function workspaceRead(config, method, path, body) {
  try {
    return await requestJson(config, method, path, body);
  } catch (error) {
    if (error instanceof BridgeHttpError) return workspaceErrorResult(error);
    return { used: false, saved: false, queued: false, reason: "bridge_error", message: error instanceof Error ? error.message : "OPC Bridge 调用失败" };
  }
}

/** workspace 命令族：读操作不缓存；写操作使用 X-Client-Request-Id 并把网络失败完整入队。 */
export async function runWorkspace({ flags = {}, config, cwd = process.cwd() }) {
  if (!config.enabled) return { used: false, saved: false, queued: false, reason: "bridge_disabled", message: "OPC 总开关已关闭，未读写服务器" };
  const action = String(flags.action || "").trim();
  if (!action) return { used: false, saved: false, queued: false, reason: "workspace_action_required", message: "workspace需要 --action" };
  const rawPayload = flags.stdin ? await readStdin() : {};
  const payload = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload) ? rawPayload : {};
  const id = flags.id || payload.id || payload.subject_id || payload.record_id || "";
  const requestId = flags["request-id"] || payload.request_id || payload.client_request_id || randomUUID();
  const query = new URLSearchParams();
  if (flags.board) query.set("board", String(flags.board));
  if (flags.status) query.set("status", String(flags.status));
  if (flags.q) query.set("q", String(flags.q));
  if (flags.subject) query.set("subject_id", String(flags.subject));
  if (flags.all !== undefined) query.set("all", "true");
  if (action === "subjects") return workspaceRead(config, "GET", `/api/v1/workspace/subjects${query.toString() ? `?${query}` : ""}`);
  if (action === "subject") {
    if (!id) return { used: false, saved: false, queued: false, reason: "subject_id_required" };
    return workspaceRead(config, "GET", `/api/v1/workspace/subjects/${encodeURIComponent(String(id))}`);
  }
  if (action === "create") return workspaceWrite(config, "POST", "/api/v1/workspace/subjects", payload, requestId);
  if (action === "update") {
    if (!id) return { used: false, saved: false, queued: false, reason: "subject_id_required" };
    return workspaceWrite(config, "PATCH", `/api/v1/workspace/subjects/${encodeURIComponent(String(id))}`, payload, requestId);
  }
  if (action === "record") return workspaceWrite(config, "POST", "/api/v1/workspace/records", payload, requestId);
  if (action === "record-detail") {
    if (!id) return { used: false, saved: false, queued: false, reason: "record_id_required" };
    return workspaceRead(config, "GET", `/api/v1/workspace/records/${encodeURIComponent(String(id))}`);
  }
  if (action === "context") return workspaceRead(config, "POST", "/api/v1/workspace/context", redactWorkspaceValue(payload));
  if (action === "export") {
    if (id && !query.has("subject_id")) query.set("subject_id", String(id));
    return workspaceRead(config, "GET", `/api/v1/workspace/export${query.toString() ? `?${query}` : ""}`);
  }
  return { used: false, saved: false, queued: false, reason: "workspace_action_invalid", message: `未知 workspace action：${action}` };
}

function eventPayloads(events, context) {
  let redacted = 0;
  const payloads = [];
  for (const event of Array.isArray(events) ? events : []) {
    const base = {
      event_type: event.event_type || event.type || "progress",
      topic: event.topic || "",
      title: event.title || "",
      content: event.content || "",
      rationale: event.rationale || "",
      status: event.status || "",
      verification: event.verification || "",
      evidence: Array.isArray(event.evidence) ? event.evidence : [],
      next_step: event.next_step || event.next || "",
      supersedes: event.supersedes || event.supersedes_id || "",
      occurred_at: event.occurred_at || event.occurredAt || "",
      machine: event.machine || context.machine || "",
      branch: event.branch || context.branch || "",
      commit: event.commit || context.commit || "",
      dirty: event.dirty ?? context.dirty ?? false,
    };
    const result = redactEvent(base);
    redacted += result.redacted;
    payloads.push(result.event);
    if (payloads.length >= 20) break;
  }
  return { payloads, redacted };
}

export async function runContext({ flags, config, cwd = process.cwd() }) {
  const payload = flags.stdin ? await readStdin() : {};
  const repository = flags.repo || payload.repository || resolveRepository(cwd, config);
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

export async function runResult({ flags, multi, events = [], config, cwd = process.cwd() }) {
  // 总开关关闭时：不请求服务器，也不把这次回流放进待上传队列。
  if (!config.enabled) return { saved: false, reason: "bridge_disabled", queued: false, message: "OPC 总开关已关闭，未读写服务器" };
  const payload = flags.stdin ? await readStdin() : {};
  const git = gitContext(cwd);
  const repository = flags.repo || payload.repository || resolveRepository(cwd, config);
  const machine = flags.machine || payload.machine || machineIdentity(config);
  const context = {
    machine,
    branch: flags.branch || payload.branch || git.branch,
    commit: flags.commit || payload.commit || git.commit,
    dirty: payload.dirty !== undefined ? Boolean(payload.dirty) : git.dirty,
  };
  const fromFlags = eventPayloads(events, context);
  const fromPayload = eventPayloads(payload.events || [], context);
  const body = {
    repository,
    task: flags.task || payload.task || "",
    outcome: flags.outcome || payload.outcome || "success",
    changes: multi.change.length > 0 ? multi.change : payload.changes || [],
    validation: multi.validation.length > 0 ? multi.validation : payload.validation || [],
    findings: multi.finding.length > 0 ? multi.finding : payload.findings || [],
    knowledge_used: flags["knowledge-used"] ? String(flags["knowledge-used"]).split(",").map((item) => item.trim()).filter(Boolean) : payload.knowledge_used || [],
    knowledge_effectiveness: payload.knowledge_effectiveness || [],
    submission_id: flags["submission-id"] || payload.submission_id || randomUUID(),
    machine: context.machine,
    branch: context.branch,
    commit: context.commit,
    dirty: context.dirty,
    events: [...fromPayload.payloads, ...fromFlags.payloads].slice(0, 20),
    summary: flags.summary || payload.summary || "",
    candidates: payload.candidates || [],
  };
  if (!body.task && body.events.length > 0) body.task = String(body.events[0].title || body.events[0].content || "").slice(0, 120);
  if (!body.task) return { saved: false, reason: "task_required" };
  // 任务级字段同样在本地脱敏：上传载荷里不出现凭据原文。
  body.task = redactSecrets(String(body.task)).text;
  body.changes = body.changes.map((item) => redactSecrets(String(item)).text);
  body.validation = body.validation.map((item) => redactSecrets(String(item)).text);
  body.findings = body.findings.map((item) => redactSecrets(String(item)).text);
  body.summary = redactSecrets(String(body.summary || "")).text;
  body.candidates = (Array.isArray(body.candidates) ? body.candidates : []).map((candidate) => ({
    title: redactSecrets(String(candidate?.title ?? "")).text,
    summary: redactSecrets(String(candidate?.summary ?? "")).text,
    evidence: redactSecrets(String(candidate?.evidence ?? "")).text,
    suggestion: redactSecrets(String(candidate?.suggestion ?? "")).text,
    related_entry_ids: Array.isArray(candidate?.related_entry_ids) ? candidate.related_entry_ids : [],
  }));
  try {
    const result = await postJson(config, "/api/v1/agent/result", body);
    clearBootstrapCache(repository);
    if (body.repository && body.task) writeCache(body.repository, body.task, { used: false, reason: "result_submitted" });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "OPC Bridge 调用失败";
    const pending = body.events.length > 0 || body.changes.length > 0 || body.validation.length > 0 || body.findings.length > 0;
    if (pending) enqueuePending({ submissionId: body.submission_id, path: "/api/v1/agent/result", body, attempts: 1, queuedAt: new Date().toISOString(), lastError: message });
    return { saved: false, reason: "bridge_error", queued: pending, submissionId: body.submission_id, message };
  }
}

export async function runBootstrap({ flags, config, cwd = process.cwd() }) {
  const payload = flags.stdin ? await readStdin() : {};
  const git = gitContext(cwd);
  const repository = flags.repo || payload.repository || resolveRepository(cwd, config);
  const machine = flags.machine || payload.machine || machineIdentity(config);
  const branch = flags.branch || payload.branch || git.branch || "";
  const body = {
    repository,
    branch,
    commit: flags.commit || payload.commit || git.commit || "",
    dirty: payload.dirty !== undefined ? Boolean(payload.dirty) : git.dirty,
    machine,
    task: flags.task || payload.task || "",
    limit: Number(flags.limit || payload.limit || 8),
  };
  if (!config.enabled) return { used: false, reason: "bridge_disabled" };
  if (!repository) return { used: false, reason: "repository_unresolved", machine, branch: branch || null, message: "无法识别仓库；可在 %LOCALAPPDATA%\\OPC\\config.json 的 projects 里配置本机路径映射" };
  const force = flags.force === true || payload.force === true;
  if (!force) {
    const cached = readBootstrapCache(repository, branch, machine, body.commit, body.limit, Number(config.cacheMinutes));
    if (cached) return { ...cached, cached: true };
  }
  const result = await postJson(config, "/api/v1/agent/bootstrap", body);
  if (result?.used) writeBootstrapCache(repository, branch, machine, body.commit, body.limit, result);
  return result;
}

export async function runCandidates({ flags, config }) {
  if (!config.enabled) return { disabled: true, resolved: false, reason: "bridge_disabled", pending: [], resolvedCandidates: [], message: "OPC 总开关已关闭，未读写服务器" };
  if (flags.id && flags.status) {
    if (!flags.note) return { resolved: false, reason: "note_required", message: "处置候选经验需要 --note 说明理由" };
    return postJson(config, `/api/v1/knowledge/candidates/${encodeURIComponent(flags.id)}/resolve`, {
      status: flags.status,
      note: flags.note,
      entry_id: flags.entry || "",
      knowledge_commit: flags.commit || "",
    });
  }
  const overview = await getJson(config, "/api/v1/knowledge/reuse");
  return {
    counts: overview.counts,
    pending: (overview.candidates || []).map((item) => ({ id: item.id, title: item.title, repository: item.repository, suggestion: item.suggestion, createdAt: item.createdAt })),
    resolved: (overview.resolvedCandidates || []).map((item) => ({ id: item.id, title: item.title, status: item.status, note: item.note, entryId: item.entryId, knowledgeCommit: item.knowledgeCommit, resolvedAt: item.resolvedAt })),
    usage: "opc candidates --id cand-x --status merged|added|hold|discarded --note \"理由\" [--entry 条目 id] [--commit 知识仓库提交]",
  };
}

async function runDoctor(config) {
  const repository = resolveRepository(process.cwd(), config);
  const machine = machineIdentity(config);
  let reachable = false;
  let detail = "";
  if (!config.enabled) {
    detail = "bridge_disabled：总开关关闭，没有访问服务器";
  } else {
    try {
      const headers = authHeaders(config);
      const response = await fetch(`${String(config.serverUrl).replace(/\/+$/, "")}/api/v1/health`, { headers, signal: AbortSignal.timeout(5000) });
      reachable = response.ok;
      detail = reachable ? await response.text() : `HTTP ${response.status}`;
    } catch (error) {
      detail = error instanceof Error ? error.message : "请求失败";
    }
  }
  const queue = readQueue();
  return {
    home: opcHome(),
    config: configPath(),
    serverUrl: config.serverUrl,
    auth: config.auth?.username ? "username+password" : "none",
    enabled: config.enabled,
    machine,
    repository,
    queue: { pending: queue.length, attempts: queue.reduce((sum, item) => sum + (item.attempts || 0), 0) },
    reachable,
    detail,
    skipped: config.enabled ? null : "bridge_disabled",
  };
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const { command, flags, multi, events } = parseArgs(argv);
  if (!command || command === "help" || flags.help) { process.stdout.write(HELP); return 0; }
  if (command === "version" || flags.version) { process.stdout.write("opc-bridge 0.2.1\n"); return 0; }
  const config = loadConfig();
  const started = Date.now();
  const contextFallback = (reason, message) => ({ used: false, reason, ...(message ? { message } : {}) });
  try {
    const flush = config.enabled ? await flushPending(config) : { sent: 0, remaining: 0, skipped: 0 };
    if (command === "context") {
      const result = await runContext({ flags, config, cwd });
      log({ command, ok: true, repository: resolveRepository(cwd, config), used: result.used === true, reason: result.reason ?? null, items: Array.isArray(result.items) ? result.items.length : 0, cached: result.cached === true, durationMs: Date.now() - started, id: randomUUID() });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (command === "result") {
      const result = await runResult({ flags, multi, events, config, cwd });
      log({ command, ok: result.saved === true, repository: resolveRepository(cwd, config), saved: result.saved === true, candidates: Array.isArray(result.candidates) ? result.candidates.length : 0, events: Array.isArray(result.events) ? result.events.length : 0, deduped: result.deduped === true, queued: result.queued === true, durationMs: Date.now() - started, id: randomUUID() });
      process.stdout.write(`${JSON.stringify({ ...result, ...(flush.sent > 0 ? { flushedPending: flush.sent } : {}) })}\n`);
      return 0;
    }
    if (command === "bootstrap") {
      const result = await runBootstrap({ flags, config, cwd });
      log({ command, ok: result.used === true, repository: resolveRepository(cwd, config), reason: result.reason ?? null, records: Array.isArray(result.recordIds) ? result.recordIds.length : 0, durationMs: Date.now() - started, id: randomUUID() });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (command === "workspace") {
      const result = await runWorkspace({ flags, config, cwd });
      log({ command, action: flags.action || null, ok: result.saved === true || result.used === true || !result.reason, reason: result.reason ?? null, queued: result.queued === true, durationMs: Date.now() - started, id: randomUUID() });
      process.stdout.write(`${JSON.stringify({ ...result, ...(flush.sent > 0 ? { flushedPending: flush.sent } : {}) })}\n`);
      return 0;
    }
    if (command === "candidates") {
      const result = await runCandidates({ flags, config });
      log({ command, ok: true, pending: Array.isArray(result.pending) ? result.pending.length : 0, resolved: result.resolved === true, durationMs: Date.now() - started, id: randomUUID() });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    if (command === "doctor") {
      process.stdout.write(`${JSON.stringify({ ...(await runDoctor(config)), flush })}\n`);
      return 0;
    }
    process.stdout.write(`${JSON.stringify(contextFallback("unknown_command", `未知命令：${command}`))}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "OPC Bridge 调用失败";
    log({ command, ok: false, message, durationMs: Date.now() - started, id: randomUUID() });
    const fallback = command === "result"
      ? { saved: false, reason: "bridge_error", message }
      : command === "workspace"
        ? { saved: false, reason: "bridge_error", queued: false, message }
      : command === "candidates"
        ? { resolved: false, reason: "bridge_error", message }
        : contextFallback("bridge_error", message);
    process.stdout.write(`${JSON.stringify(fallback)}\n`);
    return 0;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; });
}
