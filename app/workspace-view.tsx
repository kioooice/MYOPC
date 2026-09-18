"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Briefcase, Building2, CheckCircle2, ChevronRight, CircleAlert, Clock3, Compass, FileText, History, Info, Link2, Megaphone, RefreshCw, ShieldCheck, UserRound } from "lucide-react";

export type WorkspaceBoard = "overview" | "personal" | "personal_project" | "enterprise_project" | "media";
type BoardId = Exclude<WorkspaceBoard, "overview">;

type WorkspaceReference = { kind: string; id?: string; locator?: string; label?: string };
type WorkspaceSubject = {
  id: string;
  board: BoardId;
  title: string;
  status: string;
  revision: number;
  references: WorkspaceReference[];
  created_at: string;
  updated_at: string;
  source_time?: string | null;
  current_count?: number;
  source_count?: number;
  missing_source_count?: number;
};
type WorkspaceRecord = {
  id: string;
  subject_id: string;
  kind: string;
  title: string;
  content: string;
  rationale?: string | null;
  references: WorkspaceReference[];
  origin: string;
  assertion: string;
  source_locator?: string | null;
  observed_at: string;
  recorded_at: string;
  slot?: string | null;
  replaces_id?: string | null;
  current?: boolean;
  replaced_by?: string | null;
};
type WorkspaceSource = {
  reference: WorkspaceReference;
  status: string;
  source_type: string;
  id?: string | null;
  label?: string | null;
  updated_at?: string | null;
  observed_at?: string | null;
  branch?: string | null;
  commit_sha?: string | null;
  details?: Record<string, unknown>;
};
type WorkspaceContextSubject = {
  subject: WorkspaceSubject;
  current: WorkspaceRecord[];
  history: Array<WorkspaceRecord & { current?: boolean; replaced_by?: string | null }>;
  history_total?: number;
  history_truncated?: boolean;
  sources: WorkspaceSource[];
  source_time?: string | null;
  source_total?: number;
  sources_truncated?: boolean;
  warnings?: Array<{ code: string; reference?: WorkspaceReference; source_type?: string }>;
  newer_material_available?: boolean;
  newer_source_ids?: string[];
};
type WorkspaceContext = {
  used: boolean;
  reason?: string | null;
  scope?: Record<string, unknown>;
  subjects: WorkspaceContextSubject[];
  items: Array<Record<string, unknown>>;
  warnings?: Array<Record<string, unknown>>;
  missing_subject_ids?: string[];
  truncated?: boolean;
  budget_exceeded?: boolean;
  omitted_count?: number;
  omitted_ids?: string[];
};
type WorkspaceSubjectDetail = WorkspaceSubject & {
  source_time?: string | null;
  sources: WorkspaceSource[];
  source_warnings: Array<{ code: string; reference?: WorkspaceReference; source_type?: string }>;
  current: WorkspaceRecord[];
  history: Array<WorkspaceRecord & { current?: boolean; replaced_by?: string | null }>;
  heads: Array<{ subject_id: string; slot: string; record_id: string }>;
  recent_record_ids: string[];
  history_included: boolean;
  history_total: number;
  history_next_offset: number | null;
};
type RecoveryRecord = {
  id: string;
  type?: string;
  title: string;
  content: string;
  rationale?: string;
  status: string;
  verification?: string;
  evidence?: string[];
  nextStep?: string;
  occurredAt: string;
  recordedAt?: string;
  branch?: string | null;
  commit?: string | null;
  dirty?: boolean;
};
type RecoverySummary = {
  used?: boolean;
  reason?: string;
  phase?: { title: string; status: string; occurredAt: string } | null;
  goal?: string | null;
  updatedAt?: string | null;
  recent?: RecoveryRecord[];
  decisions?: RecoveryRecord[];
  environment?: RecoveryRecord[];
  blockers?: RecoveryRecord[];
  nextSteps?: string[];
};
type WorkspaceViewProps = { activeBoard: WorkspaceBoard; onBoardChange: (board: WorkspaceBoard) => void };

