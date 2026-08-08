"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  getModel,
  updateModel,
  getPrompts,
  updatePrompts,
  resetPrompts,
} from "@/lib/api";

interface ModelOption {
  value: string;
  label: string;
  desc: string;
  tags: string[];
}

const MODELS: ModelOption[] = [
  {
    value: "openai/gpt-4o",
    label: "GPT-4o",
    desc: "Best balance of speed, quality, and cost for entity extraction.",
    tags: ["recommended", "balanced"],
  },
  {
    value: "anthropic/claude-sonnet-4",
    label: "Claude Sonnet 4",
    desc: "Highest quality entity recognition. Best for nuanced gap analysis.",
    tags: ["quality"],
  },
  {
    value: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    desc: "Fastest response. Good for quick scans and high-volume analysis.",
    tags: ["fast"],
  },
  {
    value: "deepseek/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    desc: "Strong Russian-language understanding. Good for Yandex-focused queries.",
    tags: ["russian"],
  },
  {
    value: "openai/gpt-4o-mini",
    label: "GPT-4o Mini",
    desc: "Budget option. Suitable for testing prompts and low-priority tasks.",
    tags: ["cheap"],
  },
];

function Toast({ message, type = "success" }: { message: string; type?: "success" | "error" }) {
  if (!message) return null;
  const bg = type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800";
  return (
    <div className={`fixed top-16 right-6 z-50 px-4 py-2.5 rounded-lg border text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-200 ${bg}`}>
      {message}
    </div>
  );
}

export default function AdminPrompts() {
  const [model, setModel] = useState("");
  const [entityPrompt, setEntityPrompt] = useState("");
  const [gapPrompt, setGapPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" }>({ message: "", type: "success" });
  const [activeTab, setActiveTab] = useState<"entity" | "gap">("entity");

  useEffect(() => {
    getModel().then((d) => setModel(d.model));
    getPrompts().then((d) => {
      setEntityPrompt(d.entity_prompt);
      setGapPrompt(d.gap_prompt);
    });
  }, []);

  const flash = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast({ message: "", type: "success" }), 2500);
  };

  const handleModelChange = async (m: string) => {
    setModel(m);
    try {
      await updateModel(m);
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

  const tagColor = (tag: string) => {
    switch (tag) {
      case "recommended":
        return "bg-primary/10 text-primary border-primary/20";
      case "balanced":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "quality":
        return "bg-purple-50 text-purple-700 border-purple-200";
      case "fast":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "russian":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "cheap":
        return "bg-slate-100 text-slate-600 border-slate-200";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <div className="space-y-8">
      <Toast message={toast.message} type={toast.type} />

      {/* Model selection — radio cards */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Model</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {MODELS.map((m) => {
            const active = model === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => handleModelChange(m.value)}
                className={`text-left p-3.5 rounded-xl border-2 transition-all duration-150 ${
                  active
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border/60 hover:border-border hover:bg-muted/30"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-foreground">
                    {m.label}
                  </span>
                  {active && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      className="text-primary shrink-0"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground leading-relaxed mb-2">
                  {m.desc}
                </p>
                <div className="flex flex-wrap gap-1">
                  {m.tags.map((tag) => (
                    <span
                      key={tag}
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${tagColor(tag)}`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Prompt editors — tabbed on mobile, side-by-side on desktop */}
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
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === tab
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
          <div className={activeTab === "gap" ? "hidden lg:block" : ""}>
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-[13px] font-semibold text-foreground">
                Entity Extraction
              </h4>
              <span className="text-[11px] text-muted-foreground font-mono">
                {"{page_text}"}
              </span>
            </div>
            <Textarea
              value={entityPrompt}
              onChange={(e) => setEntityPrompt(e.target.value)}
              rows={12}
              className="font-mono text-xs leading-relaxed resize-y"
              placeholder="Enter entity extraction prompt..."
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Use {"{page_text}"} as placeholder. Instruct the LLM how to
              extract and classify entities.
            </p>
          </div>

          {/* Gap prompt */}
          <div className={activeTab === "entity" ? "hidden lg:block" : ""}>
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-[13px] font-semibold text-foreground">
                Gap Analysis
              </h4>
              <span className="text-[11px] text-muted-foreground font-mono">
                {"{user_entities}"}, {"{competitor_entities}"}
              </span>
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
    </div>
  );
}