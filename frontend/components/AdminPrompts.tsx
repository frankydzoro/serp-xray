"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getModel, updateModel, getPrompts, updatePrompts, resetPrompts } from "@/lib/api";

const MODELS = [
  { value: "openai/gpt-4o", label: "GPT-4o  balanced price/quality" },
  { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4  best quality" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash  fast & cheap" },
  { value: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro  good for Russian" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o Mini  budget" },
];

export default function AdminPrompts() {
  const [model, setModel] = useState("");
  const [entityPrompt, setEntityPrompt] = useState("");
  const [gapPrompt, setGapPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getModel().then((d) => setModel(d.model));
    getPrompts().then((d) => {
      setEntityPrompt(d.entity_prompt);
      setGapPrompt(d.gap_prompt);
    });
  }, []);

  const handleModelChange = async (m: string | null) => {
    if (!m) return;
    setModel(m);
    await updateModel(m);
    setMsg("Model saved");
    setTimeout(() => setMsg(""), 2000);
  };

  const handlePromptsSave = async () => {
    setSaving(true);
    await updatePrompts(entityPrompt, gapPrompt);
    setSaving(false);
    setMsg("Prompts saved");
    setTimeout(() => setMsg(""), 2000);
  };

  const handleReset = async () => {
    const d = await resetPrompts();
    setEntityPrompt(d.entity_prompt);
    setGapPrompt(d.gap_prompt);
    setMsg("Reset to defaults");
    setTimeout(() => setMsg(""), 2000);
  };

  return (
    <div className="space-y-6">
      {msg && (
        <div className="bg-green-900/30 text-green-400 px-4 py-2 rounded text-sm">{msg}</div>
      )}

      <div>
        <label className="text-sm font-medium mb-2 block">OpenRouter Model</label>
        <Select value={model} onValueChange={handleModelChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {MODELS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="text-sm font-medium mb-2 block">Entity Extraction Prompt</label>
        <p className="text-xs text-muted-foreground mb-2">
          Use {"{page_text}"} as placeholder for the page content
        </p>
        <Textarea value={entityPrompt} onChange={(e) => setEntityPrompt(e.target.value)} rows={8} className="font-mono text-xs" />
      </div>

      <div>
        <label className="text-sm font-medium mb-2 block">Gap Analysis Prompt</label>
        <p className="text-xs text-muted-foreground mb-2">
          Use {"{user_entities}"} and {"{top3_entities}"} as placeholders
        </p>
        <Textarea value={gapPrompt} onChange={(e) => setGapPrompt(e.target.value)} rows={6} className="font-mono text-xs" />
      </div>

      <div className="flex gap-3">
        <Button onClick={handlePromptsSave} disabled={saving}> Save Prompts</Button>
        <Button variant="outline" onClick={handleReset}> Reset to Defaults</Button>
      </div>
    </div>
  );
}