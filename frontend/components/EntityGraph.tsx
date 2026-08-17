"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";

/* ── Types ─────────────────────────────────── */
interface GraphEntity {
  name: string;
  type: string;
  confidence: number;
  frequency: number;
  owner: "user" | "competitor" | "gap";
  isGap?: boolean;
  priority?: string;
  description?: string;
  source_urls?: string[];
}

interface Props {
  entities: GraphEntity[];
  cooccurrence?: Record<string, number>;
  typedEdges?: Array<{ source: string; target: string; weight: number; type: string }>;
  showFilter?: boolean;
}

/* ── Colors ────────────────────────────────── */
const TYPE_COLORS: Record<string, { fill: string; stroke: string }> = {
  Person:       { fill: "#FEE2E2", stroke: "#EF4444" },
  Organization: { fill: "#DBEAFE", stroke: "#2563EB" },
  Concept:      { fill: "#D1FAE5", stroke: "#10B981" },
  Product:      { fill: "#FEF3C7", stroke: "#F59E0B" },
  Event:        { fill: "#EDE9FE", stroke: "#8B5CF6" },
  Location:     { fill: "#CCFBF1", stroke: "#14B8A6" },
  Metric:       { fill: "#FFEDD5", stroke: "#F97316" },
};
const FALLBACK = { fill: "#F1F5F9", stroke: "#94A3B8" };

const OWNER_BORDER: Record<string, string> = {
  user: "#22c55e",
  competitor: "#3b82f6",
  gap: "#ef4444",
};

/* ── Constants ─────────────────────────────── */
const TOP_N = 50;