type BoardDefinition = {
  id: BoardId;
  label: string;
  title: string;
  description: string;
  empty: string;
  Icon: typeof UserRound;
};

const BOARD_DEFINITIONS: readonly BoardDefinition[] = [
  { id: "personal", label: "个人", title: "个人方向与协作", description: "只放已经确认的个人方向、边界和协作约定。", empty: "个人板块暂时没有可展示的当前主题。", Icon: UserRound },
  { id: "personal_project", label: "个人项目", title: "个人项目进展", description: "按项目看当前状态、下一步和可回溯的实现证据。", empty: "个人项目板块暂时没有可展示的当前主题。", Icon: Briefcase },
  { id: "enterprise_project", label: "企业项目", title: "企业项目", description: "企业项目保持独立，不把个人项目或推断自动挪进来。", empty: "企业项目板块目前为空；没有足够来源时保持为空。", Icon: Building2 },
  { id: "media", label: "自媒体", title: "自媒体", description: "自媒体主题单独承接，当前不生成内容，也不替用户推断经营计划。", empty: "自媒体板块目前为空；本轮不创建未被来源支持的主题。", Icon: Megaphone },
];

const BOARD_BY_ID = new Map(BOARD_DEFINITIONS.map((item) => [item.id, item]));

function displayTime(value?: string | null) {
  if (!value) return "未记录时间";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function shortTime(value?: string | null) {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function excerpt(value: string | null | undefined, length = 132) {
  const text = (value || "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function subjectStatusLabel(status: string) {
  return status === "paused" ? "已暂停" : status === "archived" ? "已归档" : "当前";
}

function kindLabel(kind: string) {
  return ({ statement: "事实陈述", observation: "执行观察", decision: "已记录决定", question: "待澄清问题", feedback: "反馈", correction: "更正" }[kind] || kind);
}

function originLabel(origin: string, assertion: string) {
  const originText = origin === "user" ? "用户表达" : origin === "agent" ? "执行报告" : "外部来源";
  const assertionText = assertion === "inferred" ? "模型推断" : "已报告";
  return `${originText} · ${assertionText}`;
}

function sourceText(reference?: WorkspaceReference | null) {
  if (!reference) return "未标记来源";
  return reference.label || reference.id || reference.locator || "未命名来源";
}

function sourceStatusLabel(status: string) {
  return status === "available" ? "可追溯" : status === "missing" ? "来源缺失" : "待解析";
}

function recoveryStatusLabel(status: string) {
  return ({ planned: "进行中", reported: "进行中", verified: "已完成", blocked: "受阻", superseded: "已替代" }[status] || status);
}

function recoveryStatusClass(status: string) {
  return status === "verified" ? "is-verified" : status === "blocked" ? "is-blocked" : status === "planned" || status === "reported" ? "is-active" : "";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { message?: string }).message || "读取工作区失败");
  return payload as T;
}

function BoardIcon({ board }: { board: BoardId }) {
  const Icon = BOARD_BY_ID.get(board)?.Icon || Compass;
  return <Icon size={17} />;
}

export default function WorkspaceView({ activeBoard, onBoardChange }: WorkspaceViewProps) {
  const [subjects, setSubjects] = useState<WorkspaceSubject[]>([]);
  const [contexts, setContexts] = useState<Record<BoardId, WorkspaceContext | null>>({ personal: null, personal_project: null, enterprise_project: null, media: null });
  const [recovery, setRecovery] = useState<RecoverySummary | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkspaceSubjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setRefreshing(true);
    try {
      const [subjectResult, personal, personalProject, enterpriseProject, media, recoveryResult] = await Promise.all([
        fetchJson<{ subjects: WorkspaceSubject[] }>("/api/v1/workspace/subjects"),
        fetchJson<WorkspaceContext>("/api/v1/workspace/context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ board: "personal", limit: 10, max_chars: 24000 }) }),
        fetchJson<WorkspaceContext>("/api/v1/workspace/context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ board: "personal_project", limit: 10, max_chars: 24000 }) }),
        fetchJson<WorkspaceContext>("/api/v1/workspace/context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ board: "enterprise_project", limit: 10, max_chars: 24000 }) }),
        fetchJson<WorkspaceContext>("/api/v1/workspace/context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ board: "media", limit: 10, max_chars: 24000 }) }),
        fetchJson<RecoverySummary>("/api/v1/agent/bootstrap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repository: "kioooice/MYOPC", branch: "main", limit: 8 }) }),
      ]);
      setSubjects(subjectResult.subjects || []);
      setContexts({ personal, personal_project: personalProject, enterprise_project: enterpriseProject, media });
      setRecovery(recoveryResult);
      setLoadedAt(new Date().toISOString());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取工作区失败，请重试");
    } finally {
      setRefreshing(false);
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const openSubject = useCallback(async (subjectId: string) => {
    setSelectedSubjectId(subjectId);
    setDetailLoading(true);
    setError("");
    try {
      const result = await fetchJson<WorkspaceSubjectDetail>(`/api/v1/workspace/subjects/${encodeURIComponent(subjectId)}?history=true&limit=100`);
      setDetail(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取主题详情失败，请重试");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const boardSubjects = useMemo(() => activeBoard === "overview" ? [] : subjects.filter((subject) => subject.board === activeBoard), [activeBoard, subjects]);
  const selectedSubject = selectedSubjectId ? subjects.find((subject) => subject.id === selectedSubjectId && (activeBoard === "overview" || subject.board === activeBoard)) || null : null;
  const currentRecords = useMemo(() => Object.values(contexts).flatMap((context) => context?.subjects.flatMap((subject) => subject.current) || []), [contexts]);
  const understandingRecords = currentRecords.filter((record) => record.kind !== "question").slice(0, 8);
  const explicitQuestions = currentRecords.filter((record) => record.kind === "question" || record.slot === "needs_user_decision");
  const recentChanges = (recovery?.recent || []).slice(0, 8);
  const inProgress = recentChanges.filter((event) => event.status === "planned" || event.status === "reported");
  const completed = recentChanges.filter((event) => event.status === "verified");
  const blocked = recentChanges.filter((event) => event.status === "blocked");

  function switchBoard(board: WorkspaceBoard) {
    onBoardChange(board);
    if (board === "overview") {
      setSelectedSubjectId(null);
      setDetail(null);
    }
  }

  function openRelatedSubject(subjectId: string) {
    const related = subjects.find((subject) => subject.id === subjectId);
    if (!related) return;
    onBoardChange(related.board);
    void openSubject(subjectId);
  }

  async function copyCorrectionPrompt(subjectId: string, slot: string | null | undefined, recordId?: string) {
    const target = slot ? `slot ${slot}` : recordId ? `记录 ${recordId}` : "当前主题";
    const prompt = `请更正 OPC 主题 ${subjectId} 的${target}。请说明更正后的事实、来源和观察时间；不要直接改写历史记录。`;
    try {
      await navigator.clipboard?.writeText(prompt);
      setNotice("更正提示已复制；请在 Codex 入口提交并带上来源");
    } catch {
      setNotice(prompt);
    }
  }

  if (loading && subjects.length === 0) return <div className="workspace-loading"><RefreshCw size={17} className="spin" />正在读取 OPC 当前状态…</div>;

  return <div className="workspace-view">
    <header className="workspace-hero">
      <div>
        <p className="workspace-eyebrow"><Compass size={14} /> OPC · 当前状态</p>
        <h1>{activeBoard === "overview" ? "现在，OPC 在理解什么" : BOARD_BY_ID.get(activeBoard)?.title}</h1>
        <p className="workspace-lede">这里展示有来源的当前理解、变化和主题历史。空白代表暂无足够来源，不代表系统替你补全了事实。</p>
      </div>
      <div className="workspace-hero-actions">
        <span>{loadedAt ? `状态更新于 ${shortTime(loadedAt)}` : "状态尚未更新"}</span>
        <button className="workspace-refresh" onClick={() => void load(true)} disabled={refreshing}><RefreshCw size={14} className={refreshing ? "spin" : ""} />{refreshing ? "刷新中" : "刷新"}</button>
      </div>
    </header>

    <nav className="workspace-board-tabs" aria-label="OPC 工作区板块">
      <button className={activeBoard === "overview" ? "workspace-tab active" : "workspace-tab"} onClick={() => switchBoard("overview")}><Compass size={15} /><span>变化总览</span></button>
      {BOARD_DEFINITIONS.map((board) => <button key={board.id} className={activeBoard === board.id ? "workspace-tab active" : "workspace-tab"} onClick={() => switchBoard(board.id)}><board.Icon size={15} /><span>{board.label}</span><b>{subjects.filter((subject) => subject.board === board.id).length}</b></button>)}
    </nav>

    {error && <div className="workspace-inline-error"><CircleAlert size={16} /><span>{error}</span><button onClick={() => void load()}>重新读取</button></div>}
    {notice && <div className="workspace-inline-notice"><CheckCircle2 size={15} /><span>{notice}</span></div>}

    {activeBoard === "overview"
      ? <OverviewPanel recentChanges={recentChanges} inProgress={inProgress} completed={completed} blocked={blocked} explicitQuestions={explicitQuestions} understandingRecords={understandingRecords} subjects={subjects} onBoardChange={switchBoard} onOpenSubject={openSubject} />
      : <BoardPanel board={activeBoard} subjects={boardSubjects} context={contexts[activeBoard]} selectedSubject={selectedSubject} detail={detail} detailLoading={detailLoading} allSubjects={subjects} onOpenSubject={openSubject} onOpenRelatedSubject={openRelatedSubject} onCopyCorrection={copyCorrectionPrompt} />}
  </div>;
}

function OverviewPanel({ recentChanges, inProgress, completed, blocked, explicitQuestions, understandingRecords, subjects, onBoardChange, onOpenSubject }: {
  recentChanges: RecoveryRecord[];
  inProgress: RecoveryRecord[];
  completed: RecoveryRecord[];
  blocked: RecoveryRecord[];
  explicitQuestions: WorkspaceRecord[];
  understandingRecords: WorkspaceRecord[];
  subjects: WorkspaceSubject[];
  onBoardChange: (board: WorkspaceBoard) => void;
  onOpenSubject: (id: string) => void;
}) {
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  return <div className="workspace-overview">
    <section className="workspace-intro-grid">
      <article className="workspace-panel workspace-intro-panel">
        <span className="workspace-panel-kicker">先看这里</span>
        <h2>把状态当作可核对的工作面</h2>
        <p>四个板块保留不同范围；当前记录和历史记录分开显示；来源时间用于判断新鲜度。普通工具调用、测试和实现细节默认收在展开区里。</p>
        <div className="workspace-agreement"><ShieldCheck size={16} /><span>讨论任务负责方向与必要验收；执行任务负责已授权范围内的实现、验证、提交推送和回传。</span></div>
      </article>
      <article className="workspace-panel workspace-decision-panel">
        <div className="workspace-panel-heading"><span className="workspace-panel-kicker">需要你决定</span><Info size={15} /></div>
        {explicitQuestions.length === 0
          ? <><strong>暂无明确需要你决定的事项</strong><p>当前没有带有 question 或 needs_user_decision 标记的当前记录。普通提问、日志和工具事件不会自动升级成审批事项。</p></>
          : <div className="workspace-question-list">{explicitQuestions.map((record) => <article key={record.id}><strong>{record.title}</strong><p>{excerpt(record.content, 180)}</p><small>{originLabel(record.origin, record.assertion)} · {shortTime(record.observed_at)}</small></article>)}</div>}
      </article>
    </section>

    <section className="workspace-section">
      <div className="workspace-section-heading"><div><span className="workspace-panel-kicker">变化概览</span><h2>最近发生了什么</h2></div><span className="workspace-muted">只按明确记录的状态归类</span></div>
      <div className="workspace-change-grid">
        <ChangeColumn title="进行中" status="planned" events={inProgress} empty="没有明确标记为进行中的工作" />
        <ChangeColumn title="已完成" status="verified" events={completed} empty="没有新的已完成记录" />
        <ChangeColumn title="受阻" status="blocked" events={blocked} empty="没有明确标记为受阻的工作" />
      </div>
      {recentChanges.length > 0 && <details className="workspace-technical-details"><summary><Clock3 size={14} />最近记录（含执行与验证信息）<span>{recentChanges.length} 条</span></summary><div className="workspace-event-list">{recentChanges.map((event) => <RecoveryEvent key={event.id} event={event} />)}</div></details>}
      {recentChanges.length === 0 && <div className="workspace-empty workspace-empty-compact"><FileText size={19} /><p>当前没有可展示的变化记录。</p></div>}
    </section>

    <section className="workspace-section">
      <div className="workspace-section-heading"><div><span className="workspace-panel-kicker">当前理解</span><h2>可验证的工作记忆</h2></div><span className="workspace-muted">区分表达、执行报告与推断</span></div>
      <div className="workspace-understanding-grid">
        <div className="workspace-panel workspace-understanding-panel">
          {understandingRecords.length === 0
            ? <div className="workspace-empty"><Info size={20} /><p>暂无有来源的当前理解；不凭空生成个人画像。</p></div>
            : understandingRecords.map((record) => {
              const subject = subjectById.get(record.subject_id);
              return <article className="workspace-understanding-card" key={record.id}>
                <div className="workspace-record-top"><span className="workspace-record-kind">{kindLabel(record.kind)}</span><span>{originLabel(record.origin, record.assertion)}</span></div>
                <h3>{record.title}</h3><p>{record.content}</p>
                <footer><span>{subject?.title || record.subject_id}</span><span>来源 {record.source_locator || "未标记"}</span><span>观察 {shortTime(record.observed_at)}</span><button onClick={() => onOpenSubject(record.subject_id)}>查看主题 <ChevronRight size={13} /></button></footer>
              </article>;
            })}
        </div>
        <div className="workspace-panel workspace-correction-panel">
          <span className="workspace-panel-kicker">如何更正</span><h3>从 Codex 入口提出更正</h3>
          <p>页面不直接编辑正文。请在 Codex 入口说明主题 ID、slot 或记录 ID，并给出更正后的事实、来源和观察时间；系统会追加更正记录，保留原历史。</p>
          <code>请更正主题 &lt;subject-id&gt; 的 slot &lt;slot&gt;，并说明来源与观察时间。</code>
          <small>主题详情页会显示当前头、来源和完整历史，方便定位。</small>
        </div>
      </div>
    </section>

    <section className="workspace-section">
      <div className="workspace-section-heading"><div><span className="workspace-panel-kicker">四个板块</span><h2>按主体范围查看</h2></div><span className="workspace-muted">保留现有知识、工具、图谱和项目入口</span></div>
      <div className="workspace-board-grid">{BOARD_DEFINITIONS.map((board) => {
        const count = subjects.filter((subject) => subject.board === board.id).length;
        const latest = subjects.filter((subject) => subject.board === board.id).sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
        return <button className="workspace-board-card" key={board.id} onClick={() => onBoardChange(board.id)}><div className="workspace-board-card-icon"><board.Icon size={18} /></div><div><div className="workspace-board-card-head"><strong>{board.label}</strong><b>{count}</b></div><p>{board.description}</p><small>{latest ? `最近更新 ${shortTime(latest.updated_at)} · ${latest.title}` : board.empty}</small></div><ArrowUpRight size={15} /></button>;
      })}</div>
    </section>
  </div>;
}

function ChangeColumn({ title, status, events, empty }: { title: string; status: string; events: RecoveryRecord[]; empty: string }) {
  return <article className="workspace-change-column"><div className="workspace-change-heading"><span className={`workspace-status-dot ${recoveryStatusClass(status)}`} /><h3>{title}</h3><b>{events.length}</b></div>{events.length === 0 ? <p className="workspace-column-empty">{empty}</p> : <div className="workspace-change-list">{events.slice(0, 4).map((event) => <article key={event.id}><div className="workspace-record-top"><span className={`workspace-status-pill ${recoveryStatusClass(event.status)}`}>{recoveryStatusLabel(event.status)}</span><span>{event.type || "进展"}</span></div><strong>{event.title}</strong><p>{excerpt(event.content, 118)}</p><small>{shortTime(event.occurredAt)}</small></article>)}</div>}</article>;
}

function RecoveryEvent({ event }: { event: RecoveryRecord }) {
  return <article className="workspace-event"><div className="workspace-event-head"><strong>{event.title}</strong><span className={`workspace-status-pill ${recoveryStatusClass(event.status)}`}>{recoveryStatusLabel(event.status)}</span></div><p>{event.content}</p><div className="workspace-event-meta"><span>记录 {shortTime(event.occurredAt)}</span>{event.commit && <span>提交 {event.commit.slice(0, 8)}</span>}{event.branch && <span>分支 {event.branch}</span>}</div>{(event.verification || event.nextStep || (event.evidence && event.evidence.length > 0)) && <details><summary>验证与后续</summary>{event.verification && <p><b>验证：</b>{event.verification}</p>}{event.nextStep && <p><b>下一步：</b>{event.nextStep}</p>}{event.evidence && event.evidence.length > 0 && <ul>{event.evidence.map((item, index) => <li key={`${event.id}-evidence-${index}`}>{item}</li>)}</ul>}</details>}</article>;
}

function BoardPanel({ board, subjects, context, selectedSubject, detail, detailLoading, allSubjects, onOpenSubject, onOpenRelatedSubject, onCopyCorrection }: {
  board: BoardId;
  subjects: WorkspaceSubject[];
  context: WorkspaceContext | null;
  selectedSubject: WorkspaceSubject | null;
  detail: WorkspaceSubjectDetail | null;
  detailLoading: boolean;
  allSubjects: WorkspaceSubject[];
  onOpenSubject: (id: string) => void;
  onOpenRelatedSubject: (id: string) => void;
  onCopyCorrection: (subjectId: string, slot: string | null | undefined, recordId?: string) => void;
}) {
  const definition = BOARD_BY_ID.get(board) || BOARD_DEFINITIONS[0];
  const contextSubjects = context?.subjects || [];
  const contextById = new Map(contextSubjects.map((item) => [item.subject.id, item]));
  const selectedContext = selectedSubject ? contextById.get(selectedSubject.id) : null;
  return <div className="workspace-board-page">
    <section className="workspace-board-banner"><div className="workspace-board-banner-icon"><definition.Icon size={22} /></div><div><span className="workspace-panel-kicker">{definition.label}板块</span><h2>{definition.title}</h2><p>{definition.description}</p></div><div className="workspace-board-banner-meta"><strong>{subjects.length}</strong><span>个主题</span></div></section>
    <div className="workspace-board-layout">
      <section className="workspace-subject-list"><div className="workspace-section-heading"><div><span className="workspace-panel-kicker">主题</span><h2>当前主题</h2></div><span className="workspace-muted">{context?.truncated ? "当前读取已截断，进入主题可看完整历史" : "按当前头展示"}</span></div>
        {subjects.length === 0 ? <div className="workspace-empty workspace-panel"><definition.Icon size={22} /><p>{definition.empty}</p><small>本轮不根据其他板块内容自动创建主题。</small></div> : <div className="workspace-subject-cards">{subjects.map((subject) => {
          const subjectContext = contextById.get(subject.id);
          const current = subjectContext?.current || [];
          const sourceTime = subjectContext?.source_time || subject.source_time;
          return <button className={selectedSubject?.id === subject.id ? "workspace-subject-card active" : "workspace-subject-card"} key={subject.id} onClick={() => onOpenSubject(subject.id)}><div className="workspace-subject-card-head"><span className="workspace-subject-status">{subjectStatusLabel(subject.status)}</span><span>修订 {subject.revision}</span></div><h3>{subject.title}</h3><p>{current.length > 0 ? excerpt(current.map((record) => record.content).join(" "), 150) : "当前没有已发布的当前记录；打开详情查看来源与历史。"}</p><footer><span>{current.length} 条当前记录</span><span>来源时间 {shortTime(sourceTime)}</span><ChevronRight size={14} /></footer></button>;
        })}</div>}
      </section>
      <section className="workspace-subject-detail">{detailLoading ? <div className="workspace-empty workspace-panel"><RefreshCw size={20} className="spin" /><p>正在读取主题详情…</p></div> : detail && selectedSubject?.id === detail.id ? <SubjectDetail detail={detail} allSubjects={allSubjects} onOpenRelatedSubject={onOpenRelatedSubject} onCopyCorrection={onCopyCorrection} /> : <div className="workspace-empty workspace-panel"><FileText size={22} /><p>{subjects.length > 0 ? "选择左侧主题查看当前内容、来源和历史" : "这个板块还没有主题详情"}</p><small>当前内容、来源时间和历史记录会在这里分开呈现。</small></div>}</section>
    </div>
    {selectedContext && selectedContext.newer_material_available && <p className="workspace-newer-warning">当前主题关联来源有更新材料，详情页按当前存档显示；请通过更正流程核对后再改变当前头。</p>}
  </div>;
}

function SubjectDetail({ detail, allSubjects, onOpenRelatedSubject, onCopyCorrection }: { detail: WorkspaceSubjectDetail; allSubjects: WorkspaceSubject[]; onOpenRelatedSubject: (id: string) => void; onCopyCorrection: (subjectId: string, slot: string | null | undefined, recordId?: string) => void }) {
  const relatedSubjects = detail.references.filter((reference) => reference.kind === "subject");
  const sources = detail.sources || [];
  return <div className="workspace-detail-card">
    <header className="workspace-detail-head"><div><span className="workspace-panel-kicker">{BOARD_BY_ID.get(detail.board)?.label || detail.board} · 主题详情</span><h2>{detail.title}</h2><p><code>{detail.id}</code> · {subjectStatusLabel(detail.status)} · 修订 {detail.revision}</p></div><div className="workspace-detail-time"><span>来源时间</span><strong>{shortTime(detail.source_time)}</strong><small>主题更新 {shortTime(detail.updated_at)}</small></div></header>

    <section className="workspace-detail-section"><div className="workspace-section-heading"><div><span className="workspace-panel-kicker">当前</span><h3>当前头</h3></div><span className="workspace-muted">当前记录可被新记录替代，历史不会被覆盖</span></div>{detail.current.length === 0 ? <div className="workspace-detail-empty">暂无当前记录。</div> : <div className="workspace-current-records">{detail.current.map((record) => <article className="workspace-record-card" key={record.id}><div className="workspace-record-top"><span className="workspace-record-kind">{kindLabel(record.kind)}</span><span>{originLabel(record.origin, record.assertion)}</span>{record.slot && <code>{record.slot}</code>}</div><h4>{record.title}</h4><p>{record.content}</p><footer><span>观察 {displayTime(record.observed_at)}</span><span>记录 {displayTime(record.recorded_at)}</span><button onClick={() => onCopyCorrection(detail.id, record.slot, record.id)}>定位更正 <ArrowUpRight size={13} /></button></footer></article>)}</div>}</section>

    <section className="workspace-detail-section workspace-source-section"><div className="workspace-section-heading"><div><span className="workspace-panel-kicker">证据</span><h3>来源与新鲜度</h3></div><span className="workspace-muted">{sources.length} 个已登记来源</span></div>{sources.length === 0 ? <div className="workspace-detail-empty">暂无来源；当前主题只显示已存档记录。</div> : <div className="workspace-source-list">{sources.map((source, index) => <div className="workspace-source-row" key={`${source.source_type}-${source.id || source.reference.locator || index}`}><div><span className={`workspace-source-status ${source.status}`}>{sourceStatusLabel(source.status)}</span><strong>{sourceText(source.reference)}</strong></div><span>{source.observed_at ? `观察 ${shortTime(source.observed_at)}` : source.updated_at ? `更新 ${shortTime(source.updated_at)}` : "时间未记录"}</span><small>{source.source_type}{source.commit_sha ? ` · ${source.commit_sha.slice(0, 8)}` : ""}</small></div>)}</div>}{detail.source_warnings.length > 0 && <p className="workspace-warning-note"><CircleAlert size={14} />有 {detail.source_warnings.length} 个来源未能完整解析，页面不把它们当成已验证事实。</p>}</section>

    {relatedSubjects.length > 0 && <section className="workspace-detail-section"><div className="workspace-section-heading"><div><span className="workspace-panel-kicker">关联</span><h3>跨板块引用</h3></div><span className="workspace-muted">只显示主题明确声明的引用</span></div><div className="workspace-related-list">{relatedSubjects.map((reference, index) => { const related = reference.id ? allSubjects.find((subject) => subject.id === reference.id) : null; return <button key={`${reference.id || reference.locator}-${index}`} onClick={() => related && onOpenRelatedSubject(related.id)} disabled={!related}><Link2 size={14} /><span>{related?.title || sourceText(reference)}</span><small>{related ? BOARD_BY_ID.get(related.board)?.label : "引用缺失"}</small><ChevronRight size={14} /></button>; })}</div></section>}

    <section className="workspace-detail-section"><details className="workspace-history-details" open={detail.history.length > 0}><summary><History size={15} /><span>历史与技术记录</span><b>{detail.history_total}</b></summary>{detail.history.length === 0 ? <p className="workspace-detail-empty">暂无历史记录。</p> : <div className="workspace-history-list">{detail.history.map((record) => <article key={record.id}><div className="workspace-record-top"><span className="workspace-record-kind">{kindLabel(record.kind)}</span><span>{record.current ? "当前" : "历史"}</span><span>{shortTime(record.recorded_at)}</span></div><strong>{record.title}</strong><p>{excerpt(record.content, 240)}</p><small><code>{record.id}</code>{record.replaces_id ? ` · 替代 ${record.replaces_id}` : ""}{record.replaced_by ? ` · 后续 ${record.replaced_by}` : ""}</small></article>)}</div>}</details></section>

    <aside className="workspace-correction-callout"><div><Info size={17} /><strong>发现不准确时怎么改</strong></div><p>请回到 Codex 入口，带上主题 ID <code>{detail.id}</code>、slot 或记录 ID，并提供新来源与观察时间。系统按追加记录处理，保留当前头的变更轨迹；页面不提供隐式覆盖或删除历史。</p><button onClick={() => onCopyCorrection(detail.id, detail.current[0]?.slot, detail.current[0]?.id)}>复制更正提示</button></aside>
  </div>;
}
