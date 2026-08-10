"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import GapGraph from "@/components/GapGraph";
import GapCard from "@/components/GapCard";
import Checklist from "@/components/Checklist";
import RewriteModal from "@/components/RewriteModal";
import ReportSkeleton from "@/components/ReportSkeleton";
import { getAnalysisStatus, getReport } from "@/lib/api";
import { downloadMarkdown, downloadPDF } from "@/lib/export";

function KpiInline({
  label,
  value,
  suffix,
  variant = "default",
}: {
  label: string;
  value: number | string;
  suffix?: string;
  variant?: "default" | "danger" | "success";
}) {
  const colorMap = {
    default: "text-primary",
    danger: "text-red-500",
    success: "text-emerald-500",
  };
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={`text-2xl font-extrabold tracking-tight ${colorMap[variant]}`}>
        {value}
        {suffix && (
          <span className="text-sm font-medium text-muted-foreground ml-0.5">{suffix}</span>
        )}
      </span>
    </div>
  );
}

function SectionHeading({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {badge && (
        <Badge variant="secondary" className="text-[11px] font-medium">
          {badge}
        </Badge>
      )}
    </div>
  );
}

/* ── Main page ────────────────────────────── */
export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [view, setView] = useState<"loading" | "running" | "completed" | "failed">("loading");
  const [stage, setStage] = useState("searching");
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState("");
  // Терминальное состояние: после completed/failed поллинг останавливается,
  // чтобы не пересобирать отчёт и граф каждые 2с
  const settledRef = useRef(false);

  // Poll while running, fetch full report once completed
  useEffect(() => {
    if (!id) return;
    let active = true;
    settledRef.current = false;

    const poll = async () => {
      // Completed/failed — stop polling
      if (!active || settledRef.current) return;
      try {
        const s = await getAnalysisStatus(id);
        if (!active) return;
        if (s.status === "running") {
          setView("running");
          setStage(s.stage);
        } else if (s.status === "failed") {
          settledRef.current = true;
          setView("failed");
          setError(s.error || "Analysis failed");
        } else {
          // completed — fetch full report once, then stop
          settledRef.current = true;
          setView("loading");
          const full = await getReport(id).catch(() => null);
          if (!active) return;
          if (full) {
            setReport(full);
            setView("completed");
          } else {
            setView("failed");
            setError("Report not found");
          }
        }
      } catch (err: any) {
        if (!active) return;
        settledRef.current = true;
        setError(err.message || "Connection lost");
        setView("failed");
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [id]);

  /* ── Loading ── */
  if (view === "loading")
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );

  /* ── Running ── */
  if (view === "running")
    return (
      <div className="space-y-6">
        <ReportSkeleton analysisId={id || "pending"} stage={stage} />
        <div className="bg-card rounded-xl border border-primary/30 p-4 shadow-card animate-pulse">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground truncate max-w-[300px]">
                Analysis in progress
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{id}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-medium text-primary capitalize">{stage}</span>
            </div>
          </div>
        </div>
      </div>
    );

  /* ── Failed ── */
  if (view === "failed")
    return (
      <div className="max-w-4xl mx-auto">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <span className="text-destructive text-lg font-bold leading-none mt-0.5">!</span>
              <div>
                <p className="text-sm font-semibold text-destructive">Analysis failed</p>
                <p className="text-sm text-muted-foreground mt-0.5">{error}</p>
                <Link
                  href="/history"
                  className="text-sm font-medium text-primary hover:underline inline-block mt-4"
                >
                  ← Back to History
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );

  /* ── Completed ── */
  const data = report?.result_json || {};
  const gapCount = data.gaps?.length ?? 0;

  const handleExport = async (format: "md" | "pdf") => {
    const rd = {
      id,
      query: data.query,
      entities_found: data.entities_found,
      user_entity_coverage: data.user_entity_coverage || 0,
      competitor_entity_coverage: data.competitor_entity_coverage || 0,
      gaps: data.gaps || [],
      checklist: data.checklist || [],
      timestamp: report.created_at,
      competitor_pages: data.competitor_pages || [],
      user_page_text: data.user_page_text || "",
    };
    if (format === "md") downloadMarkdown(rd);
    else await downloadPDF(rd);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Breadcrumb + title */}
      <div className="space-y-2">
        <Link
          href="/history"
          className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          History
        </Link>
        <h1 className="text-xl font-bold tracking-tight">{data.query}</h1>
        <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
          <span>
            {new Date(report.created_at).toLocaleString("en-US", {
              month: "short", day: "numeric", year: "numeric",
              hour: "2-digit", minute: "2-digit",
            })}
          </span>
          <span>·</span>
          <span className="font-mono">{report.model_used?.split("/").pop()}</span>
          <span>·</span>
          <Badge variant="secondary" className="text-[10px] font-medium">
            {report.id?.slice(0, 8)}
          </Badge>
        </div>
      </div>

      {/* KPI bar */}
      <div className="bg-card rounded-2xl border border-border/60 p-6 shadow-card">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <KpiInline label="Entities" value={data.entities_found || 0} />
          <KpiInline label="Gaps" value={gapCount} variant={gapCount > 0 ? "danger" : "success"} />
          <KpiInline
            label="Competitor coverage" value={data.competitor_entity_coverage || 0} suffix="%"
            variant={(data.competitor_entity_coverage || 0) >= 70 ? "success" : (data.competitor_entity_coverage || 0) >= 40 ? "default" : "danger"}
          />
          <KpiInline
            label="Your coverage" value={data.user_entity_coverage || 0} suffix="%"
            variant={(data.user_entity_coverage || 0) >= 70 ? "success" : (data.user_entity_coverage || 0) >= 40 ? "default" : "danger"}
          />
        </div>
      </div>

      {/* Entity Graph — только gap-сущности, привязанные к конкурентам */}
      {gapCount > 0 && (
        <section>
          <SectionHeading title="Entity Graph" badge={`${gapCount}`} />
          <Card className="shadow-card border-border/60">
            <CardContent className="p-4">
              <GapGraph gaps={data.gaps || []} />
            </CardContent>
          </Card>
        </section>
      )}

      {/* Gaps */}
      <section>
        <SectionHeading title="Content Gaps" badge={`${gapCount}`} />
        <Card className="shadow-card border-border/60">
          <CardContent className="p-4 space-y-3">
            <GapCard gaps={data.gaps || []} />
            {gapCount > 0 && data.user_page_text && (
              <RewriteModal
                articleText={data.user_page_text}
                gaps={data.gaps}
                analysisId={id as string}
                querySlug={data.query}
              />
            )}
          </CardContent>
        </Card>
      </section>

      {/* Checklist */}
      {data.checklist?.length > 0 && (
        <section>
          <SectionHeading title="Checklist" badge={`${data.checklist.length}`} />
          <Card className="shadow-card border-border/60">
            <CardContent className="p-4">
              <Checklist items={data.checklist} />
            </CardContent>
          </Card>
        </section>
      )}

      {/* Competitor pages */}
      {data.competitor_pages?.length > 0 && (
        <section>
          <SectionHeading title="Competitor Pages" badge={`${data.competitor_pages.length}`} />
          <div className="space-y-4">
            {data.competitor_pages.map((p: any, i: number) => (
              <Card key={i} className="shadow-card border-border/60">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] font-bold text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                      #{p.position}
                    </span>
                    <span className="text-[11px] font-medium text-muted-foreground uppercase">
                      {p.engine}
                    </span>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-primary hover:underline truncate"
                    >
                      {p.title || p.url}
                    </a>
                  </div>
                  <details>
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      View full text
                    </summary>
                    <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-96 overflow-y-auto bg-muted/50 rounded-lg p-3">
                      {p.text}
                    </pre>
                  </details>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* User page text */}
      {data.user_page_text && (
        <section>
          <SectionHeading title="Your Page Text" />
          <Card className="shadow-card border-border/60">
            <CardContent className="p-4">
              <details>
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  View full text
                </summary>
                <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-96 overflow-y-auto bg-muted/50 rounded-lg p-3">
                  {data.user_page_text}
                </pre>
              </details>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Sticky export bar */}
      <div className="sticky bottom-4 flex justify-end gap-2">
        <div className="bg-card/90 backdrop-blur border border-border/60 rounded-xl p-2 shadow-elevated flex gap-2">
          <Button size="sm" variant="outline" onClick={() => handleExport("md")}>
            Download Markdown
          </Button>
          <Button size="sm" variant="default" onClick={() => handleExport("pdf")}>
            Download PDF
          </Button>
        </div>
      </div>
    </div>
  );
}