"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, ExternalLink, FileText, Folder, GitBranch, Inbox, Link2, Menu, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Rocket, Search, Sparkles, Upload, X } from "lucide-react";
import { PROJECT_CATEGORIES } from "@/lib/project-categories";
import { assertPendingWriteCanSend, clearPendingWrite, loadPendingWrite, storePendingWrite, type PendingWrite } from "@/lib/pending-write";

type Feedback = { id: string; content: string; status: string; source?: string; kind?: string; handled_at?: string | null };
type Version = { id: string; ordinal: number; content: string; created_at?: string; review_status?: string; feedback: Feedback[]; handles_feedback_ids: string[] };
type Deliverable = { id: string; title: string; type: string; accepted_version_id: string | null; review_status?: string; created_at?: string; versions: Version[] };
type Decision = { id: string; rationale: string; adjustment: string; next_step: string; execution_status: string };
type Trial = { id: string; title: string; goal: string; status: string; revision: number; project_id?: string | null; project?: { id: string; name: string; category: string } | null; code_repository?: string | null; code_branch?: string | null; code_commit?: string | null; next_step?: string | null; method: null | { title: string; revision_label: string; purpose: string; steps: string[] }; capture: null | { title: string; kind: string; source?: string }; captures?: Array<{ id: string; title: string; kind: string }>; deliverables: Deliverable[]; decisions: Decision[] };
type ProjectProfile = { summary: string; highlights: string[]; usage: string[]; stage: string; stack: string };
type ProjectLocation = { id: string; label: string; environment: string; repository_url?: string | null; branch?: string | null; commit_sha?: string | null; deploy_url?: string | null; notes?: string | null };
type ProjectFeedback = Feedback & { trial_id: string; trial_title: string; version_id: string; version_ordinal: number };
type ProjectPendingReview = { id: string; trial_id: string; trial_title: string; deliverable_id: string; deliverable_title: string; version_ordinal: number; content: string };
type Project = { id: string; name: string; category: string; status: string; description: string | null; created_at: string; updated_at: string; profile: ProjectProfile | null; locations: ProjectLocation[]; trial_count: number; open_feedback_count: number; pending_review_count: number; pending_reviews: ProjectPendingReview[]; open_feedback: ProjectFeedback[]; latest_trial: { id: string; title: string; goal: string; status: string; updated_at: string; code_commit?: string | null } | null; latest_deliverable: { id: string; trial_id: string; trial_title?: string; title: string; type: string; version: number | null; review_status?: string; content?: string | null; updated_at: string } | null; next_step: string | null };
type Capture = { id: string; kind: string; title: string; content?: string | null; source?: string | null; read_status: string; file_name?: string | null; mime_type?: string | null; file_size?: number | null; has_file?: boolean; used_count?: number; method_count?: number; created_at: string };
type Method = { id: string; title: string; purpose: string; revision_label: string; steps: string[]; conditions?: string | null; family_id?: string | null; previous_method_id?: string | null; revision_number: number; created_at: string; usage_count?: number; captures?: Capture[] };
type Tool = { id: string; name: string; type: string; status: string; purpose: string; usage?: string | null; location?: string | null; source_url?: string | null; verification: string; notes?: string | null; projects: Array<{ id: string; name: string }> };
type SpaceEntry = { id: string; title: string; type: string; content: string; source_url?: string | null; verification?: string | null; projects: Array<{ id: string; name: string }>; tools: Array<{ id: string; name: string }> };
type WriteRequest = PendingWrite;
type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];
type View = "overview" | "projects" | "toolbox" | "space" | "active" | "inbox" | "deliverables" | "library";

const statusLabel = (status: string) => ({ in_progress: "进行中", review: "审阅中", done: "已完成", paused: "已暂停" }[status] || status);
const kindLabel = (kind?: string) => kind === "failure" ? "从失败开始" : kind === "discovery" ? "从资料开始" : "从需求开始";
const feedbackKindLabel = (kind?: string) => kind === "review" ? "待审阅" : "待修改";
const sourceLabel = (source?: string) => source === "user" ? "用户反馈" : source === "codex" ? "Codex 记录" : source === "system" ? "系统记录" : "反馈";
const reviewStatusLabel = (status?: string) => status === "accepted" ? "已采用" : status === "needs_revision" ? "需要修改" : "待审阅";
const shortTime = (value?: string | null) => value ? new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";

