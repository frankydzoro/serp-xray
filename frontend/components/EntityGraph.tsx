"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";

interface Entity {
  name: string;
  type: string;
  confidence: number;
  source_url: string;
}

interface Props {
  entities: Entity[];
}

const TYPE_COLORS: Record<string, { fill: string; stroke: string }> = {
  Person:      { fill: "#FEE2E2", stroke: "#EF4444" },
  Organization:{ fill: "#DBEAFE", stroke: "#2563EB" },
  Concept:     { fill: "#D1FAE5", stroke: "#10B981" },
  Product:     { fill: "#FEF3C7", stroke: "#F59E0B" },
  Event:       { fill: "#EDE9FE", stroke: "#8B5CF6" },
  Location:    { fill: "#CCFBF1", stroke: "#14B8A6" },
  Metric:      { fill: "#FFEDD5", stroke: "#F97316" },
};

const FALLBACK = { fill: "#F1F5F9", stroke: "#94A3B8" };

export default function EntityGraph({ entities }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || entities.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth || 600;
    const height = 420;

    const nodes = entities.map((e, i) => ({
      id: i,
      name: e.name,
      type: e.type,
      confidence: e.confidence,
      radius: 10 + e.confidence * 18,
    }));

    const links: { source: number; target: number }[] = [];
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        if (entities[i].source_url === entities[j].source_url) {
          links.push({ source: i, target: j });
        }
      }
    }

    const simulation = d3
      .forceSimulation(nodes as any)
      .force("link", d3.forceLink(links).distance(70).strength(0.25))
      .force("charge", d3.forceManyBody().strength(-250))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((d: any) => d.radius + 6));

    const g = svg.append("g");

    // Links
    g.selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#CBD5E1")
      .attr("stroke-opacity", 0.5)
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3");

    // Nodes group
    const node = g
      .selectAll("g")
      .data(nodes)
      .join("g")
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

    // Node circle
    node
      .append("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => (TYPE_COLORS[d.type] || FALLBACK).fill)
      .attr("stroke", (d) => (TYPE_COLORS[d.type] || FALLBACK).stroke)
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.6);

    // Node label
    node
      .append("text")
      .text((d) => d.name)
      .attr("text-anchor", "middle")
      .attr("dy", "0.3em")
      .attr("font-size", (d) => Math.max(9, 8 + d.confidence * 5))
      .attr("font-weight", "600")
      .attr("font-family", "Plus Jakarta Sans, system-ui, sans-serif")
      .attr("fill", "#334155")
      .attr("pointer-events", "none");

    // Title on hover
    node.append("title").text((d) => `${d.name} [${d.type}] — confidence: ${(d.confidence * 100).toFixed(0)}%`);

    simulation.on("tick", () => {
      g.selectAll<SVGGElement, any>("g").attr("transform", (d) => `translate(${d.x},${d.y})`);

      g.selectAll<SVGLineElement, any>("line")
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
    });

    return () => {
      simulation.stop();
    };
  }, [entities]);

  if (entities.length === 0) return null;

  const types = [...new Set(entities.map((e) => e.type))];

  return (
    <div>
      <svg
        ref={svgRef}
        className="w-full rounded-lg bg-white"
        style={{ minHeight: 420 }}
      />
      {/* Legend */}
      <div className="flex flex-wrap gap-2 mt-3">
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
    </div>
  );
}