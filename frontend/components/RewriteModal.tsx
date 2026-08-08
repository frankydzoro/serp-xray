"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { rewriteArticle } from "@/lib/api";

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
  /** Called with the rewritten text when done */
  onComplete?: (text: string) => void;
}

export default function RewriteModal({ articleText, gaps, onComplete }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  if (gaps.length === 0) {
    // Don't render if no gaps
    return null;
  }

  const handleRewrite = async () => {
    setOpen(true);
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await rewriteArticle(articleText, gaps);
      setResult(res.rewritten_text);
      onComplete?.(res.rewritten_text);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
    setLoading(false);
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: use textarea selection
      const textarea = document.getElementById("rewrite-result") as HTMLTextAreaElement;
      if (textarea) {
        textarea.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  return (
    <>
      {/* Trigger button */}
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
        {loading ? "Rewriting…" : "Rewrite Article"}
      </Button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !loading && setOpen(false)}
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
                <h2 className="text-sm font-semibold">Rewrite Article</h2>
                <span className="text-[11px] text-muted-foreground">
                  {gaps.length} gap{gaps.length !== 1 ? "s" : ""}
                </span>
              </div>
              <button
                onClick={() => !loading && setOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                disabled={loading}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {loading && (
                <div className="flex flex-col items-center justify-center py-16 space-y-4">
                  <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Integrating {gaps.length} gap{gaps.length !== 1 ? "s" : ""} into article…
                  </p>
                  <p className="text-[11px] text-muted-foreground/60">
                    This may take 30–60 seconds depending on model and article length
                  </p>
                </div>
              )}

              {error && (
                <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-4">
                  <p className="text-sm font-semibold text-destructive mb-1">Error</p>
                  <p className="text-sm text-muted-foreground">{error}</p>
                </div>
              )}

              {result && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Rewrite complete — {result.length.toLocaleString()} characters
                    </p>
                    <Button size="sm" variant="outline" onClick={handleCopy} className="text-xs">
                      {copied ? (
                        <>
                          <svg className="w-3 h-3 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Copied
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  <Textarea
                    id="rewrite-result"
                    value={result}
                    readOnly
                    rows={20}
                    className="font-mono text-xs leading-relaxed resize-y"
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end px-6 py-3 border-t border-border/40">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}