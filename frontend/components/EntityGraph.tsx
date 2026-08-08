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

const TYPE_COLORS: Record<string, string> = {
  Person: "#e74c3c",
  Organization: "#3498db",
  Concept: "#2ecc71",
  Product: "#f39c12",
  Event: "#9b59b6",
  Location: "#1abc9c",
  Metric: "#e67e22",
};

export default function EntityGraph({ entities }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || entities.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth || 600;
    const height = 400;

    // Group entities by type and create nodes
    const nodes = entities.map((e, i) => ({
      id: i,
      name: e.name,
      type: e.type,
      confidence: e.confidence,
      radius: 8 + e.confidence * 16, // size based on confidence
    }));

    // Create links between entities sharing source_url
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
      .force(
        "link",
        d3
          .forceLink(links)
          .distance(60)
          .strength(0.3)
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((d: any) => d.radius + 4));

    const g = svg.append("g");

    // Draw links
    const link = g
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#555")
      .attr("stroke-opacity", 0.3)
      .attr("stroke-width", 1);

    // Draw nodes
    const node = g
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => TYPE_COLORS[d.type] || "#95a5a6")
      .attr("stroke", "#2c2c2c")
      .attr("stroke-width", 1.5)
      .call(
        d3
          .drag<SVGCircleElement, any>()
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

    // Labels
    const labels = g
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text((d) => d.name)
      .attr("font-size", (d) => 8 + d.confidence * 4)
      .attr("dx", (d) => d.radius + 4)
      .attr("dy", 3)
      .attr("fill", "#e0e0e0");

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);

      labels.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
    });

    return () => {
      simulation.stop();
    };
  }, [entities]);

  if (entities.length === 0) return null;

  // Legend
  const types = [...new Set(entities.map((e) => e.type))];

  return (
    <div>
      <svg
        ref={svgRef}
        className="w-full border border-border rounded-lg bg-card"
        style={{ minHeight: 400 }}
        viewBox="0 0 600 400"
        preserveAspectRatio="xMidYMid meet"
      />
      <div className="flex flex-wrap gap-3 mt-3">
        {types.map((type) => (
          <div key={type} className="flex items-center gap-1.5 text-xs">
            <span
              className="w-3 h-3 rounded-full inline-block"
              style={{ backgroundColor: TYPE_COLORS[type] || "#95a5a6" }}
            />
            {type}
          </div>
        ))}
      </div>
    </div>
  );
}