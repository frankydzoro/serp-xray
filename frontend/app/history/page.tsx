"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getHistory } from "@/lib/api";

interface HistoryItem {
  id: string;
  query: string;
  entities_found: number;
  gaps_count: number;
  model_used: string;
  created_at: string;
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHistory().then(setItems).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center">Загрузка...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">📜 История анализов</h1>

      {items.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            Пока нет ни одного анализа.{" "}
            <Link href="/" className="text-primary hover:underline">
              Запустите первый
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left p-3">Дата</th>
              <th className="text-left p-3">Запрос</th>
              <th className="text-center p-3">Сущности</th>
              <th className="text-center p-3">Разрывы</th>
              <th className="text-left p-3">Модель</th>
              <th className="text-right p-3">Действие</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="p-3 text-muted-foreground">
                  {new Date(item.created_at).toLocaleString("ru-RU")}
                </td>
                <td className="p-3 font-medium max-w-xs truncate">{item.query}</td>
                <td className="p-3 text-center">
                  <Badge variant="secondary">{item.entities_found}</Badge>
                </td>
                <td className="p-3 text-center">
                  <Badge variant={item.gaps_count > 0 ? "destructive" : "secondary"}>
                    {item.gaps_count}
                  </Badge>
                </td>
                <td className="p-3 text-muted-foreground text-xs">{item.model_used}</td>
                <td className="p-3 text-right">
                  <Link
                    href={`/report/${item.id}`}
                    className="text-primary hover:underline text-sm"
                  >
                    Открыть →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}