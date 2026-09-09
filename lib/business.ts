import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { getDataDirectory, getDb } from "./db";
import { PROJECT_CATEGORIES, type ProjectCategory } from "./project-categories";
import { getProjectProfile, parseProjectProfile, type ProjectProfile } from "./project-profiles";

type Json = Record<string, unknown>;
type Stored = { status: number; body: Json };
type HydratedVersion = Json & { id: string; ordinal: number; content: string; created_at: string; write_sequence: number; review_status?: string; feedback: Json[] };
type HydratedDeliverable = Json & { id: string; title: string; type: string; created_at: string; write_sequence: number; review_status: string; versions: HydratedVersion[] };
type HydratedTrial = Json & { id: string; title: string; goal: string; status: string; updated_at: string; code_commit?: string | null; next_step?: string | null; deliverables: HydratedDeliverable[]; decisions: Array<Json & { next_step?: string }> };

const MAX_CAPTURE_FILE_BYTES = 2 * 1024 * 1024;

export class BusinessError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const now = () => new Date().toISOString();
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const optionalText = (value: unknown) => {
  const result = text(value);
  return result || null;
};

function stringList(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return [] as string[];
  const values = Array.isArray(value) ? value : [value];
  const result = values.map(text).filter(Boolean);
  if (result.length !== values.length) throw new BusinessError(400, `${label}_invalid`, `${label}包含无效 ID`);
  if (new Set(result).size !== result.length) throw new BusinessError(400, `${label}_duplicate`, `${label}不能重复`);
  return result;
}

function captureReadStatus(value: unknown) {
  const status = text(value) || "provided";
  if (!["unread", "provided", "read", "failed"].includes(status)) throw new BusinessError(400, "capture_read_status_invalid", "素材读取状态无效");
  return status;
}

function captureKind(value: unknown, hasFile: boolean, hasSource: boolean) {
  const kind = text(value) || (hasFile ? "file" : hasSource ? "link" : "text");
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(kind)) throw new BusinessError(400, "capture_kind_invalid", "素材类型无效");
  return kind;
}

function decodeFile(payload: Json) {
  const encoded = text(payload.file_data_base64);
  const fileName = optionalText(payload.file_name);
  const hasMetadata = Boolean(fileName || payload.mime_type || payload.file_size !== undefined);
  if (!encoded) {
    if (payload.file_size !== undefined && (!Number.isInteger(Number(payload.file_size)) || Number(payload.file_size) < 0)) throw new BusinessError(400, "capture_file_size_invalid", "文件大小无效");
    return { fileName, mimeType: optionalText(payload.mime_type), fileSize: payload.file_size === undefined ? null : Number(payload.file_size), bytes: null as Buffer | null, hasMetadata };
  }
  if (!fileName) throw new BusinessError(400, "capture_file_name_required", "保存文件时必须提供文件名");
  const data = encoded.startsWith("data:") ? encoded.slice(encoded.indexOf(",") + 1) : encoded;
  if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 === 1) throw new BusinessError(400, "capture_file_invalid", "文件内容不是有效的 base64");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > MAX_CAPTURE_FILE_BYTES) throw new BusinessError(413, "capture_file_too_large", "素材文件不能超过 2 MB");
  return { fileName, mimeType: optionalText(payload.mime_type) || "application/octet-stream", fileSize: bytes.length, bytes, hasMetadata: true };
}

function storeCaptureFile(id: string, fileName: string, bytes: Buffer) {
  const safeName = basename(fileName).replace(/[^\w.\-\u4e00-\u9fff]+/g, "_").slice(0, 120) || "file";
  const relativePath = join("assets", `${id}-${safeName}`);
  const absolutePath = resolve(getDataDirectory(), relativePath);
  mkdirSync(join(getDataDirectory(), "assets"), { recursive: true });
  writeFileSync(absolutePath, bytes, { flag: "wx" });
  return relativePath;
}

function captureView(row: Json): Json {
  const { file_path: _filePath, ...rest } = row;
  return { ...rest, has_file: Boolean(row.file_path), used_count: Number(row.used_count || 0), method_count: Number(row.method_count || 0) };
}

function methodView(row: Json): Json {
  const { steps_json: _stepsJson, ...rest } = row;
  return { ...rest, steps: JSON.parse(String(row.steps_json || "[]")), usage_count: Number(row.usage_count || 0) };
}

function linkTrialCaptures(trialId: string, captureIds: string[], timestamp = now()) {
  const db = getDb();
  const insert = db.prepare("INSERT OR IGNORE INTO trial_captures(trial_id,capture_id,position,created_at) VALUES (?,?,?,?)");
  captureIds.forEach((captureId, position) => insert.run(trialId, captureId, position, timestamp));
}

function captureUsage(captureId: string) {
  const db = getDb();
  const methods = db.prepare("SELECT COUNT(*) AS count FROM methods WHERE capture_id=?").get(captureId) as { count: number };
  const trials = db.prepare("SELECT COUNT(*) AS count FROM trial_captures WHERE capture_id=?").get(captureId) as { count: number };
  return { method_count: Number(methods.count), used_count: Number(trials.count) };
}

function methodCaptures(methodId: string) {
  return getDb().prepare("SELECT c.* FROM captures c JOIN methods m ON m.capture_id=c.id WHERE m.id=?").all(methodId).map((row) => captureView({ ...(row as Json), ...captureUsage(String((row as Json).id)) }));
}

function methodUsage(methodId: string) {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM trials WHERE method_id=?").get(methodId) as { count: number };
  return Number(row.count);
}
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Json).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

