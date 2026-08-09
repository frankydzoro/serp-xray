"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import DiffView from "@/components/DiffView";
import { startRewrite, getRewriteStatus } from "@/lib/api";
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
  /** Автозапуск генерации при монтировании (one-click поток из History) */
  autoStart?: boolean;
  /** Уведомление родителя о смене состояния: loading | done | error */
  onStatusChange?: (status: "idle" | "loading" | "done" | "error") => void;
}

type Tab = "original" | "result" | "diff";
/** idle → starting → running → done | error */
type RewriteStatus = "idle" | "starting" | "running" | "done" | "error";

const POLL_MS = 2500;

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export default function RewriteModal({ articleText, gaps, analysisId, querySlug, autoStart = false, onStatusChange }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<RewriteStatus>("idle");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("result");
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [mountChecked, setMountChecked] = useState(false);

  // Refs: переживают пересоздание эффектов, не вызывают churn в deps
  const startedAtRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const notifyRef = useRef(onStatusChange);
  useEffect(() => {
    notifyRef.current = onStatusChange;
  }, [onStatusChange]);

  const notify = useCallback((s: "idle" | "loading" | "done" | "error") => {
    notifyRef.current?.(s);
  }, []);

  /* ── Polling ─────────────────────────── */

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollOnce = useCallback(async () => {
    if (!analysisId) return;
    try {
      const st = await getRewriteStatus(analysisId);
      if (st.status === "completed") {
        stopPolling();
        setResult(st.rewritten_text);
        setTab("result");
        setStatus("done");
        notify("done");
      } else if (st.status === "failed") {
        stopPolling();
        setError(st.error || "Generation failed");
        setStatus("error");
        notify("error");
      }
      // running → продолжаем поллить; сетевые ошибки тоже игнорируем (retry on next tick)
    } catch {
      // transient — poll again on next tick
    }
  }, [analysisId, stopPolling, notify]);

  const startPolling = useCallback(() => {
    stopPolling();
    void pollOnce();
    pollRef.current = setInterval(() => void pollOnce(), POLL_MS);
  }, [pollOnce, stopPolling]);

  // Cleanup polling on unmount
  useEffect(() => stopPolling, [stopPolling]);

  /* ── Elapsed timer (while running) ───── */

  useEffect(() => {
    if (status !== "running") return;
    const tick = () => {
      if (startedAtRef.current) {
        const t = new Date(startedAtRef.current).getTime();
        if (!Number.isNaN(t)) setElapsed(Math.max(0, Math.floor((Date.now() - t) / 1000)));
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [status]);

  /* ── Mount: resume state from server ─── */

  useEffect(() => {
    if (!analysisId) {
      setMountChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const st = await getRewriteStatus(analysisId);
        if (cancelled) return;
        if (st.status === "completed" && st.rewritten_text) {
          setResult(st.rewritten_text);
          setStatus("done");
        } else if (st.status === "running") {
          // Генерация идёт на сервере (начата до перезагрузки страницы) —
          // возобновляем поллинг и показываем процесс
          startedAtRef.current = st.started_at;
          setStatus("running");
          setOpen(true);
          notify("loading");
          startPolling();
        } else if (st.status === "failed") {
          setError(st.error || "Generation failed");
          setStatus("error");
        }
      } catch {
        // Анализ ещё не имеет rewrite — нормальное состояние
      } finally {
        if (!cancelled) setMountChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisId]);

  /* ── Actions ─────────────────────────── */

  const handleStart = async () => {
    if (!analysisId || status === "starting" || status === "running") return;
    setOpen(true);
    setStatus("starting");
    setError("");
    try {
      const res = await startRewrite(articleText, gaps, undefined, analysisId);
      if (res.status === "completed" && res.rewritten_text) {
        // Сервер вернул уже готовый результат
        setResult(res.rewritten_text);
        setTab("result");
        setStatus("done");
        notify("done");
        return;
      }
      // running — генерация пошла в фоне
      startedAtRef.current = res.started_at;
      setElapsed(0);
      setStatus("running");
      notify("loading");
      startPolling();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
      notify("error");
    }
  };

  /* ── Auto-start (one-click из History) ── */

  useEffect(() => {
    if (!autoStart || !mountChecked) return;
    // Автозапуск только если ничего нет (idle) или прошлая попытка упала
    if (status === "idle" || status === "error") {
      void handleStart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, mountChecked]);

  const handleClick = () => {
    if (status === "running" || (status === "done" && result)) {
      setOpen(true);
      return;
    }
    void handleStart();
  };

  const handleClose = () => setOpen(false);

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

  if (gaps.length === 0) return null;

  const tabs: { key: Tab; label: string }[] = [
    { key: "original", label: "Original" },
    ...(result ? [{ key: "result" as Tab, label: "Result" }] : []),
    ...(result ? [{ key: "diff" as Tab, label: "Diff" }] : []),
  ];

  const busy = status === "starting" || status === "running";

  return (
    <>
      {/* Trigger button + live status indicator */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={handleClick}
          disabled={status === "starting"}
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
          {status === "starting"
            ? "Starting…"
            : status === "running"
              ? `Generating… ${fmtElapsed(elapsed)}`
              : status === "done"
                ? "View Rewrite"
                : status === "error"
                  ? "Retry Rewrite"
                  : "Rewrite Article"}
        </Button>
        {busy && (
          <span className="text-[11px] text-muted-foreground animate-pulse">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />
            Runs on server — closing the page is safe
          </span>
        )}
        {status === "done" && result && (
          <span className="text-[11px] text-emerald-600">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1" />
            Ready
          </span>
        )}
        {status === "error" && (
          <span className="text-[11px] text-red-500">
            <span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1" />
            Failed
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
                  {status === "done"
                    ? "View Rewrite"
                    : busy
                      ? "Rewriting Article…"
                      : status === "error"
                        ? "Rewrite Failed"
                        : "Rewrite Article"}
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
              {busy && (
                <div className="flex flex-col items-center justify-center py-16 space-y-4">
                  <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Integrating {gaps.length} gap{gaps.length !== 1 ? "s" : ""} into article…
                  </p>
                  <p className="text-[13px] font-mono text-foreground tabular-nums">
                    {fmtElapsed(elapsed)}
                  </p>
                  <p className="text-[11px] text-muted-foreground/60 text-center max-w-sm">
                    Generation runs on the server. You can close this modal or even the
                    page — the result will be saved and picked up automatically.
                  </p>
                </div>
              )}

              {status === "error" && (
                <div className="p-6">
                  <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-4 mb-4">
                    <p className="text-sm font-semibold text-destructive mb-1">Error</p>
                    <p className="text-sm text-muted-foreground break-words">{error}</p>
                  </div>
                  <Button size="sm" onClick={() => void handleStart()}>
                    Try again
                  </Button>
                </div>
              )}

              {status === "done" && result && (
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
