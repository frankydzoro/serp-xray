"use client";

import { useMemo } from "react";
import { diff_match_patch } from "diff-match-patch";

interface Props {
  original: string;
  rewritten: string;
}

interface DiffLine {
  text: string;
  type: "added" | "removed" | "equal";
}

function computeDiff(original: string, rewritten: string): DiffLine[] {
  const dmp = new diff_match_patch();
  // Use line-mode diff
  const a = original;
  const b = rewritten;
  const lineText1 = a;
  const lineText2 = b;
  const diffs = dmp.diff_main(lineText1, lineText2, true);
  dmp.diff_cleanupSemantic(diffs);

  const lines: DiffLine[] = [];
  for (const [op, text] of diffs) {
    // Split text into lines for display
    if (!text) continue;
    const textLines = text.split("\n");
    for (let i = 0; i < textLines.length; i++) {
      const line = textLines[i];
      let type: DiffLine["type"] = "equal";
      if (op === 1) type = "added";
      else if (op === -1) type = "removed";
      // For 'equal' ops, skip empty lines but keep structure
      // For added/removed, always include
      if (type === "equal" && (!line || line.trim() === "") && i < textLines.length - 1) {
        lines.push({ text: "", type: "equal" });
        continue;
      }
      lines.push({ text: line, type });
    }
    // Add a blank separator line between diff chunks
    lines.push({ text: "", type: "equal" });
  }

  return lines;
}

/* ── Legend ──────────────────────────────── */

function Legend() {
  return (
    <div className="flex items-center gap-4 mb-3 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-300" />
        Added
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-red-50 border border-red-300" />
        Removed
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-background border border-border/40" />
        Unchanged
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────── */

export default function DiffView({ original, rewritten }: Props) {
  const lines = useMemo(() => computeDiff(original, rewritten), [original, rewritten]);

  return (
    <div>
      <Legend />
      <div className="border border-border/60 rounded-lg overflow-hidden bg-card max-h-[60vh] overflow-y-auto">
        {lines.map((line, i) => {
          let bg = "";
          let prefix = "";
          if (line.type === "added") {
            bg = "bg-emerald-50 border-l-2 border-emerald-400";
            prefix = "+";
          } else if (line.type === "removed") {
            bg = "bg-red-50 border-l-2 border-red-400";
            prefix = "−";
          } else {
            bg = "";
            prefix = " ";
          }

          return (
            <div
              key={i}
              className={`flex items-start px-3 py-0.5 font-mono text-xs leading-relaxed ${bg}`}
            >
              <span className="w-5 shrink-0 text-muted-foreground select-none text-right mr-2">
                {line.type !== "equal" ? prefix : ""}
              </span>
              <span className="flex-1 whitespace-pre-wrap break-words">{line.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}