function event(entityType: string, entityId: string, kind: string, payload: Json) {
  getDb().prepare("INSERT INTO events(entity_type, entity_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(entityType, entityId, kind, JSON.stringify(payload), now());
}

export function idempotent(route: string, requestId: string | undefined, payload: Json, operation: () => Stored): Stored {
  if (!requestId) throw new BusinessError(400, "client_request_id_required", "写入请求必须提供 client_request_id");
  const db = getDb();
  const hash = createHash("sha256").update(stable(payload)).digest("hex");
  const previous = db.prepare("SELECT * FROM idempotency WHERE client_request_id = ?").get(requestId) as { route: string; payload_hash: string; response_status: number; response_json: string } | undefined;
  if (previous) {
    if (previous.route !== route || previous.payload_hash !== hash) {
      throw new BusinessError(409, "idempotency_conflict", "相同 client_request_id 已用于不同请求");
    }
    return { status: previous.response_status, body: JSON.parse(previous.response_json) as Json };
  }
  return db.transaction(() => {
    const result = operation();
    db.prepare("INSERT INTO idempotency VALUES (?, ?, ?, ?, ?, ?)")
      .run(requestId, route, hash, result.status, JSON.stringify(result.body), now());
    return result;
  })();
}

export function createCapture(payload: Json, requestId?: string) {
  return idempotent("POST /captures", requestId, payload, () => {
    const content = optionalText(payload.content);
    const source = optionalText(payload.source);
    const file = decodeFile(payload);
    if (!content && !source && !file.bytes && !file.hasMetadata) throw new BusinessError(400, "capture_content_required", "链接、文本或文件至少提供一项");
    if (file.hasMetadata && !file.bytes && !file.fileName) throw new BusinessError(400, "capture_file_name_required", "文件素材必须提供文件名");
    const id = randomUUID();
    let filePath: string | null = null;
    try {
      filePath = file.bytes && file.fileName ? storeCaptureFile(id, file.fileName, file.bytes) : null;
    } catch (error) {
      throw new BusinessError(500, "capture_file_save_failed", `素材文件保存失败：${error instanceof Error ? error.message : String(error)}`);
    }
    const row = {
      id,
      kind: captureKind(payload.kind, Boolean(file.bytes || file.fileName), Boolean(source)),
      title: text(payload.title) || file.fileName || "未命名输入",
      content,
      source,
      read_status: captureReadStatus(payload.read_status),
      file_name: file.fileName,
      mime_type: file.mimeType,
      file_size: file.fileSize,
      file_path: filePath,
      created_at: now(),
    };
    try {
      getDb().prepare("INSERT INTO captures(id,kind,title,content,source,read_status,file_name,mime_type,file_size,file_path,created_at) VALUES (@id,@kind,@title,@content,@source,@read_status,@file_name,@mime_type,@file_size,@file_path,@created_at)").run(row);
    } catch (error) {
      if (filePath) {
        const absolutePath = resolve(getDataDirectory(), filePath);
        if (existsSync(absolutePath)) unlinkSync(absolutePath);
      }
      throw error;
    }
    event("capture", row.id, "capture.created", row);
    return { status: 201, body: captureView(row) };
  });
}

export function createMethod(payload: Json, requestId?: string) {
  return idempotent("POST /methods", requestId, payload, () => {
    const db = getDb();
    const captureId = optionalText(payload.capture_id);
    if (captureId && !db.prepare("SELECT id FROM captures WHERE id=?").get(captureId)) throw new BusinessError(404, "capture_not_found", "关联素材不存在");
    const previousId = optionalText(payload.previous_method_id);
    const previous = previousId ? db.prepare("SELECT * FROM methods WHERE id=?").get(previousId) as Json | undefined : undefined;
    if (previousId && !previous) throw new BusinessError(404, "method_not_found", "前一方法版本不存在");
    const steps = stringList(payload.steps, "方法步骤");
    const title = text(payload.title);
    const purpose = text(payload.purpose);
    if (!title || !purpose || steps.length === 0) throw new BusinessError(400, "method_fields_required", "方法标题、用途和步骤不能为空");
    const familyId = previous ? String(previous.family_id || previous.id) : optionalText(payload.family_id) || randomUUID();
    const revisionNumber = previous ? Number(previous.revision_number || 1) + 1 : 1;
    const row = { id: randomUUID(), capture_id: captureId, title, purpose, revision_label: text(payload.revision_label) || `r${revisionNumber}`, steps_json: JSON.stringify(steps), conditions: optionalText(payload.conditions), family_id: familyId, previous_method_id: previous?.id || null, revision_number: revisionNumber, created_at: now() };
    db.prepare("INSERT INTO methods(id,capture_id,title,purpose,revision_label,steps_json,conditions,family_id,previous_method_id,revision_number,created_at) VALUES (@id,@capture_id,@title,@purpose,@revision_label,@steps_json,@conditions,@family_id,@previous_method_id,@revision_number,@created_at)").run(row);
    event("method", row.id, "method.created", row);
    return { status: 201, body: methodView(row) };
  });
}

export function getCaptures(query = "", readStatus = "") {
  const normalizedQuery = text(query).toLowerCase();
  const normalizedStatus = text(readStatus);
  if (normalizedStatus && !["unread", "provided", "read", "failed"].includes(normalizedStatus)) throw new BusinessError(400, "capture_read_status_invalid", "素材读取状态无效");
  const rows = getDb().prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM trial_captures tc WHERE tc.capture_id=c.id) AS used_count,
      (SELECT COUNT(*) FROM methods m WHERE m.capture_id=c.id) AS method_count
    FROM captures c
    WHERE (? = '' OR lower(c.title) LIKE '%' || ? || '%' OR lower(COALESCE(c.content,'')) LIKE '%' || ? || '%' OR lower(COALESCE(c.source,'')) LIKE '%' || ? || '%')
      AND (? = '' OR c.read_status = ?)
    ORDER BY c.created_at DESC, c.id DESC
  `).all(normalizedQuery, normalizedQuery, normalizedQuery, normalizedQuery, normalizedStatus, normalizedStatus) as Json[];
  return { captures: rows.map(captureView), query: normalizedQuery, read_status: normalizedStatus || "all" };
}

export function getCapture(id: string) {
  const row = getDb().prepare("SELECT * FROM captures WHERE id=?").get(id) as Json | undefined;
  if (!row) throw new BusinessError(404, "capture_not_found", "素材不存在");
  const trials = getDb().prepare("SELECT t.id,t.title,t.status FROM trials t JOIN trial_captures tc ON tc.trial_id=t.id WHERE tc.capture_id=? ORDER BY t.updated_at DESC").all(id);
  const methods = getDb().prepare("SELECT id,title,purpose,revision_label,revision_number,previous_method_id,created_at FROM methods WHERE capture_id=? ORDER BY created_at DESC").all(id);
  return { ...captureView({ ...row, ...captureUsage(id) }), trials, methods };
}

export function getCaptureFile(id: string) {
  const row = getDb().prepare("SELECT id,file_name,mime_type,file_path FROM captures WHERE id=?").get(id) as { id: string; file_name?: string | null; mime_type?: string | null; file_path?: string | null } | undefined;
  if (!row) throw new BusinessError(404, "capture_not_found", "素材不存在");
  if (!row.file_path) throw new BusinessError(404, "capture_file_not_found", "该素材没有可预览文件");
  const base = resolve(getDataDirectory());
  const absolutePath = resolve(base, row.file_path);
  if (!absolutePath.startsWith(`${base}${sep}`) || !existsSync(absolutePath)) throw new BusinessError(404, "capture_file_not_found", "素材文件不可读取");
  return { content: readFileSync(absolutePath), fileName: row.file_name || "download", mimeType: row.mime_type || "application/octet-stream" };
}

export function updateCapture(id: string, payload: Json, requestId?: string) {
  return idempotent(`PATCH /captures/${id}`, requestId, payload, () => {
    const current = getDb().prepare("SELECT * FROM captures WHERE id=?").get(id) as Json | undefined;
    if (!current) throw new BusinessError(404, "capture_not_found", "素材不存在");
    const readStatus = payload.read_status === undefined ? String(current.read_status) : captureReadStatus(payload.read_status);
    const title = payload.title === undefined ? String(current.title) : text(payload.title);
    if (!title) throw new BusinessError(400, "capture_title_required", "素材标题不能为空");
    const next = { ...current, title, read_status: readStatus };
    getDb().prepare("UPDATE captures SET title=?,read_status=? WHERE id=?").run(title, readStatus, id);
    event("capture", id, "capture.updated", next);
    return { status: 200, body: captureView({ ...next, ...captureUsage(id) }) };
  });
}

export function getMethods(query = "") {
  const normalizedQuery = text(query).toLowerCase();
  const rows = getDb().prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM trials t WHERE t.method_id=m.id) AS usage_count
    FROM methods m
    WHERE (? = '' OR lower(m.title) LIKE '%' || ? || '%' OR lower(m.purpose) LIKE '%' || ? || '%')
    ORDER BY m.created_at DESC, m.id DESC
  `).all(normalizedQuery, normalizedQuery, normalizedQuery) as Json[];
  return { methods: rows.map(methodView), query: normalizedQuery };
}

