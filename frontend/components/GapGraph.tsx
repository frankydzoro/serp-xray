"use client";

import { useEffect, useMemo, useRef, useCallback } from "react";
import * as d3 from "d3";

/* ── Types ─────────────────────────────────── */
interface FoundUrl {
  url?: string;
  title?: string;
  position?: number;
  engine?: string;
}

export interface GapGraphGap {
  entity: string;
  entity_type?: string;
  priority?: string;
  frequency?: number;
  description?: string;
  competitor_description?: string;
  found_on_urls?: FoundUrl[];
}

interface Props {
  gaps: GapGraphGap[];
}

const COMPETITOR_FILL = "#DBEAFE";
const COMPETITOR_STROKE = "#2563EB";
const GAP_FILL = "#FEF2F2";
const GAP_STROKE = "#ef4444";

const PRIORITY_LABEL: Record<string, string> = {
  critical: "Критический",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};
const PRIORITY_COLOR: Record<string, string> = {
  critical: "#991b1b",
  high: "#b91c1c",
  medium: "#c2410c",
  low: "#92400e",
};

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/* ── Component ──────────────────────────────── */
export default function GapGraph({ gaps }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<d3.Simulation<any, any> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, any> | null>(null);

  /* ── Build bipartite nodes/links ── */
  const { nodes, links } = useMemo(() => {
    const nodeList: any[] = [];
    const linkList: { source: string; target: string }[] = [];
    const compMap = new Map<string, any>();

    for (const g of gaps || []) {
      const gapId = `gap:${g.entity}`;
      nodeList.push({
        id: gapId,
        kind: "gap",
        name: g.entity,
        type: g.entity_type || "Concept",
        priority: g.priority || "medium",
        frequency: g.frequency || 1,
        description: g.competitor_description || g.description || "",
      });
      for (const u of g.found_on_urls || []) {
        const url = (u.url || "").trim();
        if (!url) continue;
        const key = `url:${url}`;
        if (!compMap.has(key)) {
          compMap.set(key, {
            id: key,
            kind: "competitor",
            name: hostname(url),
            title: u.title || hostname(url),
            url,
            position: u.position,
            engine: u.engine,
          });
          nodeList.push(compMap.get(key));
        }
        linkList.push({ source: gapId, target: key });
      }
    }
    return { nodes: nodeList, links: linkList };
  }, [gaps]);

  /* ── Build graph ── */
  useEffect(() => {
    const svgEl = svgRef.current;
    const tooltipEl = tooltipRef.current;
    if (!svgEl || !tooltipEl) return;
    if (nodes.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const width = svgEl.clientWidth || 700;
    const height = 520;
    const hasCompetitors = nodes.some((d: any) => d.kind === "competitor");

    // Gap radius by frequency (14..30), competitor fixed
    nodes.forEach((d: any) => {
      d.radius = d.kind === "gap" ? 14 + Math.log(Math.max(1, d.frequency)) * 7 : 22;
    });

    // Simulation with column pinning (competitors left / gaps right)
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d: any) => d.id)
          .distance(70)
          .strength(0.25)
      )
      .force("charge", d3.forceManyBody().strength(-220))
      .force(
        "x",
        d3
          .forceX<any>((d: any) => (d.kind === "competitor" ? width * 0.22 : width * 0.78))
          .strength(hasCompetitors ? 0.5 : 0)
      )
      .force("y", d3.forceY(height / 2).strength(0.12))
      .force(
        "collision",
        d3.forceCollide<any>().radius((d: any) =>
          d.kind === "competitor" ? d.radius + 30 : d.radius + 10
        )
      );
    simRef.current = simulation;

    // Zoom
    const zoom = d3
      .zoom<SVGSVGElement, any>()
      .scaleExtent([0.2, 5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });
    svg.call(zoom);
    zoomRef.current = zoom;

    const g = svg.append("g");

    // ── Links ──
    g.selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#94a3b8")
      .attr("stroke-opacity", 0.45)
      .attr("stroke-width", 1.2);

    // ── Competitor nodes (rects) ──
    const dragBehavior = d3
      .drag<any, any>()
      .on("start", (event, d: any) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d: any) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d: any) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }) as any;

    const competitor = g
      .selectAll("g.competitor")
      .data(nodes.filter((d: any) => d.kind === "competitor"))
      .join("g")
      .attr("class", "competitor")
      .style("cursor", "pointer")
      .on("click", (_event, d: any) => {
        window.open(d.url, "_blank", "noopener");
      })
      .call(dragBehavior);

    competitor
      .append("rect")
      .attr("x", -52)
      .attr("y", -15)
      .attr("width", 104)
      .attr("height", 30)
      .attr("rx", 8)
      .attr("fill", COMPETITOR_FILL)
      .attr("stroke", COMPETITOR_STROKE)
      .attr("stroke-width", 1.5);

    competitor
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", 10)
      .attr("font-weight", 600)
      .attr("font-family", "Plus Jakarta Sans, system-ui, sans-serif")
      .attr("fill", "#1e3a8a")
      .attr("pointer-events", "none")
      .text((d: any) => truncate(d.name, 16));

    // ── Gap nodes (circles) ──
    const gapNode = g
      .selectAll("g.gap")
      .data(nodes.filter((d: any) => d.kind === "gap"))
      .join("g")
      .attr("class", "gap")
      .call(dragBehavior);

    gapNode
      .append("circle")
      .attr("r", (d: any) => d.radius)
      .attr("fill", GAP_FILL)
      .attr("stroke", GAP_STROKE)
      .attr("stroke-width", 2.5)
      .attr("stroke-dasharray", "4,2")
      .attr("stroke-opacity", 0.8);

    gapNode
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.3em")
      .attr("font-size", (d: any) => Math.max(8.5, 11 - d.name.length * 0.2))
      .attr("font-weight", 600)
      .attr("font-family", "Plus Jakarta Sans, system-ui, sans-serif")
      .attr("fill", "#7f1d1d")
      .attr("pointer-events", "none")
      .text((d: any) => truncate(d.name, 14));

    // ── Tooltips ──
    // БЕЗОПАСНОСТЬ: контент (заголовки/URL/описания) приходит с произвольных сайтов
    // и от LLM — рендерим ТОЛЬКО через textContent, никакого innerHTML (stored XSS).
    const showTooltip = (event: any, d: any) => {
      tooltipEl.innerHTML = ""; // чистый контейнер, строковых HTML-вставок ниже нет
      const box = document.createElement("div");
      box.style.cssText = "font-size:12px;line-height:1.5;max-width:280px";

      const textSpan = (text: string | undefined, style: string) => {
        const el = document.createElement("span");
        el.style.cssText = style;
        el.textContent = text ?? "";
        return el;
      };

      if (d.kind === "competitor") {
        const strong = document.createElement("strong");
        strong.textContent = d.title || d.name || "";
        box.appendChild(strong);
        box.appendChild(document.createElement("br"));
        box.appendChild(textSpan(d.url, "color:#64748b;word-break:break-all"));
        box.appendChild(document.createElement("br"));
        const meta: string[] = [];
        if (d.position) meta.push(`Позиция ${d.position}`);
        if (d.engine) meta.push(String(d.engine));
        meta.push("клик, чтобы открыть");
        box.appendChild(textSpan(meta.join(" · "), "color:#475569;font-size:11px"));
      } else {
        const pl = PRIORITY_LABEL[d.priority] || d.priority || "gap";
        box.style.fontSize = "13px";
        const strong = document.createElement("strong");
        strong.textContent = d.name || "";
        box.appendChild(strong);
        const badge = document.createElement("span");
        badge.style.cssText =
          `background:#fef2f2;color:${PRIORITY_COLOR[d.priority] || "#dc2626"};` +
          "padding:1px 6px;border-radius:3px;font-size:10px;margin-left:4px";
        badge.textContent = pl;
        box.appendChild(badge);
        box.appendChild(document.createElement("br"));
        const typeParts: string[] = [];
        if (d.type) typeParts.push(String(d.type));
        if (d.frequency) typeParts.push(`${d.frequency} стр.`);
        box.appendChild(textSpan(typeParts.join(" · "), "color:#64748b"));
        if (d.description) {
          box.appendChild(document.createElement("br"));
          box.appendChild(
            textSpan(String(d.description).slice(0, 160), "color:#475569;font-size:11px")
          );
        }
      }
      tooltipEl.appendChild(box);
      tooltipEl.style.display = "block";
      tooltipEl.style.opacity = "1";
    };
    const moveTooltip = (event: any) => {
      tooltipEl.style.left = `${event.clientX + 12}px`;
      tooltipEl.style.top = `${event.clientY - 12}px`;
    };
    const hideTooltip = () => {
      tooltipEl.style.display = "none";
      tooltipEl.style.opacity = "0";
    };

    competitor
      .on("mouseover", (event: any, d: any) => showTooltip(event, d))
      .on("mousemove", moveTooltip)
      .on("mouseout", hideTooltip);
    gapNode
      .on("mouseover", (event: any, d: any) => showTooltip(event, d))
      .on("mousemove", moveTooltip)
      .on("mouseout", hideTooltip);

    // ── Tick ──
    simulation.on("tick", () => {
      g.selectAll<SVGGElement, any>("g.competitor").attr("transform", (d: any) => `translate(${d.x},${d.y})`);
      g.selectAll<SVGGElement, any>("g.gap").attr("transform", (d: any) => `translate(${d.x},${d.y})`);
      g.selectAll<SVGLineElement, any>("line")
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
    });

    return () => {
      simulation.stop();
      simRef.current = null;
    };
  }, [nodes, links]);

  /* ── Zoom buttons ── */
  const handleZoomIn = useCallback(() => {
    const svgEl = svgRef.current;
    const zoom = zoomRef.current;
    if (!svgEl || !zoom) return;
    d3.select(svgEl).transition().duration(200).call(zoom.scaleBy, 1.3);
  }, []);

  const handleZoomOut = useCallback(() => {
    const svgEl = svgRef.current;
    const zoom = zoomRef.current;
    if (!svgEl || !zoom) return;
    d3.select(svgEl).transition().duration(200).call(zoom.scaleBy, 0.7);
  }, []);

  const handleZoomReset = useCallback(() => {
    const svgEl = svgRef.current;
    const zoom = zoomRef.current;
    if (!svgEl || !zoom) return;
    d3.select(svgEl).transition().duration(300).call(zoom.transform, d3.zoomIdentity);
  }, []);

  /* ── Empty state ── */
  if (nodes.length === 0) return null;

  return (
    <div className="relative">
      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="fixed z-50 hidden bg-white border border-border rounded-lg shadow-lg p-3 pointer-events-none"
        style={{ maxWidth: 300 }}
      />

      {/* SVG */}
      <svg ref={svgRef} className="w-full rounded-lg bg-white" style={{ minHeight: 520 }} />

      {/* ── Controls ── */}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <div className="flex items-center gap-1 bg-muted/40 rounded-lg px-1.5 py-1">
          <button
            onClick={handleZoomOut}
            className="w-7 h-7 flex items-center justify-center rounded-md text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Zoom out"
          >
            −
          </button>
          <button
            onClick={handleZoomReset}
            className="text-[10px] text-muted-foreground hover:text-foreground px-1 transition-colors"
            title="Reset zoom"
          >
            ↺
          </button>
          <button
            onClick={handleZoomIn}
            className="w-7 h-7 flex items-center justify-center rounded-md text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap gap-4 mt-3">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full">
          <span
            className="w-3 h-3 rounded"
            style={{ backgroundColor: COMPETITOR_FILL, border: `1.5px solid ${COMPETITOR_STROKE}` }}
          />
          Конкуренты (клик — открыть)
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full">
          <span
            className="w-3 h-3 rounded-full border-2 border-dashed"
            style={{ borderColor: GAP_STROKE, backgroundColor: GAP_FILL }}
          />
          Разрывы (gap)
        </div>
      </div>
    </div>
  );
}