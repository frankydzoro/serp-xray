"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Modal from "@/components/Modal";
import { analyzeQuery } from "@/lib/api";

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
        No analysis yet
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Start an analysis — results will open in the report.
      </p>
      <Button onClick={onNewAnalysis}>New Analysis</Button>
    </div>
  );
}

/* ── Main page ────────────────────────────── */
export default function HomePage() {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [form, setForm] = useState<FormState>({
    query: "",
    url: "",
    userText: "",
    engine: "google",
  });
  const [inputMode, setInputMode] = useState<"url" | "text">("url");

  const handleNewAnalysis = () => {
    setForm({ query: "", url: "", userText: "", engine: "google" });
    setInputMode("url");
    setError("");
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.query.trim() || submitting) return;

    setError("");
    setSubmitting(true);
    try {
      const userText = inputMode === "text" ? form.userText.trim() : undefined;
      const url = inputMode === "url" ? form.url.trim() || undefined : undefined;
      const { id } = await analyzeQuery(form.query.trim(), url, userText, form.engine);
      setModalOpen(false);
      // Results live only on the report page
      router.push(`/report/${id}`);
    } catch (err: any) {
      setError(err.message || "Failed to start analysis");
      setSubmitting(false);
    }
  };

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
      {error && (
        <Card className="border-destructive/30 bg-destructive/5 mb-6">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <span className="text-destructive text-lg font-bold leading-none mt-0.5">!</span>
              <div>
                <p className="text-sm font-semibold text-destructive">Failed to start analysis</p>
                <p className="text-sm text-muted-foreground mt-0.5">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Empty ─────────────────────────── */}
      <EmptyState onNewAnalysis={handleNewAnalysis} />

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
          <Button
            type="submit"
            disabled={!form.query.trim() || submitting}
            className="w-full"
            size="lg"
          >
            {submitting ? "Starting..." : "Analyze"}
          </Button>
        </form>
      </Modal>
    </>
  );
}