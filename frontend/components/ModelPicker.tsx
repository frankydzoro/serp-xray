"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { fetchModels, type ModelInfo } from "@/lib/api";

/* ── Helpers ─────────────────────────────── */

export function fmtPrice(priceStr: string | undefined | null): string {
  if (!priceStr) return "—";
  const p = parseFloat(priceStr) * 1_000_000;
  if (p === 0) return "Free";
  if (p >= 100) return `$${p.toFixed(0)}`;
  if (p >= 1) return `$${p.toFixed(1)}`;
  if (p >= 0.01) return `$${p.toFixed(3)}`;
  return `< $0.01`;
}

export function fmtNum(n: number | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/* ── ModelPicker component ────────────────── */

export default function ModelPicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

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