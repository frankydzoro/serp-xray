"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import EntityGraph from "@/components/EntityGraph";
import GapCard from "@/components/GapCard";
import RewriteModal from "@/components/RewriteModal";
import { getReport } from "@/lib/api";
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

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getReport(id)
      .then(setReport)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );

  if (!report)
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-lg font-semibold text-foreground mb-1">Report not found</p>
        <p className="text-sm text-muted-foreground mb-4">This analysis may have been deleted.</p>
        <Link
          href="/history"
          className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          Back to History
        </Link>
      </div>
    );

  const data = report.result_json || {};
  const gapCount = data.gaps?.length ?? 0;

  // Wave 1: сборка entities для графа из трёх источников
  const userEntities = (data.user_entities || []).map((e: any) => ({
    name: e.name,
    type: e.type || "Concept",
    confidence: e.confidence || 0.5,
    frequency: 1,
    owner: "user" as const,
    isGap: false,
    description: e.description || "",
    source_urls: e.source_urls || [],
  }));
  const competitorEntities = (data.all_competitor_entities || []).map((e: any) => ({
    name: e.name,
    type: e.type || "Concept",
    confidence: e.adjusted_confidence || e.confidence || 0.5,
    frequency: e.frequency || 1,
    owner: "competitor" as const,
    isGap: false,
    description: e.description || "",
    source_urls: e.source_urls || [],
  }));
  const gapEntities = (data.gaps || []).map((g: any) => ({
    name: g.entity,
    type: g.entity_type || "Concept",
    confidence: g.confidence ?? (g.priority === "critical" ? 1.0 : g.priority === "high" ? 0.8 : 0.5),
    frequency: g.frequency || 1,
    owner: "gap" as const,
    isGap: true,
    priority: g.priority,
    description: g.competitor_description || "",
    source_urls: (g.found_on_urls || []).map((u: any) => u.url || u),
  }));
  // Merge: gap → competitor → user (unique by name)
  const seen = new Set<string>();
  const allEntitiesForGraph: any[] = [];
  for (const e of gapEntities) {
    if (!seen.has(e.name.toLowerCase())) { seen.add(e.name.toLowerCase()); allEntitiesForGraph.push(e); }
  }
  for (const e of competitorEntities) {
    if (!seen.has(e.name.toLowerCase())) { seen.add(e.name.toLowerCase()); allEntitiesForGraph.push(e); }
  }
  for (const e of userEntities) {
    if (!seen.has(e.name.toLowerCase())) { seen.add(e.name.toLowerCase()); allEntitiesForGraph.push(e); }
  }
  const cooccurrenceFromReport = data.cooccurrence_matrix || {};
  const typedEdgesFromReport = data.typed_edges || [];

  const handleExport = async (format: "md" | "pdf") => {
    const rd = {
      id,
      query: data.query,
      entities_found: data.entities_found,
      user_entity_coverage: data.user_entity_coverage || 0,
      competitor_entity_coverage: data.competitor_entity_coverage || 0,
      gaps: data.gaps || [],
      checklist: [],
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

      {/* Entity Graph */}
      {allEntitiesForGraph.length > 0 && (
        <section>
          <SectionHeading title="Entity Graph" badge={`${allEntitiesForGraph.length}`} />
          <Card className="shadow-card border-border/60">
            <CardContent className="p-4">
              <EntityGraph entities={allEntitiesForGraph} cooccurrence={cooccurrenceFromReport} typedEdges={typedEdgesFromReport} showFilter />
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
            {data.gaps?.length > 0 && data.user_page_text && (
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