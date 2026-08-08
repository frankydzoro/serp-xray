"use client";

import { Badge } from "@/components/ui/badge";

interface GapItem {
  entity: string;
  entity_type: string;
  priority: string;
  recommendation: string;
  competitor_description: string;
  found_in_competitors: boolean;
  found_in_user_page: boolean;
  found_on_urls: { url: string; title: string; position: number }[];
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

export default function GapTable({ gaps }: Props) {
  if (gaps.length === 0) {
    return (
      <div className="text-center p-6 text-muted-foreground">
        No gaps found — your page covers all key entities
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left p-2">Entity</th>
            <th className="text-left p-2">Type</th>
            <th className="text-left p-2">Description</th>
            <th className="text-left p-2">Priority</th>
            <th className="text-left p-2">Recommendation</th>
            <th className="text-left p-2">Found on URLs</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((gap, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
              <td className="p-2 font-medium">{gap.entity}</td>
              <td className="p-2 text-muted-foreground">{gap.entity_type}</td>
              <td className="p-2 max-w-xs text-muted-foreground text-xs">
                {gap.competitor_description || "—"}
              </td>
              <td className="p-2">
                <Badge variant={PRIORITY_COLORS[gap.priority] || "outline"}>
                  {gap.priority}
                </Badge>
              </td>
              <td className="p-2 max-w-xs">{gap.recommendation}</td>
              <td className="p-2">
                <div className="flex flex-col gap-1">
                  {(gap.found_on_urls || []).slice(0, 5).map((u, j) => (
                    <a
                      key={j}
                      href={u.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline truncate max-w-[250px] block"
                      title={u.url}
                    >
                      #{u.position} {u.title || u.url}
                    </a>
                  ))}
                  {(gap.found_on_urls || []).length === 0 && (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}