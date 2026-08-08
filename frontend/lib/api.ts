const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function analyzeQuery(
  query: string,
  url?: string,
  userText?: string,
  engine = "google"
): Promise<{ id: string }> {
  const resp = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, url, user_text: userText || null, engine }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(err);
  }
  return resp.json();
}

export interface AnalysisStatus {
  id: string;
  status: "running" | "completed" | "failed";
  stage: "searching" | "fetching" | "extracting" | "analyzing" | "building" | "done" | "error";
  result: any | null;
  error: string | null;
}

export async function getAnalysisStatus(id: string): Promise<AnalysisStatus> {
  const resp = await fetch(`${API_BASE}/api/analyze/${id}/status`);
  if (!resp.ok) throw new Error("Status check failed");
  return resp.json();
}

export async function getHistory(limit = 50) {
  const resp = await fetch(`${API_BASE}/api/history?limit=${limit}`);
  return resp.json();
}

export async function getReport(id: string) {
  const resp = await fetch(`${API_BASE}/api/history/${id}`);
  if (!resp.ok) throw new Error("Report not found");
  return resp.json();
}

export async function getModel() {
  const resp = await fetch(`${API_BASE}/api/admin/model`);
  return resp.json();
}

export async function updateModel(model: string) {
  const resp = await fetch(`${API_BASE}/api/admin/model`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  return resp.json();
}

export async function getPrompts() {
  const resp = await fetch(`${API_BASE}/api/admin/prompts`);
  return resp.json();
}

export async function updatePrompts(entity_prompt: string, gap_prompt: string) {
  const resp = await fetch(`${API_BASE}/api/admin/prompts`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity_prompt, gap_prompt }),
  });
  return resp.json();
}

export async function resetPrompts() {
  const resp = await fetch(`${API_BASE}/api/admin/prompts/reset`, {
    method: "POST",
  });
  return resp.json();
}