"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import RewriteModal from "@/components/RewriteModal";
import { getHistory, getReport } from "@/lib/api";
import { downloadMarkdown, downloadPDF, downloadRewrittenMD } from "@/lib/export";

interface HistoryItem {
  id: string;
  query: string;
  entities_found: number;
  gaps_count: number;
  model_used: string;
  status: string;
  stage: string;
  created_at: string;
  has_rewrite?: boolean;
  rewrite_status?: string;
}

const API_BASE = "http://localhost:8000";

/* ── Empty state ──────────────────────────── */
function EmptyHistory() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mb-4">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="text-muted-foreground"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-foreground mb-1">
        No analyses yet
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        Run your first analysis to see it here.
      </p>
      <Link
        href="/"
        className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition-colors"
      >
        New Analysis
      </Link>
    </div>
  );
}

/* ── Date formatter ───────────────────────── */
function fmtDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

/* ── Main page ────────────────────────────── */
export default function HistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rewriteData, setRewriteData] = useState<{ articleText: string; gaps: any[]; analysisId?: string; querySlug?: string } | null>(null);
  const [rewriteLoadingId, setRewriteLoadingId] = useState<string | null>(null);
  const [rewritingIds, setRewritingIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const loadHistory = useCallback(async () => {
    setLoading(true);
    const data = await getHistory();
    setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Auto-refresh while there are running analyses
  useEffect(() => {
    const hasRunning = items.some(
      (i) => i.status === "running" || i.rewrite_status === "running"
    );
    if (!hasRunning) return;
    const interval = setInterval(loadHistory, 3000);
    return () => clearInterval(interval);
  }, [items, loadHistory]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.query.toLowerCase().includes(q) ||
        i.model_used.toLowerCase().includes(q)
    );
  }, [items, search]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((i) => i.id)));
    }
  };

  const deleteOne = async (id: string) => {
    setActionLoading(id);
    await fetch(`${API_BASE}/api/history/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelected((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    setActionLoading(null);
  };

  const bulkDelete = async () => {
    if (selected.size === 0 || !confirm(`Delete ${selected.size} records?`))
      return;
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
    const ids =
      selected.size > 0 ? [...selected] : [filtered[0]?.id].filter(Boolean);
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

  const handleRewrite = async (itemId: string) => {
    setRewriteLoadingId(itemId);
    try {
      const report = await getReport(itemId);
      const data = report.result_json || {};
      if (data.user_page_text && data.gaps?.length > 0) {
        setRewriteData({
          articleText: data.user_page_text,
          gaps: data.gaps,
          analysisId: itemId,
          querySlug: data.query || itemId,
        });
      }
    } catch {
      // silently fail, user can retry
    }
    setRewriteLoadingId(null);
  };

  const handleDownloadRewriteMD = async (itemId: string) => {
    setActionLoading(itemId);
    try {
      const report = await getReport(itemId);
      const data = report.result_json || {};
      const rewrittenText = report.rewritten_text || "";
      const articleText = data.user_page_text || "";
      if (rewrittenText && articleText) {
        downloadRewrittenMD(articleText, rewrittenText, data.query || itemId);
      }
    } catch {
      // silently fail
    }
    setActionLoading(null);
  };

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">History</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {items.length} {items.length === 1 ? "analysis" : "analyses"}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <Input
            placeholder="Search queries or models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Bulk toolbar */}
      {items.length > 0 && (
        <div className="sticky top-14 z-40 -mx-6 px-6 py-2 bg-background/80 backdrop-blur border-b border-border/40">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] font-medium cursor-pointer select-none text-muted-foreground hover:text-foreground transition-colors">
              <input
                type="checkbox"
                checked={
                  selected.size === filtered.length && filtered.length > 0
                }
                onChange={toggleAll}
                className="rounded"
              />
              {selected.size > 0 ? `${selected.size} selected` : "Select all"}
            </label>
            <div className="flex-1" />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={selected.size === 0}
                onClick={() => bulkExport("md")}
              >
                MD
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={selected.size === 0}
                onClick={() => bulkExport("pdf")}
              >
                PDF
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={selected.size === 0}
                onClick={bulkDelete}
              >
                Delete ({selected.size || 0})
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Empty */}
      {filtered.length === 0 && !loading && (
        search ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No results for "{search}"
          </div>
        ) : (
          <EmptyHistory />
        )
      )}

      {/* Card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((item) => (
          <Card
            key={item.id}
            className={`group shadow-card hover:shadow-elevated transition-all duration-200 cursor-pointer border-border/50 ${
              selected.has(item.id) ? "ring-2 ring-primary border-primary/30" : ""
            }`}
            onClick={() => toggleSelect(item.id)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold leading-snug line-clamp-2 flex-1">
                  {item.query}
                </h3>
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                />
              </div>

              <div className="flex items-center gap-2 mb-3">
                {item.status === "running" ? (
                  <Badge className="text-[11px] font-medium bg-amber-100 text-amber-700 border-amber-200">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse mr-1.5" />
                    {item.stage || "running"}...
                  </Badge>
                ) : item.status === "failed" ? (
                  <Badge variant="destructive" className="text-[11px] font-medium">
                    Failed
                  </Badge>
                ) : (
                  <>
                    <Badge variant="secondary" className="text-[11px] font-medium">
                      {item.entities_found} entities
                    </Badge>
                    {item.gaps_count > 0 ? (
                      <Badge variant="destructive" className="text-[11px] font-medium">
                        {item.gaps_count} gaps
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="text-[11px] font-medium bg-emerald-100 text-emerald-700 border-emerald-200"
                      >
                        No gaps
                      </Badge>
                    )}
                    {item.has_rewrite && (
                      <Badge className="text-[11px] font-medium bg-violet-100 text-violet-700 border-violet-200">
                        Rewritten
                      </Badge>
                    )}
                    {(rewritingIds.has(item.id) || item.rewrite_status === "running") && (
                      <Badge className="text-[11px] font-medium bg-amber-100 text-amber-700 border-amber-200">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse mr-1.5" />
                        Generating…
                      </Badge>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  {fmtDate(item.created_at)}
                </span>
                <span className="text-[11px] text-muted-foreground font-mono">
                  {item.model_used?.split("/").pop()}
                </span>
              </div>

              {/* Hover actions */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-border/50 opacity-0 group-hover:opacity-100 transition-opacity">
                <Link
                    href={item.status === "running" ? `/?id=${item.id}` : `/report/${item.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex h-7 flex-1 items-center justify-center rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    {item.status === "running" ? "View" : "Open"}
                  </Link>
                {item.status === "completed" && item.gaps_count > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRewrite(item.id);
                    }}
                    disabled={rewriteLoadingId === item.id || rewritingIds.has(item.id)}
                  >
                    {rewritingIds.has(item.id) ? "Rewriting…" : rewriteLoadingId === item.id ? "..." : "Rewrite"}
                  </Button>
                )}
                {item.status === "completed" && item.has_rewrite && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground hover:text-violet-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownloadRewriteMD(item.id);
                    }}
                    disabled={actionLoading === item.id}
                  >
                    MD
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteOne(item.id);
                  }}
                  disabled={actionLoading === item.id}
                >
                  {actionLoading === item.id ? "..." : "Delete"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Rewrite modal (lazy-loaded from history) */}
      {rewriteData && (
        <RewriteModal
          articleText={rewriteData.articleText}
          gaps={rewriteData.gaps}
          analysisId={rewriteData.analysisId}
          querySlug={rewriteData.querySlug}
          autoStart
          onStatusChange={(status) => {
            const aid = rewriteData.analysisId;
            if (!aid) return;
            if (status === "loading") {
              setRewritingIds((prev) => new Set(prev).add(aid));
            } else if (status === "done") {
              setRewritingIds((prev) => {
                const next = new Set(prev);
                next.delete(aid);
                return next;
              });
              // Refresh history to get has_rewrite flag
              loadHistory();
              setRewriteData(null);
            } else if (status === "error") {
              setRewritingIds((prev) => {
                const next = new Set(prev);
                next.delete(aid);
                return next;
              });
              setRewriteData(null);
            }
          }}
        />
      )}
    </div>
  );
}