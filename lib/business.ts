import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db";
import { PROJECT_CATEGORIES, type ProjectCategory } from "./project-categories";
import { getProjectProfile, parseProjectProfile, type ProjectProfile } from "./project-profiles";

type Json = Record<string, unknown>;
type Stored = { status: number; body: Json };
type HydratedVersion = Json & { id: string; ordinal: number; content: string; created_at: string; feedback: Json[] };
type HydratedDeliverable = Json & { id: string; title: string; type: string; created_at: string; versions: HydratedVersion[] };
type HydratedTrial = Json & { id: string; title: string; goal: string; status: string; updated_at: string; code_commit?: string | null; next_step?: string | null; deliverables: HydratedDeliverable[]; decisions: Array<Json & { next_step?: string }> };

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
    if (!payload.content && !payload.source) throw new BusinessError(400, "capture_content_required", "文本或来源链接至少提供一项");
    const row = { id: randomUUID(), kind: payload.kind || "text", title: payload.title || "未命名输入", content: payload.content || null, source: payload.source || null, read_status: payload.read_status || "provided", created_at: now() };
    getDb().prepare("INSERT INTO captures VALUES (@id,@kind,@title,@content,@source,@read_status,@created_at)").run(row);
    event("capture", row.id, "capture.created", row);
    return { status: 201, body: row };
  });
}

export function createMethod(payload: Json, requestId?: string) {
  return idempotent("POST /methods", requestId, payload, () => {
    const row = { id: randomUUID(), capture_id: payload.capture_id || null, title: payload.title, purpose: payload.purpose, revision_label: payload.revision_label || "r1", steps_json: JSON.stringify(payload.steps || []), conditions: payload.conditions || null, created_at: now() };
    if (!row.title || !row.purpose) throw new BusinessError(400, "method_fields_required", "方法标题和用途不能为空");
    getDb().prepare("INSERT INTO methods VALUES (@id,@capture_id,@title,@purpose,@revision_label,@steps_json,@conditions,@created_at)").run(row);
    event("method", row.id, "method.created", row);
    return { status: 201, body: { ...row, steps: JSON.parse(row.steps_json), steps_json: undefined } };
  });
}

export function createTrial(payload: Json, requestId?: string) {
  return idempotent("POST /trials", requestId, payload, () => {
    const timestamp = now();
    const project = projectOrThrow(payload.project_id);
    const row = { id: randomUUID(), title: text(payload.title), goal: text(payload.goal), method_id: optionalText(payload.method_id), capture_id: optionalText(payload.capture_id), project_id: project?.id || null, status: text(payload.status) || "in_progress", environment: optionalText(payload.environment), actual_result: null, code_repository: optionalText(payload.code_repository), code_branch: optionalText(payload.code_branch), code_commit: optionalText(payload.code_commit), next_step: optionalText(payload.next_step), revision: 1, created_at: timestamp, updated_at: timestamp };
    if (!row.title || !row.goal) throw new BusinessError(400, "trial_fields_required", "尝试标题和目标不能为空");
    getDb().prepare("INSERT INTO trials(id,title,goal,method_id,capture_id,project_id,status,environment,actual_result,code_repository,code_branch,code_commit,next_step,revision,created_at,updated_at) VALUES (@id,@title,@goal,@method_id,@capture_id,@project_id,@status,@environment,@actual_result,@code_repository,@code_branch,@code_commit,@next_step,@revision,@created_at,@updated_at)").run(row);
    event("trial", row.id, "trial.created", row);
    return { status: 201, body: row };
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
    const row = { id: randomUUID(), name, category, path: optionalText(payload.path), description: optionalText(payload.description), status: text(payload.status) || "active", profile_json: profileJson(payload.profile, getProjectProfile({ name })), created_at: timestamp, updated_at: timestamp };
    getDb().prepare("INSERT INTO projects(id,name,category,path,description,status,profile_json,created_at,updated_at) VALUES (@id,@name,@category,@path,@description,@status,@profile_json,@created_at,@updated_at)").run(row);
    event("project", row.id, "project.created", row);
    return { status: 201, body: projectView(row) };
  });
}