export default function Home() {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [methods, setMethods] = useState<Method[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [spaceEntries, setSpaceEntries] = useState<SpaceEntry[]>([]);
  const [projectCategories, setProjectCategories] = useState<ProjectCategory[]>([]);
  const [selected, setSelected] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
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
      const [dashboardResponse, projectsResponse, libraryResponse, assetsResponse] = await Promise.all([
        fetch("/api/v1/dashboard", { cache: "no-store" }),
        fetch("/api/v1/projects", { cache: "no-store" }),
        fetch("/api/v1/library", { cache: "no-store" }),
        fetch("/api/v1/assets", { cache: "no-store" }),
      ]);
      if (!dashboardResponse.ok || !projectsResponse.ok || !libraryResponse.ok || !assetsResponse.ok) throw new Error("读取工作台失败，请检查连接后重试");
      const [data, projectData, libraryData, assetsData] = await Promise.all([dashboardResponse.json(), projectsResponse.json(), libraryResponse.json(), assetsResponse.json()]);
      setTrials(data.trials);
      setProjects(projectData.projects);
      setProjectCategories(projectData.categories);
      setCaptures(libraryData.captures || []);
      setMethods(libraryData.methods || []);
      setTools(assetsData.tools || []);
      setSpaceEntries(assetsData.space_entries || []);
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
  const project = projects.find((item) => item.id === selectedProject);
  const activeTrials = useMemo(() => trials.filter((item) => item.status === "in_progress" || item.status === "review"), [trials]);
  const openFeedbackCount = useMemo(() => trials.flatMap((item) => item.deliverables).flatMap((item) => item.versions).flatMap((item) => item.feedback).filter((item) => item.status === "open").length, [trials]);
  const pendingReviewCount = useMemo(() => trials.flatMap((item) => item.deliverables).filter((deliverable) => deliverable.review_status === "pending_review" && !deliverable.versions[0]?.feedback.some((feedback) => feedback.status === "open" && feedback.kind === "review")).length, [trials]);
  const inboxCount = openFeedbackCount + pendingReviewCount;
  const deliverableCount = useMemo(() => trials.reduce((count, item) => count + item.deliverables.length, 0), [trials]);
  const filteredTrials = trials.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));

  function openTrial(id: string) { setSelected(id); setSelectedProject(""); setView("active"); }
  function openProject(id: string) { setSelected(""); setSelectedProject(id); setView("projects"); }

  function openLibrary(section: "toolbox" | "space") { setSelected(""); setSelectedProject(""); setView(section); }

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
      <div className="sidebar-head"><button className="logo" onClick={() => { setView("overview"); setSelected(""); setSelectedProject(""); }} aria-label="返回总览">M</button><strong>MYOPC</strong><button className="icon-button collapse" onClick={() => setSidebarOpen(false)} title="收起侧边栏"><PanelLeftClose size={18} /></button></div>
      <nav className="primary-nav" aria-label="主导航">
        <button className={view === "overview" && !selected ? "nav-item active" : "nav-item"} onClick={() => { setView("overview"); setSelected(""); setSelectedProject(""); }}><Sparkles size={17} /><span>总览</span></button>
        <div className="nav-divider" />
        <button className={view === "projects" && !selected ? "nav-item active" : "nav-item"} onClick={() => { setView("projects"); setSelected(""); setSelectedProject(""); }}><Folder size={17} /><span>项目</span>{Boolean(projects.length) && <b>{projects.length}</b>}</button>
        <button className={view === "toolbox" ? "nav-item active" : "nav-item"} onClick={() => openLibrary("toolbox")}><Rocket size={17} /><span>工具</span>{tools.length > 0 && <b>{tools.length}</b>}</button>
        <button className={view === "space" ? "nav-item active" : "nav-item"} onClick={() => openLibrary("space")}><BookOpen size={17} /><span>空间</span>{spaceEntries.length > 0 && <b>{spaceEntries.length}</b>}</button>
      </nav>
      <div className="sidebar-section"><div className="section-label"><span>最近行动</span>{trials.length > 0 && <small>{trials.length}</small>}</div>
        {trials.length > 4 && <label className="search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" /></label>}
        <div className="trial-list">{filteredTrials.slice(0, 8).map((item) => <button key={item.id} className={selected === item.id ? "history-item active" : "history-item"} onClick={() => openTrial(item.id)}><span>{item.title}</span><small>{statusLabel(item.status)}</small></button>)}{!loading && trials.length === 0 && <p className="sidebar-empty">还没有记录</p>}</div>
      </div>
      <div className="sidebar-foot"><span><i /> 共享工作状态</span><small>Codex 驱动</small></div>
    </aside>

    <section className="main-panel">
      <header className="main-header"><button className="icon-button menu-button" onClick={() => setSidebarOpen(!sidebarOpen)} title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}>{sidebarOpen ? <Menu size={19} /> : <PanelLeftOpen size={19} />}</button><div className="breadcrumb"><span>工作台</span>{trial && <><ChevronLeft size={13} className="crumb-arrow" /><strong>{trial.title}</strong></>}{project && !trial && <><ChevronLeft size={13} className="crumb-arrow" /><strong>{project.name}</strong></>}</div><div className="header-sync"><span title={latestEventSequence ? `服务器事件 ${latestEventSequence}` : undefined}>{lastSyncedAt ? `已同步 ${shortTime(lastSyncedAt.toISOString())}` : "等待同步"}</span><button className="icon-button" onClick={() => void load()} disabled={refreshing} title="刷新共享状态" aria-label="刷新共享状态"><RefreshCw size={15} className={refreshing ? "spin" : ""} /></button></div></header>
      <div className="content">
        {pendingWrite && <div className="pending-write-banner"><CircleAlert size={16} /><span><strong>{pendingWrite.label}尚未确认</strong><small>请求已保留；读取成功不代表写入响应已确认。</small></span><button className="retry-button" onClick={() => void retryWrite()} disabled={busy}>重试原请求</button></div>}
        {error && <div className="error-banner"><CircleAlert size={16} /><span>{error}</span>{!pendingWrite && <button className="retry-button" onClick={() => void load()}>重新连接</button>}<button onClick={() => setError("")} aria-label="关闭提示"><X size={16} /></button></div>}
        {loading && <div className="loading-state">正在读取共享工作状态…</div>}
        {!loading && !trial && view === "overview" && <OverviewView trials={trials} projects={projects} tools={tools} spaceEntries={spaceEntries} onOpen={openTrial} onNavigate={(nextView) => { setView(nextView); setSelected(""); setSelectedProject(""); }} />}
        {!loading && !trial && view === "projects" && project && <ProjectDetailView project={project} category={projectCategories.find((item) => item.id === project.category)} onBack={() => setSelectedProject("")} onOpenTrial={openTrial} />}
        {!loading && !trial && view === "projects" && !project && <ProjectsView projects={projects} categories={projectCategories} onOpen={openProject} />}
        {!loading && !trial && view === "active" && <ListView title="进行中的行动" subtitle="从这里继续目标、产物和反馈；审阅中的行动也保留在这里。" trials={activeTrials} onOpen={openTrial} empty="还没有进行中的行动" />}
        {!loading && !trial && view === "inbox" && <InboxView trials={trials} onOpen={openTrial} />}
        {!loading && !trial && view === "deliverables" && <DeliverablesView trials={trials} onOpen={openTrial} />}
        {!loading && !trial && (view === "toolbox" || view === "space" || view === "library") && <AssetsView section={view === "space" ? "space" : "toolbox"} tools={tools} spaceEntries={spaceEntries} />}
        {trial && <TrialWorkspace trial={trial} busy={busy} onFeedback={addFeedback} onAccept={accept} onDraft={createDraft} />}
      </div>
    </section>
  </main>;
}

