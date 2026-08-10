"use client";

import { Badge } from "@/components/ui/badge";
import { ChevronDown, ExternalLink } from "lucide-react";

interface Entity {
  name: string;
  type?: string;
  confidence?: number;
  description?: string;
}

interface CompetitorPage {
  url: string;
  title: string;
  position: number;
  engine: string;
  entities?: Entity[];
}

interface Props {
  pages: CompetitorPage[];
}

export default function CompetitorEntities({ pages }: Props) {
  const emptyCount = pages.filter((p) => !p.entities?.length).length;

  return (
    <div className="space-y-3">
      {emptyCount > 0 && (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠ {emptyCount} of {pages.length} pages have <b>0 entities</b> — text extracted, but NER didn't return anything.
        </div>
      )}

      {pages.map((p, i) => {
        const entities = p.entities || [];
        const empty = entities.length === 0;
        return (
          <details
            key={i}
            className="group bg-card rounded-lg border border-border/60 shadow-card overflow-hidden"
          >
            <summary className="flex items-center gap-2 p-3 cursor-pointer list-none hover:bg-muted/40 transition-colors">
              <span className="text-[11px] font-bold text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                #{p.position}
              </span>
              <span className="text-[11px] font-medium text-muted-foreground uppercase">
                {p.engine}
              </span>
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-sm font-semibold text-primary hover:underline truncate flex-1 min-w-0"
              >
                {p.title || p.url}
                <ExternalLink className="inline-block w-3 h-3 ml-1 mb-0.5" />
              </a>
              <Badge
                variant={empty ? "destructive" : "secondary"}
                className="text-[11px] font-medium shrink-0"
              >
                {entities.length} entities
              </Badge>
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-180" />
            </summary>

            <div className="px-3 pb-3 border-t border-border/40">
              {empty ? (
                <div className="py-3 text-xs text-red-500">
                  No entities extracted for this page.
                </div>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {entities.map((e, j) => (
                    <li
                      key={j}
                      className="flex items-baseline gap-2 text-sm py-1 border-b border-border/30 last:border-0"
                    >
                      <span className="font-semibold text-foreground">
                        {e.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground uppercase shrink-0">
                        {e.type || "Concept"}
                      </span>
                      {typeof e.confidence === "number" && (
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {Math.round(e.confidence * 100)}%
                        </span>
                      )}
                      {e.description && (
                        <span className="text-xs text-muted-foreground truncate min-w-0">
                          — {e.description}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}