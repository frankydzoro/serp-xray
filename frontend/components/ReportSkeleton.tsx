"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { AnalysisProgress, PageProgress } from "@/lib/api";

const STAGES = [
  { key: "searching", label: "Searching results..." },
  { key: "fetching", label: "Fetching page content..." },
  { key: "extracting", label: "Extracting entities via LLM..." },
  { key: "analyzing", label: "Analyzing gaps..." },
  { key: "building", label: "Building report..." },
] as const;

interface Props {
  analysisId: string;
  stage: string;
  progress?: AnalysisProgress;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function PageStatus({ page }: { page: PageProgress }) {
  switch (page.step) {
    case "done":
      return (
        <span className="text-[11px] text-emerald-600 font-medium inline-flex items-center gap-1 shrink-0">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          {page.entities} entities
        </span>
      );
    case "failed":
      return (
        <span className="text-[11px] text-rose-500 font-medium shrink-0">✗ failed</span>
      );
    case "fetching":
    case "extracting":
      return (
        <span className="text-[11px] text-primary font-medium inline-flex items-center gap-1.5 shrink-0 capitalize">
          <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
          {page.step}
        </span>
      );
    default:
      return (
        <span className="text-[11px] text-muted-foreground/40 shrink-0">waiting</span>
      );
  }
}

function StepRow({
  label,
  detail,
  active,
  done,
  failed,
}: {
  label: string;
  detail?: string;
  active?: boolean;
  done?: boolean;
  failed?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 bg-muted/40">
      <span className="w-5 text-center shrink-0">
        {done ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-emerald-500 inline">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : failed ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-rose-500 inline">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : active ? (
          <span className="inline-block w-3 h-3 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
        ) : (
          <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30" />
        )}
      </span>
      <span className={`text-xs ${active ? "text-primary font-medium" : "text-muted-foreground/80"}`}>{label}</span>
      {detail && <span className="text-[11px] font-mono text-muted-foreground ml-auto shrink-0">{detail}</span>}
    </div>
  );
}

export default function ReportSkeleton({ analysisId, stage, progress }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set());

  // Update completed stages based on stage prop
  useEffect(() => {
    const stageIdx = STAGES.findIndex((s) => s.key === stage);
    const done = new Set<string>();
    for (let i = 0; i < stageIdx; i++) {
      done.add(STAGES[i].key);
    }
    setCompletedStages(done);
  }, [stage]);

  // Timer
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsedStr =
    elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  const currentIdx = STAGES.findIndex((s) => s.key === stage);

  const pages = progress?.pages ?? [];
  const settledPages = pages.filter((p) => p.step === "done" || p.step === "failed").length;
  const showPages = (stage === "fetching" || stage === "extracting") && pages.length > 0;
  const showAnalyzing = stage === "analyzing";

  // Ширина прогресс-бара: внутри fetching/extracting учитываем долю готовых страниц
  let stageFraction = 0.3;
  if (pages.length > 0) stageFraction = settledPages / pages.length;
  if (stage === "done") stageFraction = 1;
  const widthPct = Math.max(5, Math.min(100, ((currentIdx + stageFraction) / STAGES.length) * 100));

  return (
    <Card className="shadow-card border-border/60">
      <CardContent className="p-8">
        <div className="flex flex-col items-center gap-6">
          {/* Spinner */}
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-4 border-primary/15" />
            <div className="absolute inset-0 rounded-full border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent animate-spin" />
          </div>

          {/* Stage list */}
          <div className="space-y-2 w-full max-w-md">
            {STAGES.map((s, i) => {
              const isDone = completedStages.has(s.key);
              const isActive = i === currentIdx;
              const isPending = i > currentIdx;

              return (
                <div
                  key={s.key}
                  className={`flex items-center gap-3 p-2 rounded-lg transition-all duration-300 ${
                    isDone
                      ? "text-muted-foreground/50 line-through"
                      : isActive
                        ? "bg-primary/5 text-primary font-semibold"
                        : "text-muted-foreground/40"
                  }`}
                >
                  <span className="text-base shrink-0 w-5 text-center">
                    {isDone ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-emerald-500 inline">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : isActive ? (
                      <span className="inline-block w-3 h-3 rounded-full bg-primary animate-pulse" />
                    ) : (
                      <span className="inline-block w-3 h-3 rounded-full bg-muted-foreground/20" />
                    )}
                  </span>
                  <span className="text-sm">{s.label}</span>
                </div>
              );
            })}
          </div>

          {/* ── Per-page progress: fetching / extracting ── */}
          {showPages && (
            <div className="w-full max-w-md space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1.5">
                Pages — {settledPages}/{pages.length}
              </div>
              <div className="max-h-56 overflow-y-auto pr-1 space-y-1">
                {pages.map((p) => (
                  <div
                    key={p.url}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 bg-muted/40"
                  >
                    <span className="text-[11px] font-mono text-muted-foreground/60 shrink-0 w-7 text-right">
                      #{p.position}
                    </span>
                    <span className="text-xs text-foreground/80 truncate flex-1 min-w-0">
                      {hostname(p.url)}
                      {p.title ? <span className="text-muted-foreground/60"> — {p.title}</span> : null}
                    </span>
                    <PageStatus page={p} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Analyzing: user page + gap steps ── */}
          {showAnalyzing && (
            <div className="w-full max-w-md space-y-1">
              {progress?.user_step && progress.user_step !== "skipped" && (
                <StepRow
                  label={progress.user_step === "done" ? `Your page entities — ${progress.user_entities ?? 0} extracted` : "Extracting entities from your page..."}
                  active={progress.user_step === "extracting"}
                  done={progress.user_step === "done"}
                  failed={progress.user_step === "failed"}
                />
              )}
              {progress?.gap_step && (
                <StepRow
                  label={
                    progress.gap_step === "done"
                      ? `Gap analysis — ${progress.gap_count ?? 0} gaps found`
                      : progress.gap_step === "failed"
                        ? "Gap analysis failed — building report with available data"
                        : `Gap analysis — comparing ${progress.gap_competitor_n ?? 0} competitor vs ${progress.gap_user_n ?? 0} user entities`
                  }
                  active={progress.gap_step === "running"}
                  done={progress.gap_step === "done"}
                  failed={progress.gap_step === "failed"}
                />
              )}
            </div>
          )}

          {/* Elapsed */}
          <div className="text-sm text-muted-foreground">
            Elapsed: <span className="font-mono text-primary font-medium">{elapsedStr}</span>
          </div>

          {/* Progress bar */}
          <div className="w-full max-w-md bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${widthPct}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}