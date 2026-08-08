"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";

const STAGES = [
  "🔍 Ищем топ-20 в Google...",
  "📄 Загружаем текст страниц...",
  "🧠 Извлекаем сущности через LLM...",
  "🕳 Анализируем разрывы...",
  "📋 Формируем чек-лист...",
];

export default function ReportSkeleton() {
  const [stage, setStage] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const start = Date.now();

    // Cycle through stages every 8 seconds
    intervalRef.current = setInterval(() => {
      setStage((s) => (s + 1) % STAGES.length);
    }, 8000);

    // Update elapsed time every second
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearInterval(timer);
    };
  }, []);

  const elapsedStr = elapsed < 60 ? `${elapsed}с` : `${Math.floor(elapsed / 60)}м ${elapsed % 60}с`;

  return (
    <Card className="border-primary/30 bg-card/80">
      <CardContent className="p-8">
        <div className="flex flex-col items-center gap-6">
          {/* Spinner */}
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-4 border-primary/20 animate-ping" />
            <div className="absolute inset-0 rounded-full border-4 border-t-primary border-r-transparent border-b-transparent border-l-transparent animate-spin" />
          </div>

          {/* Stage indicators */}
          <div className="space-y-3 w-full max-w-md">
            {STAGES.map((label, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 p-2 rounded transition-all duration-500 ${
                  i === stage
                    ? "bg-primary/10 text-primary font-medium scale-105"
                    : i < stage
                    ? "text-muted-foreground/40 line-through"
                    : "text-muted-foreground/50"
                }`}
              >
                <span className="text-lg">
                  {i < stage ? "✅" : i === stage ? "⏳" : "○"}
                </span>
                <span className="text-sm">{label}</span>
              </div>
            ))}
          </div>

          {/* Timer */}
          <div className="text-sm text-muted-foreground">
            ⏱ Прошло: <span className="font-mono text-primary">{elapsedStr}</span>
          </div>

          {/* Progress bar */}
          <div className="w-full max-w-md bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${Math.min((stage / STAGES.length) * 100, 90)}%` }}
            />
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Анализ поисковой выдачи: извлечение сущностей, сравнение с топ-3, формирование рекомендаций
          </p>
        </div>
      </CardContent>
    </Card>
  );
}