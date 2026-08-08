"use client";

import { useState, useCallback } from "react";

interface Props {
  items: string[];
}

export default function Checklist({ items }: Props) {
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const toggle = useCallback((i: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }, []);

  if (items.length === 0) return null;

  const done = checked.size;
  const total = items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[12px] font-semibold text-muted-foreground tabular-nums min-w-[3rem] text-right">
          {done}/{total}
        </span>
      </div>

      {/* Items */}
      <div className="space-y-0.5">
        {items.map((item, i) => {
          const isDone = checked.has(i);
          return (
            <button
              key={i}
              onClick={() => toggle(i)}
              className={`w-full flex items-start gap-3 p-2.5 -mx-2.5 rounded-lg text-left transition-all duration-150 group ${
                isDone
                  ? "opacity-50"
                  : "hover:bg-muted/50"
              }`}
            >
              {/* Checkbox */}
              <span
                className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                  isDone
                    ? "bg-primary border-primary"
                    : "border-muted-foreground/30 group-hover:border-primary/50"
                }`}
              >
                {isDone && (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </span>

              {/* Text */}
              <span
                className={`text-[13px] leading-relaxed flex-1 ${
                  isDone
                    ? "line-through text-muted-foreground"
                    : "text-foreground"
                }`}
              >
                {item}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}