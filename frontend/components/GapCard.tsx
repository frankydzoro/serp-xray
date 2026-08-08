"use client";

import { Badge } from "@/components/ui/badge";
import { ExternalLink, Lightbulb } from "lucide-react";

interface FoundUrl {
  url: string;
  title: string;
  position: number;
}

interface GapItem {
  entity: string;
  entity_type: string;
  priority: string;
  recommendation: string;
  competitor_description: string;
  found_in_competitors: boolean;
  found_in_user_page: boolean;
  found_on_urls: FoundUrl[];
}

interface Props {
  gaps: GapItem[];
}

const PRIORITY_COLORS: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  critical: "destructive",
  high: "destructive",
  medium: "default",
  low: "secondary",
};

const PRIORITY_ACCENT: Record<string, string> = {
  critical: "bg-destructive",
  high: "bg-warning",
  medium: "bg-primary",
  low: "bg-muted-foreground",
};

export default function GapCard({ gaps }: Props) {
  if (gaps.length === 0) {
    return (
      <div className="text-center p-6 text-muted-foreground">
        No gaps found — your page covers all key entities
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {gaps.map((gap, i) => (
        <div
          key={i}
          className="group bg-card rounded-lg border border-border/60 shadow-card overflow-hidden flex transition-shadow hover:shadow-elevated"
        >
          {/* Left accent bar */}
          <div
            className={`w-1 flex-shrink-0 ${PRIORITY_ACCENT[gap.priority] || "bg-muted-foreground"}`}
          />

          <div className="flex-1 p-4 space-y-3 min-w-0">
            {/* ── Header: entity + badges ── */}
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm font-bold text-foreground leading-snug break-words">
                {gap.entity}
              </span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider font-semibold">
                  {gap.entity_type}
                </Badge>
                <Badge variant={PRIORITY_COLORS[gap.priority] || "outline"}>
                  {gap.priority}
                </Badge>
              </div>
            </div>

            {/* ── Description ── */}
            {gap.competitor_description && (
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                {gap.competitor_description}
              </p>
            )}

            {/* ── Recommendation ── */}
            {gap.recommendation && (
              <div className="flex items-start gap-2 rounded-md bg-primary/5 border border-primary/10 p-2.5">
                <Lightbulb className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
                <span className="text-[13px] text-foreground leading-relaxed">
                  {gap.recommendation}
                </span>
              </div>
            )}

            {/* ── Found on URLs ── */}
            {(gap.found_on_urls || []).length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Found on {gap.found_on_urls.length} page{gap.found_on_urls.length !== 1 ? "s" : ""}
                </p>
                <div className="space-y-0.5">
                  {gap.found_on_urls.map((u, j) => (
                    <a
                      key={j}
                      href={u.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group/link flex items-center gap-1.5 text-[12px] text-primary hover:underline min-w-0"
                    >
                      <span className="text-[10px] font-bold text-muted-foreground tabular-nums flex-shrink-0 w-4 text-right">
                        #{u.position}
                      </span>
                      <span className="truncate">{u.title || u.url}</span>
                      <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