function ProjectsView({ projects, categories, onOpen }: { projects: Project[]; categories: ProjectCategory[]; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState("all");
  const visibleProjects = filter === "all" ? projects : projects.filter((project) => project.category === filter);
  const categoryLabel = (category: string) => categories.find((item) => item.id === category)?.label || category;

  return <div className="projects-view">
    <div className="view-title"><span className="eyebrow">项目</span><h1>把正在建设的东西放在一起</h1><p>项目是可持续推进的方向；具体输入和执行仍由 Codex 完成。</p></div>
    <div className="project-categories" aria-label="项目类别">
      <button className={filter === "all" ? "project-category-filter active" : "project-category-filter"} onClick={() => setFilter("all")}><span>全部</span><b>{projects.length}</b></button>
      {categories.map((category) => <button className={filter === category.id ? "project-category-filter active" : "project-category-filter"} key={category.id} onClick={() => setFilter(category.id)}><span>{category.label}</span><small>{category.description}</small><b>{projects.filter((project) => project.category === category.id).length}</b></button>)}
    </div>
    {visibleProjects.length === 0 ? <div className="quiet-empty project-empty"><Folder size={22} /><p>{filter === "all" ? "还没有登记项目" : `“${categoryLabel(filter)}”类别下还没有项目`}</p></div> : <div className="project-grid">{visibleProjects.map((project) => <button type="button" className="project-card" key={project.id} onClick={() => onOpen(project.id)}><div className="project-card-head"><span className="project-category-label">{categoryLabel(project.category)}</span><span className="project-status">{project.status === "active" ? "已登记" : project.status}</span><ChevronRight size={15} /></div><h2>{project.name}</h2><p>{project.profile?.summary || project.description || "尚未补充项目说明。"}</p><div className="project-card-summary"><span>{project.trial_count} 个行动</span><span>{project.latest_deliverable ? `最新 v${project.latest_deliverable.version || 1}` : "还没有成果"}</span>{project.open_feedback_count > 0 && <b>{project.open_feedback_count} 条反馈</b>}{project.pending_review_count > 0 && <b>{project.pending_review_count} 条待审阅</b>}</div><span className="project-card-hint">查看接续状态</span></button>)}</div>}
  </div>;
}

function ProjectDetailView({ project, category, onBack, onOpenTrial }: { project: Project; category?: ProjectCategory; onBack: () => void; onOpenTrial: (id: string) => void }) {
  const categoryLabel = category?.label || project.category;
  const projectStatusLabel = project.status === "active" ? "已登记" : project.status;
  const profile = project.profile;
  const summary = profile?.summary || project.description || "尚未补充项目介绍。";
  const highlights = profile?.highlights || ["尚未补充主要能力。"];
  const usage = profile?.usage || ["尚未补充使用方式。"];

  return <div className="project-detail-view">
    <button type="button" className="back-button" onClick={onBack}><ChevronLeft size={15} />返回项目</button>
    <section className="project-detail-hero"><div><span className="eyebrow">{categoryLabel}</span><h1>{project.name}</h1><p>{summary}</p></div><span className="project-detail-status">{projectStatusLabel}</span></section>
    <div className="project-detail-meta"><div><span>项目类别</span><strong>{categoryLabel}</strong></div><div><span>当前行动</span><strong>{project.latest_trial?.title || "还没有行动"}</strong></div><div><span>最新成果</span><strong>{project.latest_deliverable ? `v${project.latest_deliverable.version || 1} · ${project.latest_deliverable.title}` : "还没有成果"}</strong></div></div>

    <div className="continuity-grid">
      <section className="project-detail-panel continuity-target"><div className="project-detail-panel-head"><div><span className="eyebrow">现在在做</span><h2>{project.latest_trial?.title || "还没有行动"}</h2></div><Rocket size={18} /></div>{project.latest_trial ? <><p>{project.latest_trial.goal}</p><div className="continuity-meta"><span>{statusLabel(project.latest_trial.status)}</span>{project.latest_trial.code_commit && <span><GitBranch size={12} />{project.latest_trial.code_commit.slice(0, 8)}</span>}</div><button className="inline-action" onClick={() => onOpenTrial(project.latest_trial!.id)}>打开行动 <ChevronRight size={14} /></button></> : <p>从 Codex 留下一项行动后，这里会成为下一次接续的入口。</p>}</section>
      <section className="project-detail-panel"><div className="project-detail-panel-head"><div><span className="eyebrow">最新成果</span><h2>{project.latest_deliverable?.title || "还没有成果"}</h2></div><FileText size={18} /></div>{project.latest_deliverable ? <><div className="latest-version">v{project.latest_deliverable.version || 1} · {reviewStatusLabel(project.latest_deliverable.review_status)}</div><p className="latest-content">{project.latest_deliverable.content || "版本内容为空。"}</p><button className="inline-action" onClick={() => onOpenTrial(project.latest_deliverable!.trial_id)}>查看版本与反馈 <ChevronRight size={14} /></button></> : <p>成果版本会在 Codex 写入后显示在这里。</p>}</section>
      <section className="project-detail-panel"><div className="project-detail-panel-head"><div><span className="eyebrow">需要处理</span><h2>{project.open_feedback_count + project.pending_review_count ? `${project.open_feedback_count + project.pending_review_count} 项需要判断` : "没有待处理事项"}</h2></div><Inbox size={18} /></div>{project.pending_reviews.length > 0 || project.open_feedback.length > 0 ? <div className="project-feedback-list">{project.pending_reviews.map((item) => <button key={item.id} onClick={() => onOpenTrial(item.trial_id)}><span>待审阅</span><strong>{item.deliverable_title} v{item.version_ordinal}</strong><small>{item.trial_title}</small></button>)}{project.open_feedback.map((item) => <button key={item.id} onClick={() => onOpenTrial(item.trial_id)}><span>{feedbackKindLabel(item.kind)}</span><strong>{item.content}</strong><small>{item.trial_title} · v{item.version_ordinal} · {sourceLabel(item.source)}</small></button>)}</div> : <p>当前没有等待审阅或修改的事项。</p>}</section>
      <section className="project-detail-panel"><div className="project-detail-panel-head"><div><span className="eyebrow">下一步</span><h2>{project.next_step || "尚未留下下一步"}</h2></div><CheckCircle2 size={18} /></div><p>{project.next_step ? "这是当前共享状态中留下的下一步，是否执行由你决定。" : "在行动记录中留下判断后，下一步会出现在这里。"}</p></section>
    </div>

    <div className="project-detail-grid"><section className="project-detail-panel"><div className="project-detail-panel-head"><div><span className="eyebrow">工具介绍</span><h2>主要能力</h2></div><Folder size={18} /></div><ul className="project-detail-list">{highlights.map((item) => <li key={item}>{item}</li>)}</ul></section><section className="project-detail-panel"><div className="project-detail-panel-head"><div><span className="eyebrow">使用方式</span><h2>怎么用</h2></div><CheckCircle2 size={18} /></div><ul className="project-detail-list">{usage.map((item) => <li key={item}>{item}</li>)}</ul></section></div>
    <section className="project-detail-stage"><span className="eyebrow">当前阶段</span><h2>{profile?.stage || "尚未补充当前阶段。"}</h2>{profile?.stack && <p>{profile.stack}</p>}</section>
    <section className="project-locations"><div className="project-detail-panel-head"><div><span className="eyebrow">工作入口</span><h2>在哪些环境继续</h2></div><GitBranch size={18} /></div>{project.locations.length === 0 ? <p>还没有登记其他工作环境；项目身份不依赖某一台电脑的目录。</p> : <div className="location-list">{project.locations.map((location) => <div className="location-item" key={location.id}><div><strong>{location.label}</strong><span>{location.environment}{location.branch ? ` · ${location.branch}` : ""}</span></div><div className="location-links">{location.repository_url && <a href={location.repository_url} target="_blank" rel="noreferrer">代码 <ExternalLink size={12} /></a>}{location.deploy_url && <a href={location.deploy_url} target="_blank" rel="noreferrer">服务 <ExternalLink size={12} /></a>}{location.commit_sha && <code>{location.commit_sha.slice(0, 8)}</code>}</div></div>)}</div>}</section>
  </div>;
}

function OverviewView({ trials, projects, tools, spaceEntries, onOpen, onNavigate }: { trials: Trial[]; projects: Project[]; tools: Tool[]; spaceEntries: SpaceEntry[]; onOpen: (id: string) => void; onNavigate: (view: View) => void }) {
  const activeProjects = projects.filter((item) => item.status === "active" || item.status === "in_progress").slice(0, 3);
  const recentTrials = trials.slice(0, 3);
  const toolCount = tools.length;
  const methods = spaceEntries.map((entry) => ({ id: entry.id, title: entry.title, purpose: entry.content, revision_label: entry.type }));
  return <div className="overview-view"><section className="overview-hero"><div className="overview-intro"><span className="eyebrow">个人资产空间</span><h1>我在做什么、能用什么、留下了什么</h1><p>Projects 记录当前项目，Toolbox 保存真正可调用的工具，Space 沉淀经过实践的知识。</p></div><div className="codex-note"><span><Sparkles size={18} /></span><div><strong>轻量连接</strong><small>项目、工具与知识各自归位</small></div></div></section><div className="overview-stats"><button onClick={() => onNavigate("projects")}><span>正在进行的项目</span><strong>{activeProjects.length}</strong><small>查看 Projects <ChevronRight size={13} /></small></button><button onClick={() => onNavigate("toolbox")}><span>可调用工具</span><strong>{toolCount}</strong><small>查看 Toolbox <ChevronRight size={13} /></small></button><button onClick={() => onNavigate("space")}><span>知识与方法</span><strong>{methods.length}</strong><small>查看 Space <ChevronRight size={13} /></small></button></div><section className="overview-section"><div className="overview-section-head"><div><span className="eyebrow">Projects</span><h2>最近在做什么</h2></div><button className="text-button" onClick={() => onNavigate("projects")}>查看全部 <ChevronRight size={14} /></button></div>{activeProjects.length === 0 ? <div className="overview-empty"><span className="overview-empty-icon"><Folder size={22} /></span><h2>还没有进行中的项目</h2><p>先在 Projects 中登记一个项目，再从项目详情跟踪当前状态。</p></div> : <div className="overview-trials">{activeProjects.map((item) => <button className="overview-trial" key={item.id} onClick={() => onNavigate("projects")}><span className="overview-trial-icon"><Folder size={16} /></span><span className="overview-trial-copy"><strong>{item.name}</strong><small>{item.description || "尚未补充项目定位"}</small></span><span className="overview-trial-status">{statusLabel(item.status)}</span><ChevronRight size={15} /></button>)}</div>}</section><section className="overview-section"><div className="overview-section-head"><div><span className="eyebrow">最近沉淀</span><h2>从行动中留下的东西</h2></div><button className="text-button" onClick={() => onNavigate("space")}>打开 Space <ChevronRight size={14} /></button></div>{methods.length === 0 ? <div className="quiet-empty"><BookOpen size={22} /><p>还没有 Space 内容</p></div> : <div className="overview-trials">{methods.slice(0, 3).map((item) => <button className="overview-trial" key={item.id} onClick={() => onNavigate("space")}><span className="overview-trial-icon"><BookOpen size={16} /></span><span className="overview-trial-copy"><strong>{item.title}</strong><small>{item.purpose}</small></span><span className="overview-trial-status">{item.revision_label}</span><ChevronRight size={15} /></button>)}</div>}</section>{recentTrials.length > 0 && <p className="overview-footnote">最近行动仍保留在项目详情和历史记录中，共 {recentTrials.length} 条最近记录。</p>}</div>;
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

function AssetsView({ section, tools, spaceEntries }: { section: "toolbox" | "space"; tools: Tool[]; spaceEntries: SpaceEntry[] }) {
  return <div className="asset-view"><div className="view-title"><span className="eyebrow">{section === "toolbox" ? "Toolbox" : "Space"}</span><h1>{section === "toolbox" ? "真正可以调用的工具" : "经过实践留下的知识"}</h1><p>{section === "toolbox" ? "这里只保存已经拥有、配置、尝试或验证过的能力。状态与证据分开显示。" : "这里保存自己的方法、经验与判断；外部文章和收藏仍留在 Karakeep。"}</p></div>{section === "toolbox" ? <div className="asset-grid">{tools.map((tool) => <article className="asset-card" key={tool.id}><div className="asset-card-head"><span>{tool.type}</span><b>{tool.status}</b></div><h2>{tool.name}</h2><p>{tool.purpose}</p><dl><div><dt>位置</dt><dd>{tool.location || "未登记"}</dd></div><div><dt>验证</dt><dd>{tool.verification}</dd></div>{tool.projects.length > 0 && <div><dt>相关项目</dt><dd>{tool.projects.map((item) => item.name).join("、")}</dd></div>}</dl>{tool.source_url && <a href={tool.source_url} target="_blank" rel="noreferrer">打开入口 <ExternalLink size={12} /></a>}</article>)}</div> : <div className="asset-grid">{spaceEntries.map((entry) => <article className="asset-card space-card" key={entry.id}><div className="asset-card-head"><span>{entry.type}</span><b>{entry.verification || "待继续验证"}</b></div><h2>{entry.title}</h2><p>{entry.content}</p>{(entry.projects.length > 0 || entry.tools.length > 0) && <dl>{entry.projects.length > 0 && <div><dt>相关项目</dt><dd>{entry.projects.map((item) => item.name).join("、")}</dd></div>}{entry.tools.length > 0 && <div><dt>相关工具</dt><dd>{entry.tools.map((item) => item.name).join("、")}</dd></div>}</dl>}</article>)}</div>}</div>;
}

function LibraryView({ section, captures, methods, projects, busy, onWrite, onReload }: { section: "toolbox" | "space"; captures: Capture[]; methods: Method[]; projects: Project[]; busy: boolean; onWrite: (request: WriteRequest) => Promise<unknown>; onReload: () => void }) {
  const [tab, setTab] = useState<"captures" | "methods">(section === "space" ? "methods" : "captures");
  const [query, setQuery] = useState("");
  const [selectedCaptures, setSelectedCaptures] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const toolKinds = ["tool", "software", "open_source", "model", "api", "cli", "skill", "workflow", "service"];
  const toolCaptures = captures.filter((item) => toolKinds.includes(item.kind));
  const visibleCaptures = (section === "toolbox" ? toolCaptures : captures).filter((item) => `${item.title} ${item.content || ""} ${item.source || ""}`.toLowerCase().includes(query.toLowerCase()));
  const visibleMethods = methods.filter((item) => `${item.title} ${item.purpose}`.toLowerCase().includes(query.toLowerCase()));
  const toggleCapture = (id: string) => setSelectedCaptures((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  async function saveCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const requestBody: Record<string, unknown> = { title: data.get("title"), content: data.get("content"), source: data.get("source"), kind: data.get("kind") };
    if (file instanceof File && file.size > 0) {
      if (file.size > 2 * 1024 * 1024) { setMessage("文件不能超过 2 MB"); return; }
      requestBody.file_name = file.name;
      requestBody.mime_type = file.type || "application/octet-stream";
      requestBody.file_data_base64 = await toBase64(file);
    }
    try {
      await onWrite({ path: "/api/v1/captures", body: requestBody, requestId: crypto.randomUUID(), label: "素材保存" });
      form.reset(); setMessage("素材已保存"); onReload();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "素材保存失败"); }
  }

  async function markRead(capture: Capture) {
    try {
      await onWrite({ path: `/api/v1/captures/${capture.id}`, body: { title: capture.title, read_status: "read" }, requestId: crypto.randomUUID(), label: "标记素材" });
      onReload();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "标记失败"); }
  }

  async function createAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const selectedMethod = data.get("method_id")?.toString() || "";
    if (!selectedMethod || selectedCaptures.length === 0) { setMessage("请选择一个方法版本和至少一份素材"); return; }
    try {
      await onWrite({ path: "/api/v1/trials", body: { title: data.get("title"), goal: data.get("goal"), method_id: selectedMethod, capture_ids: selectedCaptures, project_id: data.get("project_id") || undefined }, requestId: crypto.randomUUID(), label: "内容行动创建" });
      setMessage("内容行动已创建"); setSelectedCaptures([]); onReload();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "行动创建失败"); }
  }

  return <div className="library-view"><div className="view-title"><span className="eyebrow">{section === "toolbox" ? "Toolbox" : "Space"}</span><h1>{section === "toolbox" ? "真正可以调用的工具" : "经过实践留下的知识"}</h1><p>{section === "toolbox" ? "只记录已经配置、尝试或验证过的软件、模型、API、Skill 和 Workflow；发现但未拥有的内容留在外部收藏工具。" : "这里保存方法、经验、决策和学习，不复制外部资料，也不把收藏直接当成能力。"}</p></div>
    <div className="library-toolbar"><div className="library-tabs"><button className={tab === "captures" ? "active" : ""} onClick={() => setTab("captures")}>{section === "toolbox" ? "工具记录" : "来源记录"} <b>{section === "toolbox" ? toolCaptures.length : captures.length}</b></button><button className={tab === "methods" ? "active" : ""} onClick={() => setTab("methods")}>{section === "toolbox" ? "使用方法" : "方法与经验"} <b>{methods.length}</b></button></div><label className="library-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文或来源" /></label></div>
    {message && <div className="library-message">{message}</div>}
    {tab === "captures" ? <><form className="capture-form" onSubmit={saveCapture}><div className="capture-form-title"><Plus size={16} />收下一份新素材</div><div className="capture-form-grid"><input name="title" placeholder="标题（可选）" /><input name="source" type="url" placeholder="来源链接（可选）" /><select name="kind" defaultValue="text" aria-label="素材类型"><option value="text">文本/想法</option><option value="link">链接</option><option value="image">图片</option><option value="video">视频</option><option value="tool">工具或 Skill</option></select><input name="file" type="file" aria-label="选择文件（最大 2 MB）" /><textarea name="content" rows={3} placeholder="粘贴文字或记下想法（可选）" /><button disabled={busy}><Upload size={14} />保存素材</button></div></form><div className="capture-list">{visibleCaptures.length === 0 ? <div className="quiet-empty"><Link2 size={22} /><p>还没有匹配的素材</p></div> : visibleCaptures.map((capture) => <article className={selectedCaptures.includes(capture.id) ? "capture-card selected" : "capture-card"} key={capture.id}><label className="capture-select"><input type="checkbox" checked={selectedCaptures.includes(capture.id)} onChange={() => toggleCapture(capture.id)} /><span>用于下一次行动</span></label><div className="capture-card-head"><div><span className="capture-kind">{capture.kind}</span><h2>{capture.title}</h2></div><span className={`read-status ${capture.read_status}`}>{capture.read_status === "read" ? "已读取" : capture.read_status === "failed" ? "读取失败" : "未整理"}</span></div>{capture.content && <p>{capture.content}</p>}{capture.source && <a href={capture.source} target="_blank" rel="noreferrer"><ExternalLink size={12} />打开来源</a>}{capture.has_file && <a href={`/api/v1/captures/${capture.id}/file`} target="_blank" rel="noreferrer"><FileText size={12} />预览文件{capture.file_name ? ` · ${capture.file_name}` : ""}</a>}<div className="capture-card-foot"><span>已用于 {capture.used_count || 0} 次行动 · 关联 {capture.method_count || 0} 个方法</span>{capture.read_status !== "read" && <button onClick={() => void markRead(capture)}>标为已读取</button>}</div></article>)}</div></> : <><MethodForm captures={captures} methods={methods} busy={busy} onWrite={onWrite} onReload={onReload} onMessage={setMessage} /><div className="method-list">{visibleMethods.length === 0 ? <div className="quiet-empty"><BookOpen size={22} /><p>还没有匹配的方法版本</p></div> : visibleMethods.map((method) => <article className="method-card" key={method.id}><div className="capture-card-head"><div><span className="capture-kind">方法版本 · {method.revision_label}</span><h2>{method.title}</h2></div><span className="read-status read">已记录</span></div><p>{method.purpose}</p><ol>{method.steps.map((step) => <li key={step}>{step}</li>)}</ol><div className="capture-card-foot"><span>已用于 {method.usage_count || 0} 次行动</span><small>{method.conditions || "未补充限制条件"}</small></div></article>)}</div></>}
    {tab === "captures" && selectedCaptures.length > 0 && <form className="action-form" onSubmit={createAction}><div><span className="eyebrow">组合素材</span><h2>用选中的 {selectedCaptures.length} 份素材发起内容行动</h2></div><input name="title" required placeholder="行动标题" /><textarea name="goal" required rows={2} placeholder="面向谁、要解决什么问题？" /><div className="action-form-row"><select name="method_id" defaultValue="" aria-label="选择方法版本"><option value="" disabled>选择方法版本</option>{methods.map((method) => <option key={method.id} value={method.id}>{method.title} · {method.revision_label}</option>)}</select><select name="project_id" defaultValue="" aria-label="关联项目"><option value="">不关联项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button disabled={busy}>开始内容行动</button></div></form>}
  </div>;
}

