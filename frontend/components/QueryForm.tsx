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
  { value: "google", label: "🇬 Google", desc: "Только Google" },
  { value: "yandex", label: "🇾 Яндекс", desc: "Только Яндекс" },
  { value: "both", label: "🇬+🇾 Оба", desc: "Google + Яндекс" },
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
        <label className="text-sm font-medium mb-1 block">
          Поисковый запрос
        </label>
        <Input
          placeholder="например: как выбрать CRM для малого бизнеса"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={loading}
          className="text-base"
        />
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <label className="text-sm font-medium mb-1 block">
            Ваша страница (опционально)
          </label>
          <Input
            placeholder="https://example.com/my-page"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Если указать URL — сравним вашу страницу с топ-3 выдачи
          </p>
        </div>

        <div className="w-48">
          <label className="text-sm font-medium mb-1 block">
            Поисковик
          </label>
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
        {loading ? "⏳ Анализируем..." : "🔍 Анализировать"}
      </Button>
    </form>
  );
}