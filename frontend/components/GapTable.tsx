"use client";

import { Badge } from "@/components/ui/badge";

interface GapItem {
  entity: string;
  entity_type: string;
  priority: string;
  recommendation: string;
  found_in_top3: boolean;
  found_in_user_page: boolean;
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

const PRIORITY_LABELS: Record<string, string> = {
  critical: "🔴 Критический",
  high: "🟠 Высокий",
  medium: "🟡 Средний",
  low: "⚪ Низкий",
};

export default function GapTable({ gaps }: Props) {
  if (gaps.length === 0) {
    return (
      <div className="text-center p-6 text-muted-foreground">
        Разрывов не обнаружено — страница покрывает все ключевые сущности
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left p-2">Сущность</th>
            <th className="text-left p-2">Тип</th>
            <th className="text-left p-2">Приоритет</th>
            <th className="text-left p-2">Рекомендация</th>
            <th className="text-center p-2">В топ-3</th>
            <th className="text-center p-2">У вас</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((gap, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
              <td className="p-2 font-medium">{gap.entity}</td>
              <td className="p-2 text-muted-foreground">{gap.entity_type}</td>
              <td className="p-2">
                <Badge variant={PRIORITY_COLORS[gap.priority] || "outline"}>
                  {gap.priority}
                </Badge>
              </td>
              <td className="p-2 max-w-xs">{gap.recommendation}</td>
              <td className="p-2 text-center">{gap.found_in_top3 ? "✓" : "—"}</td>
              <td className="p-2 text-center">
                {gap.found_in_user_page ? "✓" : "✗"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}