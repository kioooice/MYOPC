export const WORKSPACE_BOARDS = ["personal", "personal_project", "enterprise_project", "media"] as const;
export type WorkspaceBoard = (typeof WORKSPACE_BOARDS)[number];

export const SUBJECT_STATUSES = ["active", "paused", "archived"] as const;
export type SubjectStatus = (typeof SUBJECT_STATUSES)[number];

export const RECORD_KINDS = ["statement", "observation", "decision", "question", "feedback", "correction"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const RECORD_ORIGINS = ["user", "agent", "external"] as const;
export type RecordOrigin = (typeof RECORD_ORIGINS)[number];

export const RECORD_ASSERTIONS = ["reported", "inferred"] as const;
export type RecordAssertion = (typeof RECORD_ASSERTIONS)[number];

export const REFERENCE_KINDS = ["subject", "knowledge", "repository", "file", "url"] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export const RECORD_MODES = ["history", "set_current", "clear_current"] as const;
export type RecordMode = (typeof RECORD_MODES)[number];

export type WorkspaceReference = {
  kind: ReferenceKind;
  id?: string;
  locator?: string;
  label?: string;
};

export type WorkspaceSubject = {
  id: string;
  board: WorkspaceBoard;
  title: string;
  status: SubjectStatus;
  revision: number;
  references: WorkspaceReference[];
  created_at: string;
  updated_at: string;
};

export type WorkspaceRecord = {
  id: string;
  subject_id: string;
  kind: RecordKind;
  title: string;
  content: string;
  rationale: string | null;
  references: WorkspaceReference[];
  origin: RecordOrigin;
  assertion: RecordAssertion;
  source_locator: string | null;
  observed_at: string;
  recorded_at: string;
  slot: string | null;
  replaces_id: string | null;
};

export type WorkspaceHead = {
  subject_id: string;
  slot: string;
  record_id: string;
};

export type WorkspaceReferenceSource = {
  reference: WorkspaceReference;
  status: "available" | "missing" | "unresolved";
  source_type: string;
  id?: string | null;
  label?: string | null;
  updated_at?: string | null;
  observed_at?: string | null;
  branch?: string | null;
  commit_sha?: string | null;
  details?: Record<string, unknown>;
};