export function getMethod(id: string) {
  const row = getDb().prepare("SELECT m.*, (SELECT COUNT(*) FROM trials t WHERE t.method_id=m.id) AS usage_count FROM methods m WHERE m.id=?").get(id) as Json | undefined;
  if (!row) throw new BusinessError(404, "method_not_found", "方法版本不存在");
  const family = getDb().prepare("SELECT id,title,revision_label,revision_number,previous_method_id,created_at FROM methods WHERE family_id=? ORDER BY revision_number").all(String(row.family_id || row.id));
  return { ...methodView(row), captures: methodCaptures(id), family };
}

export function getLibrary(query = "") {
  return { ...getCaptures(query), ...getMethods(query) };
}

export function getAssets(query = "") {
  const db = getDb();
  const normalizedQuery = text(query).toLowerCase();
  const tools = db.prepare(`SELECT t.*,
    (SELECT json_group_array(json_object('id',p.id,'name',p.name)) FROM projects p JOIN project_tools pt ON pt.project_id=p.id WHERE pt.tool_id=t.id) AS projects_json
    FROM tools t WHERE (?='' OR lower(t.name || ' ' || t.purpose || ' ' || COALESCE(t.notes,'')) LIKE '%' || ? || '%') ORDER BY t.updated_at DESC, t.name`).all(normalizedQuery, normalizedQuery) as Json[];
  const spaceEntries = db.prepare(`SELECT s.*,
    (SELECT json_group_array(json_object('id',p.id,'name',p.name)) FROM projects p JOIN project_space_entries ps ON ps.project_id=p.id WHERE ps.space_entry_id=s.id) AS projects_json,
    (SELECT json_group_array(json_object('id',t.id,'name',t.name)) FROM tools t JOIN tool_space_entries ts ON ts.tool_id=t.id WHERE ts.space_entry_id=s.id) AS tools_json
    FROM space_entries s WHERE (?='' OR lower(s.title || ' ' || s.content) LIKE '%' || ? || '%') ORDER BY s.updated_at DESC, s.title`).all(normalizedQuery, normalizedQuery) as Json[];
  const parseLinks = (row: Json) => ({ ...row, projects: JSON.parse(String(row.projects_json || "[]")), tools: JSON.parse(String(row.tools_json || "[]")), projects_json: undefined, tools_json: undefined });
  return { tools: tools.map(parseLinks), space_entries: spaceEntries.map(parseLinks), query: normalizedQuery };
}