/* ── Component ─────────────────────────────── */
export default function EntityGraph({ entities, cooccurrence, typedEdges, showFilter = false }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<d3.Simulation<any, any> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, any> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, any, null, undefined> | null>(null);

  const [showAll, setShowAll] = useState(false);
  const [repulsion, setRepulsion] = useState(-280);
  const [attraction, setAttraction] = useState(0.2);

  const effectiveEntities = (() => {
    if (entities.length <= TOP_N || showAll) return entities;
    return [...entities]
      .sort((a, b) => {
        const scoreA = (a.frequency || 1) * (a.confidence || 0.5) + (a.isGap ? 3 : 0);
        const scoreB = (b.frequency || 1) * (b.confidence || 0.5) + (b.isGap ? 3 : 0);
        return scoreB - scoreA;
      })
      .slice(0, TOP_N);
  })();

  /* ── Build graph (runs when data changes) ── */
  useEffect(() => {
    const svgEl = svgRef.current;
    const tooltipEl = tooltipRef.current;
    if (!svgEl || !tooltipEl) return;
    if (effectiveEntities.length === 0) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const width = svgEl.clientWidth || 700;
    const height = 500;

    // ── Build nodes ──
    const nodes = effectiveEntities.map((e, i) => ({
      id: i,
      ...e,
      radius: Math.log((e.frequency || 1) + 1) * (e.confidence || 0.5) * 18 + 6,
    }));

    // ── Build links ──
    const maxWeight = typedEdges
      ? Math.max(1, ...typedEdges.map((e) => e.weight))
      : cooccurrence
        ? Math.max(1, ...Object.values(cooccurrence))
        : 1;

    const edgeTypeMap: Record<string, string> = {};
    if (typedEdges) {
      for (const edge of typedEdges) {
        const pair = [edge.source, edge.target].sort().join("|");
        edgeTypeMap[pair] = edge.type;
      }
    }

    const links: { source: number; target: number; weight: number; edgeType: string }[] = [];
    if (cooccurrence || typedEdges) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const pair = [nodes[i].name.toLowerCase(), nodes[j].name.toLowerCase()].sort();
          const key = pair.join("|");
          const weight = (typedEdges
            ? (typedEdges.find((e) => [e.source, e.target].sort().join("|") === key)?.weight ?? 0)
            : (cooccurrence?.[key] ?? 0));
          if (weight > 0) {
            links.push({
              source: i,
              target: j,
              weight,
              edgeType: edgeTypeMap[key] || "co_occurrence",
            });
          }
        }
      }
    } else {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const urlsI = new Set(nodes[i].source_urls || []);
          const urlsJ = new Set(nodes[j].source_urls || []);
          const shared = [...urlsI].filter((u) => urlsJ.has(u));
          if (shared.length > 0) {
            links.push({ source: i, target: j, weight: shared.length, edgeType: "co_occurrence" });
          }
        }
      }
    }

    // ── Defs: arrow marker ──
    svg.append("defs").append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 20)
      .attr("refY", 5)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", "#f59e0b");

    // ── Simulation (initial forces; sliders update via separate effect) ──
    const simulation = d3
      .forceSimulation(nodes as any)
      .force("link", d3.forceLink(links).distance(70).strength(attraction))
      .force("charge", d3.forceManyBody().strength(repulsion))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((d: any) => d.radius + 10));
    simRef.current = simulation;

    // ── Zoom ──
    const zoom = d3.zoom<SVGSVGElement, any>()
      .scaleExtent([0.2, 5])
      .on("zoom", (event) => {
        g.selectAll("g.node").attr("transform", (d: any) => `translate(${d.x},${d.y})`);
        g.selectAll("line")
          .attr("x1", (d: any) => d.source.x)
          .attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x)
          .attr("y2", (d: any) => d.target.y);
        g.attr("transform", event.transform.toString());
      });
    svg.call(zoom);
    zoomRef.current = zoom;

    const g = svg.append("g");
    gRef.current = g as any;

    // ── Links ──
    g.selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d) => d.edgeType === "parent_child" ? "#f59e0b" : "#94a3b8")
      .attr("stroke-opacity", (d) => Math.min(0.6, (d.weight / maxWeight) * 0.8))
      .attr("stroke-width", (d) => Math.max(1, Math.sqrt(d.weight) * 1.8))
      .attr("stroke-dasharray", (d) => d.edgeType === "parent_child" ? "none" : "3,3")
      .attr("marker-end", (d) => d.edgeType === "parent_child" ? "url(#arrow)" : null);

    // ── Nodes ──
    const node = g
      .selectAll("g.node")
      .data(nodes)
      .join("g")
      .attr("class", "node")
      .call(
        d3
          .drag<SVGGElement, any>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }) as any
      );

    node
      .append("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => {
        const tc = TYPE_COLORS[d.type] || FALLBACK;
        return tc.fill;
      })
      .attr("stroke", (d) => {
        if (d.isGap) return "#ef4444";
        return OWNER_BORDER[d.owner] || FALLBACK.stroke;
      })
      .attr("stroke-width", (d) => (d.isGap ? 3 : 2))
      .attr("stroke-dasharray", (d) => (d.isGap ? "4,2" : "none"))
      .attr("stroke-opacity", 0.7);

    node
      .append("text")
      .text((d) => d.name.length > 18 ? d.name.slice(0, 16) + "…" : d.name)
      .attr("text-anchor", "middle")
      .attr("dy", "0.3em")
      .attr("font-size", (d) => Math.max(9, 7 + d.confidence * 7))
      .attr("font-weight", "600")
      .attr("font-family", "Plus Jakarta Sans, system-ui, sans-serif")
      .attr("fill", "#334155")
      .attr("pointer-events", "none");

    // ── Tooltip ──
    node
      .on("mouseover", (event, d) => {
        const priorityBadge = d.isGap
          ? `<span style="background:#fef2f2;color:#dc2626;padding:1px 6px;border-radius:3px;font-size:10px">⚠ ${d.priority || "gap"}</span>`
          : "";
        const freqText = d.frequency
          ? `found on <strong>${d.frequency}</strong> competitor pages`
          : "";
        const ownerBadge =
          d.owner === "user"
            ? '<span style="color:#22c55e">● yours</span>'
            : d.owner === "gap"
              ? '<span style="color:#ef4444">● gap</span>'
              : '<span style="color:#3b82f6">● competitor</span>';

        tooltipEl.innerHTML = `
          <div style="font-size:13px;line-height:1.5;max-width:260px">
            <strong>${d.name}</strong> ${priorityBadge}<br>
            <span style="color:#64748b">${d.type} · conf: ${(d.confidence * 100).toFixed(0)}%</span><br>
            ${freqText} ${ownerBadge}<br>
            ${d.description ? `<span style="color:#475569;font-size:11px">${d.description.slice(0, 150)}</span>` : ""}
          </div>
        `;
        tooltipEl.style.display = "block";
        tooltipEl.style.opacity = "1";
      })
      .on("mousemove", (event) => {
        tooltipEl.style.left = `${event.clientX + 12}px`;
        tooltipEl.style.top = `${event.clientY - 12}px`;
      })
      .on("mouseout", () => {
        tooltipEl.style.display = "none";
        tooltipEl.style.opacity = "0";
      });

    // ── Tick ──
    simulation.on("tick", () => {
      g.selectAll<SVGGElement, any>("g.node").attr("transform", (d) => `translate(${d.x},${d.y})`);
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
  }, [effectiveEntities, cooccurrence, typedEdges]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Update forces when sliders change (no rebuild) ── */
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.force("charge", d3.forceManyBody().strength(repulsion));
    sim.force("link", d3.forceLink((sim.force("link") as any)?.links?.() || []).distance(70).strength(attraction));
    sim.alpha(0.3).restart();
  }, [repulsion, attraction]);

  /* ── Zoom button handlers ────────────────── */
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

  /* ── Empty state ────────────────────────── */
  if (entities.length === 0) return null;

  /* ── Collect legend info ────────────────── */
  const types = [...new Set(effectiveEntities.map((e) => e.type))];
  const owners = [...new Set(effectiveEntities.map((e) => e.owner))];

  return (
    <div className="relative">
      {/* Filter bar */}
      {showFilter && entities.length > TOP_N && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-muted-foreground">
            Showing {effectiveEntities.length} of {entities.length} entities
          </span>
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            {showAll ? "Top 50" : "All entities"}
          </button>
        </div>
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="fixed z-50 hidden bg-white border border-border rounded-lg shadow-lg p-3 pointer-events-none"
        style={{ maxWidth: 280 }}
      />

      {/* SVG */}
      <svg
        ref={svgRef}
        className="w-full rounded-lg bg-white"
        style={{ minHeight: 500 }}
      />

      {/* ── Controls ────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        {/* Zoom */}
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

        {/* Divider */}
        <div className="w-px h-6 bg-border" />

        {/* Repulsion slider */}
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
            Repulsion
          </label>
          <input
            type="range"
            min={-800}
            max={-50}
            step={10}
            value={repulsion}
            onChange={(e) => setRepulsion(Number(e.target.value))}
            className="w-20 h-1 accent-primary cursor-pointer"
            title={`Repulsion: ${repulsion}`}
          />
        </div>

        {/* Attraction slider */}
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-medium text-muted-foreground whitespace-nowrap">
            Attraction
          </label>
          <input
            type="range"
            min={0.05}
            max={0.8}
            step={0.05}
            value={attraction}
            onChange={(e) => setAttraction(Number(e.target.value))}
            className="w-20 h-1 accent-primary cursor-pointer"
            title={`Attraction: ${attraction}`}
          />
        </div>
      </div>

      {/* ── Legends ─────────────────────────── */}
      <div className="flex flex-wrap gap-4 mt-3">
        {/* Owner legend */}
        <div className="flex flex-wrap gap-2">
          {owners.map((owner) => (
            <div
              key={owner}
              className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full"
            >
              <span
                className="w-3 h-3 rounded-full ring-1 ring-black/10"
                style={{ backgroundColor: OWNER_BORDER[owner] || "#94a3b8" }}
              />
              {owner === "user" ? "Yours" : owner === "gap" ? "Gaps" : "Competitors"}
            </div>
          ))}
        </div>

        {/* Type legend */}
        <div className="flex flex-wrap gap-2">
          {types.map((type) => {
            const c = TYPE_COLORS[type] || FALLBACK;
            return (
              <div
                key={type}
                className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: c.stroke }}
                />
                {type}
              </div>
            );
          })}
        </div>

        {/* Edge type legend */}
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
          <span className="flex items-center gap-1.5 font-medium">
            <svg width="24" height="8" className="shrink-0">
              <line x1="0" y1="4" x2="24" y2="4" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3,3" />
            </svg>
            Co-occurrence
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <svg width="28" height="8" className="shrink-0">
              <line x1="0" y1="4" x2="20" y2="4" stroke="#f59e0b" strokeWidth="2" />
              <polygon points="20,1 28,4 20,7" fill="#f59e0b" />
            </svg>
            Parent → Child
          </span>
        </div>

        {/* Gap node indicator */}
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full">
          <span
            className="w-3 h-3 rounded-full border-2 border-dashed"
            style={{ borderColor: "#ef4444", backgroundColor: "transparent" }}
          />
          Dashed = gap
        </div>
      </div>
    </div>
  );
}