function MethodForm({ captures, methods, busy, onWrite, onReload, onMessage }: { captures: Capture[]; methods: Method[]; busy: boolean; onWrite: (request: WriteRequest) => Promise<unknown>; onReload: () => void; onMessage: (message: string) => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const steps = data.get("steps")?.toString().split("\n").map((item) => item.trim()).filter(Boolean) || [];
    try {
      await onWrite({ path: "/api/v1/methods", body: { title: data.get("title"), purpose: data.get("purpose"), steps, conditions: data.get("conditions"), capture_id: data.get("capture_id") || undefined, previous_method_id: data.get("previous_method_id") || undefined }, requestId: crypto.randomUUID(), label: "方法版本保存" });
      form.reset(); onMessage("方法版本已保存"); onReload();
    } catch (cause) { onMessage(cause instanceof Error ? cause.message : "方法保存失败"); }
  }
  return <form className="capture-form method-form" onSubmit={submit}><div className="capture-form-title"><Plus size={16} />记录方法版本</div><div className="capture-form-grid"><input name="title" required placeholder="方法名称" /><input name="purpose" required placeholder="适用目的" /><select name="capture_id" defaultValue="" aria-label="来源素材"><option value="">不关联来源素材</option>{captures.map((capture) => <option key={capture.id} value={capture.id}>{capture.title}</option>)}</select><select name="previous_method_id" defaultValue="" aria-label="前一方法版本"><option value="">创建全新方法</option>{methods.map((method) => <option key={method.id} value={method.id}>基于 {method.title} · {method.revision_label}</option>)}</select><textarea name="steps" required rows={4} placeholder={"每行一个步骤\n例如：核对事实\n确定受众和角度"} /><input name="conditions" placeholder="依赖条件或限制（可选）" /><button disabled={busy}><BookOpen size={14} />保存版本</button></div></form>;
}