export function updateProject(id: string, payload: Json, requestId?: string) {
  return idempotent(`PATCH /projects/${id}`, requestId, payload, () => {
    const current = getDb().prepare("SELECT * FROM projects WHERE id=?").get(id) as Json | undefined;
    if (!current) throw new BusinessError(404, "project_not_found", "项目不存在");
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
      updated_at: now(),
    };
    getDb().prepare("UPDATE projects SET name=@name,category=@category,description=@description,status=@status,profile_json=@profile_json,updated_at=@updated_at WHERE id=@id").run(next);
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
    db.prepare("INSERT INTO captures VALUES (@id,@kind,@title,@content,@source,@read_status,@created_at)").run(capture);
    db.prepare("INSERT INTO trials(id,title,goal,method_id,capture_id,project_id,status,environment,actual_result,code_repository,code_branch,code_commit,next_step,revision,created_at,updated_at) VALUES (@id,@title,@goal,@method_id,@capture_id,@project_id,@status,@environment,@actual_result,@code_repository,@code_branch,@code_commit,@next_step,@revision,@created_at,@updated_at)").run(trial);
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
    db.prepare("INSERT INTO deliverable_versions VALUES (@id,@deliverable_id,@ordinal,@content,@previous_version_id,@handles_feedback_json,@created_at)").run(version);
    event("deliverable", deliverable.id, "deliverable.created", deliverable);
    event("deliverable_version", version.id, "version.created", version);
    return { status: 201, body: { ...deliverable, version: { ...version, handles_feedback_ids: [] } } };
  });
}

export function createVersion(deliverableId: string, payload: Json, requestId?: string) {
  return idempotent(`POST /deliverables/${deliverableId}/versions`, requestId, payload, () => {
    const db = getDb();
    const deliverable = db.prepare("SELECT id FROM deliverables WHERE id = ?").get(deliverableId);
    if (!deliverable) throw new BusinessError(404, "deliverable_not_found", "成果不存在");
    const latest = db.prepare("SELECT * FROM deliverable_versions WHERE deliverable_id = ? ORDER BY ordinal DESC LIMIT 1").get(deliverableId) as Json | undefined;
    const feedbackIds = Array.isArray(payload.handles_feedback_ids) ? payload.handles_feedback_ids.map((id) => text(id)).filter(Boolean) : [];
    if (new Set(feedbackIds).size !== feedbackIds.length) throw new BusinessError(400, "feedback_duplicate", "同一条反馈不能重复处理");
    const row = { id: randomUUID(), deliverable_id: deliverableId, ordinal: latest ? Number(latest.ordinal) + 1 : 1, content: text(payload.content), previous_version_id: latest?.id || null, handles_feedback_json: JSON.stringify(feedbackIds), created_at: now() };
    if (!row.content) throw new BusinessError(400, "version_content_required", "成果内容不能为空");
    db.prepare("INSERT INTO deliverable_versions VALUES (@id,@deliverable_id,@ordinal,@content,@previous_version_id,@handles_feedback_json,@created_at)").run(row);
    for (const feedbackId of feedbackIds) {
      const feedback = db.prepare("SELECT f.id, f.status FROM feedback f JOIN deliverable_versions v ON v.id=f.version_id WHERE f.id=? AND v.deliverable_id=?").get(feedbackId, deliverableId) as { id: string; status: string } | undefined;
      if (!feedback) throw new BusinessError(400, "feedback_mismatch", "反馈不属于该成果");
      if (feedback.status !== "open") throw new BusinessError(409, "feedback_already_handled", "反馈已经处理，请重新读取当前状态");
      db.prepare("UPDATE feedback SET status='handled',handled_at=? WHERE id=?").run(now(), feedbackId);
    }
    event("deliverable_version", row.id, "version.created", { ...row, handles_feedback_ids: feedbackIds });
    return { status: 201, body: { ...row, handles_feedback_ids: JSON.parse(row.handles_feedback_json), handles_feedback_json: undefined } };
  });
}

export function createFeedback(payload: Json, requestId?: string) {
  return idempotent("POST /feedback", requestId, payload, () => {
    const versionId = text(payload.version_id);
    if (!getDb().prepare("SELECT id FROM deliverable_versions WHERE id=?").get(versionId)) throw new BusinessError(404, "version_not_found", "成果版本不存在");
    const row = { id: randomUUID(), version_id: versionId, content: text(payload.content), status: "open", source: feedbackSource(payload.source), kind: feedbackKind(payload.kind), handled_at: null, created_at: now() };
    if (!row.content) throw new BusinessError(400, "feedback_content_required", "反馈不能为空");
    getDb().prepare("INSERT INTO feedback(id,version_id,content,status,source,kind,handled_at,created_at) VALUES (@id,@version_id,@content,@status,@source,@kind,@handled_at,@created_at)").run(row);
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
    event("decision", row.id, "decision.created", row);
    return { status: 201, body: row };
  });
}

