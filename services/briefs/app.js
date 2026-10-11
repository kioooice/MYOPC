"use strict";
const $ = (id) => document.getElementById(id);
const labels = {frontier: ["02", "AI FRONTIER", "新能力、真实进展与早期信号"], creative: ["01", "CREATIVE MATERIALS", "具体素材与可吸收的工作流"], experience: ["03", "WAYS OF WORKING", "从真实实践里，找到更好的用法"]};
let allTasks = [], selected = null, report = null, refreshTimer = null;
let size = Number(localStorage.getItem("brief-font") || 18);
size = Math.max(16, Math.min(24, size));
document.documentElement.style.setProperty("--article-size", `${size}px`);
document.body.dataset.theme = localStorage.getItem("brief-theme") || "light";
$("theme").textContent = document.body.dataset.theme === "dark" ? "日间" : "夜间";

function node(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function inline(parent, text) {
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let start = 0, match;
  while ((match = pattern.exec(text))) {
    parent.append(document.createTextNode(text.slice(start, match.index)));
    if (match[1]) { const a = node("a", match[1]); a.href = match[2]; a.target = "_blank"; a.rel = "noopener noreferrer"; parent.append(a); }
    else parent.append(node(match[3] ? "strong" : "code", match[3] || match[4]));
    start = pattern.lastIndex;
  }
  parent.append(document.createTextNode(text.slice(start)));
}
function renderMarkdown(text) {
  const fragment = document.createDocumentFragment(), toc = [];
  let paragraph = [], list = null, quote = null, code = null;
  function flush() { if (paragraph.length) { const p = node("p"); inline(p, paragraph.join(" ")); fragment.append(p); paragraph = []; } list = null; quote = null; }
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) { flush(); if (code) code = null; else { code = node("pre"); fragment.append(code); } continue; }
    if (code) { code.textContent += `${line}\n`; continue; }
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.+)/);
    if (heading) { flush(); const level = Math.min(heading[1].length === 1 ? 2 : heading[1].length, 3); const h = node(`h${level}`); inline(h, heading[2]); h.id = `section-${toc.length}`; fragment.append(h); toc.push({id:h.id, title:h.textContent}); continue; }
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) { flush(); fragment.append(node("hr")); continue; }
    const bullet = line.match(/^\s*([-*]|\d+\.)\s+(.+)/);
    if (bullet) { if (paragraph.length) flush(); const type = /^\d/.test(bullet[1]) ? "ol" : "ul"; if (!list || list.tagName.toLowerCase() !== type) { list = node(type); fragment.append(list); } const li = node("li"); inline(li, bullet[2]); list.append(li); continue; }
    if (line.startsWith("> ")) { if (paragraph.length) flush(); if (!quote) { quote = node("blockquote"); fragment.append(quote); } const p = node("p"); inline(p, line.slice(2)); quote.append(p); continue; }
    list = null; quote = null; paragraph.push(line);
  }
  flush(); $("article").replaceChildren(fragment);
  $("toc").replaceChildren(...toc.map((h) => { const a = node("a", h.title); a.href = `#${h.id}`; return a; }));
}
async function api(path) { const r = await fetch(path); if (!r.ok) throw new Error(`服务暂时无法读取（${r.status}）`); return r.json(); }
function status(text) { $("status").hidden = !text; $("status").textContent = text || ""; }
function empty(title, text) { const e = node("div", undefined, "empty"); e.append(node("strong", title), node("span", text)); $("article").replaceChildren(e); }
function nav() {
  $("navigation").replaceChildren(...allTasks.map(t => { const a = node("a", undefined, `nav-link${selected?.slug === t.slug ? " active" : ""}`); a.href = `/${t.slug}`; a.append(node("span", labels[t.slug][0], "nav-number"), node("span", t.title), node("small", labels[t.slug][2])); if (selected?.slug === t.slug) a.setAttribute("aria-current", "page"); a.addEventListener("click", e => { e.preventDefault(); history.pushState({}, "", a.href); choose(t.slug); }); return a; }));
}
async function choose(slug, issueId, keepPosition = false) {
  selected = allTasks.find(t => t.slug === slug) || allTasks[0]; if (!selected) throw new Error("任务尚未配置");
  document.body.dataset.task = selected.slug; document.title = `${selected.title} · 每日精选`;
  $("category").textContent = selected.title; $("heading").textContent = selected.title; $("description").textContent = selected.description; $("eyebrow").textContent = labels[selected.slug][1]; nav();
  const completed = selected.reports.filter(r => ["ready","limited"].includes(r.status));
  const chosen = issueId ? selected.reports.find(r => r.id === issueId) : completed[0] || selected.reports[0];
  $("issues").replaceChildren(...selected.reports.map(r => { const state = {running:"研究中",failed:"未完成",ready:"已更新",limited:"含核验限制"}[r.status]; const o = node("option", `${r.day} · ${state}`); o.value = r.id; o.selected = chosen?.id === r.id; return o; }));
  if (!selected.reports.length) { $("issues").append(node("option", "首期尚未生成")); $("issues").disabled = true; } else $("issues").disabled = false;
  ["highlights","limitations","sources"].forEach(id => $(id).hidden = true); $("toc").replaceChildren(); $("finished").textContent = ""; $("readtime").textContent = "";
  const newest = selected.reports[0];
  status(newest?.status === "running" ? "新一期正在搜集资料与核对来源。完成后会出现在期刊列表中。" : newest?.status === "failed" ? (completed.length ? "新一期未完成，上一期内容仍可阅读。请选择日期查看本次状态。" : "首期研究未达到核验要求，暂未发布正文。") : "");
  if (!chosen) { report = null; empty("信息通道已就绪", "首份简报尚未生成。每期内容经过搜索、来源读取与整理后才会展示。"); return; }
  if (!keepPosition) empty("正在读取这一期", "内容与来源正在载入。");
  const requestedTask = selected.slug;
  const loaded = await api(`/api/reports/${chosen.id}`); if (selected.slug !== requestedTask) return;
  report = loaded;
  if (!keepPosition) { window.scrollTo(0,0); const u = new URL(location.href); u.searchParams.set("issue",report.id); history.replaceState({}, "",u); }
  if (!["ready","limited"].includes(report.status)) {
    const reason = /Research|item-level|Missing/.test(report.error || "") ? "本轮资料不足或来源核验未通过，未发布替代内容。" : /Model|model|HTTP/.test(report.error || "") ? "模型服务暂时未能完成整理，已有期刊会保留。" : "研究未能完成，已保留取得的资料，等待重新核验。";
    empty(report.status === "running" ? "这一期，正在研究" : "这一期尚未完成", report.status === "running" ? "正在拓宽来源、阅读原文并核对证据。内容准备好后会自动出现。" : reason); return;
  }
  $("highlights").hidden = false; $("headline").textContent = report.headline; $("summary").textContent = report.summary;
  $("highlight-list").replaceChildren(...report.highlights.map(t => node("li",t)));
  if (report.warnings.length) { $("limitations").hidden = false; $("warning-list").replaceChildren(...report.warnings.map(t => node("li",t))); }
  renderMarkdown(report.markdown);
  const chars = report.markdown.replace(/https?:\/\/[^\s)]+/g, "").length; $("readtime").textContent = `约 ${Math.max(1, Math.round(chars / 230))} 分钟阅读`;
  const seen = new Set(); const sources = report.sources.filter(s => !seen.has(s.url) && seen.add(s.url));
  $("sources").hidden = !sources.length; $("source-count").textContent = `${sources.length} 个实际读取的来源 · 查看原文`;
  $("source-list").replaceChildren(...sources.map(s => { const a = node("a",s.title || s.url); a.href=s.url; a.target="_blank"; a.rel="noopener noreferrer"; try {a.append(node("small",new URL(s.url).hostname));} catch {} return a; }));
  $("finished").textContent = `整理完成于 ${report.finished?.replace("T"," ").slice(0,16)} · 北京时间`;
  if (!keepPosition) { const scroll = Number(localStorage.getItem(`brief-position-${report.id}`) || 0); if (scroll > 100) requestAnimationFrame(() => window.scrollTo(0,scroll)); }
}
async function refresh() {
  try { allTasks = await api("/api/tasks"); const slug = location.pathname.slice(1) || "frontier"; const issue = new URL(location.href).searchParams.get("issue"); await choose(slug,issue,true); }
  catch(e) { status(e.message); }
}
$("issues").addEventListener("change", () => choose(selected.slug,$("issues").value).catch(e => status(e.message)));
$("font-down").addEventListener("click", () => changeSize(-1)); $("font-up").addEventListener("click", () => changeSize(1));
function changeSize(n) { size = Math.max(16,Math.min(24,size+n)); document.documentElement.style.setProperty("--article-size",`${size}px`); localStorage.setItem("brief-font",size); }
$("theme").addEventListener("click", () => { const dark=document.body.dataset.theme !== "dark"; document.body.dataset.theme=dark?"dark":"light"; localStorage.setItem("brief-theme",document.body.dataset.theme); $("theme").textContent=dark?"日间":"夜间"; });
$("back-top").addEventListener("click",() => window.scrollTo({top:0,behavior:"smooth"}));
window.addEventListener("popstate",() => choose(location.pathname.slice(1),new URL(location.href).searchParams.get("issue")).catch(e=>status(e.message)));
let scrollTimer;
window.addEventListener("scroll",() => { const max=document.documentElement.scrollHeight-innerHeight; $("progress").style.width=`${max>0?Math.min(100,scrollY/max*100):0}%`; clearTimeout(scrollTimer); scrollTimer=setTimeout(()=> { if(report && ["ready","limited"].includes(report.status))localStorage.setItem(`brief-position-${report.id}`,scrollY); },250); },{passive:true});
(async()=> { try {allTasks=await api("/api/tasks"); await choose(location.pathname.slice(1)||"frontier",new URL(location.href).searchParams.get("issue")); refreshTimer=setInterval(()=> {if(allTasks.some(t=>t.reports[0]?.status === "running")) refresh();},30000);}catch(e){status(e.message);empty("暂时无法读取", "请稍后刷新页面。已有简报会保留，不会被连接失败覆盖。");} })();
