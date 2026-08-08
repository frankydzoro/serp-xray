"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Modal from "@/components/Modal";
import EntityGraph from "@/components/EntityGraph";
import GapCard from "@/components/GapCard";
import ReportSkeleton from "@/components/ReportSkeleton";
import RewriteModal from "@/components/RewriteModal";
import { analyzeQuery, getAnalysisStatus } from "@/lib/api";

/* ── Types ───────────────────────────────── */
type Engine = "google" | "yandex" | "both";

const ENGINE_OPTIONS: { value: Engine; label: string }[] = [
  { value: "google", label: "Google" },
  { value: "yandex", label: "Yandex" },
  { value: "both", label: "Both" },
];

interface FormState {
  query: string;
  url: string;
  userText: string;
  engine: Engine;
}

/* ── KPI card ─────────────────────────────── */
function KpiCard({
  label,
  value,
  suffix,
  variant = "default",
}: {
  label: string;
  value: number | string;
  suffix?: string;
  variant?: "default" | "danger" | "success" | "muted";
}) {
  const colorMap = {
    default: "text-primary",
    danger: "text-red-500",
    success: "text-emerald-500",
    muted: "text-foreground",
  };
  return (
    <div className="bg-card rounded-xl border border-border/60 p-4 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </p>
      <div className="flex items-baseline gap-1">
        <span className={`text-3xl font-extrabold tracking-tight ${colorMap[variant]}`}>
          {value}
        </span>
        {suffix && (
          <span className="text-sm font-medium text-muted-foreground">{suffix}</span>
        )}
      </div>
    </div>
  );
}

