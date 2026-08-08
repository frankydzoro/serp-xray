"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Engine = "google" | "yandex" | "both";

interface Props {
  onAnalyze: (query: string, url?: string, engine?: Engine) => void;
  loading: boolean;
}

const ENGINE_OPTIONS: { value: Engine; label: string; desc: string }[] = [
  { value: "google", label: " Google", desc: "Google only" },
  { value: "yandex", label: " Yandex", desc: "Yandex only" },
  { value: "both", label: "+ Both", desc: "Google + Yandex" },
];

export default function QueryForm({ onAnalyze, loading }: Props) {
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [engine, setEngine] = useState<Engine>("google");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    onAnalyze(query.trim(), url.trim() || undefined, engine);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-medium mb-1 block">Search query</label>
        <Input
          placeholder="e.g. how to choose a CRM for small business"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
          className="text-base"
        />
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium mb-1 block">Your page (optional)</label>
          <Input
            placeholder="https://example.com/my-page"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
          />
          <p className="text-xs text-muted-foreground mt-1">
            If provided  compares your page to the top-3 results
          </p>
        </div>

        <div className="w-48">
          <label className="text-sm font-medium mb-1 block">Search engine</label>
          <div className="flex gap-1">
            {ENGINE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={loading}
                onClick={() => setEngine(opt.value)}
                className={`flex-1 px-3 py-2 text-xs rounded-md border transition-colors ${
                  engine === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border hover:bg-muted text-muted-foreground"
                }`}
                title={opt.desc}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Button type="submit" disabled={loading || !query.trim()} className="w-full">
        {loading ? " Analyzing..." : "Analyze"}
      </Button>
    </form>
  );
}