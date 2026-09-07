"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, ChevronLeft, ChevronRight, FileText, Folder, Inbox, Menu, PanelLeftClose, PanelLeftOpen, Rocket, Search, Sparkles, X } from "lucide-react";
import { PROJECT_CATEGORIES } from "@/lib/project-categories";

type Feedback = { id: string; content: string; status: string };
type Version = { id: string; ordinal: number; content: string; feedback: Feedback[]; handles_feedback_ids: string[] };
type Deliverable = { id: string; title: string; type: string; accepted_version_id: string | null; versions: Version[] };
type Decision = { id: string; rationale: string; adjustment: string; next_step: string; execution_status: string };
type Trial = { id: string; title: string; goal: string; status: string; revision: number; method: null | { title: string; revision_label: string; purpose: string; steps: string[] }; capture: null | { title: string; kind: string; source?: string }; deliverables: Deliverable[]; decisions: Decision[] };
type ProjectProfile = { summary: string; highlights: string[]; usage: string[]; stage: string; stack: string };
type Project = { id: string; name: string; category: string; path: string | null; description: string | null; status: string; created_at: string; updated_at: string; profile: ProjectProfile | null };
type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];
type View = "overview" | "projects" | "active" | "inbox" | "deliverables";

const statusLabel = (status: string) => status === "in_progress" ? "进行中" : status === "review" ? "审阅中" : status;
const kindLabel = (kind?: string) => kind === "failure" ? "从失败开始" : kind === "discovery" ? "从资料开始" : "从需求开始";

