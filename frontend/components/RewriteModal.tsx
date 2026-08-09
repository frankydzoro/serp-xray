"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import DiffView from "@/components/DiffView";
import { rewriteArticle, getRewriteResult } from "@/lib/api";
import { downloadRewrittenMD } from "@/lib/export";

interface GapItem {
  entity: string;
  entity_type?: string;
  priority?: string;
  competitor_description?: string;
  recommendation?: string;
  [key: string]: unknown;
}

interface Props {
  articleText: string;
  gaps: GapItem[];
  analysisId?: string;
  querySlug?: string;
  /** Родительский компонент может отслеживать статус */
  onStatusChange?: (status: "idle" | "loading" | "done" | "error") => void;
}

type Tab = "original" | "result" | "diff";

export default function RewriteModal({ articleText, gaps, analysisId, querySlug, onStatusChange }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("result");
  const [copied, setCopied] = useState(false);
  // Track if we already checked DB for cached rewrite
  const [checkedCache, setCheckedCache] = useState(false);

  if (gaps.length === 0) return null;

  const notifyStatus = useCallback(
    (s: "idle" | "loading" | "done" | "error") => {
      onStatusChange?.(s);
    },
    [onStatusChange],
  );

  // Check for existing rewrite in DB when modal opens
  useEffect(() => {
    if (!open || !analysisId || checkedCache) return;
    setCheckedCache(true);
    getRewriteResult(analysisId)
      .then((res) => {
        setResult(res.rewritten_text);
        setTab("result");
        notifyStatus("done");
      })
      .catch(() => {
        // No cached rewrite — normal
      });
  }, [open, analysisId, checkedCache, notifyStatus]);

  const handleRewrite = async () => {
    // If we already have a result, just show modal
    if (result) {
      setOpen(true);
      return;
    }

    setOpen(true);
    setLoading(true);
    setError("");
    setTab("result");
    notifyStatus("loading");

    try {
      const res = await rewriteArticle(articleText, gaps, undefined, analysisId);
      setResult(res.rewritten_text);
      notifyStatus("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
      notifyStatus("error");
    }
    setLoading(false);
  };

  const handleClose = () => {
    setOpen(false);
    // Keep result so next open is instant
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.getElementById("rewrite-result") as HTMLTextAreaElement;
      if (textarea) {
        textarea.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  const handleDownloadMD = () => {
    if (!result) return;
    downloadRewrittenMD(articleText, result, querySlug || "rewritten");
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "original", label: "Original" },
    ...(result ? [{ key: "result" as Tab, label: "Result" }] : []),
    ...(result ? [{ key: "diff" as Tab, label: "Diff" }] : []),
  ];

  return (
    <>
      {/* Trigger button + status indicator */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleRewrite}
          disabled={loading}
          className="text-xs font-medium"
        >
          <svg
            className="w-3.5 h-3.5 mr-1.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          {loading
            ? "Rewriting…"
            : result
              ? "View Rewrite"
              : "Rewrite Article"}
        </Button>
        {loading && (
          <span className="text-[11px] text-muted-foreground animate-pulse">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />
            Generating… (you can close the modal, result will be saved)
          </span>
        )}
        {!loading && result && (
          <span className="text-[11px] text-emerald-600">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1" />
            Ready
          </span>
        )}
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Dialog */}
          <div className="relative bg-card border border-border/60 rounded-2xl shadow-elevated w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col mx-4">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-primary"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <h2 className="text-sm font-semibold">
                  {result ? "View Rewrite" : "Rewrite Article"}
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  {gaps.length} gap{gaps.length !== 1 ? "s" : ""}
                </span>
              </div>
              <button
                onClick={handleClose}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              {loading && (
                <div className="flex flex-col items-center justify-center py-16 space-y-4">
                  <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Integrating {gaps.length} gap{gaps.length !== 1 ? "s" : ""} into article…
                  </p>
                  <p className="text-[11px] text-muted-foreground/60">
                    This may take 30–60 seconds. You can close this modal — the result will be saved.
                  </p>
                </div>
              )}

              {error && (
                <div className="p-6">
                  <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-4">
                    <p className="text-sm font-semibold text-destructive mb-1">Error</p>
                    <p className="text-sm text-muted-foreground">{error}</p>
                  </div>
                </div>
              )}

              {result && !loading && (
                <>
                  {/* Tab bar */}
                  <div className="flex items-center gap-1 px-6 py-3 bg-muted/50 border-b border-border/40">
                    {tabs.map((t) => (
                      <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                          tab === t.key
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                    <div className="flex-1" />
                    {tab === "result" && (
                      <>
                        <Button size="sm" variant="outline" onClick={handleCopy} className="text-xs h-7">
                          {copied ? "Copied" : "Copy"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleDownloadMD} className="text-xs h-7 ml-1.5">
                          Download MD
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Tab content */}
                  <div className="flex-1 overflow-y-auto p-6">
                    {tab === "original" && (
                      <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono text-muted-foreground">
                        {articleText}
                      </pre>
                    )}
                    {tab === "result" && (
                      <Textarea
                        id="rewrite-result"
                        value={result}
                        readOnly
                        rows={20}
                        className="font-mono text-xs leading-relaxed resize-y min-h-[300px]"
                      />
                    )}
                    {tab === "diff" && (
                      <DiffView original={articleText} rewritten={result} />
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end px-6 py-3 border-t border-border/40">
              <Button size="sm" variant="ghost" onClick={handleClose}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}