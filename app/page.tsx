"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Feedback = { id: string; content: string; status: string };
type Version = { id: string; ordinal: number; content: string; feedback: Feedback[]; handles_feedback_ids: string[] };
type Deliverable = { id: string; title: string; type: string; accepted_version_id: string | null; versions: Version[] };
type Decision = { id: string; rationale: string; adjustment: string; next_step: string; execution_status: string };
type Trial = { id: string; title: string; goal: string; status: string; revision: number; method: null | { title: string; revision_label: string; purpose: string; steps: string[] }; capture: null | { title: string; source?: string }; deliverables: Deliverable[]; decisions: Decision[] };

export default function Home() {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/dashboard", { cache: "no-store" });
      if (!response.ok) throw new Error("读取工作台失败");
      const data = await response.json();
      setTrials(data.trials);
      setSelected((current) => current || data.trials[0]?.id || "");
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败"); }
    finally { setLoading(false); }
  }, []);

  // Initial hydration is intentionally tied to the API, so the client can recover after a restart.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const trial = trials.find((item) => item.id === selected);
  const trialStatus = trial?.status === "in_progress" ? "进行中" : trial?.status === "review" ? "审阅中" : trial?.status;

  async function addFeedback(event: FormEvent<HTMLFormElement>, versionId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const content = new FormData(form).get("content")?.toString().trim();
    if (!content) return;
    setBusy(true);
    const response = await fetch("/api/v1/feedback", { method: "POST", headers: { "content-type": "application/json", "x-client-request-id": crypto.randomUUID() }, body: JSON.stringify({ version_id: versionId, content }) });
    setBusy(false);
    if (!response.ok) { setError("反馈保存失败，请重试"); return; }
    form.reset();
    await load();
  }

  async function accept(deliverableId: string, versionId: string) {
    setBusy(true);
    const response = await fetch(`/api/v1/deliverables/${deliverableId}/accept`, { method: "POST", headers: { "content-type": "application/json", "x-client-request-id": crypto.randomUUID() }, body: JSON.stringify({ version_id: versionId }) });
    setBusy(false);
    if (!response.ok) { setError("采用版本失败，请重试"); return; }
    await load();
  }

  return <main>
    <header className="topbar"><div className="brand"><span className="brand-mark">M</span><div><strong>MYOPC</strong><small>个人行动与经营工作台</small></div></div><div className="stage"><i /> S0 · 本地私有数据</div></header>
    <div className="shell">
      <aside>
        <p className="eyebrow">正在推进</p>
        <h1>让这一次行动，<br />改变下一轮起点。</h1>
        <p className="aside-copy">围绕真实输入、产物与反馈连续工作，不必先补齐项目或能力档案。</p>
        <nav aria-label="尝试列表">
          {trials.map((item) => <button key={item.id} className={item.id === selected ? "trial-link active" : "trial-link"} onClick={() => setSelected(item.id)}><span>{item.title}</span><small>{item.status === "in_progress" ? "进行中" : item.status === "review" ? "审阅中" : item.status}</small></button>)}
        </nav>
        <div className="truth-note"><span>事实边界</span><p>采用 ≠ 发布<br />内部反馈 ≠ 市场验证</p></div>
      </aside>
      <section className="workspace">
        {loading && <div className="state">正在读取本地记录…</div>}
        {error && <div className="error">{error}<button onClick={() => void load()}>重试</button></div>}
        {!loading && !trial && <div className="empty"><p className="eyebrow">还没有尝试</p><h2>从一条文本、链接或需求开始</h2><p>运行 README 中的 S0 联动命令，即可创建首个低成本图文样例。</p></div>}
        {trial && <>
          <div className="workspace-head"><div><p className="eyebrow">当前尝试 · 无需项目</p><h2>{trial.title}</h2><p>{trial.goal}</p></div><span className="status-pill">{trialStatus}</span></div>
          <div className="context-strip">
            <article><span>输入来源</span><strong>{trial.capture?.title || "未关联"}</strong><small>{trial.capture?.source || "已提供文本"}</small></article>
            <article><span>采用方法</span><strong>{trial.method?.title || "未关联"}</strong><small>{trial.method ? `${trial.method.revision_label} · ${trial.method.purpose}` : "可在行动中补充"}</small></article>
            <article><span>下一步</span><strong>{trial.decisions[0]?.execution_status === "proposed" ? "拟议，尚未执行" : "等待反馈"}</strong><small>{trial.decisions[0]?.next_step || "先审阅当前成果"}</small></article>
          </div>
          {trial.deliverables.map((deliverable) => <section className="deliverable" key={deliverable.id}>
            <div className="section-title"><div><p className="eyebrow">成果 · {deliverable.type === "article" ? "图文" : deliverable.type}</p><h3>{deliverable.title}</h3></div><span className={deliverable.accepted_version_id ? "accepted" : "draft"}>{deliverable.accepted_version_id ? "已采用，未发布" : "待审阅"}</span></div>
            <div className="version-grid">
              {deliverable.versions.map((version) => <article className="version-card" key={version.id}>
                <div className="version-meta"><strong>v{version.ordinal}</strong>{deliverable.accepted_version_id === version.id && <span>采用版本</span>}</div>
                <div className="article-preview">{version.content.split("\n").map((line, index) => line.startsWith("# ") ? <h4 key={index}>{line.slice(2)}</h4> : <p key={index}>{line || <br />}</p>)}</div>
                {version.handles_feedback_ids.length > 0 && <p className="handled">已处理 {version.handles_feedback_ids.length} 条反馈</p>}
                <div className="feedback-list">{version.feedback.map((item) => <p key={item.id}><span>{item.status === "handled" ? "已处理" : "待处理"}</span>{item.content}</p>)}</div>
                <form onSubmit={(event) => void addFeedback(event, version.id)}><label htmlFor={`feedback-${version.id}`}>给这个版本留意见</label><div><input id={`feedback-${version.id}`} name="content" placeholder="例如：开头更直接一些" disabled={busy} /><button disabled={busy}>保存反馈</button></div></form>
                {deliverable.accepted_version_id !== version.id && <button className="accept-button" disabled={busy} onClick={() => void accept(deliverable.id, version.id)}>采用 v{version.ordinal}</button>}
              </article>)}
            </div>
          </section>)}
          {trial.decisions.length > 0 && <section className="decision"><p className="eyebrow">本轮留下的判断</p><h3>{trial.decisions[0].adjustment}</h3><p>{trial.decisions[0].rationale}</p><div><span>下一步</span>{trial.decisions[0].next_step}<b>拟议</b></div></section>}
        </>}
      </section>
    </div>
  </main>;
}
