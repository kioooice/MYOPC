"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, FileText, Inbox, Lightbulb, Menu, PanelLeftClose, PanelLeftOpen, Plus, Rocket, Search, Sparkles, X } from "lucide-react";

type Feedback = { id: string; content: string; status: string };
type Version = { id: string; ordinal: number; content: string; feedback: Feedback[]; handles_feedback_ids: string[] };
type Deliverable = { id: string; title: string; type: string; accepted_version_id: string | null; versions: Version[] };
type Decision = { id: string; rationale: string; adjustment: string; next_step: string; execution_status: string };
type Trial = { id: string; title: string; goal: string; status: string; revision: number; method: null | { title: string; revision_label: string; purpose: string; steps: string[] }; capture: null | { title: string; kind: string; source?: string }; deliverables: Deliverable[]; decisions: Decision[] };
type View = "start" | "active" | "inbox" | "deliverables";

const statusLabel = (status: string) => status === "in_progress" ? "进行中" : status === "review" ? "审阅中" : status;
const kindLabel = (kind?: string) => kind === "failure" ? "从失败开始" : kind === "discovery" ? "从资料开始" : "从需求开始";

export default function Home() {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [selected, setSelected] = useState("");
  const [view, setView] = useState<View>("start");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/dashboard", { cache: "no-store" });
      if (!response.ok) throw new Error("读取工作台失败");
      const data = await response.json();
      setTrials(data.trials);
      setError("");
      return data.trials as Trial[];
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败"); }
    finally { setLoading(false); }
    return [] as Trial[];
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const trial = trials.find((item) => item.id === selected);
  const openFeedbackCount = useMemo(() => trials.flatMap((item) => item.deliverables).flatMap((item) => item.versions).flatMap((item) => item.feedback).filter((item) => item.status === "open").length, [trials]);
  const deliverableCount = useMemo(() => trials.reduce((count, item) => count + item.deliverables.length, 0), [trials]);
  const filteredTrials = trials.filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));

  function openTrial(id: string) { setSelected(id); setView("active"); setComposerOpen(false); }

  async function createStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/starts", { method: "POST", headers: { "content-type": "application/json", "x-client-request-id": crypto.randomUUID() }, body: JSON.stringify({ kind: data.get("kind"), title: data.get("title"), content: data.get("content") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "创建失败");
      form.reset();
      const refreshed = await load();
      if (refreshed.some((item) => item.id === result.id)) openTrial(result.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建失败"); }
    finally { setBusy(false); }
  }

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

  const nav = [
    { id: "start" as View, label: "开始", icon: Sparkles },
    { id: "active" as View, label: "进行中", icon: Rocket, count: trials.length },
    { id: "inbox" as View, label: "待处理", icon: Inbox, count: openFeedbackCount },
    { id: "deliverables" as View, label: "成果", icon: FileText, count: deliverableCount },
  ];

  return <main className={sidebarOpen ? "app-shell" : "app-shell sidebar-collapsed"}>
    <aside className="sidebar">
      <div className="sidebar-head"><button className="logo" onClick={() => { setView("start"); setSelected(""); }} aria-label="返回开始">M</button><strong>MYOPC</strong><button className="icon-button collapse" onClick={() => setSidebarOpen(false)} title="收起侧边栏"><PanelLeftClose size={18} /></button></div>
      <button className="new-button" onClick={() => { setComposerOpen(true); setSelected(""); setView("start"); }}><Plus size={17} /> 新建行动</button>
      <nav className="primary-nav" aria-label="主导航">
        {nav.map(({ id, label, icon: Icon, count }) => <button key={id} className={view === id && !selected ? "nav-item active" : "nav-item"} onClick={() => { setView(id); setSelected(""); }}><Icon size={17} /><span>{label}</span>{Boolean(count) && <b>{count}</b>}</button>)}
      </nav>
      <div className="sidebar-section"><div className="section-label"><span>最近行动</span>{trials.length > 0 && <small>{trials.length}</small>}</div>
        {trials.length > 4 && <label className="search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" /></label>}
        <div className="trial-list">{filteredTrials.slice(0, 8).map((item) => <button key={item.id} className={selected === item.id ? "history-item active" : "history-item"} onClick={() => openTrial(item.id)}><span>{item.title}</span><small>{statusLabel(item.status)}</small></button>)}{!loading && trials.length === 0 && <p className="sidebar-empty">还没有记录</p>}</div>
      </div>
      <div className="sidebar-foot"><span><i /> 本地私有数据</span></div>
    </aside>

    <section className="main-panel">
      <header className="main-header"><button className="icon-button menu-button" onClick={() => setSidebarOpen(!sidebarOpen)} title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}>{sidebarOpen ? <Menu size={19} /> : <PanelLeftOpen size={19} />}</button><div className="breadcrumb"><span>工作台</span>{trial && <><ChevronLeft size={13} className="crumb-arrow" /><strong>{trial.title}</strong></>}</div><button className="header-new" onClick={() => { setComposerOpen(true); setSelected(""); setView("start"); }}><Plus size={16} /> 新建</button></header>
      <div className="content">
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
        {loading && <div className="loading-state">正在读取本地记录…</div>}
        {!loading && !trial && view === "start" && <StartView onSubmit={createStart} busy={busy} autoFocus={composerOpen || trials.length === 0} />}
        {!loading && !trial && view === "active" && <ListView title="进行中的行动" subtitle="从这里继续上次的目标、产物和反馈。" trials={trials} onOpen={openTrial} empty="还没有进行中的行动" />}
        {!loading && !trial && view === "inbox" && <InboxView trials={trials} onOpen={openTrial} />}
        {!loading && !trial && view === "deliverables" && <DeliverablesView trials={trials} onOpen={openTrial} />}
        {trial && <TrialWorkspace trial={trial} busy={busy} onFeedback={addFeedback} onAccept={accept} onDraft={createDraft} />}
      </div>
    </section>
  </main>;
}

function StartView({ onSubmit, busy, autoFocus }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; autoFocus: boolean }) {
  return <div className="start-view"><div className="start-heading"><span className="start-icon"><Lightbulb size={21} /></span><div><h1>从现在要做的事开始</h1><p>写下需求、看到的资料，或刚遇到的问题。</p></div></div>
    <form className="composer" onSubmit={onSubmit}>
      <div className="mode-switch" role="group" aria-label="入口类型"><label><input type="radio" name="kind" value="need" defaultChecked /><span>需求</span></label><label><input type="radio" name="kind" value="discovery" /><span>资料</span></label><label><input type="radio" name="kind" value="failure" /><span>失败</span></label></div>
      <input className="title-input" name="title" required autoFocus={autoFocus} placeholder="给这次行动起个名字" aria-label="行动名称" />
      <textarea name="content" required rows={5} placeholder="描述你想完成什么、发现了什么，或者哪里出了问题…" aria-label="具体内容" />
      <div className="composer-footer"><span>稍后可以继续补充方法、成果和反馈</span><button disabled={busy} type="submit">{busy ? "正在创建…" : "开始行动"}<Rocket size={16} /></button></div>
    </form>
    <div className="start-tips"><div><span>需求</span><p>“为新产品写一页清晰的介绍”</p></div><div><span>资料</span><p>“这篇文章里的方法值得试一下”</p></div><div><span>失败</span><p>“上次发布后没有人继续咨询”</p></div></div>
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
