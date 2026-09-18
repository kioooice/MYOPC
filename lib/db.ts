import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let instance: Database.Database | undefined;

const schema = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
  content TEXT, source TEXT, read_status TEXT NOT NULL,
  file_name TEXT, mime_type TEXT, file_size INTEGER, file_path TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS methods (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES captures(id),
  title TEXT NOT NULL, purpose TEXT NOT NULL, revision_label TEXT NOT NULL,
  steps_json TEXT NOT NULL, conditions TEXT, family_id TEXT,
  previous_method_id TEXT REFERENCES methods(id), revision_number INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trials (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, goal TEXT NOT NULL,
  method_id TEXT REFERENCES methods(id), capture_id TEXT REFERENCES captures(id),
  project_id TEXT REFERENCES projects(id), status TEXT NOT NULL,
  environment TEXT, actual_result TEXT, code_repository TEXT, code_branch TEXT,
  code_commit TEXT, next_step TEXT, revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
  path TEXT, description TEXT, status TEXT NOT NULL DEFAULT 'active', profile_json TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_locations (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL, environment TEXT NOT NULL, path TEXT,
  repository_url TEXT, branch TEXT, commit_sha TEXT, deploy_url TEXT, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY, trial_id TEXT NOT NULL REFERENCES trials(id),
  title TEXT NOT NULL, type TEXT NOT NULL,
  accepted_version_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deliverable_versions (
  id TEXT PRIMARY KEY, deliverable_id TEXT NOT NULL REFERENCES deliverables(id),
  ordinal INTEGER NOT NULL, content TEXT NOT NULL,
  previous_version_id TEXT REFERENCES deliverable_versions(id),
  handles_feedback_json TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL DEFAULT 'pending_review', created_at TEXT NOT NULL,
  UNIQUE(deliverable_id, ordinal)
);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES deliverable_versions(id),
  content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  source TEXT NOT NULL DEFAULT 'user', kind TEXT NOT NULL DEFAULT 'revision',
  handled_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, trial_id TEXT NOT NULL REFERENCES trials(id),
  basis_feedback_id TEXT REFERENCES feedback(id), rationale TEXT NOT NULL,
  adjustment TEXT NOT NULL, next_step TEXT NOT NULL,
  execution_status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL, status TEXT NOT NULL,
  purpose TEXT NOT NULL, usage TEXT, location TEXT, source_url TEXT,
  verification TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS space_entries (
  id TEXT PRIMARY KEY, title TEXT NOT NULL UNIQUE, type TEXT NOT NULL, content TEXT NOT NULL,
  source_url TEXT, verification TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_tools (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, tool_id)
);
CREATE TABLE IF NOT EXISTS project_space_entries (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  space_entry_id TEXT NOT NULL REFERENCES space_entries(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, space_entry_id)
);
CREATE TABLE IF NOT EXISTS tool_space_entries (
  tool_id TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  space_entry_id TEXT NOT NULL REFERENCES space_entries(id) ON DELETE CASCADE,
  PRIMARY KEY (tool_id, space_entry_id)
);
CREATE TABLE IF NOT EXISTS trial_captures (
  trial_id TEXT NOT NULL REFERENCES trials(id) ON DELETE CASCADE,
  capture_id TEXT NOT NULL REFERENCES captures(id),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (trial_id, capture_id)
);
CREATE TABLE IF NOT EXISTS events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
  client_request_id TEXT PRIMARY KEY, route TEXT NOT NULL,
  payload_hash TEXT NOT NULL, response_status INTEGER NOT NULL,
  response_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]', related_json TEXT NOT NULL DEFAULT '[]',
  link TEXT, updated_at TEXT, sources_json TEXT NOT NULL DEFAULT '[]',
  extra_json TEXT NOT NULL DEFAULT '{}', body TEXT NOT NULL, rel_path TEXT NOT NULL,
  content_hash TEXT NOT NULL, visible INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, changed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_reading_notes (
  entry_id TEXT PRIMARY KEY REFERENCES knowledge_entries(id) ON DELETE CASCADE,
  prompt_version TEXT NOT NULL, source_hash TEXT NOT NULL, model TEXT NOT NULL,
  status TEXT NOT NULL, content_json TEXT, error TEXT,
  generated_at TEXT, attempted_at TEXT NOT NULL, attempted_source_hash TEXT
);
CREATE TABLE IF NOT EXISTS knowledge_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  directory TEXT, repository TEXT, branch TEXT, commit_sha TEXT,
  status TEXT NOT NULL, message TEXT,
  entry_count INTEGER NOT NULL DEFAULT 0, added_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0, removed_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_kind ON knowledge_entries(kind, visible, title);
CREATE INDEX IF NOT EXISTS idx_versions_deliverable ON deliverable_versions(deliverable_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_feedback_version ON feedback(version_id, status);
CREATE INDEX IF NOT EXISTS idx_project_locations_project ON project_locations(project_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_events_sequence ON events(sequence);
CREATE INDEX IF NOT EXISTS idx_trial_captures_capture ON trial_captures(capture_id, trial_id);
`;

const assetSeeds = {
  projects: [
    ["seed-project-myopc", "MYOPC", "tool", "active", "个人项目、工具与知识资产空间", "https://github.com/kioooice/MYOPC"],
    ["seed-project-observer", "Project Observer", "tool", "active", "本地优先的项目状态、记忆与理解工作台", "https://github.com/kioooice/Project-Observer"],
    ["seed-project-helm", "Helm", "tool", "done", "已完成的个人项目关系理解工具", "https://github.com/kioooice/Helm"],
    ["seed-project-scholarscope", "ScholarScope Desktop", "tool", "active", "个人文献检索桌面工具", "https://github.com/kioooice/scholarscope-desktop"],
    ["seed-project-knowledge", "Knowledge Engine", "business", "active", "面向企业 Agent 的知识构建、检索与评测能力", "https://github.com/kioooice/surface-treatment-agent-workbench"],
    ["seed-project-enterprise-agent", "Enterprise Agent", "business", "paused", "以知识能力层为基础的企业 Agent 长期方向", "https://github.com/kioooice/agent"],
  ],
  tools: [
    ["seed-tool-project-observer", "Project Observer", "自建工具", "正在使用", "恢复项目事实、状态与开发演进", "本地运行，按项目目录建立观察", "GitHub / 本地", "https://github.com/kioooice/Project-Observer", "GitHub 仓库确认 v0.12；当前主链路包含 Repository Map、Evidence Map、Project Model 与 Commit Flow。"],
    ["seed-tool-easel", "Easel", "开源项目", "正在使用", "社交媒体内容策划、制作与运营", "独立运行，不由 OPC 复制其运营功能", "服务器", "https://github.com/ZJU-REAL/Easel", "服务器 easel-gateway 与 easel-web 服务均为 active。"],
    ["seed-tool-karakeep", "Karakeep", "服务", "正在使用", "保存外部文章、链接、资料与灵感", "作为 OPC 的外部输入层", "服务器", "https://github.com/karakeep-app/karakeep", "服务器 Karakeep 0.33.2 容器 healthy。"],
    ["seed-tool-autodl", "AutoDL", "服务", "尝试中", "提供视频生成所需的在线 GPU 计算", "按实际任务启动计算资源", "云服务", "https://www.autodl.com", "上下文已确定为视频制作路径；本轮未核对在线实例。"],
    ["seed-tool-h3", "H3", "模型", "尝试中", "视频生成能力", "由 Easel 工作流按需调用", "AutoDL", null, "具体模型与版本仍待实际工作流核对。"],
    ["seed-tool-github", "GitHub", "服务", "正在使用", "保存代码与项目交付事实", "仓库、提交和远程同步", "SaaS", "https://github.com/kioooice", "MYOPC、Project Observer、Helm、ScholarScope 等仓库已核对。"],
    ["seed-tool-codex", "Codex", "Agent", "正在使用", "执行代码开发、测试与交付", "通过本地工作树和 GitHub 协作", "本地", null, "当前 MYOPC 改造与三端部署由 Codex 实际执行。"],
    ["seed-tool-cloud-deploy", "GitHub 到私人云安全部署", "Workflow", "已验证", "将已提交版本部署到私人云并保留数据", "Git 同步、测试、构建、容器重建和健康检查", "GitHub / 服务器", null, "已验证提交一致性、SQLite 持久化与 HTTP 200；凭据不进入资产记录。"],
  ],
  space: [
    ["seed-space-cloud-node", "私人云工作节点初始化", "工作流", "服务器环境要区分代码同步与业务数据持久化。初始化后分别验证运行服务、磁盘、内存、端口和失败服务；任何模拟或历史状态都不能替代现场核查。", null, "历史部署曾验证；当前服务器已重新核查基础运行状态。"],
    ["seed-space-safe-deploy", "GitHub 到私人云服务安全部署", "经验", "部署应以已提交 SHA 为单位，先确认工作树和远程提交，再备份 SQLite，执行测试、lint、build，重启服务并核对 release 标记与 HTTP 健康。GitHub 私有仓库无法直接拉取时，可传输同一提交的 Git bundle，但仍要让服务器工作树落在可追踪提交上。", null, "2026-09-09 使用同一提交完成本地、GitHub 与服务器一致性验证。"],
    ["seed-space-boundaries", "OPC 与外部工具的职责边界", "决策", "Karakeep 负责外部发现，Projects 保存当前项目画像，Toolbox 保存可调用能力，Space 保存经过实践形成的认知，Project Observer 解释项目演进，Easel 负责内容运营，AutoDL/H3 提供视频计算，Codex 执行开发。", null, "来自当前冻结产品定义。"],
  ],
};

export function getDataDirectory() {
  return process.env.MYOPC_DATA_DIR || join(homedir(), ".myopc");
}

export function getDb() {
  if (instance) return instance;
  const directory = getDataDirectory();
  mkdirSync(directory, { recursive: true });
  instance = new Database(join(directory, "myopc.sqlite"));
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  instance.exec(schema);

  const hasColumn = (table: string, column: string) =>
    (instance?.pragma(`table_info(${table})`) as Array<{ name: string }>).some((item) => item.name === column);
  const addColumn = (table: string, column: string, definition: string) => {
    if (!hasColumn(table, column)) instance?.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };

  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)").run(new Date().toISOString());
  const trialColumns = instance.pragma("table_info(trials)") as Array<{ name: string }>;
  if (!trialColumns.some((column) => column.name === "capture_id")) {
    instance.exec("ALTER TABLE trials ADD COLUMN capture_id TEXT REFERENCES captures(id)");
    instance.exec("UPDATE trials SET capture_id=(SELECT capture_id FROM methods WHERE methods.id=trials.method_id) WHERE method_id IS NOT NULL");
  }
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?)").run(new Date().toISOString());
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, ?)").run(new Date().toISOString());

  addColumn("projects", "profile_json", "TEXT");
  const legacyProjects = instance.prepare("SELECT id, path, created_at, updated_at FROM projects WHERE path IS NOT NULL AND path <> ''").all() as Array<{ id: string; path: string; created_at: string; updated_at: string }>;
  const insertLocation = instance.prepare("INSERT OR IGNORE INTO project_locations(id, project_id, label, environment, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const project of legacyProjects) {
    const exists = instance.prepare("SELECT 1 FROM project_locations WHERE project_id=? LIMIT 1").get(project.id);
    if (!exists) insertLocation.run(randomUUID(), project.id, "原有工作目录", "本地", project.path, project.created_at, project.updated_at);
  }
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, ?)").run(new Date().toISOString());

  addColumn("trials", "project_id", "TEXT REFERENCES projects(id)");
  addColumn("trials", "code_repository", "TEXT");
  addColumn("trials", "code_branch", "TEXT");
  addColumn("trials", "code_commit", "TEXT");
  addColumn("trials", "next_step", "TEXT");
  instance.exec("CREATE INDEX IF NOT EXISTS idx_trials_project ON trials(project_id, updated_at)");
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, ?)").run(new Date().toISOString());

  addColumn("feedback", "source", "TEXT NOT NULL DEFAULT 'user'");
  addColumn("feedback", "kind", "TEXT NOT NULL DEFAULT 'revision'");
  addColumn("feedback", "handled_at", "TEXT");
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (6, ?)").run(new Date().toISOString());

  addColumn("projects", "revision", "INTEGER NOT NULL DEFAULT 1");
  addColumn("deliverable_versions", "review_status", "TEXT NOT NULL DEFAULT 'pending_review'");
  instance.exec("UPDATE deliverable_versions SET review_status='accepted' WHERE id IN (SELECT accepted_version_id FROM deliverables WHERE accepted_version_id IS NOT NULL)");
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (7, ?)").run(new Date().toISOString());

  addColumn("captures", "file_name", "TEXT");
  addColumn("captures", "mime_type", "TEXT");
  addColumn("captures", "file_size", "INTEGER");
  addColumn("captures", "file_path", "TEXT");
  addColumn("methods", "family_id", "TEXT");
  addColumn("methods", "previous_method_id", "TEXT REFERENCES methods(id)");
  addColumn("methods", "revision_number", "INTEGER NOT NULL DEFAULT 1");
  instance.exec("UPDATE methods SET family_id=id WHERE family_id IS NULL OR family_id=''");
  instance.exec("CREATE TABLE IF NOT EXISTS trial_captures (trial_id TEXT NOT NULL REFERENCES trials(id) ON DELETE CASCADE, capture_id TEXT NOT NULL REFERENCES captures(id), position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY (trial_id, capture_id))");
  instance.exec("CREATE INDEX IF NOT EXISTS idx_trial_captures_capture ON trial_captures(capture_id, trial_id)");
  instance.exec("INSERT OR IGNORE INTO trial_captures(trial_id, capture_id, position, created_at) SELECT id, capture_id, 0, created_at FROM trials WHERE capture_id IS NOT NULL");
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (8, ?)").run(new Date().toISOString());

  const timestamp = new Date().toISOString();
  if (process.env.NODE_ENV !== "test") {
  const insertProject = instance.prepare("INSERT OR IGNORE INTO projects(id,name,category,description,status,revision,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)");
  const insertSeedLocation = instance.prepare("INSERT OR IGNORE INTO project_locations(id,project_id,label,environment,repository_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?)");
  for (const [id, name, category, status, description, repositoryUrl] of assetSeeds.projects) {
    insertProject.run(id, name, category, description, status, timestamp, timestamp);
    instance.prepare("UPDATE projects SET category=? WHERE id=?").run(category, id);
    insertSeedLocation.run(`${id}-github`, id, "GitHub", "远程仓库", repositoryUrl, timestamp, timestamp);
  }
  const insertTool = instance.prepare("INSERT OR IGNORE INTO tools(id,name,type,status,purpose,usage,location,source_url,verification,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  for (const row of assetSeeds.tools) insertTool.run(...row, timestamp, timestamp);
  const insertSpace = instance.prepare("INSERT OR IGNORE INTO space_entries(id,title,type,content,source_url,verification,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)");
  for (const row of assetSeeds.space) insertSpace.run(...row, timestamp, timestamp);
  const projectTool = instance.prepare("INSERT OR IGNORE INTO project_tools(project_id,tool_id) VALUES (?,?)");
  for (const toolId of ["seed-tool-project-observer", "seed-tool-github", "seed-tool-codex", "seed-tool-cloud-deploy"]) projectTool.run("seed-project-myopc", toolId);
  projectTool.run("seed-project-observer", "seed-tool-github");
  projectTool.run("seed-project-knowledge", "seed-tool-github");
  const projectSpace = instance.prepare("INSERT OR IGNORE INTO project_space_entries(project_id,space_entry_id) VALUES (?,?)");
  projectSpace.run("seed-project-myopc", "seed-space-safe-deploy");
  projectSpace.run("seed-project-myopc", "seed-space-boundaries");
  const toolSpace = instance.prepare("INSERT OR IGNORE INTO tool_space_entries(tool_id,space_entry_id) VALUES (?,?)");
  toolSpace.run("seed-tool-cloud-deploy", "seed-space-safe-deploy");
  }
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (9, ?)").run(timestamp);
  addColumn("knowledge_reading_notes", "attempted_source_hash", "TEXT");
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (10, ?)").run(new Date().toISOString());
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (11, ?)").run(new Date().toISOString());
  // 开发知识复用（V0）：任务结果先落在 OPC，可长期保留的部分变成候选经验。
  instance.exec("CREATE TABLE IF NOT EXISTS agent_task_results (id TEXT PRIMARY KEY, repository TEXT NOT NULL DEFAULT '', task TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT '', changes_json TEXT NOT NULL DEFAULT '[]', validation_json TEXT NOT NULL DEFAULT '[]', findings_json TEXT NOT NULL DEFAULT '[]', knowledge_used_json TEXT NOT NULL DEFAULT '[]', summary TEXT NOT NULL DEFAULT '', reusable INTEGER NOT NULL DEFAULT 0, candidate_count INTEGER NOT NULL DEFAULT 0, model TEXT, error TEXT, created_at TEXT NOT NULL)");
  instance.exec("CREATE INDEX IF NOT EXISTS idx_agent_task_results_repository ON agent_task_results(repository, created_at)");
  instance.exec("CREATE INDEX IF NOT EXISTS idx_agent_task_results_created ON agent_task_results(created_at)");
  instance.exec("CREATE TABLE IF NOT EXISTS knowledge_candidates (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '', suggestion TEXT NOT NULL DEFAULT '', repository TEXT NOT NULL DEFAULT '', task_result_id TEXT REFERENCES agent_task_results(id), related_entry_ids_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  instance.exec("CREATE INDEX IF NOT EXISTS idx_knowledge_candidates_status ON knowledge_candidates(status, created_at)");
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (12, ?)").run(new Date().toISOString());
  // OPC V0.2：项目关键进展即时回流 + 新会话恢复。事件与回流批次分开存，事件保留更正历史。
  addColumn("agent_task_results", "submission_id", "TEXT");
  addColumn("agent_task_results", "machine", "TEXT");
  addColumn("agent_task_results", "branch", "TEXT");
  addColumn("agent_task_results", "commit_sha", "TEXT");
  addColumn("agent_task_results", "dirty", "INTEGER NOT NULL DEFAULT 0");
  addColumn("agent_task_results", "event_count", "INTEGER NOT NULL DEFAULT 0");
  instance.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_task_results_submission ON agent_task_results(submission_id) WHERE submission_id IS NOT NULL");
  instance.exec(`CREATE TABLE IF NOT EXISTS project_events (
    id TEXT PRIMARY KEY,
    repository TEXT NOT NULL DEFAULT '',
    task_result_id TEXT REFERENCES agent_task_results(id),
    submission_id TEXT,
    event_index INTEGER NOT NULL DEFAULT 0,
    event_type TEXT NOT NULL DEFAULT 'progress',
    topic TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    rationale TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'reported',
    verification TEXT NOT NULL DEFAULT '',
    evidence_json TEXT NOT NULL DEFAULT '[]',
    next_step TEXT NOT NULL DEFAULT '',
    machine TEXT,
    branch TEXT,
    commit_sha TEXT,
    dirty INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'codex',
    supersedes_id TEXT,
    superseded_by TEXT,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  instance.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_project_events_submission ON project_events(submission_id, event_index) WHERE submission_id IS NOT NULL");
  instance.exec("CREATE INDEX IF NOT EXISTS idx_project_events_repository ON project_events(repository, occurred_at)");
  instance.exec("CREATE INDEX IF NOT EXISTS idx_project_events_type ON project_events(repository, event_type, occurred_at)");
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (13, ?)").run(new Date().toISOString());
  // OPC V0.2：候选经验处置（已合并 / 已新增 / 暂存 / 舍弃），处理理由与适用知识仓库提交一并保留。
  addColumn("knowledge_candidates", "resolution_note", "TEXT");
  addColumn("knowledge_candidates", "resolved_entry_id", "TEXT");
  addColumn("knowledge_candidates", "knowledge_commit", "TEXT");
  addColumn("knowledge_candidates", "resolved_at", "TEXT");
  instance.exec("CREATE INDEX IF NOT EXISTS idx_knowledge_candidates_resolved ON knowledge_candidates(status, resolved_at)");
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (14, ?)").run(new Date().toISOString());
  // 一人公司改造阶段 2：主题、历史记录与明确的当前状态。
  instance.exec(`CREATE TABLE IF NOT EXISTS workspace_subjects (
    id TEXT PRIMARY KEY,
    board TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    revision INTEGER NOT NULL DEFAULT 1,
    references_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  instance.exec(`CREATE TABLE IF NOT EXISTS workspace_records (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES workspace_subjects(id),
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    rationale TEXT,
    references_json TEXT NOT NULL DEFAULT '[]',
    origin TEXT NOT NULL,
    assertion TEXT NOT NULL,
    source_locator TEXT,
    observed_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    slot TEXT,
    replaces_id TEXT REFERENCES workspace_records(id)
  )`);
  instance.exec(`CREATE TABLE IF NOT EXISTS workspace_heads (
    subject_id TEXT NOT NULL REFERENCES workspace_subjects(id),
    slot TEXT NOT NULL,
    record_id TEXT NOT NULL REFERENCES workspace_records(id),
    PRIMARY KEY (subject_id, slot)
  )`);
  instance.exec("CREATE INDEX IF NOT EXISTS idx_workspace_subjects_board_status ON workspace_subjects(board, status, updated_at)");
  instance.exec("CREATE INDEX IF NOT EXISTS idx_workspace_records_subject_time ON workspace_records(subject_id, observed_at DESC, recorded_at DESC)");
  instance.exec("CREATE INDEX IF NOT EXISTS idx_workspace_records_slot ON workspace_records(subject_id, slot, observed_at DESC)");
  instance.exec("CREATE INDEX IF NOT EXISTS idx_workspace_heads_record ON workspace_heads(record_id)");
  instance.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (15, ?)").run(new Date().toISOString());
  return instance;
}

export function closeDbForTests() {
  instance?.close();
  instance = undefined;
}
