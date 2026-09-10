"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, ExternalLink, FileText, Folder, Inbox, Menu, PanelLeftClose, PanelLeftOpen, RefreshCw, Rocket, Search, Sparkles, X } from "lucide-react";
import { assertPendingWriteCanSend, clearPendingWrite, loadPendingWrite, storePendingWrite, type PendingWrite } from "@/lib/pending-write";

type Feedback = { id: string; content: string; status: string; source?: string; kind?: string; handled_at?: string | null };
type Version = { id: string; ordinal: number; content: string; created_at?: string; review_status?: string; feedback: Feedback[]; handles_feedback_ids: string[] };
type Deliverable = { id: string; title: string; type: string; accepted_version_id: string | null; review_status?: string; created_at?: string; versions: Version[] };
type Decision = { id: string; rationale: string; adjustment: string; next_step: string; execution_status: string };
type Trial = { id: string; title: string; goal: string; status: string; revision: number; project_id?: string | null; project?: { id: string; name: string; category: string } | null; code_repository?: string | null; code_branch?: string | null; code_commit?: string | null; next_step?: string | null; method: null | { title: string; revision_label: string; purpose: string; steps: string[] }; capture: null | { title: string; kind: string; source?: string }; captures?: Array<{ id: string; title: string; kind: string }>; deliverables: Deliverable[]; decisions: Decision[] };
type KnowledgeNote = { status: "ready" | "failed" | "missing"; model: string | null; generatedAt: string | null; error: string | null; summary: string | null };
type KnowledgeItem = { id: string; kind: string; title: string; summary: string; status: string; tags: string[]; updatedAt: string | null; link: string | null; relPath: string; sourceUrls: string[]; note: KnowledgeNote };
type KnowledgeNoteContent = { summary: string; facts: string[]; decisions: Array<{ title: string; detail: string }>; steps: string[]; conditions: string[]; open_questions: string[]; inferences: string[] };
type KnowledgeDetail = KnowledgeItem & { body: string; sources: Array<{ label: string; url: string | null }>; related: Array<{ id: string; title: string; kind: string; status: string }>; noteContent: KnowledgeNoteContent | null; promptVersion: string };
type KnowledgeSync = { status: "ok" | "failed" | "never"; commit: string | null; branch: string | null; message: string | null; entryCount: number; addedCount: number; updatedCount: number; removedCount: number; startedAt: string | null; finishedAt: string | null };
type KnowledgeOverviewResponse = { sync: KnowledgeSync; model: { configured: boolean; model: string | null; baseUrl: string | null }; promptVersion: string; repository: string; directory: string; pendingNotes: number; entries: KnowledgeItem[] };
type WriteRequest = PendingWrite;
type View = "overview" | "projects" | "toolbox" | "space" | "entry" | "active" | "inbox" | "deliverables";

const statusLabel = (status: string) => ({ in_progress: "进行中", review: "审阅中", done: "已完成", paused: "已暂停" }[status] || status);
const kindLabel = (kind?: string) => kind === "failure" ? "从失败开始" : kind === "discovery" ? "从资料开始" : "从需求开始";
const feedbackKindLabel = (kind?: string) => kind === "review" ? "待审阅" : "待修改";
const sourceLabel = (source?: string) => source === "user" ? "用户反馈" : source === "codex" ? "Codex 记录" : source === "system" ? "系统记录" : "反馈";
const reviewStatusLabel = (status?: string) => status === "accepted" ? "已采用" : status === "needs_revision" ? "需要修改" : "待审阅";
const shortTime = (value?: string | null) => value ? new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";

