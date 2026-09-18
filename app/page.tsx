"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Building2, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Compass, ExternalLink, FileText, Folder, Inbox, Menu, Megaphone, Network, PanelLeftClose, PanelLeftOpen, RefreshCw, Rocket, Search, Sparkles, UserRound, Briefcase, X } from "lucide-react";
import { assertPendingWriteCanSend, clearPendingWrite, loadPendingWrite, storePendingWrite, type PendingWrite } from "@/lib/pending-write";
import { MermaidDiagram } from "./mermaid-diagram";
import WorkspaceView, { type WorkspaceBoard } from "./workspace-view";

type Feedback = { id: string; content: string; status: string; source?: string; kind?: string; handled_at?: string | null };
type Version = { id: string; ordinal: number; content: string; created_at?: string; review_status?: string; feedback: Feedback[]; handles_feedback_ids: string[] };
type Deliverable = { id: string; title: string; type: string; accepted_version_id: string | null; review_status?: string; created_at?: string; versions: Version[] };
type Decision = { id: string; rationale: string; adjustment: string; next_step: string; execution_status: string };
type Trial = { id: string; title: string; goal: string; status: string; revision: number; project_id?: string | null; project?: { id: string; name: string; category: string } | null; code_repository?: string | null; code_branch?: string | null; code_commit?: string | null; next_step?: string | null; method: null | { title: string; revision_label: string; purpose: string; steps: string[] }; capture: null | { title: string; kind: string; source?: string }; captures?: Array<{ id: string; title: string; kind: string }>; deliverables: Deliverable[]; decisions: Decision[] };
type KnowledgeNote = { status: "ready" | "stale" | "failed" | "missing"; stale: boolean; model: string | null; generatedAt: string | null; error: string | null; summary: string | null; brief: string | null; card: string | null };
type KnowledgeItem = { id: string; kind: string; title: string; summary: string; status: string; tags: string[]; updatedAt: string | null; link: string | null; relPath: string; sourceUrls: string[]; category: string | null; mapType: string | null; note: KnowledgeNote };
type KnowledgeNoteContent = { summary: string; facts: string[]; decisions: Array<{ title: string; detail: string }>; steps: string[]; conditions: string[]; open_questions: string[]; inferences: string[] };
type KnowledgeDetail = KnowledgeItem & { body: string; sources: Array<{ label: string; url: string | null }>; related: Array<{ id: string; title: string; kind: string; status: string }>; noteContent: KnowledgeNoteContent | null; stale: boolean; promptVersion: string; progress: EntryProgress | null };
type KnowledgeSync = { status: "ok" | "failed" | "never"; commit: string | null; branch: string | null; message: string | null; entryCount: number; addedCount: number; updatedCount: number; removedCount: number; startedAt: string | null; finishedAt: string | null };
type ReuseCall = { id: string; repository: string; task: string; usedCount: number; reason: string | null; createdAt: string; outcome: string | null };
type ReuseCandidate = { id: string; title: string; summary: string; evidence: string; suggestion: string; repository: string; createdAt: string };
type ReuseUsage = { id: string; title: string; usedCount: number; effective: number; partial: number; ineffective: number; unknown: number; lastUsedAt: string };
type ReuseCandidateResolution = { id: string; title: string; status: string; note: string | null; entryId: string | null; knowledgeCommit: string | null; resolvedAt: string | null; repository: string };
type ReuseOverview = { counts: { calls: number; usedCalls: number; results: number; pendingCandidates: number; resolvedCandidates: number }; recentCalls: ReuseCall[]; candidates: ReuseCandidate[]; resolvedCandidates: ReuseCandidateResolution[]; usage: ReuseUsage[] };
type ProgressRecord = { id: string; type: string; title: string; content: string; rationale: string; status: string; verification: string; evidence: string[]; nextStep: string; machine: string | null; branch: string | null; commit: string | null; dirty: boolean; occurredAt: string; recordedAt: string; sameBranch: boolean | null; sameMachine: boolean | null; sameCommit: boolean | null; note: string | null; taskResultId: string | null; supersedesId: string | null; supersededBy: string | null };
type EntryProgress = { repositories: string[]; stage: { title: string; status: string; occurredAt: string } | null; updatedAt: string | null; events: ProgressRecord[]; environment: Array<ProgressRecord & { verifiedOnThisMachine: boolean }>; blockers: ProgressRecord[]; nextSteps: string[]; total: number };
type KnowledgeOverviewResponse = { sync: KnowledgeSync; model: { configured: boolean; model: string | null; baseUrl: string | null }; promptVersion: string; repository: string; directory: string; pendingNotes: number; reuse: ReuseOverview; entries: KnowledgeItem[] };
type WriteRequest = PendingWrite;
type View = "overview" | "projects" | "toolbox" | "space" | "maps" | "entry" | "active" | "inbox" | "deliverables" | "workspace";

const statusLabel = (status: string) => ({ in_progress: "进行中", review: "审阅中", done: "已完成", paused: "已暂停" }[status] || status);
const kindLabel = (kind?: string) => kind === "failure" ? "从失败开始" : kind === "discovery" ? "从资料开始" : "从需求开始";
const feedbackKindLabel = (kind?: string) => kind === "review" ? "待审阅" : "待修改";
const sourceLabel = (source?: string) => source === "user" ? "用户反馈" : source === "codex" ? "Codex 记录" : source === "system" ? "系统记录" : "反馈";
const reviewStatusLabel = (status?: string) => status === "accepted" ? "已采用" : status === "needs_revision" ? "需要修改" : "待审阅";
const noteStatusLabel = (status: string, stale = false) => status === "ready" ? "已有阅读说明" : status === "failed" ? "加工失败" : status === "stale" || stale ? "待更新" : "待生成";
const progressTypeLabel = (type: string) => ({ plan: "计划", progress: "进展", decision: "决定", environment: "环境", finding: "发现", blocker: "阻塞", correction: "更正" }[type] || type);
const progressStatusLabel = (status: string) => ({ planned: "计划中", reported: "执行方报告", verified: "附验证依据", blocked: "未解决", superseded: "已被替代" }[status] || status);
const candidateStatusLabel = (status: string) => ({ merged: "已合并", added: "已新增", hold: "暂存", discarded: "舍弃" }[status] || status);
const shortDateTime = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const mapTypeLabel = (mapType?: string | null) => mapType === "architecture" ? "架构图" : mapType === "workflow" ? "流程图" : mapType === "decision" ? "判断树" : mapType === "relationship" ? "关系图" : "图谱";
const RELATED_KIND_META: Record<string, { title: string; badge: string }> = {
  project: { title: "相关项目", badge: "项目" },
  tool: { title: "相关工具", badge: "工具" },
  note: { title: "相关方法", badge: "笔记" },
  map: { title: "相关图谱", badge: "图谱" },
};
const shortTime = (value?: string | null) => value ? new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";

