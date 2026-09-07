const base = process.env.MYOPC_BASE_URL || "http://127.0.0.1:3000";
const authHeaders: Record<string, string> = process.env.MYOPC_USERNAME && process.env.MYOPC_PASSWORD
  ? { authorization: `Basic ${Buffer.from(`${process.env.MYOPC_USERNAME}:${process.env.MYOPC_PASSWORD}`).toString("base64")}` }
  : {};
export {};
const mode = process.argv[2];
const trialId = process.argv[3];

async function request(path: string, method = "GET", body?: unknown, requestId?: string) {
  const headers: Record<string, string> = body ? { "content-type": "application/json", "x-client-request-id": requestId || crypto.randomUUID(), ...authHeaders } : authHeaders;
  const response = await fetch(`${base}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(data)}`);
  return data;
}

async function start() {
  const health = await request("/health");
  const capture = await request("/captures", "POST", { kind: "text", title: "示例资料：低负担行动原则", content: "这是一份由 MYOPC 规划提炼的明确示例资料，不是外部经营证据。先用最小产物获得具体反馈，再决定下一步。", read_status: "provided" }, "s0-capture-001");
  const method = await request("/methods", "POST", { capture_id: capture.id, title: "最小图文试验", purpose: "用短稿快速获得可执行反馈", revision_label: "r1", steps: ["确定单一读者问题", "写出标题与三段短稿", "收集针对具体版本的反馈"], conditions: "仅用于低成本内部样例，尚未经过外部验证" }, "s0-method-001");
  const trial = await request("/trials", "POST", { title: "把模糊想法变成一页行动", goal: "写一篇短稿，验证版本、反馈和下一步记录能否往返", method_id: method.id, environment: "Codex desktop local shell → localhost HTTP" }, "s0-trial-001");
  const deliverable = await request("/deliverables", "POST", { trial_id: trial.id, title: "先行动，再把反馈带回来", type: "article" }, "s0-deliverable-001");
  const version = await request(`/deliverables/${deliverable.id}/versions`, "POST", { content: "# 别等计划完整，再开始你的第一个小试验\n\n把想法缩成今天能完成的一页。\n先做出可看的版本，再请一个人指出最不清楚的地方。\n记录这条反馈，让下一次行动从具体问题开始。" }, "s0-version-001");
  console.log(JSON.stringify({ connection: health, trial_id: trial.id, deliverable_id: deliverable.id, version_id: version.id, next: `在工作台给 v1 留反馈，然后运行 npm run s0:resume -- ${trial.id}` }, null, 2));
}

async function resume(id: string) {
  const context = await request(`/context?trial_id=${encodeURIComponent(id)}`);
  const deliverable = context.deliverables[0];
  const open = deliverable.versions.flatMap((version: { feedback: Array<{ id: string; status: string; content: string }> }) => version.feedback).filter((item: { status: string }) => item.status === "open");
  if (!open.length) throw new Error("没有待处理反馈；请先在工作台给 v1 留一条具体意见。");
  const version = await request(`/deliverables/${deliverable.id}/versions`, "POST", { content: "# 今天就完成一页：让反馈推动下一次行动\n\n别先搭一套完整系统。把当前想法缩成今天能读完的一页。\n请审阅者只指出一个最不清楚的地方，并把意见绑定到这个版本。\n下一次打开工作台时，直接从这条具体反馈继续，而不是重新回忆上下文。", handles_feedback_ids: open.map((item: { id: string }) => item.id) }, "s0-version-002");
  const decision = await request("/decisions", "POST", { trial_id: id, basis_feedback_id: open[0].id, rationale: `v1 收到反馈：“${open[0].content}”。本轮据此调整了标题和开头，但尚无外部效果证据。`, adjustment: "标题与开头更直接，明确今天可完成的一页", next_step: "下一轮用同一方法为一个真实需求写新短稿，并比较是否减少重新寻找上下文", execution_status: "proposed" }, "s0-decision-001");
  const updated = await request(`/trials/${id}`, "PATCH", { expected_revision: context.revision, status: "review", actual_result: "已完成 v1→反馈→v2 的本地往返；未发布，未获得市场反馈。" }, "s0-trial-update-001");
  console.log(JSON.stringify({ trial_id: id, created_version: `v${version.ordinal}`, handled_feedback: open.map((item: { id: string }) => item.id), decision_status: decision.execution_status, trial_revision: updated.revision }, null, 2));
}

async function main() {
  if (mode === "start") await start();
  else if (mode === "resume" && trialId) await resume(trialId);
  else throw new Error("用法：npm run s0:start；或 npm run s0:resume -- <trial_id>");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
