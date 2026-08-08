"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getHistory } from "@/lib/api";
import { downloadMarkdown, downloadPDF } from "@/lib/export";

interface HistoryItem {
  id: string;
  query: string;
  entities_found: number;
  gaps_count: number;
  model_used: string;
  created_at: string;
}

const API_BASE = "http://localhost:8000";

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    const data = await getHistory();
    setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  };

  const deleteOne = async (id: string) => {
    setActionLoading(id);
    await fetch(`${API_BASE}/api/history/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setActionLoading(null);
  };

  const bulkDelete = async () => {
    if (selected.size === 0 || !confirm(`Delete ${selected.size} records?`)) return;
    const ids = [...selected];
    await fetch(`${API_BASE}/api/history/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setItems((prev) => prev.filter((i) => !selected.has(i.id)));
    setSelected(new Set());
  };

  const bulkExport = async (format: "md" | "pdf") => {
    const ids = selected.size > 0 ? [...selected] : [items[0]?.id].filter(Boolean);
    if (!ids.length) return;

    for (const id of ids) {
      setActionLoading(id);
      const resp = await fetch(`${API_BASE}/api/history/${id}`);
      const report = await resp.json();
      const data = report.result_json;
      if (format === "md") {
        downloadMarkdown({ id, query: data.query, ...data });
      } else {
        await downloadPDF({ id, query: data.query, ...data });
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    setActionLoading(null);
  };

  if (loading) return <div className="p-8 text-center">Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">📜 Analysis History</h1>
        <span className="text-sm text-muted-foreground">{items.length} records</span>
      </div>

      {items.length > 0 && (
        <Card className="border-border/50 bg-muted/20">
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleAll} className="rounded" />
              All
            </label>
            <span className="text-xs text-muted-foreground">
              {selected.size > 0 ? `Selected: ${selected.size}` : "Select records"}
            </span>
            <div className="flex-1" />
            <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => bulkExport("md")}>
              📄 Download MD
            </Button>
            <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => bulkExport("pdf")}>
              📕 Download PDF
            </Button>
            <Button size="sm" variant="destructive" disabled={selected.size === 0} onClick={bulkDelete}>
              🗑 Delete ({selected.size})
            </Button>
          </CardContent>
        </Card>
      )}

      {items.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No analyses yet. <Link href="/" className="text-primary hover:underline">Run your first one</Link>
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="p-3 w-8"></th>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Query</th>
              <th className="text-center p-3">Entities</th>
              <th className="text-center p-3">Gaps</th>
              <th className="text-left p-3">Model</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="p-3">
                  <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} className="rounded" />
                </td>
                <td className="p-3 text-muted-foreground text-xs">
                  {new Date(item.created_at).toLocaleString("en-US")}
                </td>
                <td className="p-3 font-medium max-w-[200px] truncate" title={item.query}>{item.query}</td>
                <td className="p-3 text-center"><Badge variant="secondary">{item.entities_found}</Badge></td>
                <td className="p-3 text-center">
                  <Badge variant={item.gaps_count > 0 ? "destructive" : "secondary"}>{item.gaps_count}</Badge>
                </td>
                <td className="p-3 text-muted-foreground text-xs">{item.model_used}</td>
                <td className="p-3">
                  <div className="flex items-center justify-end gap-1">
                    <Link href={`/report/${item.id}`} className="text-primary hover:underline text-xs px-2 py-1">Open</Link>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-red-400"
                      onClick={() => deleteOne(item.id)} disabled={actionLoading === item.id}>
                      {actionLoading === item.id ? "..." : "🗑"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}