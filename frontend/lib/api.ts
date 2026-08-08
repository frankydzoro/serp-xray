const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function analyzeQuery(query: string, url?: string, engine = "google") {
  const resp = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, url, engine }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(err);
  }
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