async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function TrialWorkspace({ trial, busy, onFeedback, onAccept, onDraft }: { trial: Trial; busy: boolean; onFeedback: (event: FormEvent<HTMLFormElement>, versionId: string) => void; onAccept: (deliverableId: string, versionId: string) => void; onDraft: (event: FormEvent<HTMLFormElement>, trialId: string) => void }) {
  const codeRef = [trial.code_branch, trial.code_commit && trial.code_commit.slice(0, 8)].filter(Boolean).join(" · ");
  return <div className="trial-workspace"><div className="workspace-title"><div><span>{kindLabel(trial.capture?.kind)}</span><h1>{trial.title}</h1><p>{trial.goal}</p></div><b>{statusLabel(trial.status)}</b></div><div className="context-row"><div><span>输入</span><strong>{trial.captures?.length ? `${trial.captures.length} 份素材` : trial.capture?.title || "未关联"}</strong></div><div><span>项目</span><strong>{trial.project?.name || "未关联项目"}</strong></div><div><span>方法版本</span><strong>{trial.method ? `${trial.method.title} · ${trial.method.revision_label}` : codeRef || "未记录"}</strong></div><div><span>下一步</span><strong>{trial.next_step || "形成第一个可审阅成果"}</strong></div></div>{Boolean(trial.captures?.length) && <div className="trial-materials">{trial.captures!.map((capture) => <span key={capture.id}>{capture.title}</span>)}</div>}{trial.deliverables.length === 0 && <div className="workspace-empty"><FileText size={22} /><h2>添加第一个可审阅成果</h2><p>可以先放一段短稿，获得反馈后再继续迭代。</p><DraftForm busy={busy} onSubmit={(event) => onDraft(event, trial.id)} /></div>}{trial.deliverables.map((deliverable) => <section className="deliverable" key={deliverable.id}><div className="deliverable-head"><div><span>成果 · {deliverable.type === "article" ? "图文" : deliverable.type}</span><h2>{deliverable.title}</h2></div><b>{reviewStatusLabel(deliverable.review_status)}</b></div><div className="version-grid">{deliverable.versions.map((version) => <article className="version-card" key={version.id}><div className="version-meta"><strong>v{version.ordinal}</strong>{deliverable.accepted_version_id === version.id && <span>采用版本</span>}{deliverable.versions[0]?.id === version.id && deliverable.accepted_version_id !== version.id && <span>{reviewStatusLabel(deliverable.review_status)}</span>}</div><div className="article-preview">{version.content.split("\n").map((line, index) => line.startsWith("# ") ? <h3 key={index}>{line.slice(2)}</h3> : <p key={index}>{line || <br />}</p>)}</div>{version.handles_feedback_ids.length > 0 && <p className="handled">已处理 {version.handles_feedback_ids.length} 条反馈</p>}<div className="feedback-list">{version.feedback.map((item) => <p key={item.id}><span>{item.status === "handled" ? "已处理" : feedbackKindLabel(item.kind)}</span><small>{sourceLabel(item.source)}：</small>{item.content}</p>)}</div><form onSubmit={(event) => onFeedback(event, version.id)}><label htmlFor={`feedback-${version.id}`}>留下反馈</label><div className="feedback-form-row"><select name="kind" defaultValue="revision" aria-label="反馈类型"><option value="revision">待修改</option><option value="review">待审阅</option></select><input id={`feedback-${version.id}`} name="content" placeholder="写下具体意见" disabled={busy} /><button disabled={busy}>保存</button></div></form>{deliverable.accepted_version_id !== version.id && <button className="accept-button" disabled={busy} onClick={() => onAccept(deliverable.id, version.id)}>采用 v{version.ordinal}</button>}</article>)}</div></section>)}{trial.decisions.length > 0 && <section className="decision"><span>本轮判断</span><h2>{trial.decisions[0].adjustment}</h2><p>{trial.decisions[0].rationale}</p><div><small>下一步</small>{trial.decisions[0].next_step}<b>拟议</b></div></section>}</div>;
}

function DraftForm({ busy, onSubmit }: { busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="draft-form" onSubmit={onSubmit}><input name="title" required placeholder="成果名称" aria-label="成果名称" /><textarea name="content" required rows={5} placeholder="粘贴或写下第一版内容…" aria-label="成果内容" /><button disabled={busy}>{busy ? "正在保存…" : "保存第一版"}</button></form>;
}