/* ── Section heading ──────────────────────── */
function SectionHeading({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {badge && (
        <span className="text-[11px] font-semibold bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}
    </div>
  );
}

/* ── Empty state ──────────────────────────── */
function EmptyState({ onNewAnalysis }: { onNewAnalysis: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-20 h-20 rounded-2xl bg-secondary flex items-center justify-center mb-6">
        <svg
          width="32" height="32" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" className="text-muted-foreground"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.3-4.3" />
          <path d="M8 11h6M11 8v6" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        No analysis running
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Start a new analysis to see which entities appear in search results.
      </p>
      <Button onClick={onNewAnalysis}>New Analysis</Button>
    </div>
  );
}

/* ── Running card in history ───────────────── */
function RunningCard({ analysisId, query, stage }: { analysisId: string; query: string; stage: string }) {
  return (
    <div className="bg-card rounded-xl border border-primary/30 p-4 shadow-card animate-pulse">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground truncate max-w-[300px]">
            {query}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
            {analysisId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs font-medium text-primary capitalize">{stage}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────── */
export default function HomePage() {
  const [modalOpen, setModalOpen] = useState(false);

  // Form state
  const [form, setForm] = useState<FormState>({
    query: "",
    url: "",
    userText: "",
    engine: "google",
  });
  const [inputMode, setInputMode] = useState<"url" | "text">("url");

  // Analysis state
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle"); // idle | running | completed | failed
  const [stage, setStage] = useState<string>("searching");
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState("");
  const [allEntities, setAllEntities] = useState<any[]>([]);
  const [cooccurrence, setCooccurrence] = useState<Record<string, number>>({});
  const [typedEdges, setTypedEdges] = useState<Array<{source:string;target:string;weight:number;type:string}>>([]);

  const [savedQuery, setSavedQuery] = useState("");
  const searchParams = useSearchParams();

  // Resume from ?id= or localStorage on mount
  const resumeRef = useRef(false);
  useEffect(() => {
    const urlId = searchParams.get("id");
    const stored = localStorage.getItem("serp_xray_active_analysis");

    if (urlId && !resumeRef.current) {
      resumeRef.current = true;
      setAnalysisId(urlId);
      setStatus("running");
      // Try to get query from localStorage, fall back to "..."
      try {
        const parsed = stored ? JSON.parse(stored) : null;
        setSavedQuery(parsed?.id === urlId ? parsed.query : "");
      } catch {
        setSavedQuery("");
      }
      return;
    }

    if (stored && !resumeRef.current) {
      resumeRef.current = true;
      try {
        const { id, query } = JSON.parse(stored);
        setAnalysisId(id);
        setSavedQuery(query);
        setStatus("running");
      } catch {
        localStorage.removeItem("serp_xray_active_analysis");
      }
    }
  }, [searchParams]);

  // Polling — single source of truth
  useEffect(() => {
    if (!analysisId || status !== "running") return;

    let active = true;
    const poll = async () => {
      try {
        const s = await getAnalysisStatus(analysisId);
        if (!active) return;
        setStage(s.stage);
        if (s.status === "completed" && s.result) {
          setReport(s.result);
          setStatus("completed");
          localStorage.removeItem("serp_xray_active_analysis");
          // Wave 1: сборка allEntities из трёх источников
          const userEntities = (s.result.user_entities || []).map((e: any) => ({
            name: e.name,
            type: e.type || "Concept",
            confidence: e.confidence || 0.5,
            frequency: 1,
            owner: "user" as const,
            isGap: false,
            description: e.description || "",
            source_urls: e.source_urls || [],
          }));
          const competitorEntities = (s.result.all_competitor_entities || []).map((e: any) => ({
            name: e.name,
            type: e.type || "Concept",
            confidence: e.adjusted_confidence || e.confidence || 0.5,
            frequency: e.frequency || 1,
            owner: "competitor" as const,
            isGap: false,
            description: e.description || "",
            source_urls: e.source_urls || [],
          }));
          const userEntityNames = new Set(userEntities.map((e: any) => e.name.toLowerCase()));
          const gapEntities = (s.result.gaps || []).map((g: any) => ({
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
          // Merge: competitor + gap (unique by name), then user
          const seen = new Set<string>();
          const mergedEntities: any[] = [];
          for (const e of gapEntities) {
            if (!seen.has(e.name.toLowerCase())) {
              seen.add(e.name.toLowerCase());
              mergedEntities.push(e);
            }
          }
          for (const e of competitorEntities) {
            if (!seen.has(e.name.toLowerCase())) {
              seen.add(e.name.toLowerCase());
              mergedEntities.push(e);
            }
          }
          for (const e of userEntities) {
            if (!seen.has(e.name.toLowerCase())) {
              seen.add(e.name.toLowerCase());
              mergedEntities.push(e);
            }
          }
          setAllEntities(mergedEntities);
          setCooccurrence(s.result.cooccurrence_matrix || {});
          setTypedEdges(s.result.typed_edges || []);
        } else if (s.status === "failed") {
          setError(s.error || "Analysis failed");
          setStatus("failed");
          localStorage.removeItem("serp_xray_active_analysis");
        }
      } catch (err: any) {
        if (active) {
          setError(err.message || "Connection lost");
          setStatus("failed");
        }
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => { active = false; clearInterval(interval); };
  }, [analysisId, status]);

  const handleNewAnalysis = () => {
    setForm({ query: "", url: "", userText: "", engine: "google" });
    setInputMode("url");
    setError("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.query.trim()) return;

    setModalOpen(false);
    setStatus("running");
    setStage("searching");
    setReport(null);
    setError("");
    setAllEntities([]);
    setCooccurrence({});
    setTypedEdges([]);

    try {
      const userText = inputMode === "text" ? form.userText.trim() : undefined;
      const url = inputMode === "url" ? form.url.trim() || undefined : undefined;
      const { id } = await analyzeQuery(form.query.trim(), url, userText, form.engine);
      setAnalysisId(id);
      setSavedQuery(form.query.trim());
      localStorage.setItem("serp_xray_active_analysis", JSON.stringify({ id, query: form.query.trim() }));
    } catch (err: any) {
      setError(err.message || "Failed to start analysis");
      setStatus("failed");
    }
  };

  const gapCount = report?.gaps?.length ?? 0;

  return (
    <>
      {/* ── Top bar ──────────────────────── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analysis</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Competitive SERP entity analysis
          </p>
        </div>
        <Button onClick={handleNewAnalysis}>New Analysis</Button>
      </div>

      {/* ── Error ─────────────────────────── */}
      {error && status === "failed" && (
        <Card className="border-destructive/30 bg-destructive/5 mb-6">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <span className="text-destructive text-lg font-bold leading-none mt-0.5">!</span>
              <div>
                <p className="text-sm font-semibold text-destructive">Analysis failed</p>
                <p className="text-sm text-muted-foreground mt-0.5">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Running ───────────────────────── */}
      {status === "running" && (
        <div className="space-y-6">
          <ReportSkeleton analysisId={analysisId || "pending"} stage={stage} />
          <SectionHeading title="In Progress" />
          <RunningCard analysisId={analysisId || "..."} query={savedQuery || form.query.trim()} stage={stage} />
        </div>
      )}

      {/* ── Empty ─────────────────────────── */}
      {status === "idle" && <EmptyState onNewAnalysis={handleNewAnalysis} />}

      {/* ── Results ───────────────────────── */}
      {status === "completed" && report && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Query info */}
          <div className="bg-card rounded-xl border border-border/60 p-5 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Query
            </p>
            <p className="text-lg font-semibold">{report.query}</p>
          </div>

          {/* KPI bar */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Entities" value={report.entities_found} />
            <KpiCard
              label="Gaps"
              value={gapCount}
              variant={gapCount > 0 ? "danger" : "success"}
            />
            <KpiCard
              label="Competitor coverage"
              value={report.competitor_entity_coverage}
              suffix="%"
              variant={
                report.competitor_entity_coverage >= 70
                  ? "success"
                  : report.competitor_entity_coverage >= 40
                    ? "muted"
                    : "danger"
              }
            />
            <KpiCard
              label="Your coverage"
              value={report.user_entity_coverage}
              suffix="%"
              variant={
                report.user_entity_coverage >= 70
                  ? "success"
                  : report.user_entity_coverage >= 40
                    ? "muted"
                    : "danger"
              }
            />
          </div>

          {/* Entity Graph */}
          {allEntities.length > 0 && (
            <section>
              <SectionHeading title="Entity Graph" badge={`${allEntities.length}`} />
              <Card className="shadow-card border-border/60">
                <CardContent className="p-4">
                  <EntityGraph entities={allEntities} cooccurrence={cooccurrence} typedEdges={typedEdges} showFilter />
                </CardContent>
              </Card>
            </section>
          )}

          {/* Gaps */}
          <section>
            <SectionHeading title="Content Gaps" badge={`${gapCount}`} />
            <Card className="shadow-card border-border/60">
              <CardContent className="p-4 space-y-3">
                <GapCard gaps={report.gaps || []} />
                {report.gaps?.length > 0 && report.user_page_text && (
                  <RewriteModal
                    articleText={report.user_page_text}
                    gaps={report.gaps}
                  />
                )}
              </CardContent>
            </Card>
          </section>

          {/* Competitor pages */}
          {report.competitor_pages?.length > 0 && (
            <section>
              <SectionHeading title="Competitor Pages" badge={`${report.competitor_pages.length}`} />
              <div className="space-y-4">
                {report.competitor_pages.map((p: any, i: number) => (
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
          {report.user_page_text && (
            <section>
              <SectionHeading title="Your Page Text" />
              <Card className="shadow-card border-border/60">
                <CardContent className="p-4">
                  <details>
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      View full text
                    </summary>
                    <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-96 overflow-y-auto bg-muted/50 rounded-lg p-3">
                      {report.user_page_text}
                    </pre>
                  </details>
                </CardContent>
              </Card>
            </section>
          )}
        </div>
      )}

      {/* ── Modal ─────────────────────────── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Analysis">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Query */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Search query</label>
            <Input
              placeholder="e.g. how to choose a CRM for small business"
              value={form.query}
              onChange={(e) => setForm((f) => ({ ...f, query: e.target.value }))}
              autoFocus
              className="text-base"
            />
          </div>

          {/* Input mode: URL or Text */}
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <label className="text-sm font-medium">
                Your page <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <div className="flex gap-0.5 bg-muted rounded-md p-0.5">
                <button
                  type="button"
                  onClick={() => setInputMode("url")}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition-all ${
                    inputMode === "url"
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  URL
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("text")}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition-all ${
                    inputMode === "text"
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Paste text
                </button>
              </div>
            </div>
            {inputMode === "url" ? (
              <Input
                placeholder="https://example.com/my-page"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            ) : (
              <Textarea
                placeholder="Paste your article text here..."
                value={form.userText}
                onChange={(e) => setForm((f) => ({ ...f, userText: e.target.value }))}
                rows={6}
                className="resize-y"
              />
            )}
            <p className="text-xs text-muted-foreground mt-1">
              If provided — compares your page to all competitor results.
            </p>
          </div>

          {/* Engine selector */}
          <div>
            <label className="text-sm font-medium mb-1.5 block">Search engine</label>
            <div className="flex gap-1 bg-muted rounded-lg p-0.5">
              {ENGINE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, engine: opt.value }))}
                  className={`flex-1 px-3 py-2 text-sm rounded-md font-medium transition-all duration-200 ${
                    form.engine === opt.value
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Submit */}
          <Button type="submit" disabled={!form.query.trim()} className="w-full" size="lg">
            Analyze
          </Button>
        </form>
      </Modal>
    </>
  );
}