export function createTrial(payload: Json, requestId?: string) {
  return idempotent("POST /trials", requestId, payload, () => {
    const db = getDb();
    const timestamp = now();
    const project = projectOrThrow(payload.project_id);
    const methodId = optionalText(payload.method_id);
    const method = methodId ? db.prepare("SELECT * FROM methods WHERE id=?").get(methodId) as Json | undefined : undefined;
    if (methodId && !method) throw new BusinessError(404, "method_not_found", "方法版本不存在");
    const requestedCaptureIds = stringList(payload.capture_ids === undefined ? payload.capture_id : payload.capture_ids, "素材");
    const captureIds = requestedCaptureIds.length > 0 ? requestedCaptureIds : method?.capture_id ? [String(method.capture_id)] : [];
    for (const captureId of captureIds) {
      if (!db.prepare("SELECT id FROM captures WHERE id=?").get(captureId)) throw new BusinessError(404, "capture_not_found", "关联素材不存在");
    }
    const row = { id: randomUUID(), title: text(payload.title), goal: text(payload.goal), method_id: methodId, capture_id: captureIds[0] || null, project_id: project?.id || null, status: text(payload.status) || "in_progress", environment: optionalText(payload.environment), actual_result: null, code_repository: optionalText(payload.code_repository), code_branch: optionalText(payload.code_branch), code_commit: optionalText(payload.code_commit), next_step: optionalText(payload.next_step), revision: 1, created_at: timestamp, updated_at: timestamp };
    if (!row.title || !row.goal) throw new BusinessError(400, "trial_fields_required", "尝试标题和目标不能为空");
    db.prepare("INSERT INTO trials(id,title,goal,method_id,capture_id,project_id,status,environment,actual_result,code_repository,code_branch,code_commit,next_step,revision,created_at,updated_at) VALUES (@id,@title,@goal,@method_id,@capture_id,@project_id,@status,@environment,@actual_result,@code_repository,@code_branch,@code_commit,@next_step,@revision,@created_at,@updated_at)").run(row);
    linkTrialCaptures(row.id, captureIds, timestamp);
    event("trial", row.id, "trial.created", { ...row, capture_ids: captureIds });
    return { status: 201, body: { ...row, capture_ids: captureIds } };
  });
}

function projectOrThrow(projectId: unknown) {
  const id = text(projectId);
  if (!id) return null;
  const project = getDb().prepare("SELECT * FROM projects WHERE id=?").get(id) as Json | undefined;
  if (!project) throw new BusinessError(404, "project_not_found", "项目不存在");
  return project;
}

function profileJson(value: unknown, fallback: ProjectProfile | null = null) {
  if (value === undefined) return fallback ? JSON.stringify(fallback) : null;
  const profile = parseProjectProfile(value);
  if (!profile) throw new BusinessError(400, "project_profile_invalid", "项目介绍格式不完整");
  return JSON.stringify(profile);
}

function feedbackKind(value: unknown) {
  const kind = text(value) || "revision";
  if (!['review', 'revision'].includes(kind)) throw new BusinessError(400, "feedback_kind_invalid", "反馈类型无效");
  return kind;
}

function feedbackSource(value: unknown) {
  const source = text(value) || "user";
  if (!['user', 'codex', 'system'].includes(source)) throw new BusinessError(400, "feedback_source_invalid", "反馈来源无效");
  return source;
}

function reviewStatus(deliverable: Json, versions: HydratedVersion[]) {
  const latest = versions[0];
  if (!latest) return "pending_review";
  const hasOpenRevision = latest.feedback.some((item) => item.status === "open" && item.kind === "revision");
  if (hasOpenRevision) return "needs_revision";
  if (String(deliverable.accepted_version_id || "") === latest.id) return "accepted";
  return "pending_review";
}

function touchTrial(trialId: unknown) {
  const id = text(trialId);
  if (id) getDb().prepare("UPDATE trials SET updated_at=? WHERE id=?").run(now(), id);
}

function touchTrialByDeliverable(deliverableId: string) {
  const trial = getDb().prepare("SELECT trial_id FROM deliverables WHERE id=?").get(deliverableId) as { trial_id?: string } | undefined;
  touchTrial(trial?.trial_id);
}

function latestDeliverableEntry(trials: HydratedTrial[]) {
  return trials
    .flatMap((trial) => trial.deliverables.map((deliverable) => ({ trial, deliverable, latestVersion: deliverable.versions[0] || null })))
    .sort((left, right) => {
      const leftTime = left.latestVersion?.created_at || left.deliverable.created_at;
      const rightTime = right.latestVersion?.created_at || right.deliverable.created_at;
      return rightTime.localeCompare(leftTime)
        || Number(right.latestVersion?.write_sequence || right.deliverable.write_sequence) - Number(left.latestVersion?.write_sequence || left.deliverable.write_sequence);
    })[0] || null;
}

function currentNextStep(trial: HydratedTrial | null) {
  return trial?.decisions?.[0]?.next_step || trial?.next_step || null;
}

function projectView(project: Json) {
  const { profile_json: _profileJson, ...rest } = project;
  return { ...rest, profile: getProjectProfile(project) };
}

export function createProject(payload: Json, requestId?: string) {
  return idempotent("POST /projects", requestId, payload, () => {
    const name = text(payload.name);
    const category = text(payload.category) as ProjectCategory;
    if (!name) throw new BusinessError(400, "project_name_required", "项目名称不能为空");
    if (!PROJECT_CATEGORIES.some((item) => item.id === category)) throw new BusinessError(400, "project_category_invalid", "项目类别无效");
    const timestamp = now();
    const row = { id: randomUUID(), name, category, path: optionalText(payload.path), description: optionalText(payload.description), status: text(payload.status) || "active", profile_json: profileJson(payload.profile, getProjectProfile({ name })), revision: 1, created_at: timestamp, updated_at: timestamp };
    getDb().prepare("INSERT INTO projects(id,name,category,path,description,status,profile_json,revision,created_at,updated_at) VALUES (@id,@name,@category,@path,@description,@status,@profile_json,@revision,@created_at,@updated_at)").run(row);
    event("project", row.id, "project.created", row);
    return { status: 201, body: projectView(row) };
  });
}