export default function Home() {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [knowledgeSync, setKnowledgeSync] = useState<KnowledgeSync | null>(null);
  const [knowledgeModel, setKnowledgeModel] = useState<KnowledgeOverviewResponse["model"] | null>(null);
  const [pendingNotes, setPendingNotes] = useState(0);
  const [entry, setEntry] = useState<KnowledgeDetail | null>(null);
  const [entryLoading, setEntryLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [lastEntrySection, setLastEntrySection] = useState<View>("projects");
  const [selected, setSelected] = useState("");
  const [view, setView] = useState<View>("overview");
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
      const [dashboardResponse, knowledgeResponse] = await Promise.all([
        fetch("/api/v1/dashboard", { cache: "no-store" }),
        fetch("/api/v1/knowledge", { cache: "no-store" }),
      ]);
      if (!dashboardResponse.ok || !knowledgeResponse.ok) throw new Error("读取工作台失败，请检查连接后重试");
      const [data, knowledgeData] = await Promise.all([dashboardResponse.json(), knowledgeResponse.json()]) as [{ trials: Trial[]; latest_event_sequence?: number }, KnowledgeOverviewResponse];
      setTrials(data.trials);
      setKnowledge(knowledgeData.entries || []);
      setKnowledgeSync(knowledgeData.sync);
      setKnowledgeModel(knowledgeData.model);
      setPendingNotes(knowledgeData.pendingNotes || 0);
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
  const knowledgeTooltip = [knowledgeSync?.commit ? `知识仓库 ${knowledgeSync.commit.slice(0, 8)}` : "知识仓库未同步", knowledgeSync?.finishedAt ? new Date(knowledgeSync.finishedAt).toLocaleString("zh-CN") : "", knowledgeModel?.configured ? `模型 ${knowledgeModel.model}` : "模型未配置", pendingNotes > 0 ? `${pendingNotes} 条待加工` : "阅读说明已就绪"].filter(Boolean).join(" · ");
  const recentKnowledge = useMemo(() => [...knowledge].sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || "")).slice(0, 5), [knowledge]);
  const activeTrials = useMemo(() => trials.filter((item) => item.status === "in_progress" || item.status === "review"), [trials]);
  const openFeedbackCount = useMemo(() => trials.flatMap((item) => item.deliverables).flatMap((item) => item.versions).flatMap((item) => item.feedback).filter((item) => item.status === "open").length, [trials]);
  const pendingReviewCount = useMemo(() => trials.flatMap((item) => item.deliverables).filter((deliverable) => deliverable.review_status === "pending_review" && !deliverable.versions[0]?.feedback.some((feedback) => feedback.status === "open" && feedback.kind === "review")).length, [trials]);
  const inboxCount = openFeedbackCount + pendingReviewCount;
  const deliverableCount = useMemo(() => trials.reduce((count, item) => count + item.deliverables.length, 0), [trials]);
  const filteredTrials = trials.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));

  function openTrial(id: string) { setSelected(id); setEntry(null); setView("active"); }

  function goTo(nextView: View) { setSelected(""); setEntry(null); setView(nextView); }

  async function openEntry(id: string, kind?: string) {
    const section: View = kind === "tool" ? "toolbox" : kind === "note" ? "space" : "projects";
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
      setNotice(`已同步：新增 ${summary.added || 0}，更新 ${summary.updated || 0}，移除 ${summary.removed || 0}，共 ${summary.total || 0} 条`);
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
      <div className="sidebar-head"><button className="logo" onClick={() => goTo("overview")} aria-label="返回总览">M</button><strong>MYOPC</strong><button className="icon-button collapse" onClick={() => setSidebarOpen(false)} title="收起侧边栏"><PanelLeftClose size={18} /></button></div>
      <nav className="primary-nav" aria-label="主导航">
        <button className={view === "overview" && !selected ? "nav-item active" : "nav-item"} onClick={() => goTo("overview")}><Sparkles size={17} /><span>总览</span></button>
        <div className="nav-divider" />
        <button className={view === "projects" || (view === "entry" && lastEntrySection === "projects") ? "nav-item active" : "nav-item"} onClick={() => goTo("projects")}><Folder size={17} /><span>项目</span>{knowledgeProjects.length > 0 && <b>{knowledgeProjects.length}</b>}</button>
        <button className={view === "toolbox" || (view === "entry" && lastEntrySection === "toolbox") ? "nav-item active" : "nav-item"} onClick={() => goTo("toolbox")}><Rocket size={17} /><span>工具</span>{knowledgeTools.length > 0 && <b>{knowledgeTools.length}</b>}</button>
        <button className={view === "space" || (view === "entry" && lastEntrySection === "space") ? "nav-item active" : "nav-item"} onClick={() => goTo("space")}><BookOpen size={17} /><span>空间</span>{knowledgeNotes.length > 0 && <b>{knowledgeNotes.length}</b>}</button>
      </nav>
      <div className="sidebar-section"><div className="section-label"><span>最近行动</span>{trials.length > 0 && <small>{trials.length}</small>}</div>
        {trials.length > 4 && <label className="search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" /></label>}
        <div className="trial-list">{filteredTrials.slice(0, 8).map((item) => <button key={item.id} className={selected === item.id ? "history-item active" : "history-item"} onClick={() => openTrial(item.id)}><span>{item.title}</span><small>{statusLabel(item.status)}</small></button>)}{!loading && trials.length === 0 && <p className="sidebar-empty">还没有记录</p>}</div>
      </div>
      <div className="sidebar-foot"><span><i /> 共享工作状态</span><small>Codex 驱动</small></div>
    </aside>

    <section className="main-panel">
      <header className="main-header"><button className="icon-button menu-button" onClick={() => setSidebarOpen(!sidebarOpen)} title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}>{sidebarOpen ? <Menu size={19} /> : <PanelLeftOpen size={19} />}</button><div className="breadcrumb"><span>工作台</span>{trial && <><ChevronLeft size={13} className="crumb-arrow" /><strong>{trial.title}</strong></>}{entry && !trial && <><ChevronLeft size={13} className="crumb-arrow" /><strong>{entry.title}</strong></>}</div><div className="header-sync" title={knowledgeTooltip}><span>{knowledgeSync?.finishedAt ? `知识 ${new Date(knowledgeSync.finishedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "未同步"}</span><button className="header-action" onClick={() => void syncKnowledge()} disabled={knowledgeBusy} title="同步知识仓库并更新索引">{knowledgeBusy ? "处理中…" : "同步"}</button><button className="header-action" onClick={() => void processPending()} disabled={knowledgeBusy || pendingNotes === 0 || !knowledgeModel?.configured} title={pendingNotes > 0 ? `生成 ${pendingNotes} 条阅读说明` : "没有待加工的条目"}>{pendingNotes > 0 ? `加工 ${pendingNotes}` : "加工"}</button><button className="icon-button" onClick={() => void load()} disabled={refreshing} title="刷新共享状态" aria-label="刷新共享状态"><RefreshCw size={15} className={refreshing ? "spin" : ""} /></button></div></header>
      <div className="content">
        {pendingWrite && <div className="pending-write-banner"><CircleAlert size={16} /><span><strong>{pendingWrite.label}尚未确认</strong><small>请求已保留；读取成功不代表写入响应已确认。</small></span><button className="retry-button" onClick={() => void retryWrite()} disabled={busy}>重试原请求</button></div>}
        {error && <div className="error-banner"><CircleAlert size={16} /><span>{error}</span>{!pendingWrite && <button className="retry-button" onClick={() => void load()}>重新连接</button>}<button onClick={() => setError("")} aria-label="关闭提示"><X size={16} /></button></div>}
        {loading && <div className="loading-state">正在读取共享工作状态…</div>}
        {notice && <div className="notice-banner"><CheckCircle2 size={15} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="关闭提示"><X size={15} /></button></div>}
        {!loading && view === "overview" && !trial && <OverviewView projects={knowledgeProjects} tools={knowledgeTools} notes={knowledgeNotes} recent={recentKnowledge} onOpen={openEntry} onNavigate={goTo} />}
        {view === "entry" && entryLoading && <div className="loading-state">正在读取条目…</div>}
        {view === "entry" && !entryLoading && entry && <KnowledgeDetailView entry={entry} busy={knowledgeBusy} model={knowledgeModel} onBack={() => goTo(lastEntrySection)} onGenerate={(id, force) => void generateNote(id, force)} />}
        {!loading && !trial && view === "projects" && <KnowledgeListView kind="project" items={knowledgeProjects} onOpen={openEntry} />}
        {!loading && !trial && view === "toolbox" && <KnowledgeListView kind="tool" items={knowledgeTools} onOpen={openEntry} />}
        {!loading && !trial && view === "space" && <KnowledgeListView kind="note" items={knowledgeNotes} onOpen={openEntry} />}
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

function KnowledgeListView({ kind, items, onOpen }: { kind: "project" | "tool" | "note"; items: KnowledgeItem[]; onOpen: (id: string, kind: string) => void }) {
  const meta = kind === "project"
    ? { eyebrow: "Projects", title: "项目", subtitle: "来自知识仓库的项目概况；原文、来源和模型阅读说明都在同一条目里。" }
    : kind === "tool"
      ? { eyebrow: "Toolbox", title: "工具", subtitle: "真正可调用的工具与入口，说明和维护都在知识仓库里。" }
      : { eyebrow: "Space", title: "空间", subtitle: "经过实践留下的方法、经验与判断。" };
  return <div className="asset-view">
    <div className="view-title"><span className="eyebrow">{meta.eyebrow}</span><h1>{meta.title}</h1><p>{meta.subtitle}</p></div>
    {items.length === 0
      ? <div className="quiet-empty"><BookOpen size={22} /><p>知识仓库里还没有{meta.title}条目</p></div>
      : <div className="asset-grid">{items.map((item) => <article className="asset-card knowledge-card" key={item.id}>
        <div className="asset-card-head"><span>{item.status || meta.eyebrow}</span><b>{item.note.status === "ready" ? "已有阅读说明" : item.note.status === "failed" ? "加工失败" : "待生成"}</b></div>
        <h2>{item.title}</h2>
        <p>{item.note.summary || item.summary || "暂无摘要"}</p>
        {item.tags.length > 0 && <div className="tag-row">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
        <dl>
          <div><dt>更新</dt><dd>{item.updatedAt || "未标注"}</dd></div>
          <div><dt>原文</dt><dd>{item.relPath}</dd></div>
        </dl>
        <div className="knowledge-actions">
          <button className="primary-button" onClick={() => onOpen(item.id, item.kind)}>查看原文与说明</button>
          {item.link && <a href={item.link} target="_blank" rel="noreferrer">打开入口 <ExternalLink size={12} /></a>}
        </div>
      </article>)}</div>}
  </div>;
}

function KnowledgeDetailView({ entry, busy, model, onBack, onGenerate }: { entry: KnowledgeDetail; busy: boolean; model: KnowledgeOverviewResponse["model"] | null; onBack: () => void; onGenerate: (id: string, force: boolean) => void }) {
  const note = entry.noteContent;
  return <div className="knowledge-detail">
    <div className="view-title">
      <button className="text-button back-button" onClick={onBack}><ChevronLeft size={14} /> 返回列表</button>
      <span className="eyebrow">{entry.kind === "project" ? "Project" : entry.kind === "tool" ? "Tool" : "Note"}</span>
      <h1>{entry.title}</h1>
      <p>{entry.summary}</p>
      <div className="detail-meta">
        <span>{entry.status || "未标注状态"}</span>
        <span>条目更新 {entry.updatedAt || "未标注"}</span>
        <span>{entry.note.status === "ready" ? `阅读说明：${entry.note.model || "模型"}${entry.note.generatedAt ? ` · ${new Date(entry.note.generatedAt).toLocaleString("zh-CN")}` : ""}` : entry.note.status === "failed" ? "上次加工失败" : "尚未生成阅读说明"}</span>
      </div>
      <div className="detail-actions">
        <button className="primary-button" onClick={() => onGenerate(entry.id, false)} disabled={busy || !model?.configured} title={model?.configured ? undefined : "未配置模型密钥"}>{busy ? "处理中…" : "生成阅读说明"}</button>
        <button onClick={() => onGenerate(entry.id, true)} disabled={busy || !model?.configured}>重新生成</button>
        {entry.link && <a className="button-link" href={entry.link} target="_blank" rel="noreferrer">打开入口 <ExternalLink size={12} /></a>}
      </div>
      {entry.note.error && <div className="inline-warning"><CircleAlert size={15} /><span>{entry.note.error}</span></div>}
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
    <section className="knowledge-section">
      <h2>原文</h2>
      <div className="markdown-body">{renderMarkdown(entry.body)}</div>
    </section>
    <section className="knowledge-section">
      <h2>来源</h2>
      {entry.sources.length === 0 ? <p className="muted-text">条目没有标注来源。</p> : <ul className="source-list">{entry.sources.map((source) => <li key={source.label}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.label} <ExternalLink size={11} /></a> : source.label}</li>)}</ul>}
      {entry.related.length > 0 && <><h3>相关知识</h3><ul className="source-list">{entry.related.map((item) => <li key={item.id}>{item.title}（{item.kind === "project" ? "项目" : item.kind === "tool" ? "工具" : "笔记"}）</li>)}</ul></>}
    </section>
  </div>;
}

function OverviewView({ projects, tools, notes, recent, onOpen, onNavigate }: { projects: KnowledgeItem[]; tools: KnowledgeItem[]; notes: KnowledgeItem[]; recent: KnowledgeItem[]; onOpen: (id: string, kind: string) => void; onNavigate: (view: View) => void }) {
  return <div className="overview-view">
    <section className="overview-hero"><div className="overview-intro"><span className="eyebrow">个人资产空间</span><h1>我在做什么、能用什么、留下了什么</h1><p>项目、工具和空间都来自独立知识仓库；OPC 同步内容、按规程生成阅读说明并展示。</p></div><div className="codex-note"><span><Sparkles size={18} /></span><div><strong>知识驱动</strong><small>内容来自知识仓库，OPC 负责同步与加工</small></div></div></section>
    <div className="overview-stats">
      <button onClick={() => onNavigate("projects")}><span>项目</span><strong>{projects.length}</strong><small>查看 Projects <ChevronRight size={13} /></small></button>
      <button onClick={() => onNavigate("toolbox")}><span>可调用工具</span><strong>{tools.length}</strong><small>查看 Toolbox <ChevronRight size={13} /></small></button>
      <button onClick={() => onNavigate("space")}><span>知识与方法</span><strong>{notes.length}</strong><small>查看 Space <ChevronRight size={13} /></small></button>
    </div>
    <section className="overview-section">
      <div className="overview-section-head"><div><span className="eyebrow">最近更新</span><h2>知识仓库里最近变化的条目</h2></div><button className="text-button" onClick={() => onNavigate("projects")}>打开 Projects <ChevronRight size={14} /></button></div>
      {recent.length === 0 ? <div className="overview-empty"><span className="overview-empty-icon"><BookOpen size={22} /></span><h2>还没有同步内容</h2><p>先同步知识仓库，或在收集对话里整理出第一条条目。</p></div> : <div className="overview-trials">{recent.map((item) => <button className="overview-trial" key={item.id} onClick={() => onOpen(item.id, item.kind)}><span className="overview-trial-icon">{item.kind === "project" ? <Folder size={16} /> : item.kind === "tool" ? <Rocket size={16} /> : <BookOpen size={16} />}</span><span className="overview-trial-copy"><strong>{item.title}</strong><small>{item.note.summary || item.summary || "暂无摘要"}</small></span><span className="overview-trial-status">{item.note.status === "ready" ? "已有说明" : item.note.status === "failed" ? "加工失败" : "待生成"}</span><ChevronRight size={15} /></button>)}</div>}
    </section>
    <p className="overview-footnote">加工只处理来源或规程变化的条目；打开页面不会自动调用模型。历史行动、成果与反馈仍保留在数据库里，不再进入主要流程。</p>
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