export default function Home() {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectCategories, setProjectCategories] = useState<ProjectCategory[]>([]);
  const [selected, setSelected] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const [dashboardResponse, projectsResponse] = await Promise.all([
        fetch("/api/v1/dashboard", { cache: "no-store" }),
        fetch("/api/v1/projects", { cache: "no-store" }),
      ]);
      if (!dashboardResponse.ok || !projectsResponse.ok) throw new Error("读取工作台失败");
      const [data, projectData] = await Promise.all([dashboardResponse.json(), projectsResponse.json()]);
      setTrials(data.trials);
      setProjects(projectData.projects);
      setProjectCategories(projectData.categories);
      setError("");
      return data.trials as Trial[];
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败"); }
    finally { setLoading(false); }
    return [] as Trial[];
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const trial = trials.find((item) => item.id === selected);
  const project = projects.find((item) => item.id === selectedProject);
  const openFeedbackCount = useMemo(() => trials.flatMap((item) => item.deliverables).flatMap((item) => item.versions).flatMap((item) => item.feedback).filter((item) => item.status === "open").length, [trials]);
  const deliverableCount = useMemo(() => trials.reduce((count, item) => count + item.deliverables.length, 0), [trials]);
  const filteredTrials = trials.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));

  function openTrial(id: string) { setSelected(id); setSelectedProject(""); setView("active"); }
  function openProject(id: string) { setSelected(""); setSelectedProject(id); setView("projects"); }

  async function addFeedback(event: FormEvent<HTMLFormElement>, versionId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const content = new FormData(form).get("content")?.toString().trim();
    if (!content) return;
    setBusy(true);
    const response = await fetch("/api/v1/feedback", { method: "POST", headers: { "content-type": "application/json", "x-client-request-id": crypto.randomUUID() }, body: JSON.stringify({ version_id: versionId, content }) });
    setBusy(false);
    if (!response.ok) { setError("反馈保存失败，请重试"); return; }
    form.reset(); await load();
  }

  async function accept(deliverableId: string, versionId: string) {
    setBusy(true);
    const response = await fetch(`/api/v1/deliverables/${deliverableId}/accept`, { method: "POST", headers: { "content-type": "application/json", "x-client-request-id": crypto.randomUUID() }, body: JSON.stringify({ version_id: versionId }) });
    setBusy(false);
    if (!response.ok) { setError("采用版本失败，请重试"); return; }
    await load();
  }

  async function createDraft(event: FormEvent<HTMLFormElement>, trialId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/drafts", { method: "POST", headers: { "content-type": "application/json", "x-client-request-id": crypto.randomUUID() }, body: JSON.stringify({ trial_id: trialId, title: data.get("title"), content: data.get("content"), type: "article" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "成果保存失败");
      form.reset(); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "成果保存失败"); }
    finally { setBusy(false); }
  }

  const overviewNav = [
    { id: "active" as View, label: "进行中", icon: Rocket, count: trials.length },
    { id: "inbox" as View, label: "待处理", icon: Inbox, count: openFeedbackCount },
    { id: "deliverables" as View, label: "成果", icon: FileText, count: deliverableCount },
  ];
  const plannedNav = [
    { label: "能力", icon: BookOpen },
  ];

  return <main className={sidebarOpen ? "app-shell" : "app-shell sidebar-collapsed"}>
    <aside className="sidebar">
      <div className="sidebar-head"><button className="logo" onClick={() => { setView("overview"); setSelected(""); setSelectedProject(""); }} aria-label="返回总览">M</button><strong>MYOPC</strong><button className="icon-button collapse" onClick={() => setSidebarOpen(false)} title="收起侧边栏"><PanelLeftClose size={18} /></button></div>
      <nav className="primary-nav" aria-label="主导航">
        <button className={view === "overview" && !selected ? "nav-item active" : "nav-item"} onClick={() => { setView("overview"); setSelected(""); setSelectedProject(""); }}><Sparkles size={17} /><span>总览</span></button>
        <div className="nav-children" aria-label="总览下级">
          {overviewNav.map(({ id, label, icon: Icon, count }) => <button key={id} className={view === id ? "nav-item nav-child active" : "nav-item nav-child"} onClick={() => { setView(id); setSelected(""); setSelectedProject(""); }}><Icon size={16} /><span>{label}</span>{Boolean(count) && <b>{count}</b>}</button>)}
        </div>
        <div className="nav-divider" />
        <button className={view === "projects" && !selected ? "nav-item active" : "nav-item"} onClick={() => { setView("projects"); setSelected(""); setSelectedProject(""); }}><Folder size={17} /><span>项目</span>{Boolean(projects.length) && <b>{projects.length}</b>}</button>
        {plannedNav.map(({ label, icon: Icon }) => <button key={label} className="nav-item planned-nav-item" disabled aria-label={`${label}，规划中`}><Icon size={17} /><span>{label}</span><small>规划中</small></button>)}
      </nav>
      <div className="sidebar-section"><div className="section-label"><span>最近行动</span>{trials.length > 0 && <small>{trials.length}</small>}</div>
        {trials.length > 4 && <label className="search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" /></label>}
        <div className="trial-list">{filteredTrials.slice(0, 8).map((item) => <button key={item.id} className={selected === item.id ? "history-item active" : "history-item"} onClick={() => openTrial(item.id)}><span>{item.title}</span><small>{statusLabel(item.status)}</small></button>)}{!loading && trials.length === 0 && <p className="sidebar-empty">还没有记录</p>}</div>
      </div>
      <div className="sidebar-foot"><span><i /> 本地私有数据</span><small>Codex 驱动</small></div>
    </aside>

    <section className="main-panel">
      <header className="main-header"><button className="icon-button menu-button" onClick={() => setSidebarOpen(!sidebarOpen)} title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}>{sidebarOpen ? <Menu size={19} /> : <PanelLeftOpen size={19} />}</button><div className="breadcrumb"><span>工作台</span>{trial && <><ChevronLeft size={13} className="crumb-arrow" /><strong>{trial.title}</strong></>}{project && !trial && <><ChevronLeft size={13} className="crumb-arrow" /><strong>{project.name}</strong></>}</div></header>
      <div className="content">
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
        {loading && <div className="loading-state">正在读取本地记录…</div>}
        {!loading && !trial && view === "overview" && <OverviewView trials={trials} onOpen={openTrial} onNavigate={(nextView) => { setView(nextView); setSelected(""); setSelectedProject(""); }} />}
        {!loading && !trial && view === "projects" && project && <ProjectDetailView project={project} category={projectCategories.find((item) => item.id === project.category)} onBack={() => setSelectedProject("")} />}
        {!loading && !trial && view === "projects" && !project && <ProjectsView projects={projects} categories={projectCategories} onOpen={openProject} />}
        {!loading && !trial && view === "active" && <ListView title="进行中的行动" subtitle="从这里继续上次的目标、产物和反馈。" trials={trials} onOpen={openTrial} empty="还没有进行中的行动" />}
        {!loading && !trial && view === "inbox" && <InboxView trials={trials} onOpen={openTrial} />}
        {!loading && !trial && view === "deliverables" && <DeliverablesView trials={trials} onOpen={openTrial} />}
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
    {visibleProjects.length === 0 ? <div className="quiet-empty project-empty"><Folder size={22} /><p>{filter === "all" ? "还没有登记项目" : `“${categoryLabel(filter)}”类别下还没有项目`}</p></div> : <div className="project-grid">{visibleProjects.map((project) => <button type="button" className="project-card" key={project.id} onClick={() => onOpen(project.id)}><div className="project-card-head"><span className="project-category-label">{categoryLabel(project.category)}</span><span className="project-status">{project.status === "active" ? "已登记" : project.status}</span><ChevronRight size={15} /></div><h2>{project.name}</h2><p>{project.description || "尚未补充项目说明。"}</p><span className="project-card-hint">查看工具详情</span></button>)}</div>}
  </div>;
}

