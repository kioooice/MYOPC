import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db";

type Json = Record<string, unknown>;
type Stored = { status: number; body: Json };

export class BusinessError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const now = () => new Date().toISOString();
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
    const row = { id: randomUUID(), title: payload.title, goal: payload.goal, method_id: payload.method_id || null, capture_id: payload.capture_id || null, status: payload.status || "in_progress", environment: payload.environment || null, actual_result: null, revision: 1, created_at: timestamp, updated_at: timestamp };
    if (!row.title || !row.goal) throw new BusinessError(400, "trial_fields_required", "尝试标题和目标不能为空");
    getDb().prepare("INSERT INTO trials(id,title,goal,method_id,capture_id,status,environment,actual_result,revision,created_at,updated_at) VALUES (@id,@title,@goal,@method_id,@capture_id,@status,@environment,@actual_result,@revision,@created_at,@updated_at)").run(row);
    event("trial", row.id, "trial.created", row);
    return { status: 201, body: row };
  });
}

export function startTrial(payload: Json, requestId?: string) {
  return idempotent("POST /starts", requestId, payload, () => {
    const title = String(payload.title || "").trim();
    const content = String(payload.content || "").trim();
    const kind = String(payload.kind || "need");
    if (!title || !content) throw new BusinessError(400, "start_fields_required", "标题和具体内容不能为空");
    if (!["need", "discovery", "failure"].includes(kind)) throw new BusinessError(400, "start_kind_invalid", "入口类型无效");
    const db = getDb();
    const timestamp = now();
    const capture = { id: randomUUID(), kind, title, content, source: null, read_status: "provided", created_at: timestamp };
    const trial = { id: randomUUID(), title, goal: content, method_id: null, capture_id: capture.id, status: "in_progress", environment: "web", actual_result: null, revision: 1, created_at: timestamp, updated_at: timestamp };
    db.prepare("INSERT INTO captures VALUES (@id,@kind,@title,@content,@source,@read_status,@created_at)").run(capture);
    db.prepare("INSERT INTO trials(id,title,goal,method_id,capture_id,status,environment,actual_result,revision,created_at,updated_at) VALUES (@id,@title,@goal,@method_id,@capture_id,@status,@environment,@actual_result,@revision,@created_at,@updated_at)").run(trial);
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
    const next = { status: payload.status ?? current.status, actual_result: payload.actual_result ?? current.actual_result, environment: payload.environment ?? current.environment, revision: Number(current.revision) + 1, updated_at: now(), id };
    getDb().prepare("UPDATE trials SET status=@status,actual_result=@actual_result,environment=@environment,revision=@revision,updated_at=@updated_at WHERE id=@id").run(next);
    event("trial", id, "trial.updated", next);
    return { status: 200, body: { ...current, ...next } };
  });
}

export function createDeliverable(payload: Json, requestId?: string) {
  return idempotent("POST /deliverables", requestId, payload, () => {
    const row = { id: randomUUID(), trial_id: payload.trial_id, title: payload.title, type: payload.type || "article", accepted_version_id: null, created_at: now() };
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
    const row = { id: randomUUID(), deliverable_id: deliverableId, ordinal: latest ? Number(latest.ordinal) + 1 : 1, content: payload.content, previous_version_id: latest?.id || null, handles_feedback_json: JSON.stringify(payload.handles_feedback_ids || []), created_at: now() };
    if (!row.content) throw new BusinessError(400, "version_content_required", "成果内容不能为空");
    db.prepare("INSERT INTO deliverable_versions VALUES (@id,@deliverable_id,@ordinal,@content,@previous_version_id,@handles_feedback_json,@created_at)").run(row);
    for (const feedbackId of payload.handles_feedback_ids as string[] || []) {
      const feedback = db.prepare("SELECT f.id FROM feedback f JOIN deliverable_versions v ON v.id=f.version_id WHERE f.id=? AND v.deliverable_id=?").get(feedbackId, deliverableId);
      if (!feedback) throw new BusinessError(400, "feedback_mismatch", "反馈不属于该成果");
      db.prepare("UPDATE feedback SET status='handled' WHERE id=?").run(feedbackId);
    }
    event("deliverable_version", row.id, "version.created", { ...row, handles_feedback_ids: payload.handles_feedback_ids || [] });
    return { status: 201, body: { ...row, handles_feedback_ids: JSON.parse(row.handles_feedback_json), handles_feedback_json: undefined } };
  });
}

export function createFeedback(payload: Json, requestId?: string) {
  return idempotent("POST /feedback", requestId, payload, () => {
    const row = { id: randomUUID(), version_id: payload.version_id, content: payload.content, status: "open", created_at: now() };
    if (!row.content) throw new BusinessError(400, "feedback_content_required", "反馈不能为空");
    getDb().prepare("INSERT INTO feedback VALUES (@id,@version_id,@content,@status,@created_at)").run(row);
    event("feedback", row.id, "feedback.created", row);
    return { status: 201, body: row };
  });
}

export function createDecision(payload: Json, requestId?: string) {
  return idempotent("POST /decisions", requestId, payload, () => {
    const row = { id: randomUUID(), trial_id: payload.trial_id, basis_feedback_id: payload.basis_feedback_id || null, rationale: payload.rationale, adjustment: payload.adjustment, next_step: payload.next_step, execution_status: payload.execution_status || "proposed", created_at: now() };
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

function hydrateTrial(trial: Json) {
  const db = getDb();
  const method = trial.method_id ? db.prepare("SELECT * FROM methods WHERE id=?").get(trial.method_id) as Json : null;
  const captureId = trial.capture_id || method?.capture_id;
  const capture = captureId ? db.prepare("SELECT * FROM captures WHERE id=?").get(captureId) as Json : null;
  const deliverables = db.prepare("SELECT * FROM deliverables WHERE trial_id=? ORDER BY created_at").all(trial.id) as Json[];
  const nested = deliverables.map((deliverable) => {
    const versions = db.prepare("SELECT * FROM deliverable_versions WHERE deliverable_id=? ORDER BY ordinal DESC").all(deliverable.id) as Json[];
    return { ...deliverable, versions: versions.map((version) => ({ ...version, handles_feedback_ids: JSON.parse(String(version.handles_feedback_json)), feedback: db.prepare("SELECT * FROM feedback WHERE version_id=? ORDER BY created_at").all(version.id) })) };
  });
  const decisions = db.prepare("SELECT * FROM decisions WHERE trial_id=? ORDER BY created_at DESC").all(trial.id);
  return { ...trial, method: method ? { ...method, steps: JSON.parse(String(method.steps_json)) } : null, capture, deliverables: nested, decisions };
}

export function getContext(trialId: string) {
  const trial = getDb().prepare("SELECT * FROM trials WHERE id=?").get(trialId) as Json | undefined;
  if (!trial) throw new BusinessError(404, "trial_not_found", "尝试不存在");
  return hydrateTrial(trial);
}

export function getDashboard() {
  const trials = getDb().prepare("SELECT * FROM trials ORDER BY updated_at DESC").all() as Json[];
  return { mode: "local_private_data", stage: "S0", trials: trials.map(hydrateTrial) };
}

export function getEvents(after: number) {
  return { events: getDb().prepare("SELECT * FROM events WHERE sequence>? ORDER BY sequence LIMIT 100").all(after) };
}