export function updateProject(id: string, payload: Json, requestId?: string) {
  return idempotent(`PATCH /projects/${id}`, requestId, payload, () => {
    const current = getDb().prepare("SELECT * FROM projects WHERE id=?").get(id) as Json | undefined;
    if (!current) throw new BusinessError(404, "project_not_found", "项目不存在");
    if (Number(payload.expected_revision) !== Number(current.revision)) throw new BusinessError(409, "revision_conflict", "项目已被更新，请重新读取", { current });
    const name = payload.name === undefined ? text(current.name) : text(payload.name);
    const category = (payload.category === undefined ? text(current.category) : text(payload.category)) as ProjectCategory;
    if (!name) throw new BusinessError(400, "project_name_required", "项目名称不能为空");
    if (!PROJECT_CATEGORIES.some((item) => item.id === category)) throw new BusinessError(400, "project_category_invalid", "项目类别无效");
    const next = {
      ...current,
      name,
      category,
      description: payload.description === undefined ? current.description : optionalText(payload.description),
      status: payload.status === undefined ? current.status : text(payload.status) || current.status,
      profile_json: payload.profile === undefined ? current.profile_json : profileJson(payload.profile),
      revision: Number(current.revision) + 1,
      updated_at: now(),
    };
    getDb().prepare("UPDATE projects SET name=@name,category=@category,description=@description,status=@status,profile_json=@profile_json,revision=@revision,updated_at=@updated_at WHERE id=@id").run(next);
    event("project", id, "project.updated", next);
    return { status: 200, body: projectView(next) };
  });
}

export function createProjectLocation(projectId: string, payload: Json, requestId?: string) {
  return idempotent(`POST /projects/${projectId}/locations`, requestId, payload, () => {
    projectOrThrow(projectId);
    const label = text(payload.label);
    const environment = text(payload.environment);
    if (!label || !environment) throw new BusinessError(400, "project_location_required", "工作入口名称和环境不能为空");
    const timestamp = now();
    const row = { id: randomUUID(), project_id: projectId, label, environment, path: optionalText(payload.path), repository_url: optionalText(payload.repository_url), branch: optionalText(payload.branch), commit_sha: optionalText(payload.commit_sha), deploy_url: optionalText(payload.deploy_url), notes: optionalText(payload.notes), created_at: timestamp, updated_at: timestamp };
    getDb().prepare("INSERT INTO project_locations(id,project_id,label,environment,path,repository_url,branch,commit_sha,deploy_url,notes,created_at,updated_at) VALUES (@id,@project_id,@label,@environment,@path,@repository_url,@branch,@commit_sha,@deploy_url,@notes,@created_at,@updated_at)").run(row);
    event("project_location", row.id, "project_location.created", row);
    return { status: 201, body: row };
  });
}

export function startTrial(payload: Json, requestId?: string) {
  return idempotent("POST /starts", requestId, payload, () => {
    const title = text(payload.title);
    const content = text(payload.content);
    const kind = text(payload.kind) || "need";
    if (!title || !content) throw new BusinessError(400, "start_fields_required", "标题和具体内容不能为空");
    if (!["need", "discovery", "failure"].includes(kind)) throw new BusinessError(400, "start_kind_invalid", "入口类型无效");
    const db = getDb();
    const timestamp = now();
    const project = projectOrThrow(payload.project_id);
    const capture = { id: randomUUID(), kind, title, content, source: null, read_status: "provided", created_at: timestamp };
    const trial = { id: randomUUID(), title, goal: content, method_id: null, capture_id: capture.id, project_id: project?.id || null, status: "in_progress", environment: optionalText(payload.environment) || "web", actual_result: null, code_repository: optionalText(payload.code_repository), code_branch: optionalText(payload.code_branch), code_commit: optionalText(payload.code_commit), next_step: optionalText(payload.next_step), revision: 1, created_at: timestamp, updated_at: timestamp };
    db.prepare("INSERT INTO captures(id,kind,title,content,source,read_status,created_at) VALUES (@id,@kind,@title,@content,@source,@read_status,@created_at)").run(capture);
    db.prepare("INSERT INTO trials(id,title,goal,method_id,capture_id,project_id,status,environment,actual_result,code_repository,code_branch,code_commit,next_step,revision,created_at,updated_at) VALUES (@id,@title,@goal,@method_id,@capture_id,@project_id,@status,@environment,@actual_result,@code_repository,@code_branch,@code_commit,@next_step,@revision,@created_at,@updated_at)").run(trial);
    linkTrialCaptures(trial.id, [capture.id], timestamp);
    event("capture", capture.id, "capture.created", capture);
    event("trial", trial.id, "trial.created", trial);
    return { status: 201, body: { ...trial, capture } };
  });
}

export function updateTrial(id: string, payload: Json, requestId?: string) {
  return idempotent(`PATCH /trials/${id}`, requestId, payload, () => {
    const current = getDb().prepare("SELECT * FROM trials WHERE id = ?").get(id) as Json | undefined;
    if (!current) throw new BusinessError(404, "trial_not_found", "尝试不存在");
    if (payload.expected_revision !== current.revision) throw new BusinessError(409, "revision_conflict", "记录已被更新，请重新读取", { current });
    const projectId = payload.project_id === undefined ? current.project_id : optionalText(payload.project_id);
    projectOrThrow(projectId);
    const next = { status: payload.status ?? current.status, actual_result: payload.actual_result ?? current.actual_result, environment: payload.environment ?? current.environment, project_id: projectId, code_repository: payload.code_repository === undefined ? current.code_repository : optionalText(payload.code_repository), code_branch: payload.code_branch === undefined ? current.code_branch : optionalText(payload.code_branch), code_commit: payload.code_commit === undefined ? current.code_commit : optionalText(payload.code_commit), next_step: payload.next_step === undefined ? current.next_step : optionalText(payload.next_step), revision: Number(current.revision) + 1, updated_at: now(), id };
    getDb().prepare("UPDATE trials SET status=@status,actual_result=@actual_result,environment=@environment,project_id=@project_id,code_repository=@code_repository,code_branch=@code_branch,code_commit=@code_commit,next_step=@next_step,revision=@revision,updated_at=@updated_at WHERE id=@id").run(next);
    event("trial", id, "trial.updated", next);
    return { status: 200, body: { ...current, ...next } };
  });
}