function ProjectDetailView({ project, category, onBack }: { project: Project; category?: ProjectCategory; onBack: () => void }) {
  const categoryLabel = category?.label || project.category;
  const statusLabel = project.status === "active" ? "已登记" : project.status;
  const profile = project.profile;
  const summary = profile?.summary || project.description || "尚未补充工具介绍。";
  const highlights = profile?.highlights || ["尚未补充主要能力。"];
  const usage = profile?.usage || ["尚未补充使用方式。"];

  return <div className="project-detail-view">
    <button type="button" className="back-button" onClick={onBack}><ChevronLeft size={15} />返回项目</button>
    <section className="project-detail-hero">
      <div><span className="eyebrow">{categoryLabel}</span><h1>{project.name}</h1><p>{summary}</p></div>
      <span className="project-detail-status">{statusLabel}</span>
    </section>
    <div className="project-detail-meta">
      <div><span>项目类别</span><strong>{categoryLabel}</strong></div>
      <div><span>项目状态</span><strong>{statusLabel}</strong></div>
      <div><span>技术形态</span><strong>{profile?.stack || "尚未补充"}</strong></div>
    </div>
    <div className="project-detail-grid">
      <section className="project-detail-panel"><div className="project-detail-panel-head"><div><span className="eyebrow">工具介绍</span><h2>主要能力</h2></div><Folder size={18} /></div><ul className="project-detail-list">{highlights.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section className="project-detail-panel"><div className="project-detail-panel-head"><div><span className="eyebrow">使用方式</span><h2>怎么用</h2></div><CheckCircle2 size={18} /></div><ul className="project-detail-list">{usage.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </div>
    <section className="project-detail-stage"><span className="eyebrow">当前阶段</span><h2>{profile?.stage || "尚未补充当前阶段。"}</h2></section>
  </div>;
}

function OverviewView({ trials, onOpen, onNavigate }: { trials: Trial[]; onOpen: (id: string) => void; onNavigate: (view: View) => void }) {
  const activeTrials = trials.filter((item) => item.status === "in_progress");
  const recentTrials = trials.slice(0, 4);

  return <div className="overview-view">
    <section className="overview-hero">
      <div className="overview-intro"><span className="eyebrow">工作台</span><h1>让 MYOPC 记录正在发生的工作</h1><p>在 Codex 中提出需求、执行工作；这里查看行动、成果、反馈和下一步。</p></div>
      <div className="codex-note"><span><Sparkles size={18} /></span><div><strong>Codex 驱动</strong><small>输入与执行发生在 Codex</small></div></div>
    </section>
    <div className="overview-stats">
      <button onClick={() => onNavigate("active")}><span>进行中</span><strong>{activeTrials.length}</strong><small>继续中的行动 <ChevronRight size={13} /></small></button>
      <button onClick={() => onNavigate("inbox")}><span>待处理</span><strong>{trials.flatMap((item) => item.deliverables).flatMap((item) => item.versions).flatMap((item) => item.feedback).filter((item) => item.status === "open").length}</strong><small>需要判断的反馈 <ChevronRight size={13} /></small></button>
      <button onClick={() => onNavigate("deliverables")}><span>成果</span><strong>{trials.reduce((count, item) => count + item.deliverables.length, 0)}</strong><small>已记录的成果 <ChevronRight size={13} /></small></button>
    </div>
    <section className="overview-section">
      <div className="overview-section-head"><div><span className="eyebrow">最近行动</span><h2>继续你的工作</h2></div>{recentTrials.length > 0 && <button className="text-button" onClick={() => onNavigate("active")}>查看全部 <ChevronRight size={14} /></button>}</div>
      {recentTrials.length === 0 ? <div className="overview-empty"><span className="overview-empty-icon"><Sparkles size={22} /></span><h2>等待 Codex 中的下一次行动</h2><p>当你在 Codex 中提出需求、整理资料或记录失败，相关记录会出现在这里。</p><div className="workflow-hint"><span><b>01</b>在 Codex 中提出目标</span><span><b>02</b>Codex 执行并记录</span><span><b>03</b>在 MYOPC 中查看反馈</span></div></div> : <div className="overview-trials">{recentTrials.map((item) => <button className="overview-trial" key={item.id} onClick={() => onOpen(item.id)}><span className="overview-trial-icon"><Rocket size={16} /></span><span className="overview-trial-copy"><strong>{item.title}</strong><small>{item.goal}</small></span><span className="overview-trial-status">{statusLabel(item.status)}</span><ChevronRight size={15} /></button>)}</div>}
    </section>
  </div>;
}

function ListView({ title, subtitle, trials, onOpen, empty }: { title: string; subtitle: string; trials: Trial[]; onOpen: (id: string) => void; empty: string }) {
  return <div className="list-view"><div className="view-title"><h1>{title}</h1><p>{subtitle}</p></div>{trials.length === 0 ? <div className="quiet-empty"><Rocket size={22} /><p>{empty}</p></div> : <div className="rows">{trials.map((trial) => <button key={trial.id} onClick={() => onOpen(trial.id)}><span className="row-icon"><Rocket size={16} /></span><span><strong>{trial.title}</strong><small>{trial.goal}</small></span><b>{statusLabel(trial.status)}</b></button>)}</div>}</div>;
}

function InboxView({ trials, onOpen }: { trials: Trial[]; onOpen: (id: string) => void }) {
  const rows = trials.flatMap((trial) => trial.deliverables.flatMap((deliverable) => deliverable.versions.flatMap((version) => version.feedback.filter((item) => item.status === "open").map((feedback) => ({ trial, version, feedback })))));
  return <div className="list-view"><div className="view-title"><h1>待处理</h1><p>需要判断或修改的反馈。</p></div>{rows.length === 0 ? <div className="quiet-empty"><CheckCircle2 size={22} /><p>没有待处理反馈</p></div> : <div className="rows">{rows.map(({ trial, version, feedback }) => <button key={feedback.id} onClick={() => onOpen(trial.id)}><span className="row-icon"><Inbox size={16} /></span><span><strong>{feedback.content}</strong><small>{trial.title} · v{version.ordinal}</small></span><b>待处理</b></button>)}</div>}</div>;
}

function DeliverablesView({ trials, onOpen }: { trials: Trial[]; onOpen: (id: string) => void }) {
  const rows = trials.flatMap((trial) => trial.deliverables.map((deliverable) => ({ trial, deliverable })));
  return <div className="list-view"><div className="view-title"><h1>成果</h1><p>所有稿件、视频和工具版本。</p></div>{rows.length === 0 ? <div className="quiet-empty"><FileText size={22} /><p>还没有成果</p></div> : <div className="rows">{rows.map(({ trial, deliverable }) => <button key={deliverable.id} onClick={() => onOpen(trial.id)}><span className="row-icon"><FileText size={16} /></span><span><strong>{deliverable.title}</strong><small>{trial.title} · {deliverable.versions.length} 个版本</small></span><b>{deliverable.accepted_version_id ? "已采用" : "待审阅"}</b></button>)}</div>}</div>;
}

function TrialWorkspace({ trial, busy, onFeedback, onAccept, onDraft }: { trial: Trial; busy: boolean; onFeedback: (event: FormEvent<HTMLFormElement>, versionId: string) => void; onAccept: (deliverableId: string, versionId: string) => void; onDraft: (event: FormEvent<HTMLFormElement>, trialId: string) => void }) {
  return <div className="trial-workspace"><div className="workspace-title"><div><span>{kindLabel(trial.capture?.kind)}</span><h1>{trial.title}</h1><p>{trial.goal}</p></div><b>{statusLabel(trial.status)}</b></div>
    <div className="context-row"><div><span>输入</span><strong>{trial.capture?.title || "未关联"}</strong></div><div><span>方法</span><strong>{trial.method ? `${trial.method.title} · ${trial.method.revision_label}` : "尚未整理"}</strong></div><div><span>下一步</span><strong>{trial.decisions[0]?.next_step || "形成第一个可审阅成果"}</strong></div></div>
    {trial.deliverables.length === 0 && <div className="workspace-empty"><FileText size={22} /><h2>添加第一个可审阅成果</h2><p>可以先放一段短稿，获得反馈后再继续迭代。</p><DraftForm busy={busy} onSubmit={(event) => onDraft(event, trial.id)} /></div>}
    {trial.deliverables.map((deliverable) => <section className="deliverable" key={deliverable.id}><div className="deliverable-head"><div><span>成果 · {deliverable.type === "article" ? "图文" : deliverable.type}</span><h2>{deliverable.title}</h2></div><b>{deliverable.accepted_version_id ? "已采用，未发布" : "待审阅"}</b></div><div className="version-grid">{deliverable.versions.map((version) => <article className="version-card" key={version.id}><div className="version-meta"><strong>v{version.ordinal}</strong>{deliverable.accepted_version_id === version.id && <span>采用版本</span>}</div><div className="article-preview">{version.content.split("\n").map((line, index) => line.startsWith("# ") ? <h3 key={index}>{line.slice(2)}</h3> : <p key={index}>{line || <br />}</p>)}</div>{version.handles_feedback_ids.length > 0 && <p className="handled">已处理 {version.handles_feedback_ids.length} 条反馈</p>}<div className="feedback-list">{version.feedback.map((item) => <p key={item.id}><span>{item.status === "handled" ? "已处理" : "待处理"}</span>{item.content}</p>)}</div><form onSubmit={(event) => onFeedback(event, version.id)}><label htmlFor={`feedback-${version.id}`}>版本反馈</label><div><input id={`feedback-${version.id}`} name="content" placeholder="写下具体修改意见" disabled={busy} /><button disabled={busy}>保存</button></div></form>{deliverable.accepted_version_id !== version.id && <button className="accept-button" disabled={busy} onClick={() => onAccept(deliverable.id, version.id)}>采用 v{version.ordinal}</button>}</article>)}</div></section>)}
    {trial.decisions.length > 0 && <section className="decision"><span>本轮判断</span><h2>{trial.decisions[0].adjustment}</h2><p>{trial.decisions[0].rationale}</p><div><small>下一步</small>{trial.decisions[0].next_step}<b>拟议</b></div></section>}
  </div>;
}

function DraftForm({ busy, onSubmit }: { busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <form className="draft-form" onSubmit={onSubmit}><input name="title" required placeholder="成果名称" aria-label="成果名称" /><textarea name="content" required rows={5} placeholder="粘贴或写下第一版内容…" aria-label="成果内容" /><button disabled={busy}>{busy ? "正在保存…" : "保存第一版"}</button></form>;
}
