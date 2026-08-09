"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ModelPicker from "@/components/ModelPicker";
import {
  getModel,
  updateModel,
  getPrompts,
  updatePrompts,
  resetPrompts,
  getRewriteModel,
  updateRewriteModel,
  getRewritePrompts,
  updateRewritePrompts,
  resetRewritePrompts,
} from "@/lib/api";

/* ── Toast ──────────────────────────────── */

function Toast({ message, type = "success" }: { message: string; type?: "success" | "error" }) {
  if (!message) return null;
  const bg = type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800";
  return (
    <div className={`fixed top-16 right-6 z-50 px-4 py-2.5 rounded-lg border text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-200 ${bg}`}>
      {message}
    </div>
  );
}

/* ── Tabs component ────────────────────────── */

function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex gap-1 bg-muted rounded-lg p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
            active === tab.key
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/* ── Main component ───────────────────────── */

type SettingsTab = "analysis" | "rewrite";

export default function AdminPrompts() {
  // ── Active tab ──────────────────────────
  const [activeTab, setActiveTab] = useState<SettingsTab>("analysis");

  // ── Analysis settings ────────────────────
  const [model, setModel] = useState("");
  const [entityPrompt, setEntityPrompt] = useState("");
  const [gapPrompt, setGapPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [analysisTab, setAnalysisTab] = useState<"entity" | "gap">("entity");

  // ── Rewrite settings ─────────────────────
  const [rewriteModel, setRewriteModel] = useState("");
  const [rewriteSystemPrompt, setRewriteSystemPrompt] = useState("");
  const [rewriteUserPrompt, setRewriteUserPrompt] = useState("");
  const [rewriteSaving, setRewriteSaving] = useState(false);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" }>({ message: "", type: "success" });

  useEffect(() => {
    getModel().then((d) => setModel(d.model));
    getPrompts().then((d) => {
      setEntityPrompt(d.entity_prompt);
      setGapPrompt(d.gap_prompt);
    });
    getRewriteModel().then((d) => setRewriteModel(d.model));
    getRewritePrompts().then((d) => {
      setRewriteSystemPrompt(d.system_prompt);
      setRewriteUserPrompt(d.user_prompt);
    });
  }, []);

  const flash = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: "", type: "success" }), 2500);
  };

  // ── Analysis handlers ────────────────────

  const handleModelChange = async (mId: string) => {
    setModel(mId);
    try {
      await updateModel(mId);
      flash("Model updated");
    } catch {
      flash("Failed to update model", "error");
    }
  };

  const handlePromptsSave = async () => {
    setSaving(true);
    try {
      await updatePrompts(entityPrompt, gapPrompt);
      flash("Prompts saved");
    } catch {
      flash("Failed to save prompts", "error");
    }
    setSaving(false);
  };

  const handleReset = async () => {
    try {
      const d = await resetPrompts();
      setEntityPrompt(d.entity_prompt);
      setGapPrompt(d.gap_prompt);
      flash("Restored defaults");
    } catch {
      flash("Failed to reset", "error");
    }
  };

  // ── Rewrite handlers ─────────────────────

  const handleRewriteModelChange = async (mId: string) => {
    setRewriteModel(mId);
    try {
      await updateRewriteModel(mId);
      flash("Rewrite model updated");
    } catch {
      flash("Failed to update rewrite model", "error");
    }
  };

  const handleRewritePromptsSave = async () => {
    setRewriteSaving(true);
    try {
      await updateRewritePrompts(rewriteSystemPrompt, rewriteUserPrompt);
      flash("Rewrite prompts saved");
    } catch {
      flash("Failed to save rewrite prompts", "error");
    }
    setRewriteSaving(false);
  };

  const handleRewriteReset = async () => {
    try {
      const d = await resetRewritePrompts();
      setRewriteSystemPrompt(d.system_prompt);
      setRewriteUserPrompt(d.user_prompt);
      flash("Restored rewrite defaults");
    } catch {
      flash("Failed to reset rewrite prompts", "error");
    }
  };

  return (
    <div className="space-y-8">
      <Toast message={toast.message} type={toast.type} />

      {/* Tab switcher */}
      <Tabs
        tabs={[
          { key: "analysis", label: "Analysis" },
          { key: "rewrite", label: "Rewrite Article" },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as SettingsTab)}
      />

      {/* ═══ Analysis tab ═══════════════════════════════ */}
      {activeTab === "analysis" && (
        <>
          {/* Model selection */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Model</h3>
            <ModelPicker selected={model} onSelect={handleModelChange} />
          </div>

          {/* Prompt editors */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Prompts</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Reset to defaults
              </Button>
            </div>

            {/* Mobile tabs */}
            <div className="flex lg:hidden gap-1 bg-muted rounded-lg p-0.5 mb-3">
              {(["entity", "gap"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setAnalysisTab(tab)}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    analysisTab === tab
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "entity" ? "Entity Extraction" : "Gap Analysis"}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Entity prompt */}
              <div className={analysisTab === "gap" ? "hidden lg:block" : ""}>
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="text-[13px] font-semibold text-foreground">Entity Extraction</h4>
                  <span className="text-[11px] text-muted-foreground font-mono">{"{page_text}"}</span>
                </div>
                <Textarea
                  value={entityPrompt}
                  onChange={(e) => setEntityPrompt(e.target.value)}
                  rows={12}
                  className="font-mono text-xs leading-relaxed resize-y"
                  placeholder="Enter entity extraction prompt..."
                />
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Use {"{page_text}"} as placeholder. Instruct the LLM how to extract and classify entities.
                </p>
              </div>

              {/* Gap prompt */}
              <div className={analysisTab === "entity" ? "hidden lg:block" : ""}>
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="text-[13px] font-semibold text-foreground">Gap Analysis</h4>
                  <span className="text-[11px] text-muted-foreground font-mono">{"{user_entities}"}, {"{competitor_entities}"}</span>
                </div>
                <Textarea
                  value={gapPrompt}
                  onChange={(e) => setGapPrompt(e.target.value)}
                  rows={12}
                  className="font-mono text-xs leading-relaxed resize-y"
                  placeholder="Enter gap analysis prompt..."
                />
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Use {"{user_entities}"}, {"{competitor_entities}"}, and {"{query}"} as placeholders.
                  Compare all competitor entities against user page.
                </p>
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <Button onClick={handlePromptsSave} disabled={saving} size="sm">
                {saving ? "Saving..." : "Save Prompts"}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ═══ Rewrite tab ═══════════════════════════════ */}
      {activeTab === "rewrite" && (
        <>
          {/* Rewrite model */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">Rewrite Model</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Model used for the «Rewrite Article» feature. Runs independently from the analysis model.
            </p>
            <ModelPicker selected={rewriteModel} onSelect={handleRewriteModelChange} />
          </div>

          {/* Rewrite prompts */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">Rewrite Prompts</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRewriteReset}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Reset to defaults
              </Button>
            </div>

            {/* System prompt */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-[13px] font-semibold text-foreground">System Prompt</h4>
                <span className="text-[11px] text-muted-foreground">Role, constraints, style</span>
              </div>
              <Textarea
                value={rewriteSystemPrompt}
                onChange={(e) => setRewriteSystemPrompt(e.target.value)}
                rows={10}
                className="font-mono text-xs leading-relaxed resize-y"
                placeholder="Enter system prompt for rewrite..."
              />
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Key emphasis: do NOT rewrite the original article. Add new entities and their descriptions
                while preserving the author's structure, style, and wording.
              </p>
            </div>

            {/* User prompt */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-[13px] font-semibold text-foreground">User Prompt</h4>
                <span className="text-[11px] text-muted-foreground font-mono">{"{article_text}"}, {"{gaps}"}</span>
              </div>
              <Textarea
                value={rewriteUserPrompt}
                onChange={(e) => setRewriteUserPrompt(e.target.value)}
                rows={10}
                className="font-mono text-xs leading-relaxed resize-y"
                placeholder="Enter user prompt for rewrite..."
              />
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Use {"{article_text}"} for the original article and {"{gaps}"} for the gap analysis edits.
                The user prompt instructs the LLM how to integrate the gaps into the article.
              </p>
            </div>

            <div className="flex justify-end mt-4">
              <Button onClick={handleRewritePromptsSave} disabled={rewriteSaving} size="sm">
                {rewriteSaving ? "Saving..." : "Save Rewrite Prompts"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}