export function createDeliverable(payload: Json, requestId?: string) {
  return idempotent("POST /deliverables", requestId, payload, () => {
    const trialId = text(payload.trial_id);
    if (!getDb().prepare("SELECT id FROM trials WHERE id=?").get(trialId)) throw new BusinessError(404, "trial_not_found", "行动不存在");
    const row = { id: randomUUID(), trial_id: trialId, title: text(payload.title), type: text(payload.type) || "article", accepted_version_id: null, created_at: now() };
    if (!row.title) throw new BusinessError(400, "deliverable_fields_required", "成果名称不能为空");
    getDb().prepare("INSERT INTO deliverables VALUES (@id,@trial_id,@title,@type,@accepted_version_id,@created_at)").run(row);
    touchTrial(trialId);
    event("deliverable", row.id, "deliverable.created", row);
    return { status: 201, body: row };
  });
}

export function createDraft(payload: Json, requestId?: string) {
  return idempotent("POST /drafts", requestId, payload, () => {
    const db = getDb();
    const trialId = String(payload.trial_id || "");
    const title = String(payload.title || "").trim();
    const content = String(payload.content || "").trim();
    if (!db.prepare("SELECT id FROM trials WHERE id=?").get(trialId)) throw new BusinessError(404, "trial_not_found", "行动不存在");
    if (!title || !content) throw new BusinessError(400, "draft_fields_required", "成果标题和内容不能为空");
    const timestamp = now();
    const deliverable = { id: randomUUID(), trial_id: trialId, title, type: payload.type || "article", accepted_version_id: null, created_at: timestamp };
    const version = { id: randomUUID(), deliverable_id: deliverable.id, ordinal: 1, content, previous_version_id: null, handles_feedback_json: "[]", created_at: timestamp };
    db.prepare("INSERT INTO deliverables VALUES (@id,@trial_id,@title,@type,@accepted_version_id,@created_at)").run(deliverable);
    db.prepare("INSERT INTO deliverable_versions(id,deliverable_id,ordinal,content,previous_version_id,handles_feedback_json,review_status,created_at) VALUES (@id,@deliverable_id,@ordinal,@content,@previous_version_id,@handles_feedback_json,'pending_review',@created_at)").run(version);
    touchTrial(trialId);
    event("deliverable", deliverable.id, "deliverable.created", deliverable);
    event("deliverable_version", version.id, "version.created", version);
    return { status: 201, body: { ...deliverable, version: { ...version, handles_feedback_ids: [] } } };
  });
}

export function createVersion(deliverableId: string, payload: Json, requestId?: string) {
  return idempotent(`POST /deliverables/${deliverableId}/versions`, requestId, payload, () => {
    const db = getDb();
    const deliverable = db.prepare("SELECT id,trial_id FROM deliverables WHERE id = ?").get(deliverableId) as { id: string; trial_id: string } | undefined;
    if (!deliverable) throw new BusinessError(404, "deliverable_not_found", "成果不存在");
    const latest = db.prepare("SELECT * FROM deliverable_versions WHERE deliverable_id = ? ORDER BY ordinal DESC LIMIT 1").get(deliverableId) as Json | undefined;
    const expectedPreviousVersionId = optionalText(payload.expected_previous_version_id ?? payload.previous_version_id);
    if (latest && expectedPreviousVersionId !== String(latest.id)) {
      throw new BusinessError(409, expectedPreviousVersionId ? "version_conflict" : "version_base_required", expectedPreviousVersionId ? "成果已从你读取的版本继续更新，请重新读取当前版本" : "创建新版本前必须提供你读取的 previous_version_id", { current_version_id: latest.id, current_ordinal: latest.ordinal });
    }
    if (!latest && expectedPreviousVersionId) throw new BusinessError(409, "version_conflict", "成果还没有可作为父版本的版本", { current_version_id: null });
    const feedbackIds = Array.isArray(payload.handles_feedback_ids) ? payload.handles_feedback_ids.map((id) => text(id)).filter(Boolean) : [];
    if (new Set(feedbackIds).size !== feedbackIds.length) throw new BusinessError(400, "feedback_duplicate", "同一条反馈不能重复处理");
    const row = { id: randomUUID(), deliverable_id: deliverableId, ordinal: latest ? Number(latest.ordinal) + 1 : 1, content: text(payload.content), previous_version_id: latest?.id || null, handles_feedback_json: JSON.stringify(feedbackIds), review_status: "pending_review", created_at: now() };
    if (!row.content) throw new BusinessError(400, "version_content_required", "成果内容不能为空");
    db.prepare("INSERT INTO deliverable_versions(id,deliverable_id,ordinal,content,previous_version_id,handles_feedback_json,review_status,created_at) VALUES (@id,@deliverable_id,@ordinal,@content,@previous_version_id,@handles_feedback_json,@review_status,@created_at)").run(row);
    for (const feedbackId of feedbackIds) {
      const feedback = db.prepare("SELECT f.id, f.status FROM feedback f JOIN deliverable_versions v ON v.id=f.version_id WHERE f.id=? AND v.deliverable_id=?").get(feedbackId, deliverableId) as { id: string; status: string } | undefined;
      if (!feedback) throw new BusinessError(400, "feedback_mismatch", "反馈不属于该成果");
      if (feedback.status !== "open") throw new BusinessError(409, "feedback_already_handled", "反馈已经处理，请重新读取当前状态");
      db.prepare("UPDATE feedback SET status='handled',handled_at=? WHERE id=?").run(now(), feedbackId);
    }
    touchTrial(deliverable.trial_id);
    event("deliverable_version", row.id, "version.created", { ...row, handles_feedback_ids: feedbackIds });
    return { status: 201, body: { ...row, handles_feedback_ids: JSON.parse(row.handles_feedback_json), handles_feedback_json: undefined } };
  });
}

export function createFeedback(payload: Json, requestId?: string) {
  return idempotent("POST /feedback", requestId, payload, () => {
    const versionId = text(payload.version_id);
    const version = getDb().prepare("SELECT v.id, d.trial_id FROM deliverable_versions v JOIN deliverables d ON d.id=v.deliverable_id WHERE v.id=?").get(versionId) as { id: string; trial_id: string } | undefined;
    if (!version) throw new BusinessError(404, "version_not_found", "成果版本不存在");
    const row = { id: randomUUID(), version_id: versionId, content: text(payload.content), status: "open", source: feedbackSource(payload.source), kind: feedbackKind(payload.kind), handled_at: null, created_at: now() };
    if (!row.content) throw new BusinessError(400, "feedback_content_required", "反馈不能为空");
    getDb().prepare("INSERT INTO feedback(id,version_id,content,status,source,kind,handled_at,created_at) VALUES (@id,@version_id,@content,@status,@source,@kind,@handled_at,@created_at)").run(row);
    if (row.kind === "revision") getDb().prepare("UPDATE deliverable_versions SET review_status='needs_revision' WHERE id=?").run(versionId);
    touchTrial(version.trial_id);
    event("feedback", row.id, "feedback.created", row);
    return { status: 201, body: row };
  });
}