export function acceptVersion(deliverableId: string, payload: Json, requestId?: string) {
  return idempotent(`POST /deliverables/${deliverableId}/accept`, requestId, payload, () => {
    const version = getDb().prepare("SELECT id FROM deliverable_versions WHERE id=? AND deliverable_id=?").get(payload.version_id, deliverableId);
    if (!version) throw new BusinessError(400, "version_mismatch", "版本不属于该成果");
    getDb().prepare("UPDATE deliverables SET accepted_version_id=? WHERE id=?").run(payload.version_id, deliverableId);
    event("deliverable", deliverableId, "deliverable.accepted", { version_id: payload.version_id, actor: "user" });
    return { status: 200, body: { id: deliverableId, accepted_version_id: payload.version_id, publication_status: "not_published" } };
  });
}

function hydrateTrial(trial: Json): HydratedTrial {
  const db = getDb();
  const method = trial.method_id ? db.prepare("SELECT * FROM methods WHERE id=?").get(trial.method_id) as Json : null;
  const captureId = trial.capture_id || method?.capture_id;
  const capture = captureId ? db.prepare("SELECT * FROM captures WHERE id=?").get(captureId) as Json : null;
  const project = trial.project_id ? db.prepare("SELECT id,name,category,status FROM projects WHERE id=?").get(trial.project_id) as Json : null;
  const deliverables = db.prepare("SELECT * FROM deliverables WHERE trial_id=? ORDER BY created_at").all(trial.id) as Json[];
  const nested = deliverables.map((deliverable) => {
    const versions = db.prepare("SELECT * FROM deliverable_versions WHERE deliverable_id=? ORDER BY ordinal DESC").all(deliverable.id) as Json[];
    return { ...deliverable, versions: versions.map((version) => ({ ...version, handles_feedback_ids: JSON.parse(String(version.handles_feedback_json)), feedback: db.prepare("SELECT * FROM feedback WHERE version_id=? ORDER BY created_at").all(version.id) as Json[] })) } as unknown as HydratedDeliverable;
  });
  const decisions = db.prepare("SELECT * FROM decisions WHERE trial_id=? ORDER BY created_at DESC").all(trial.id) as Array<Json & { next_step?: string }>;
  return { ...trial, project, method: method ? { ...method, steps: JSON.parse(String(method.steps_json)) } : null, capture, deliverables: nested, decisions } as unknown as HydratedTrial;
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
  const latestDeliverable = latestTrial?.deliverables?.[0] || null;
  const latestVersion = latestDeliverable?.versions?.[0] || null;
  return {
    trial_count: trials.length,
    open_feedback_count: openFeedback.length,
    open_feedback: openFeedback.slice(0, 8),
    latest_trial: latestTrial ? { id: latestTrial.id, title: latestTrial.title, goal: latestTrial.goal, status: latestTrial.status, updated_at: latestTrial.updated_at, code_commit: latestTrial.code_commit || null } : null,
    latest_deliverable: latestDeliverable ? { id: latestDeliverable.id, title: latestDeliverable.title, type: latestDeliverable.type, version: latestVersion ? latestVersion.ordinal : null, content: latestVersion?.content || null, updated_at: latestVersion?.created_at || latestDeliverable.created_at } : null,
    next_step: latestTrial?.next_step || latestTrial?.decisions?.[0]?.next_step || null,
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
  const latestDeliverable = latestTrial?.deliverables?.[0] || null;
  const latestVersion = latestDeliverable?.versions?.[0] || null;
  return {
    ...projectView(project),
    locations,
    trials,
    open_feedback: openFeedback,
    latest_trial: latestTrial,
    latest_deliverable: latestDeliverable ? { ...latestDeliverable, latest_version: latestVersion } : null,
    next_step: latestTrial?.next_step || latestTrial?.decisions?.[0]?.next_step || null,
  };
}

export function getEvents(after: number) {
  const db = getDb();
  const events = db.prepare("SELECT * FROM events WHERE sequence>? ORDER BY sequence LIMIT 100").all(Number.isFinite(after) ? Math.max(0, after) : 0);
  const latestEvent = db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events").get() as { sequence: number };
  const last = events.at(-1) as { sequence?: number } | undefined;
  return { events, latest_event_sequence: latestEvent.sequence, next_after: last?.sequence || after };
}
