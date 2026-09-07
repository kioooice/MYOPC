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
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS methods (
  id TEXT PRIMARY KEY, capture_id TEXT REFERENCES captures(id),
  title TEXT NOT NULL, purpose TEXT NOT NULL, revision_label TEXT NOT NULL,
  steps_json TEXT NOT NULL, conditions TEXT, created_at TEXT NOT NULL
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
CREATE INDEX IF NOT EXISTS idx_versions_deliverable ON deliverable_versions(deliverable_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_feedback_version ON feedback(version_id, status);
CREATE INDEX IF NOT EXISTS idx_project_locations_project ON project_locations(project_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_events_sequence ON events(sequence);
`;

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
  return instance;
}

export function closeDbForTests() {
  instance?.close();
  instance = undefined;
}