export function createDecision(payload: Json, requestId?: string) {
  return idempotent("POST /decisions", requestId, payload, () => {
    const trialId = text(payload.trial_id);
    if (!getDb().prepare("SELECT id FROM trials WHERE id=?").get(trialId)) throw new BusinessError(404, "trial_not_found", "行动不存在");
    const basisFeedbackId = optionalText(payload.basis_feedback_id);
    if (basisFeedbackId && !getDb().prepare("SELECT f.id FROM feedback f JOIN deliverable_versions v ON v.id=f.version_id JOIN deliverables d ON d.id=v.deliverable_id WHERE f.id=? AND d.trial_id=?").get(basisFeedbackId, trialId)) throw new BusinessError(400, "feedback_trial_mismatch", "依据反馈不属于该行动");
    const row = { id: randomUUID(), trial_id: trialId, basis_feedback_id: basisFeedbackId, rationale: text(payload.rationale), adjustment: text(payload.adjustment), next_step: text(payload.next_step), execution_status: text(payload.execution_status) || "proposed", created_at: now() };
    if (!row.rationale || !row.adjustment || !row.next_step) throw new BusinessError(400, "decision_fields_required", "判断依据、调整和下一步不能为空");
    getDb().prepare("INSERT INTO decisions VALUES (@id,@trial_id,@basis_feedback_id,@rationale,@adjustment,@next_step,@execution_status,@created_at)").run(row);
    touchTrial(trialId);
    event("decision", row.id, "decision.created", row);
    return { status: 201, body: row };
  });
}

export function acceptVersion(deliverableId: string, payload: Json, requestId?: string) {
  return idempotent(`POST /deliverables/${deliverableId}/accept`, requestId, payload, () => {
    const version = getDb().prepare("SELECT id FROM deliverable_versions WHERE id=? AND deliverable_id=?").get(payload.version_id, deliverableId);
    if (!version) throw new BusinessError(400, "version_mismatch", "版本不属于该成果");
    getDb().prepare("UPDATE deliverables SET accepted_version_id=? WHERE id=?").run(payload.version_id, deliverableId);
    getDb().prepare("UPDATE deliverable_versions SET review_status='accepted' WHERE id=?").run(payload.version_id);
    touchTrialByDeliverable(deliverableId);
    event("deliverable", deliverableId, "deliverable.accepted", { version_id: payload.version_id, actor: "user" });
    return { status: 200, body: { id: deliverableId, accepted_version_id: payload.version_id, publication_status: "not_published" } };
  });
}

function hydrateTrial(trial: Json): HydratedTrial {
  const db = getDb();
  const method = trial.method_id ? db.prepare("SELECT * FROM methods WHERE id=?").get(trial.method_id) as Json : null;
  const captureId = trial.capture_id || method?.capture_id;
  const captures = db.prepare("SELECT c.*, (SELECT COUNT(*) FROM trial_captures tc2 WHERE tc2.capture_id=c.id) AS used_count, (SELECT COUNT(*) FROM methods m2 WHERE m2.capture_id=c.id) AS method_count FROM captures c JOIN trial_captures tc ON tc.capture_id=c.id WHERE tc.trial_id=? ORDER BY tc.position, c.created_at").all(trial.id).map((row) => captureView(row as Json));
  const capture = captureId ? captures.find((item) => item.id === captureId) || captureView({ ...(db.prepare("SELECT * FROM captures WHERE id=?").get(captureId) as Json), ...captureUsage(String(captureId)) }) : null;
  const project = trial.project_id ? db.prepare("SELECT id,name,category,status FROM projects WHERE id=?").get(trial.project_id) as Json : null;
  const decisions = db.prepare("SELECT * FROM decisions WHERE trial_id=? ORDER BY created_at DESC").all(trial.id) as Array<Json & { next_step?: string }>;
  const deliverables = db.prepare("SELECT d.*, COALESCE((SELECT MAX(e.sequence) FROM events e WHERE e.entity_type='deliverable' AND e.entity_id=d.id AND e.kind='deliverable.created'), 0) AS write_sequence FROM deliverables d WHERE d.trial_id=? ORDER BY d.created_at, write_sequence").all(trial.id) as Json[];
  const nested = deliverables.map((deliverable) => {
    const versions = db.prepare("SELECT v.*, COALESCE((SELECT MAX(e.sequence) FROM events e WHERE e.entity_type='deliverable_version' AND e.entity_id=v.id AND e.kind='version.created'), 0) AS write_sequence FROM deliverable_versions v WHERE v.deliverable_id=? ORDER BY v.ordinal DESC").all(deliverable.id) as Json[];
    const hydratedVersions = versions.map((version) => ({ ...version, handles_feedback_ids: JSON.parse(String(version.handles_feedback_json)), feedback: db.prepare("SELECT * FROM feedback WHERE version_id=? ORDER BY created_at").all(version.id) as Json[] })) as unknown as HydratedVersion[];
    return { ...deliverable, review_status: reviewStatus(deliverable, hydratedVersions), versions: hydratedVersions } as unknown as HydratedDeliverable;
  });
  return { ...trial, next_step: decisions[0]?.next_step || trial.next_step || null, project, method: method ? { ...methodView({ ...method, usage_count: methodUsage(String(method.id)) }), captures: methodCaptures(String(method.id)) } : null, capture, captures, deliverables: nested, decisions } as unknown as HydratedTrial;
}