export default function Home() {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [knowledgeSync, setKnowledgeSync] = useState<KnowledgeSync | null>(null);
  const [knowledgeModel, setKnowledgeModel] = useState<KnowledgeOverviewResponse["model"] | null>(null);
  const [pendingNotes, setPendingNotes] = useState(0);
  const [reuse, setReuse] = useState<ReuseOverview | null>(null);
  const [entry, setEntry] = useState<KnowledgeDetail | null>(null);
  const [entryLoading, setEntryLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [lastEntrySection, setLastEntrySection] = useState<View>("projects");
  const [selected, setSelected] = useState("");
  const [view, setView] = useState<View>("workspace");
  const [workspaceBoard, setWorkspaceBoard] = useState<WorkspaceBoard>("overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [latestEventSequence, setLatestEventSequence] = useState(0);
  const [pendingWrite, setPendingWrite] = useState<WriteRequest | null>(null);
  const pendingWriteRef = useRef<WriteRequest | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setRefreshing(true);
    try {
      // 后台轮询遇到瞬时失败时先静默重试一次，避免闪一下错误提示；用户主动刷新仍然直接报错。
      const readWorkspace = async () => {
        const [dashboardResponse, knowledgeResponse] = await Promise.all([
          fetch("/api/v1/dashboard", { cache: "no-store" }),
          fetch("/api/v1/knowledge", { cache: "no-store" }),
        ]);
        if (!dashboardResponse.ok || !knowledgeResponse.ok) throw new Error("读取工作台失败，请检查连接后重试");
        return Promise.all([dashboardResponse.json(), knowledgeResponse.json()]) as Promise<[{ trials: Trial[]; latest_event_sequence?: number }, KnowledgeOverviewResponse]>;
      };
      let [data, knowledgeData] = await readWorkspace().catch(async (cause) => {
        if (!quiet) throw cause;
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        return readWorkspace();
      });
      setTrials(data.trials);
      setKnowledge(knowledgeData.entries || []);
      setKnowledgeSync(knowledgeData.sync);
      setKnowledgeModel(knowledgeData.model);
      setPendingNotes(knowledgeData.pendingNotes || 0);
      setReuse(knowledgeData.reuse || null);
      setLatestEventSequence(data.latest_event_sequence || 0);
      setLastSyncedAt(new Date());
      setError("");
      return data.trials as Trial[];
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取失败，请重试");
      return [] as Trial[];
    } finally {
      setRefreshing(false);
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const restored = loadPendingWrite(window.sessionStorage);
    if (restored) pendingWriteRef.current = restored;
    const restore = restored ? window.setTimeout(() => { setPendingWrite(restored); }, 0) : null;
    const initial = window.setTimeout(() => { void load(); }, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 15000);
    const onFocus = () => { if (document.visibilityState === "visible") void load(true); };
    window.addEventListener("focus", onFocus);
    return () => { if (restore !== null) window.clearTimeout(restore); window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [load]);

  const trial = trials.find((item) => item.id === selected);
  const knowledgeProjects = useMemo(() => knowledge.filter((item) => item.kind === "project"), [knowledge]);
  const knowledgeTools = useMemo(() => knowledge.filter((item) => item.kind === "tool"), [knowledge]);
  const knowledgeNotes = useMemo(() => knowledge.filter((item) => item.kind === "note"), [knowledge]);
  const knowledgeMaps = useMemo(() => knowledge.filter((item) => item.kind === "map"), [knowledge]);
  const knowledgeTooltip = [knowledgeSync?.commit ? `知识仓库 ${knowledgeSync.commit.slice(0, 8)}` : "知识仓库未同步", knowledgeSync?.finishedAt ? new Date(knowledgeSync.finishedAt).toLocaleString("zh-CN") : "", knowledgeModel?.configured ? `模型 ${knowledgeModel.model}` : "模型未配置", pendingNotes > 0 ? `${pendingNotes} 条待加工` : "阅读说明已就绪"].filter(Boolean).join(" · ");
  const activeTrials = useMemo(() => trials.filter((item) => item.status === "in_progress" || item.status === "review"), [trials]);
  const openFeedbackCount = useMemo(() => trials.flatMap((item) => item.deliverables).flatMap((item) => item.versions).flatMap((item) => item.feedback).filter((item) => item.status === "open").length, [trials]);
  const pendingReviewCount = useMemo(() => trials.flatMap((item) => item.deliverables).filter((deliverable) => deliverable.review_status === "pending_review" && !deliverable.versions[0]?.feedback.some((feedback) => feedback.status === "open" && feedback.kind === "review")).length, [trials]);
  const inboxCount = openFeedbackCount + pendingReviewCount;
  const deliverableCount = useMemo(() => trials.reduce((count, item) => count + item.deliverables.length, 0), [trials]);
  const filteredTrials = trials.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));

  function openTrial(id: string) { setSelected(id); setEntry(null); setView("active"); }

  function goTo(nextView: View) { setSelected(""); setEntry(null); setView(nextView); }

  function openWorkspace(board: WorkspaceBoard = "overview") { setSelected(""); setEntry(null); setWorkspaceBoard(board); setView("workspace"); }

  async function openEntry(id: string, kind?: string) {
    const section: View = kind === "tool" ? "toolbox" : kind === "note" ? "space" : kind === "map" ? "maps" : "projects";
    setSelected(""); setView("entry"); setEntryLoading(true); setError("");
    try {
      const response = await fetch(`/api/v1/knowledge/entries/${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "读取条目失败");
      setEntry(payload as KnowledgeDetail);
      setView("entry");
      setLastEntrySection(section);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取条目失败"); }
    finally { setEntryLoading(false); }
  }

  async function syncKnowledge() {
    setKnowledgeBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/v1/knowledge/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "同步知识仓库失败");
      const summary = payload.summary || {};
      setNotice(`${payload.pull?.message || "已同步"}：新增 ${summary.added || 0}，更新 ${summary.updated || 0}，移除 ${summary.removed || 0}，共 ${summary.total || 0} 条`);
      await load(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "同步知识仓库失败"); }
    finally { setKnowledgeBusy(false); }
  }

  async function generateNote(entryId: string, force = false) {
    setKnowledgeBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/v1/knowledge/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entry_id: entryId, force }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "生成阅读说明失败");
      setNotice(payload.status === "ready" ? "阅读说明已生成" : payload.status === "skipped" ? "来源与规程未变化，复用已有结果" : `生成失败：${payload.reason || "未知原因"}`);
      await load(true);
      await openEntry(entryId, entry?.kind);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成阅读说明失败"); }
    finally { setKnowledgeBusy(false); }
  }

  async function processPending() {
    setKnowledgeBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/v1/knowledge/process", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 3 }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "批量加工失败");
      setNotice(`本次处理 ${payload.processed} 条，剩余 ${payload.remaining} 条待加工`);
      await load(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "批量加工失败"); }
    finally { setKnowledgeBusy(false); }
  }

  async function resolveCandidate(id: string, status: string, note: string, entryId: string, commit: string) {
    setKnowledgeBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/v1/knowledge/candidates/${encodeURIComponent(id)}/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, note, entry_id: entryId, knowledge_commit: commit }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "处置候选经验失败");
      setNotice(`候选经验已标记为${candidateStatusLabel(status)}`);
      await load(true);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "处置候选经验失败"); return false; }
    finally { setKnowledgeBusy(false); }
  }

  async function sendWrite(request: WriteRequest) {
    const existing = pendingWriteRef.current;
    assertPendingWriteCanSend(existing, request);
    pendingWriteRef.current = request;
    setPendingWrite(request);
    storePendingWrite(window.sessionStorage, request);
    const response = await fetch(request.path, { method: "POST", headers: { "content-type": "application/json", "x-client-request-id": request.requestId }, body: JSON.stringify(request.body) });
    const result = await response.json();
    if (!response.ok) {
      pendingWriteRef.current = null;
      setPendingWrite(null);
      clearPendingWrite(window.sessionStorage);
      throw new Error(result.message || `${request.label}失败`);
    }
    pendingWriteRef.current = null;
    setPendingWrite(null);
    clearPendingWrite(window.sessionStorage);
    return result;
  }

  async function retryWrite() {
    if (!pendingWrite) return;
    setBusy(true); setError("");
    try {
      await sendWrite(pendingWrite);
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${pendingWrite.label}失败，请重试`);
    } finally { setBusy(false); }
  }

  async function addFeedback(event: FormEvent<HTMLFormElement>, versionId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const content = data.get("content")?.toString().trim();
    if (!content) return;
    setBusy(true); setError("");
    const request: WriteRequest = { path: "/api/v1/feedback", body: { version_id: versionId, content, kind: data.get("kind") || "revision", source: "user" }, requestId: crypto.randomUUID(), label: "反馈保存" };
    try {
      await sendWrite(request);
      form.reset(); await load(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "反馈保存失败，请重试"); }
    finally { setBusy(false); }
  }

  async function accept(deliverableId: string, versionId: string) {
    setBusy(true); setError("");
    const request: WriteRequest = { path: `/api/v1/deliverables/${deliverableId}/accept`, body: { version_id: versionId }, requestId: crypto.randomUUID(), label: "采用版本" };
    try {
      await sendWrite(request);
      await load(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "采用版本失败，请重试"); }
    finally { setBusy(false); }
  }

  async function createDraft(event: FormEvent<HTMLFormElement>, trialId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setError("");
    const request: WriteRequest = { path: "/api/v1/drafts", body: { trial_id: trialId, title: data.get("title"), content: data.get("content"), type: "article" }, requestId: crypto.randomUUID(), label: "成果保存" };
    try {
      await sendWrite(request);
      form.reset(); await load(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "成果保存失败"); }
    finally { setBusy(false); }
  }

  return <main className={sidebarOpen ? "app-shell" : "app-shell sidebar-collapsed"}>
    <aside className="sidebar">
      <div className="sidebar-head"><button className="logo" onClick={() => openWorkspace()} aria-label="返回 OPC 总览">M</button><strong>MYOPC</strong><button className="icon-button collapse" onClick={() => setSidebarOpen(false)} title="收起侧边栏"><PanelLeftClose size={18} /></button></div>
      <nav className="primary-nav" aria-label="主导航">
        <button className={view === "workspace" && workspaceBoard === "overview" ? "nav-item active" : "nav-item"} onClick={() => openWorkspace()}><Compass size={17} /><span>总览</span></button>
        <button className={view === "workspace" && workspaceBoard !== "overview" ? "nav-item active" : "nav-item"} onClick={() => openWorkspace()}><Sparkles size={17} /><span>一人公司</span></button>
        <div className="workspace-nav-children">
          <button className={view === "workspace" && workspaceBoard === "personal" ? "nav-item nav-child active" : "nav-item nav-child"} onClick={() => openWorkspace("personal")}><UserRound size={15} /><span>个人</span></button>
          <button className={view === "workspace" && workspaceBoard === "personal_project" ? "nav-item nav-child active" : "nav-item nav-child"} onClick={() => openWorkspace("personal_project")}><Briefcase size={15} /><span>个人项目</span></button>
          <button className={view === "workspace" && workspaceBoard === "enterprise_project" ? "nav-item nav-child active" : "nav-item nav-child"} onClick={() => openWorkspace("enterprise_project")}><Building2 size={15} /><span>企业项目</span></button>
          <button className={view === "workspace" && workspaceBoard === "media" ? "nav-item nav-child active" : "nav-item nav-child"} onClick={() => openWorkspace("media")}><Megaphone size={15} /><span>自媒体</span></button>
        </div>
        <div className="nav-divider" />
        <button className={view === "overview" && !selected ? "nav-item active" : "nav-item"} onClick={() => goTo("overview")}><BookOpen size={17} /><span>知识总览</span></button>
        <button className={view === "projects" || (view === "entry" && lastEntrySection === "projects") ? "nav-item active" : "nav-item"} onClick={() => goTo("projects")}><Folder size={17} /><span>项目</span>{knowledgeProjects.length > 0 && <b>{knowledgeProjects.length}</b>}</button>
        <button className={view === "toolbox" || (view === "entry" && lastEntrySection === "toolbox") ? "nav-item active" : "nav-item"} onClick={() => goTo("toolbox")}><Rocket size={17} /><span>工具</span>{knowledgeTools.length > 0 && <b>{knowledgeTools.length}</b>}</button>
        <button className={view === "space" || (view === "entry" && lastEntrySection === "space") ? "nav-item active" : "nav-item"} onClick={() => goTo("space")}><BookOpen size={17} /><span>空间</span>{knowledgeNotes.length > 0 && <b>{knowledgeNotes.length}</b>}</button>
        <button className={view === "maps" || (view === "entry" && lastEntrySection === "maps") ? "nav-item active" : "nav-item"} onClick={() => goTo("maps")}><Network size={17} /><span>图谱</span>{knowledgeMaps.length > 0 && <b>{knowledgeMaps.length}</b>}</button>
      </nav>
    </aside>

    <section className="main-panel">
      {view === "overview" ? (
      <header className="main-header"><button className="icon-button menu-button" onClick={() => setSidebarOpen(!sidebarOpen)} title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}>{sidebarOpen ? <Menu size={19} /> : <PanelLeftOpen size={19} />}</button><div className="breadcrumb"><strong>个人资产空间</strong></div>{(view === "overview" || view === "active") && <div className="header-sync" title={knowledgeTooltip}><details className="sync-details"><summary>{knowledgeSync?.finishedAt ? "上次同步 " + new Date(knowledgeSync.finishedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "未同步"}</summary><div className="sync-panel"><span>来源版本 {knowledgeSync?.commit ? knowledgeSync.commit.slice(0, 8) : "未知"}</span><span>{pendingNotes > 0 ? pendingNotes + " 条待更新" : "没有待更新的条目"}</span>{knowledgeSync?.message && <span>{knowledgeSync.message}</span>}{knowledgeSync?.status === "failed" && <span>上次同步失败</span>}</div></details><button className="header-action" onClick={() => void syncKnowledge()} disabled={knowledgeBusy} title="同步知识仓库并更新索引">{knowledgeBusy ? "处理中…" : "同步"}</button><button className="header-action" onClick={() => void processPending()} disabled={knowledgeBusy || pendingNotes === 0 || !knowledgeModel?.configured} title={pendingNotes > 0 ? `生成 ${pendingNotes} 条阅读说明` : "没有待加工的条目"}>{pendingNotes > 0 ? `加工 ${pendingNotes}` : "加工"}</button><button className="icon-button" onClick={() => void load()} disabled={refreshing} title="刷新共享状态" aria-label="刷新共享状态"><RefreshCw size={15} className={refreshing ? "spin" : ""} /></button></div>}</header>
      ) : (
        !sidebarOpen && <button className="icon-button floating-menu" onClick={() => setSidebarOpen(true)} title="展开侧边栏" aria-label="展开侧边栏"><PanelLeftOpen size={17} /></button>
      )}
      <div className={view === "overview" ? "content" : "content content-flush"}>
        {pendingWrite && <div className="pending-write-banner"><CircleAlert size={16} /><span><strong>{pendingWrite.label}尚未确认</strong><small>请求已保留；读取成功不代表写入响应已确认。</small></span><button className="retry-button" onClick={() => void retryWrite()} disabled={busy}>重试原请求</button></div>}
        {error && <div className="error-banner"><CircleAlert size={16} /><span>{error}</span>{!pendingWrite && <button className="retry-button" onClick={() => void load()}>重新连接</button>}<button onClick={() => setError("")} aria-label="关闭提示"><X size={16} /></button></div>}
        {loading && view !== "workspace" && <div className="loading-state">正在读取共享工作状态…</div>}
        {notice && <div className="notice-banner"><CheckCircle2 size={15} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="关闭提示"><X size={15} /></button></div>}
        {view === "workspace" && <WorkspaceView activeBoard={workspaceBoard} onBoardChange={setWorkspaceBoard} />}
        {!loading && view === "overview" && !trial && <OverviewView projects={knowledgeProjects} tools={knowledgeTools} notes={knowledgeNotes} maps={knowledgeMaps} onOpen={openEntry} onNavigate={goTo} />}
        {view === "entry" && entryLoading && <div className="loading-state">正在读取条目…</div>}
        {view === "entry" && !entryLoading && entry && (entry.kind === "map"
          ? <MapDetailView entry={entry} busy={knowledgeBusy} model={knowledgeModel} onBack={() => goTo(lastEntrySection)} onOpen={(id, kind) => void openEntry(id, kind)} onGenerate={(id, force) => void generateNote(id, force)} />
          : <KnowledgeDetailView entry={entry} busy={knowledgeBusy} model={knowledgeModel} onBack={() => goTo(lastEntrySection)} onOpen={(id, kind) => void openEntry(id, kind)} onGenerate={(id, force) => void generateNote(id, force)} />)}
        {!loading && !trial && view === "projects" && <KnowledgeListView kind="project" items={knowledgeProjects} onOpen={openEntry} />}
        {!loading && !trial && view === "toolbox" && <KnowledgeListView kind="tool" items={knowledgeTools} onOpen={openEntry} />}
        {!loading && !trial && view === "space" && <KnowledgeListView kind="note" items={knowledgeNotes} onOpen={openEntry} reuse={reuse} onResolveCandidate={resolveCandidate} />}
        {!loading && !trial && view === "maps" && <KnowledgeListView kind="map" items={knowledgeMaps} onOpen={openEntry} />}
        {!loading && !trial && view === "active" && <ListView title="进行中的行动" subtitle="从这里继续目标、产物和反馈；审阅中的行动也保留在这里。" trials={activeTrials} onOpen={openTrial} empty="还没有进行中的行动" />}
        {!loading && !trial && view === "inbox" && <InboxView trials={trials} onOpen={openTrial} />}
        {!loading && !trial && view === "deliverables" && <DeliverablesView trials={trials} onOpen={openTrial} />}
        {trial && <TrialWorkspace trial={trial} busy={busy} onFeedback={addFeedback} onAccept={accept} onDraft={createDraft} />}
      </div>
    </section>
  </main>;
}

function inlineText(value: string, keyPrefix: string) {
  const parts = value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((part) => part !== "");
  return parts.map((part, index) => part.startsWith("**") && part.endsWith("**") && part.length > 4
    ? <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong>
    : part.startsWith("`") && part.endsWith("`") && part.length > 2
      ? <code key={`${keyPrefix}-${index}`}>{part.slice(1, -1)}</code>
      : <span key={`${keyPrefix}-${index}`}>{part}</span>);
}

function renderMarkdown(body: string) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];
  let code: string[] | null = null;
  const flushList = () => {
    if (list.length === 0) return;
    const items = list;
    nodes.push(<ul key={`ul-${nodes.length}`}>{items.map((item, index) => <li key={`${nodes.length}-${index}`}>{inlineText(item, `li-${nodes.length}-${index}`)}</li>)}</ul>);
    list = [];
  };
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    nodes.push(<p key={`p-${nodes.length}`}>{inlineText(text, `p-${nodes.length}`)}</p>);
    paragraph = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (code) {
        const content = code.join("\n");
        nodes.push(<pre key={`pre-${nodes.length}`}><code>{content}</code></pre>);
        code = null;
      } else { flushParagraph(); flushList(); code = []; }
      continue;
    }
    if (code) { code.push(line); continue; }
    if (trimmed === "") { flushParagraph(); flushList(); continue; }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph(); flushList();
      const content = inlineText(heading[2], `h-${nodes.length}`);
      if (heading[1].length <= 2) nodes.push(<h3 key={`h-${nodes.length}`}>{content}</h3>);
      else nodes.push(<h4 key={`h-${nodes.length}`}>{content}</h4>);
      continue;
    }
    const bullet = /^(?:[-*]|\d+\.)\s+(.*)$/.exec(trimmed);
    if (bullet) { flushParagraph(); list.push(bullet[1]); continue; }
    paragraph.push(trimmed);
  }
  flushParagraph(); flushList();
  if (code) nodes.push(<pre key={`pre-${nodes.length}`}><code>{code.join("\n")}</code></pre>);
  return nodes;
}

