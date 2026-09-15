"use client";

import { useEffect, useId, useState } from "react";
import { Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";

// Mermaid 源码是知识仓库里的事实结构，这里只负责渲染：
// 渲染失败时回落到源码与错误提示，任何情况下都不修改原文。
export function MermaidDiagram({ code, label = "结构图" }: { code: string; label?: string }) {
  const reactId = useId();
  const [rendered, setRendered] = useState<{ code: string; svg: string; error: string }>({ code: "", svg: "", error: "" });
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const suffix = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
      const renderId = `myopc-mermaid-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", fontFamily: "inherit" });
        const { svg: rendered } = await mermaid.render(renderId, code);
        if (!cancelled) setRendered({ code, svg: rendered, error: "" });
      } catch (cause) {
        // mermaid 渲染失败时会把错误 SVG 留在挂载点里，这里清掉，页面只展示我们自己的源码回退。
        document.getElementById(`d${renderId}`)?.remove();
        if (!cancelled) setRendered({ code, svg: "", error: cause instanceof Error ? cause.message : "Mermaid 渲染失败" });
      } finally {
        document.getElementById(`d${renderId}`)?.remove();
      }
    })();
    return () => { cancelled = true; };
  }, [code, reactId]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const current = rendered.code === code ? rendered : null;

  if (current?.error) {
    return <figure className="mermaid-figure mermaid-failed">
      <figcaption className="mermaid-error">Mermaid 渲染失败，下面显示源码：{current.error}</figcaption>
      <pre className="mermaid-source"><code>{code}</code></pre>
    </figure>;
  }

  if (!current) return <div className="mermaid-figure mermaid-loading">正在渲染结构图…</div>;

  return <figure className="mermaid-figure">
    <div className="mermaid-canvas" dangerouslySetInnerHTML={{ __html: current.svg }} />
    <figcaption className="mermaid-caption">
      <span>{label}</span>
      <button type="button" onClick={() => { setZoom(1); setExpanded(true); }}><Maximize2 size={12} /> 查看大图</button>
    </figcaption>
    {expanded && <div className="mermaid-overlay" role="dialog" aria-modal="true" aria-label={`${label}大图`}>
      <div className="mermaid-overlay-bar">
        <span>{label}</span>
        <div className="mermaid-zoom">
          <button type="button" onClick={() => setZoom((value) => Math.max(0.5, Math.round((value - 0.25) * 100) / 100))} aria-label="缩小"><ZoomOut size={14} /></button>
          <b>{Math.round(zoom * 100)}%</b>
          <button type="button" onClick={() => setZoom((value) => Math.min(4, Math.round((value + 0.25) * 100) / 100))} aria-label="放大"><ZoomIn size={14} /></button>
          <button type="button" onClick={() => setZoom(1)}>重置</button>
          <button type="button" className="mermaid-close" onClick={() => setExpanded(false)} aria-label="关闭大图"><X size={16} /></button>
        </div>
      </div>
      <div className="mermaid-overlay-scroll">
        <div className="mermaid-overlay-canvas" style={{ transform: `scale(${zoom})` }} dangerouslySetInnerHTML={{ __html: current.svg }} />
      </div>
    </div>}
  </figure>;
}
