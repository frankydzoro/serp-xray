"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  getModel,
  updateModel,
  getPrompts,
  updatePrompts,
  resetPrompts,
  fetchModels,
  type ModelInfo,
} from "@/lib/api";

/* ── Helpers ─────────────────────────────── */

function fmtPrice(priceStr: string | undefined | null): string {
  if (!priceStr) return "—";
  const p = parseFloat(priceStr) * 1_000_000;
  if (p === 0) return "Free";
  if (p >= 100) return `$${p.toFixed(0)}`;
  if (p >= 1) return `$${p.toFixed(1)}`;
  if (p >= 0.01) return `$${p.toFixed(3)}`;
  return `< $0.01`;
}

function fmtNum(n: number | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function Toast({ message, type = "success" }: { message: string; type?: "success" | "error" }) {
  if (!message) return null;
  const bg = type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800";
  return (
    <div className={`fixed top-16 right-6 z-50 px-4 py-2.5 rounded-lg border text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-200 ${bg}`}>
      {message}
    </div>
  );
}

/* ── Model picker ─────────────────────────── */

function ModelPicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Load models on mount
  useEffect(() => {
    fetchModels()
      .then((res) => {
        setModels(res.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? models.filter(
        (m) =>
          m.name.toLowerCase().includes(search.toLowerCase()) ||
          m.id.toLowerCase().includes(search.toLowerCase())
      )
    : models;

  return (
    <div className="space-y-3">
      <Input
        placeholder="Search models..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="text-sm"
      />

      {loading ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Loading models...
        </div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto border border-border/60 rounded-xl divide-y divide-border/40">
          {filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No models found
            </div>
          ) : (
            filtered.map((m) => {
              const active = selected === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onSelect(m.id)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                    active
                      ? "bg-primary/5"
                      : "hover:bg-muted/30"
                  }`}
                >
                  {/* Radio indicator */}
                  <span
                    className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${
                      active
                        ? "border-primary"
                        : "border-muted-foreground/30"
                    }`}
                  >
                    {active && (
                      <span className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </span>

                  {/* Model name + id */}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-foreground truncate">
                      {m.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">
                      {m.id}
                    </div>
                  </div>

                  {/* Pricing */}
                  <div className="shrink-0 flex items-center gap-4 text-xs">
                    <div className="text-right">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        In
                      </div>
                      <div className="font-semibold tabular-nums text-foreground">
                        {fmtPrice(m.pricing?.prompt)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        Out
                      </div>
                      <div className="font-semibold tabular-nums text-foreground">
                        {fmtPrice(m.pricing?.completion)}
                      </div>
                    </div>
                    <div className="text-right min-w-[50px]">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        Ctx
                      </div>
                      <div className="font-semibold tabular-nums text-foreground">
                        {fmtNum(m.context_length)}
                      </div>
                    </div>
                    <div className="text-right min-w-[50px]">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        Max
                      </div>
                      <div className="font-semibold tabular-nums text-foreground">
                        {fmtNum(m.top_provider?.max_completion_tokens)}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {filtered.length} model{filtered.length !== 1 ? "s" : ""}
        {search ? ` matching «${search}»` : " available"}
      </p>
    </div>
  );
}

/* ── Main component ───────────────────────── */

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

  return (
    <div className="space-y-8">
      <Toast message={toast.message} type={toast.type} />

      {/* Model selection — live search from OpenRouter */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Model</h3>
        <ModelPicker selected={model} onSelect={handleModelChange} />
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