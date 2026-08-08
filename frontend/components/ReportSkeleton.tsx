"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";

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
}

export default function ReportSkeleton({ analysisId, stage }: Props) {
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

          {/* Elapsed */}
          <div className="text-sm text-muted-foreground">
            Elapsed: <span className="font-mono text-primary font-medium">{elapsedStr}</span>
          </div>

          {/* Progress bar */}
          <div className="w-full max-w-md bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${Math.max(5, ((currentIdx + (stage === "done" ? 1 : 0.3)) / STAGES.length) * 100)}%`,
              }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}