const NOTE_CATEGORY_ORDER = ["方法", "经验", "判断"];
const PROJECT_STATUS_ORDER = ["进行中", "原型验证", "方向验证", "已暂停"];

function groupNotesByCategory(items: KnowledgeItem[]) {
  const buckets = new Map<string, KnowledgeItem[]>();
  for (const item of items) {
    const key = item.category || "未分类";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return [...NOTE_CATEGORY_ORDER, "未分类"]
    .filter((label) => buckets.has(label))
    .map((label) => ({ label, items: buckets.get(label) as KnowledgeItem[] }));
}

function sortProjectsByStatus(items: KnowledgeItem[]) {
  return [...items].sort((left, right) => {
    const rank = (item: KnowledgeItem) => {
      const index = PROJECT_STATUS_ORDER.indexOf(item.status);
      return index === -1 ? PROJECT_STATUS_ORDER.length : index;
    };
    return rank(left) - rank(right) || left.title.localeCompare(right.title);
  });
}

function KnowledgeListView({ kind, items, onOpen, reuse, onResolveCandidate }: { kind: "project" | "tool" | "note" | "map"; items: KnowledgeItem[]; onOpen: (id: string, kind: string) => void; reuse?: ReuseOverview | null; onResolveCandidate?: (id: string, status: string, note: string, entryId: string, commit: string) => Promise<boolean> }) {
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const meta = kind === "project"
    ? { eyebrow: "Projects", title: "项目", subtitle: "正在推进的项目；已暂停与不再维护的收在页面底部的折叠区。" }
    : kind === "tool"
      ? { eyebrow: "Toolbox", title: "工具", subtitle: "真正可调用的工具与入口，说明和维护都在知识仓库里。" }
      : kind === "note"
        ? { eyebrow: "Space", title: "空间", subtitle: "经过实践留下的方法、经验与判断。" }
        : { eyebrow: "Maps", title: "图谱", subtitle: "架构、流程、判断与关系的可视化理解。" };
  const allGroups = kind === "note" ? groupNotesByCategory(items) : [];
  const activeProjects = items.filter((item) => item.status !== "已暂停");
  const pausedProjects = sortProjectsByStatus(items.filter((item) => item.status === "已暂停"));
  const groups = kind === "note"
    ? (categoryFilter ? allGroups.filter((group) => group.label === categoryFilter) : allGroups)
    : kind === "project"
      ? [{ label: null as string | null, items: sortProjectsByStatus(activeProjects) }]
      : [{ label: null as string | null, items }];
  const sourceLink = (item: KnowledgeItem) => {
    if (!item.link) return null;
    const isRepo = /github\.com/i.test(item.link);
    return { href: item.link, label: item.kind === "tool" && !isRepo ? "打开工具" : isRepo ? "查看源码" : "打开入口" };
  };
  const openLabel = (kind: string) => kind === "project" ? "查看项目" : kind === "tool" ? "查看说明" : kind === "map" ? "打开图谱" : "阅读笔记";
  const renderCard = (item: KnowledgeItem) => {
    if (kind === "map") {
      const link = sourceLink(item);
      const noteHint = item.note.status === "ready" ? null : noteStatusLabel(item.note.status, item.note.stale);
      const oneLine = item.note.brief || item.summary || "暂无摘要";
      const structure = item.note.card || item.note.summary || "";
      return <article className="asset-card knowledge-card map-card" key={item.id}>
        <div className="asset-card-head"><span>{mapTypeLabel(item.mapType)}</span>{noteHint && <b>{noteHint}</b>}</div>
        <h2>{item.title}</h2>
        <p className="map-card-brief">{oneLine}</p>
        {structure && structure !== oneLine && <p className="map-card-structure">{structure}</p>}
        {item.tags.length > 0 && <div className="tag-row">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
        <div className="asset-card-foot">{item.updatedAt ? "更新 " + item.updatedAt : "未标注更新时间"}</div>
        <div className="knowledge-actions">
          <button className="primary-button" onClick={() => onOpen(item.id, item.kind)}>打开图谱</button>
          {link && <a href={link.href} target="_blank" rel="noreferrer">{link.label} <ExternalLink size={12} /></a>}
        </div>
      </article>;
    }
    const link = sourceLink(item);
    const noteHint = item.note.status === "ready" ? null : noteStatusLabel(item.note.status, item.note.stale);
    const usingSourceSummary = !item.note.card && !item.note.summary && Boolean(item.summary);
    return <article className="asset-card knowledge-card" key={item.id}>
      <div className="asset-card-head"><span>{kind === "note" ? item.category || "笔记" : item.status || meta.eyebrow}</span>{noteHint && <b>{noteHint}</b>}</div>
      <h2>{item.title}</h2>
      <p>{item.note.card || item.note.summary || item.summary || "暂无摘要"}{usingSourceSummary && <em className="source-summary-mark">原文摘要</em>}</p>
      {item.tags.length > 0 && <div className="tag-row">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
      <div className="asset-card-foot">{item.updatedAt ? "更新 " + item.updatedAt : "未标注更新时间"}</div>
      <div className="knowledge-actions">
        <button className="primary-button" onClick={() => onOpen(item.id, item.kind)}>{openLabel(item.kind)}</button>
        {link && <a href={link.href} target="_blank" rel="noreferrer">{link.label} <ExternalLink size={12} /></a>}
      </div>
    </article>;
  };
  return <div className="asset-view">
    <div className="view-head">
      <div className="view-title"><span className="eyebrow">{meta.eyebrow}</span><h1>{meta.title}</h1><p>{meta.subtitle}</p></div>
      {kind === "note" && allGroups.length > 0 && <div className="category-chips">
        <button className={categoryFilter === null ? "category-chip active" : "category-chip"} onClick={() => setCategoryFilter(null)}>全部 <small>{items.length}</small></button>
        {allGroups.map((group) => <button key={group.label} className={categoryFilter === group.label ? "category-chip active" : "category-chip"} onClick={() => setCategoryFilter(group.label)}>{group.label} <small>{group.items.length}</small></button>)}
      </div>}
    </div>
    {kind === "note" && reuse && (reuse.counts.calls > 0 || reuse.counts.results > 0) && <details className="reuse-panel">
      <summary>
        <strong>知识复用</strong>
        <span>{reuse.counts.calls} 次调用 · {reuse.counts.usedCalls} 次命中 · {reuse.counts.results} 条任务结果 · {reuse.counts.pendingCandidates} 条候选经验</span>
      </summary>
      <div className="reuse-body">
        <div className="reuse-block">
          <h4>最近调用</h4>
          {reuse.recentCalls.length === 0 ? <p className="muted-text">还没有调用记录。</p> : <ul className="reuse-list">{reuse.recentCalls.slice(0, 5).map((call) => <li key={call.id}>
            <span className="reuse-repo">{call.repository}</span>
            <span className="reuse-task">{call.task}</span>
            <span className="reuse-meta">{call.usedCount > 0 ? `使用 ${call.usedCount} 条历史知识` : "未命中"}{call.outcome ? ` · 结果：${call.outcome}` : ""}{call.usedCount === 0 && call.reason ? ` · ${call.reason}` : ""} · {new Date(call.createdAt).toLocaleString("zh-CN")}</span>
          </li>)}</ul>}
        </div>
        <div className="reuse-block">
          <h4>候选经验{reuse.counts.pendingCandidates > 0 ? `（${reuse.counts.pendingCandidates} 条待整理）` : ""}</h4>
          {reuse.candidates.length === 0 ? <p className="muted-text">没有待整理的候选经验。</p> : <ul className="reuse-list">{reuse.candidates.slice(0, 5).map((candidate) => <li key={candidate.id}>
            <span className="reuse-task">{candidate.title}</span>
            <span className="reuse-meta">{candidate.repository}{candidate.suggestion ? ` · ${candidate.suggestion}` : ""}</span>
            {onResolveCandidate && <CandidateActions candidateId={candidate.id} onResolve={onResolveCandidate} />}
          </li>)}</ul>}
          {reuse.resolvedCandidates.length > 0 && <details className="resolved-candidates">
            <summary>最近处理（{reuse.resolvedCandidates.length}）</summary>
            <ul className="reuse-list">{reuse.resolvedCandidates.slice(0, 5).map((item) => <li key={item.id}>
              <span className="reuse-task">{item.title} <em className="candidate-status">{candidateStatusLabel(item.status)}</em></span>
              <span className="reuse-meta">{item.note}{item.entryId ? ` · 条目 ${item.entryId}` : ""}{item.knowledgeCommit ? ` · ${item.knowledgeCommit.slice(0, 8)}` : ""}{item.resolvedAt ? ` · ${shortDateTime(item.resolvedAt)}` : ""}</span>
            </li>)}</ul>
          </details>}
        </div>
        <div className="reuse-block">
          <h4>知识使用情况</h4>
          {reuse.usage.length === 0 ? <p className="muted-text">还没有被复用的知识。</p> : <ul className="reuse-list">{reuse.usage.slice(0, 5).map((item) => <li key={item.id}>
            <span className="reuse-task">{item.title}</span>
            <span className="reuse-meta">被使用 {item.usedCount} 次 · {item.effective} 有效 / {item.partial} 部分有效 / {item.ineffective} 无效{item.unknown > 0 ? ` / ${item.unknown} 未判定` : ""}</span>
          </li>)}</ul>}
        </div>
      </div>
      <p className="reuse-hint">结果与阶段事件先保存在 OPC；候选经验在这里处置后才进入知识仓库，OPC 不自动改仓库。</p>
    </details>}
    {items.length === 0
      ? <div className="quiet-empty"><BookOpen size={22} /><p>知识仓库里还没有{meta.title}条目</p></div>
      : groups.map((group) => <section className="asset-group" key={group.label ?? "all"}>
        {group.label && <div className="asset-group-head"><span>{group.label}</span><small>{group.items.length}</small></div>}
        <div className="asset-grid">{group.items.map(renderCard)}</div>
      </section>)}
    {kind === "project" && pausedProjects.length > 0 && <details className="paused-projects">
      <summary><strong>已暂停 / 不再维护</strong><span>{pausedProjects.length} 个项目 · 历史记录仍可查看</span></summary>
      <div className="asset-grid">{pausedProjects.map(renderCard)}</div>
    </details>}
  </div>;
}

function CandidateActions({ candidateId, onResolve }: { candidateId: string; onResolve: (id: string, status: string, note: string, entryId: string, commit: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("merged");
  const [note, setNote] = useState("");
  const [entryId, setEntryId] = useState("");
  const [commit, setCommit] = useState("");
  const [saving, setSaving] = useState(false);
  if (!open) return <button className="text-button candidate-toggle" onClick={() => setOpen(true)}>处置</button>;
  const save = async () => {
    setSaving(true);
    const ok = await onResolve(candidateId, status, note.trim(), entryId.trim(), commit.trim());
    setSaving(false);
    if (ok) setOpen(false);
  };
  return <div className="candidate-form">
    <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="处置方式">
      <option value="merged">已合并</option>
      <option value="added">已新增</option>
      <option value="hold">暂存</option>
      <option value="discarded">舍弃</option>
    </select>
    <input value={note} onChange={(event) => setNote(event.target.value)} placeholder={status === "hold" ? "暂存原因（待复核）" : "处理理由"} />
    <input value={entryId} onChange={(event) => setEntryId(event.target.value)} placeholder="知识条目 id（可选）" />
    <input value={commit} onChange={(event) => setCommit(event.target.value)} placeholder="知识仓库提交（可选）" />
    <div className="candidate-buttons">
      <button className="primary-button" onClick={() => void save()} disabled={saving || !note.trim()}>{saving ? "保存中…" : "保存"}</button>
      <button className="text-button" onClick={() => setOpen(false)} disabled={saving}>取消</button>
    </div>
  </div>;
}

function KnowledgeDetailView({ entry, busy, model, onBack, onOpen, onGenerate }: { entry: KnowledgeDetail; busy: boolean; model: KnowledgeOverviewResponse["model"] | null; onBack: () => void; onOpen: (id: string, kind: string) => void; onGenerate: (id: string, force: boolean) => void }) {
  const note = entry.noteContent;
  return <div className="knowledge-detail">
    <div className="view-title">
      <button className="text-button back-button" onClick={onBack}><ChevronLeft size={14} /> 返回列表</button>
      <span className="eyebrow">{entry.kind === "project" ? "Project" : entry.kind === "tool" ? "Tool" : entry.kind === "map" ? "Map" : "Note"}</span>
      <h1>{entry.title}</h1>
      <p>{entry.summary}</p>
      <div className="detail-meta">
        <span>{entry.status || "未标注状态"}</span>
        <span>条目更新 {entry.updatedAt || "未标注"}</span>
        <span>{entry.noteContent ? `${entry.stale || entry.note.status === "stale" ? "上一次的阅读说明" : "阅读说明"}：${entry.note.model || "模型"}${entry.note.generatedAt ? ` · ${new Date(entry.note.generatedAt).toLocaleString("zh-CN")}` : ""}` : entry.note.status === "failed" ? "加工失败，暂无可用说明" : "尚未生成阅读说明"}</span>
      </div>
      <div className="detail-actions">
        <button className="primary-button" onClick={() => onGenerate(entry.id, false)} disabled={busy || !model?.configured} title={model?.configured ? undefined : "未配置模型密钥"}>{busy ? "处理中…" : "生成阅读说明"}</button>
        <button onClick={() => onGenerate(entry.id, true)} disabled={busy || !model?.configured}>重新生成</button>
        {entry.link && <a className="button-link" href={entry.link} target="_blank" rel="noreferrer">{/github\.com/i.test(entry.link) ? "查看源码" : entry.kind === "tool" ? "打开工具" : "打开入口"} <ExternalLink size={12} /></a>}
      </div>
      {(entry.note.error || entry.stale || entry.note.status === "stale") && <div className="inline-warning"><CircleAlert size={15} /><span>{entry.note.status === "failed"
        ? `上次加工失败：${entry.note.error || "未知原因"}。${entry.noteContent ? "下面是上一次可用的说明。" : ""}`
        : entry.noteContent ? "原文或规程已更新，下面是上一次的说明，等待重新加工。" : "原文或规程已更新，说明待重新加工。"}</span></div>}
    </div>
    <section className="knowledge-section">
      <h2>阅读说明</h2>
      {!note ? <p className="muted-text">还没有可用的阅读说明。上方按钮可按当前来源生成；失败时会保留上一次可用结果。</p> : <>
        <p className="note-summary">{note.summary}</p>
        {note.facts.length > 0 && <><h3>原文事实</h3><ul>{note.facts.map((item, index) => <li key={`fact-${index}`}>{item}</li>)}</ul></>}
        {note.decisions.length > 0 && <><h3>关键选择与依据</h3><dl className="decision-list">{note.decisions.map((item, index) => <div key={`decision-${index}`}><dt>{item.title}</dt><dd>{item.detail}</dd></div>)}</dl></>}
        {note.steps.length > 0 && <><h3>步骤</h3><ol>{note.steps.map((item, index) => <li key={`step-${index}`}>{item}</li>)}</ol></>}
        {note.conditions.length > 0 && <><h3>适用条件</h3><ul>{note.conditions.map((item, index) => <li key={`condition-${index}`}>{item}</li>)}</ul></>}
        {note.open_questions.length > 0 && <><h3>仍未确定</h3><ul>{note.open_questions.map((item, index) => <li key={`open-${index}`}>{item}</li>)}</ul></>}
        {note.inferences.length > 0 && <><h3>模型推断（非原文事实）</h3><ul className="inference-list">{note.inferences.map((item, index) => <li key={`inference-${index}`}>{item}</li>)}</ul></>}
      </>}
    </section>
    {entry.progress && <section className="knowledge-section progress-section">
      <h2>最近进展</h2>
      <div className="progress-head">
        <strong>{entry.progress.stage ? entry.progress.stage.title : "还没有阶段性记录"}</strong>
        <span className="progress-meta">{entry.progress.updatedAt ? `更新 ${shortDateTime(entry.progress.updatedAt)}` : ""}{entry.progress.updatedAt ? " · " : ""}共 {entry.progress.total} 条记录 · {entry.progress.repositories.join(" / ")}</span>
      </div>
      {entry.progress.events.length > 0 && <ul className="progress-list">{entry.progress.events.map((record) => <li key={record.id}>
        <div className="progress-item-head">
          <span className={`progress-type type-${record.type}`}>{progressTypeLabel(record.type)}</span>
          <strong>{record.title}</strong>
          <span className={`progress-status status-${record.status}`}>{progressStatusLabel(record.status)}</span>
        </div>
        <span className="progress-meta">{[shortDateTime(record.occurredAt), record.machine, record.branch, record.commit ? record.commit.slice(0, 8) : "", record.dirty ? "有未提交改动" : ""].filter(Boolean).join(" · ")}</span>
        {record.content && <p>{record.content}</p>}
        {record.rationale && <p className="progress-rationale">理由：{record.rationale}</p>}
        {record.verification && <p className="progress-verification">验证：{record.verification}</p>}
        {record.note && <p className="progress-note">{record.note}</p>}
        {record.evidence.length > 0 && <details className="progress-evidence"><summary>证据（{record.evidence.length}）</summary><ul>{record.evidence.map((item, index) => <li key={`evidence-${index}`}><code>{item}</code></li>)}</ul></details>}
      </li>)}</ul>}
      {entry.progress.environment.length > 0 && <><h3>环境验证</h3><ul className="progress-environment">{entry.progress.environment.map((record) => <li key={record.id}>
        <span className={record.verifiedOnThisMachine ? "env-badge ok" : "env-badge"}>{record.verifiedOnThisMachine ? "本机已验证" : "其他机器验证 · 不代表本机已就绪"}</span>
        <strong>{record.title}</strong>
        <span className="progress-meta">{[record.verification, record.machine, shortDateTime(record.occurredAt)].filter(Boolean).join(" · ")}</span>
      </li>)}</ul></>}
      {entry.progress.blockers.length > 0 && <><h3>阻塞</h3><ul>{entry.progress.blockers.map((record) => <li key={record.id}>{record.title}{record.nextStep ? `（下一步：${record.nextStep}）` : ""}</li>)}</ul></>}
      {entry.progress.nextSteps.length > 0 && <><h3>下一步</h3><ol>{entry.progress.nextSteps.map((step, index) => <li key={`next-${index}`}>{step}</li>)}</ol></>}
    </section>}
    {entry.related.length > 0 && <section className="knowledge-section">
      <h2>相关知识</h2>
      <RelatedKnowledge items={entry.related} onOpen={onOpen} />
    </section>}
    <details className="knowledge-details">
      <summary>原文（{entry.relPath}）</summary>
      <div className="markdown-body">{renderMarkdown(entry.body)}</div>
    </details>
    <details className="knowledge-details">
      <summary>来源</summary>
      {entry.sources.length === 0 ? <p className="muted-text">条目没有标注来源。</p> : <ul className="source-list">{entry.sources.map((source) => <li key={source.label}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.label} <ExternalLink size={11} /></a> : source.label}</li>)}</ul>}
    </details>
  </div>;
}

type MapSection = { title: string; body: string };

function extractMermaidBlocks(body: string) {
  const blocks: string[] = [];
  const pattern = /```mermaid[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) if (match[1].trim()) blocks.push(match[1].trim());
  return blocks;
}

function mapSections(body: string): MapSection[] {
  const sections: MapSection[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current) sections.push({ title: current.title, body: current.lines.join("\n").trim() });
      current = { title: heading[1], lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push({ title: current.title, body: current.lines.join("\n").trim() });
  return sections;
}

// 主图已经在页面顶部渲染，正文里同一份 Mermaid 不再重复出现；
// 只有这一张图的章节也一并跳过，避免留下空标题。
function sectionKeepsContent(section: MapSection, mainDiagram: string) {
  const withoutMain = section.body.replace(/```mermaid[^\n]*\n([\s\S]*?)```/g, (block, code: string) => code.trim() === mainDiagram ? "" : block);
  return withoutMain.trim().length > 0;
}

function renderMapBody(text: string, skipDiagram: string) {
  const nodes: ReactNode[] = [];
  const parts = text.split(/```mermaid[^\n]*\n([\s\S]*?)```/g);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const code = part.trim();
      if (!code || code === skipDiagram) return;
      nodes.push(<MermaidDiagram key={`map-diagram-${index}`} code={code} label="结构图" />);
      return;
    }
    const content = part.trim();
    if (!content) return;
    nodes.push(<div className="markdown-body" key={`map-text-${index}`}>{renderMarkdown(content)}</div>);
  });
  return nodes;
}

function RelatedKnowledge({ items, onOpen }: { items: KnowledgeDetail["related"]; onOpen: (id: string, kind: string) => void }) {
  if (items.length === 0) return <p className="muted-text">没有标注相关知识。</p>;
  const order = ["project", "tool", "note", "map"];
  const kinds = [...new Set(items.map((item) => item.kind))].sort((left, right) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex);
  });
  return <div className="related-groups">
    {kinds.map((kind) => {
      const meta = RELATED_KIND_META[kind] || { title: "其他相关知识", badge: kind };
      return <div className="related-group" key={kind}>
        <h4>{meta.title}</h4>
        <div className="related-links">
          {items.filter((item) => item.kind === kind).map((item) => <button type="button" className="related-link" key={item.id} onClick={() => onOpen(item.id, item.kind)}>
            <span className="related-kind">{meta.badge}</span>
            <span className="related-title">{item.title}</span>
            <ChevronRight size={13} />
          </button>)}
        </div>
      </div>;
    })}
  </div>;
}

function MapDetailView({ entry, busy, model, onBack, onOpen, onGenerate }: { entry: KnowledgeDetail; busy: boolean; model: KnowledgeOverviewResponse["model"] | null; onBack: () => void; onOpen: (id: string, kind: string) => void; onGenerate: (id: string, force: boolean) => void }) {
  const note = entry.noteContent;
  // 知识仓库在 Windows 检出时是 CRLF；统一换行后再比较，主图不会在正文里重复渲染。
  const body = entry.body.replace(/\r\n/g, "\n");
  const diagrams = extractMermaidBlocks(body);
  const mainDiagram = diagrams[0] || "";
  const sections = mapSections(body).filter((section) => sectionKeepsContent(section, mainDiagram));
  return <div className="knowledge-detail map-detail">
    <div className="view-title">
      <button className="text-button back-button" onClick={onBack}><ChevronLeft size={14} /> 返回图谱</button>
      <span className="eyebrow">Map · {mapTypeLabel(entry.mapType)}</span>
      <h1>{entry.title}</h1>
      <p className="map-one-line">{entry.note.brief || entry.summary}</p>
      <div className="detail-meta">
        <span>{entry.status || "未标注状态"}</span>
        <span>条目更新 {entry.updatedAt || "未标注"}</span>
        <span>{entry.noteContent ? `${entry.stale || entry.note.status === "stale" ? "上一次的阅读说明" : "阅读说明"}：${entry.note.model || "模型"}${entry.note.generatedAt ? ` · ${new Date(entry.note.generatedAt).toLocaleString("zh-CN")}` : ""}` : entry.note.status === "failed" ? "加工失败，暂无可用说明" : "尚未生成阅读说明"}</span>
      </div>
      <div className="detail-actions">
        <button className="primary-button" onClick={() => onGenerate(entry.id, false)} disabled={busy || !model?.configured} title={model?.configured ? undefined : "未配置模型密钥"}>{busy ? "处理中…" : "生成阅读说明"}</button>
        <button onClick={() => onGenerate(entry.id, true)} disabled={busy || !model?.configured}>重新生成</button>
      </div>
      {(entry.note.error || entry.stale || entry.note.status === "stale") && <div className="inline-warning"><CircleAlert size={15} /><span>{entry.note.status === "failed"
        ? `上次加工失败：${entry.note.error || "未知原因"}。${entry.noteContent ? "下面是上一次可用的说明。" : ""}`
        : entry.noteContent ? "原文或规程已更新，下面是上一次的说明，等待重新加工。" : "原文或规程已更新，说明待重新加工。"}</span></div>}
    </div>
    {mainDiagram
      ? <section className="map-main"><MermaidDiagram code={mainDiagram} label="主图" /></section>
      : <div className="inline-warning"><CircleAlert size={15} /><span>原文中没有找到 Mermaid 结构图，下面显示已整理的正文。</span></div>}
    {sections.map((section) => <section className="knowledge-section map-section" key={section.title}>
      <h2>{section.title}</h2>
      {renderMapBody(section.body, mainDiagram)}
    </section>)}
    <section className="knowledge-section map-reading">
      <h2>模型辅助阅读</h2>
      {!note ? <p className="muted-text">还没有可用的阅读说明。上方按钮可按当前来源生成；失败时会保留上一次可用结果。</p> : <>
        <p className="note-summary">{note.summary}</p>
        {note.facts.length > 0 && <><h3>图中与正文明确写出的内容</h3><ul>{note.facts.map((item, index) => <li key={`map-fact-${index}`}>{item}</li>)}</ul></>}
        {note.decisions.length > 0 && <><h3>结构选择与边界</h3><dl className="decision-list">{note.decisions.map((item, index) => <div key={`map-decision-${index}`}><dt>{item.title}</dt><dd>{item.detail}</dd></div>)}</dl></>}
        {note.conditions.length > 0 && <><h3>适用条件 / 边界</h3><ul>{note.conditions.map((item, index) => <li key={`map-condition-${index}`}>{item}</li>)}</ul></>}
        {note.open_questions.length > 0 && <><h3>仍未确定</h3><ul>{note.open_questions.map((item, index) => <li key={`map-open-${index}`}>{item}</li>)}</ul></>}
        {note.inferences.length > 0 && <><h3>模型推断（非图中事实）</h3><ul className="inference-list">{note.inferences.map((item, index) => <li key={`map-inference-${index}`}>{item}</li>)}</ul></>}
      </>}
      <p className="map-note-hint">模型只解释原图，不修改 Mermaid 源码和图结构。</p>
    </section>
    <section className="knowledge-section map-related">
      <h2>相关知识</h2>
      <RelatedKnowledge items={entry.related} onOpen={onOpen} />
      <h3 className="map-source-title">来源</h3>
      {entry.sources.length === 0 ? <p className="muted-text">条目没有标注来源。</p> : <ul className="source-list">{entry.sources.map((source, index) => <li key={`map-source-${index}`}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.label} <ExternalLink size={11} /></a> : source.label}</li>)}</ul>}
    </section>
    <details className="knowledge-details">
      <summary>原文（{entry.relPath}）</summary>
      <div className="markdown-body">{renderMarkdown(entry.body)}</div>
    </details>
  </div>;
}

function OverviewView({ projects, tools, notes, maps, onOpen, onNavigate }: { projects: KnowledgeItem[]; tools: KnowledgeItem[]; notes: KnowledgeItem[]; maps: KnowledgeItem[]; onOpen: (id: string, kind: string) => void; onNavigate: (view: View) => void }) {
  const columns: Array<{ view: "projects" | "toolbox" | "space" | "maps"; label: string; items: KnowledgeItem[] }> = [
    { view: "projects", label: "项目", items: projects },
    { view: "toolbox", label: "可调用工具", items: tools },
    { view: "space", label: "知识与方法", items: notes },
    { view: "maps", label: "图谱", items: maps },
  ];
  return <div className="overview-view">
    <div className="overview-board">
      {columns.map((column) => {
        const isProjects = column.view === "projects";
        const pool = isProjects ? column.items.filter((item) => item.status !== "已暂停") : column.items;
        const items = [...pool].sort((left, right) => {
          if (isProjects) {
            const rank = (item: KnowledgeItem) => { const index = PROJECT_STATUS_ORDER.indexOf(item.status); return index === -1 ? PROJECT_STATUS_ORDER.length : index; };
            const byStatus = rank(left) - rank(right);
            if (byStatus !== 0) return byStatus;
          }
          return (right.updatedAt || "").localeCompare(left.updatedAt || "");
        }).slice(0, 5);
        const pausedCount = isProjects ? column.items.filter((item) => item.status === "已暂停").length : 0;
        return <section className="overview-column" key={column.view}>
          <button className="overview-count" onClick={() => onNavigate(column.view)} title={`打开${column.label}`}><span>{column.label}</span><strong>{column.items.length}</strong><ChevronRight size={14} /></button>
          <div className="overview-items">
            {items.map((item) => <button className="overview-item" key={item.id} onClick={() => onOpen(item.id, item.kind)}>
              <strong>{item.title}</strong>
              <small>{item.note.brief || item.summary || "暂无摘要"}</small>
            </button>)}
            {items.length === 0 && <p className="overview-item-empty">还没有内容</p>}
            {pausedCount > 0 && <p className="overview-column-hint">暂停中的 {pausedCount} 个项目在项目页查看</p>}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
function ListView({ title, subtitle, trials, onOpen, empty }: { title: string; subtitle: string; trials: Trial[]; onOpen: (id: string) => void; empty: string }) {
  return <div className="list-view"><div className="view-title"><h1>{title}</h1><p>{subtitle}</p></div>{trials.length === 0 ? <div className="quiet-empty"><Rocket size={22} /><p>{empty}</p></div> : <div className="rows">{trials.map((trial) => <button key={trial.id} onClick={() => onOpen(trial.id)}><span className="row-icon"><Rocket size={16} /></span><span><strong>{trial.title}</strong><small>{trial.goal}</small></span><b>{statusLabel(trial.status)}</b></button>)}</div>}</div>;
}

function InboxView({ trials, onOpen }: { trials: Trial[]; onOpen: (id: string) => void }) {
  const rows = trials.flatMap((trial) => trial.deliverables.flatMap((deliverable) => deliverable.versions.flatMap((version) => version.feedback.filter((item) => item.status === "open").map((feedback) => ({ trial, version, feedback })))));
  const pendingReviews = trials.flatMap((trial) => trial.deliverables.flatMap((deliverable) => {
    const version = deliverable.versions[0];
    const hasOpenReview = version?.feedback.some((feedback) => feedback.status === "open" && feedback.kind === "review");
    return deliverable.review_status === "pending_review" && version && !hasOpenReview ? [{ trial, deliverable, version }] : [];
  }));
  return <div className="list-view"><div className="view-title"><h1>待处理</h1><p>分清等待审阅的成果和需要修改的反馈。</p></div>{rows.length === 0 && pendingReviews.length === 0 ? <div className="quiet-empty"><CheckCircle2 size={22} /><p>没有待处理事项</p></div> : <div className="rows">{pendingReviews.map(({ trial, deliverable, version }) => <button key={version.id} onClick={() => onOpen(trial.id)}><span className="row-icon"><FileText size={16} /></span><span><strong>{deliverable.title} v{version.ordinal}</strong><small>成果待审阅 · {trial.title}</small></span><b>待审阅</b></button>)}{rows.map(({ trial, version, feedback }) => <button key={feedback.id} onClick={() => onOpen(trial.id)}><span className="row-icon"><Inbox size={16} /></span><span><strong>{feedback.content}</strong><small>{feedbackKindLabel(feedback.kind)} · {trial.title} · v{version.ordinal} · {sourceLabel(feedback.source)}</small></span><b>{feedbackKindLabel(feedback.kind)}</b></button>)}</div>}</div>;
}

function DeliverablesView({ trials, onOpen }: { trials: Trial[]; onOpen: (id: string) => void }) {
  const rows = trials.flatMap((trial) => trial.deliverables.map((deliverable) => ({ trial, deliverable })));
  return <div className="list-view"><div className="view-title"><h1>成果</h1><p>所有稿件、视频和工具版本。</p></div>{rows.length === 0 ? <div className="quiet-empty"><FileText size={22} /><p>还没有成果</p></div> : <div className="rows">{rows.map(({ trial, deliverable }) => <button key={deliverable.id} onClick={() => onOpen(trial.id)}><span className="row-icon"><FileText size={16} /></span><span><strong>{deliverable.title}</strong><small>{trial.title} · {deliverable.versions.length} 个版本</small></span><b>{reviewStatusLabel(deliverable.review_status)}</b></button>)}</div>}</div>;
}

function TrialWorkspace({ trial, busy, onFeedback, onAccept, onDraft }: { trial: Trial; busy: boolean; onFeedback: (event: FormEvent<HTMLFormElement>, versionId: string) => void; onAccept: (deliverableId: string, versionId: string) => void; onDraft: (event: FormEvent<HTMLFormElement>, trialId: string) => void }) {
  const codeRef = [trial.code_branch, trial.code_commit && trial.code_commit.slice(0, 8)].filter(Boolean).join(" · ");
  return <div className="trial-workspace"><div className="workspace-title"><div><span>{kindLabel(trial.capture?.kind)}</span><h1>{trial.title}</h1><p>{trial.goal}</p></div><b>{statusLabel(trial.status)}</b></div><div className="context-row"><div><span>输入</span><strong>{trial.captures?.length ? `${trial.captures.length} 份素材` : trial.capture?.title || "未关联"}</strong></div><div><span>项目</span><strong>{trial.project?.name || "未关联项目"}</strong></div><div><span>方法版本</span><strong>{trial.method ? `${trial.method.title} · ${trial.method.revision_label}` : codeRef || "未记录"}</strong></div><div><span>下一步</span><strong>{trial.next_step || "形成第一个可审阅成果"}</strong></div></div>{Boolean(trial.captures?.length) && <div className="trial-materials">{trial.captures!.map((capture) => <span key={capture.id}>{capture.title}</span>)}</div>}{trial.deliverables.length === 0 && <div className="workspace-empty"><FileText size={22} /><h2>添加第一个可审阅成果</h2><p>可以先放一段短稿，获得反馈后再继续迭代。</p><DraftForm busy={busy} onSubmit={(event) => onDraft(event, trial.id)} /></div>}{trial.deliverables.map((deliverable) => <section className="deliverable" key={deliverable.id}><div className="deliverable-head"><div><span>成果 · {deliverable.type === "article" ? "图文" : deliverable.type}</span><h2>{deliverable.title}</h2></div><b>{reviewStatusLabel(deliverable.review_status)}</b></div><div className="version-grid">{deliverable.versions.map((version) => <article className="version-card" key={version.id}><div className="version-meta"><strong>v{version.ordinal}</strong>{deliverable.accepted_version_id === version.id && <span>采用版本</span>}{deliverable.versions[0]?.id === version.id && deliverable.accepted_version_id !== version.id && <span>{reviewStatusLabel(deliverable.review_status)}</span>}</div><div className="article-preview">{version.content.split("\n").map((line, index) => line.startsWith("# ") ? <h3 key={index}>{line.slice(2)}</h3> : <p key={index}>{line || <br />}</p>)}</div>{version.handles_feedback_ids.length > 0 && <p className="handled">已处理 {version.handles_feedback_ids.length} 条反馈</p>}<div className="feedback-list">{version.feedback.map((item) => <p key={item.id}><span>{item.status === "handled" ? "已处理" : feedbackKindLabel(item.kind)}</span><small>{sourceLabel(item.source)}：</small>{item.content}</p>)}</div><form onSubmit={(event) => onFeedback(event, version.id)}><label htmlFor={`feedback-${version.id}`}>留下反馈</label><div className="feedback-form-row"><select name="kind" defaultValue="revision" aria-label="反馈类型"><option value="revision">待修改</option><option value="review">待审阅</option></select><input id={`feedback-${version.id}`} name="content" placeholder="写下具体意见" disabled={busy} /><button disabled={busy}>保存</button></div></form>{deliverable.accepted_version_id !== version.id && <button className="accept-button" disabled={busy} onClick={() => onAccept(deliverable.id, version.id)}>采用 v{version.ordinal}</button>}</article>)}</div></section>)}{trial.decisions.length > 0 && <section className="decision"><span>本轮判断</span><h2>{trial.decisions[0].adjustment}</h2><p>{trial.decisions[0].rationale}</p><div><small>下一步</small>{trial.decisions[0].next_step}<b>拟议</b></div></section>}</div>;
}

function DraftForm({ busy, onSubmit }: { busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="draft-form" onSubmit={onSubmit}><input name="title" required placeholder="成果名称" aria-label="成果名称" /><textarea name="content" required rows={5} placeholder="粘贴或写下第一版内容…" aria-label="成果内容" /><button disabled={busy}>{busy ? "正在保存…" : "保存第一版"}</button></form>;
}