export function getContext(trialId: string) {
  const trial = getDb().prepare("SELECT * FROM trials WHERE id=?").get(trialId) as Json | undefined;
  if (!trial) throw new BusinessError(404, "trial_not_found", "尝试不存在");
  return hydrateTrial(trial);
}

export function getDashboard() {
  const db = getDb();
  const trials = db.prepare("SELECT * FROM trials ORDER BY updated_at DESC").all() as Json[];
  const latestEvent = db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events").get() as { sequence: number };
  return { mode: "shared_state", stage: "shared_continuity", generated_at: now(), latest_event_sequence: latestEvent.sequence, trials: trials.map(hydrateTrial) };
}

function projectSummary(projectId: string) {
  const trials = getDb().prepare("SELECT * FROM trials WHERE project_id=? ORDER BY updated_at DESC").all(projectId) as Json[];
  const hydratedTrials = trials.map(hydrateTrial);
  const latestTrial = hydratedTrials[0] || null;
  const openFeedback = hydratedTrials.flatMap((trial) => trial.deliverables.flatMap((deliverable) => deliverable.versions.flatMap((version) => version.feedback.filter((item: Json) => item.status === "open").map((item: Json) => ({ ...item, trial_id: trial.id, trial_title: trial.title, version_id: version.id, version_ordinal: version.ordinal })))));
  const pendingReviews = hydratedTrials.flatMap((trial) => trial.deliverables.flatMap((deliverable) => {
    const latestVersion = deliverable.versions[0];
    const hasOpenReview = latestVersion?.feedback.some((item: Json) => item.status === "open" && item.kind === "review");
    return deliverable.review_status === "pending_review" && latestVersion && !hasOpenReview ? [{ id: latestVersion.id, trial_id: trial.id, trial_title: trial.title, deliverable_id: deliverable.id, deliverable_title: deliverable.title, version_ordinal: latestVersion.ordinal, content: latestVersion.content }] : [];
  }));
  const latestEntry = latestDeliverableEntry(hydratedTrials);
  const latestDeliverable = latestEntry?.deliverable || null;
  const latestVersion = latestEntry?.latestVersion || null;
  return {
    trial_count: trials.length,
    open_feedback_count: openFeedback.length,
    open_feedback: openFeedback.slice(0, 8),
    pending_review_count: pendingReviews.length,
    pending_reviews: pendingReviews.slice(0, 8),
    latest_trial: latestTrial ? { id: latestTrial.id, title: latestTrial.title, goal: latestTrial.goal, status: latestTrial.status, updated_at: latestTrial.updated_at, code_commit: latestTrial.code_commit || null } : null,
    latest_deliverable: latestDeliverable ? { id: latestDeliverable.id, trial_id: latestEntry?.trial.id, trial_title: latestEntry?.trial.title, title: latestDeliverable.title, type: latestDeliverable.type, version: latestVersion ? latestVersion.ordinal : null, content: latestVersion?.content || null, review_status: latestDeliverable.review_status, updated_at: latestVersion?.created_at || latestDeliverable.created_at } : null,
    next_step: currentNextStep(latestTrial),
  };
}

export function getProjects() {
  const rows = getDb().prepare("SELECT * FROM projects ORDER BY updated_at DESC, name ASC").all() as Array<Record<string, unknown>>;
  const projects = rows.map((project) => ({ ...projectView(project), locations: getDb().prepare("SELECT * FROM project_locations WHERE project_id=? ORDER BY updated_at DESC, label ASC").all(project.id), ...projectSummary(String(project.id)) }));
  return { categories: PROJECT_CATEGORIES, projects };
}

export function getProject(projectId: string) {
  const project = getDb().prepare("SELECT * FROM projects WHERE id=?").get(projectId) as Json | undefined;
  if (!project) throw new BusinessError(404, "project_not_found", "项目不存在");
  const locations = getDb().prepare("SELECT * FROM project_locations WHERE project_id=? ORDER BY updated_at DESC, label ASC").all(projectId);
  const trials = getDb().prepare("SELECT * FROM trials WHERE project_id=? ORDER BY updated_at DESC").all(projectId).map((trial) => hydrateTrial(trial as Json));
  const openFeedback = trials.flatMap((trial) => trial.deliverables.flatMap((deliverable) => deliverable.versions.flatMap((version) => version.feedback.filter((item: Json) => item.status === "open"))));
  const latestTrial = trials[0] || null;
  const pendingReviews = trials.flatMap((trial) => trial.deliverables.flatMap((deliverable) => {
    const latestVersion = deliverable.versions[0];
    const hasOpenReview = latestVersion?.feedback.some((item: Json) => item.status === "open" && item.kind === "review");
    return deliverable.review_status === "pending_review" && latestVersion && !hasOpenReview ? [{ id: latestVersion.id, trial_id: trial.id, trial_title: trial.title, deliverable_id: deliverable.id, deliverable_title: deliverable.title, version_ordinal: latestVersion.ordinal, content: latestVersion.content }] : [];
  }));
  const latestEntry = latestDeliverableEntry(trials);
  const latestDeliverable = latestEntry?.deliverable || null;
  const latestVersion = latestEntry?.latestVersion || null;
  return {
    ...projectView(project),
    locations,
    trials,
    open_feedback: openFeedback,
    pending_review_count: pendingReviews.length,
    pending_reviews: pendingReviews,
    latest_trial: latestTrial,
    latest_deliverable: latestDeliverable ? { ...latestDeliverable, trial_id: latestEntry?.trial.id, trial_title: latestEntry?.trial.title, latest_version: latestVersion } : null,
    next_step: currentNextStep(latestTrial),
  };
}

export function getEvents(after: number) {
  const db = getDb();
  const events = db.prepare("SELECT * FROM events WHERE sequence>? ORDER BY sequence LIMIT 100").all(Number.isFinite(after) ? Math.max(0, after) : 0);
  const latestEvent = db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events").get() as { sequence: number };
  const last = events.at(-1) as { sequence?: number } | undefined;
  return { events, latest_event_sequence: latestEvent.sequence, next_after: last?.sequence || after };
}
