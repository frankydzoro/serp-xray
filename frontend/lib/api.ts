// API-клиент SERP X-Ray.
// API_BASE: пустая строка = same-origin (в проде Next rewrites проксирует /api
// на backend; в dev `next dev` делает то же). Полный URL через NEXT_PUBLIC_API_URL
// — только если API живёт на другом origin.
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const TOKEN_KEY = "serpxray_token";

// ── Токен сессии ──────────────────────────
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  if (typeof window === "undefined") return;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* sessionStorage недоступен (private mode и т.п.) — auth работать не будет */
  }
}

export function clearToken() {
  setToken("");
}

// ── Основной fetch: токен + 401 → /login ──
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers || {});
  if (token) headers.set("X-Auth-Token", token);

  const resp = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (resp.status === 401 && token) {
    clearToken();
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  }
  return resp;
}

export async function login(password: string): Promise<void> {
  const resp = await fetch(`${API_BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(resp.status === 429 ? "Too many attempts. Try again later." : err || "Login failed");
  }
  const data = await resp.json();
  if (!data.token) throw new Error("Login failed");
  setToken(data.token);
}

/* ── Analysis ───────────────────────────── */

export async function analyzeQuery(
  query: string,
  url?: string,
  userText?: string,
  engine = "google"
): Promise<{ id: string }> {
  const resp = await apiFetch(`/api/analyze`, {
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

export type PageStep = "pending" | "fetching" | "extracting" | "done" | "failed";

export interface PageProgress {
  url: string;
  title: string;
  position: number;
  engine: string;
  step: PageStep;
  chars: number;
  entities: number;
}

export interface AnalysisProgress {
  pages: PageProgress[];
  // из progress_meta (только для running; пишется главной корутиной пайплайна)
  user_step?: "pending" | "extracting" | "done" | "failed" | "skipped";
  user_entities?: number;
  gap_step?: "pending" | "running" | "done" | "failed";
  gap_user_n?: number;
  gap_competitor_n?: number;
  gap_count?: number;
}

export interface AnalysisStatus {
  id: string;
  status: "running" | "completed" | "failed";
  stage: "searching" | "fetching" | "extracting" | "analyzing" | "building" | "done" | "error";
  progress?: AnalysisProgress;
  result: any | null;
  error: string | null;
}

export async function getAnalysisStatus(id: string): Promise<AnalysisStatus> {
  const url = `${API_BASE}/api/analyze/${id}/status`;
  let resp: Response;
  try {
    resp = await apiFetch(`/api/analyze/${id}/status`);
  } catch (e: any) {
    throw new Error(`Network error: ${e.message} (${url})`);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status} from ${url}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

export async function getHistory(limit = 50) {
  const resp = await apiFetch(`/api/history?limit=${limit}`);
  return resp.json();
}

export async function getReport(id: string) {
  const resp = await apiFetch(`/api/history/${id}`);
  if (!resp.ok) throw new Error("Report not found");
  return resp.json();
}

export async function deleteAnalysis(id: string) {
  const resp = await apiFetch(`/api/history/${id}`, { method: "DELETE" });
  if (!resp.ok) throw new Error(`Delete failed: HTTP ${resp.status}`);
  return resp.json();
}

export async function bulkDelete(ids: string[]) {
  const resp = await apiFetch(`/api/history/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!resp.ok) throw new Error(`Bulk delete failed: HTTP ${resp.status}`);
  return resp.json();
}

/* ── Admin: модель и промпты ────────────── */

export async function getModel() {
  const resp = await apiFetch(`/api/admin/model`);
  return resp.json();
}

export async function updateModel(model: string) {
  const resp = await apiFetch(`/api/admin/model`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  return resp.json();
}

export async function getPrompts() {
  const resp = await apiFetch(`/api/admin/prompts`);
  return resp.json();
}

export async function updatePrompts(entity_prompt: string, gap_prompt: string) {
  const resp = await apiFetch(`/api/admin/prompts`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity_prompt, gap_prompt }),
  });
  return resp.json();
}

export async function resetPrompts() {
  const resp = await apiFetch(`/api/admin/prompts/reset`, {
    method: "POST",
  });
  return resp.json();
}

/* ── Models ─────────────────────────────── */
export interface ModelInfo {
  id: string;
  name: string;
  canonical_slug?: string;
  description: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
    image: string;
    request: string;
  };
  architecture: {
    modality: string;
    input_modalities: string[];
    output_modalities: string[];
    instruct_type: string;
    tokenizer: string;
  };
  top_provider: {
    name?: string;
    context_length: number;
    is_moderated: boolean;
    max_completion_tokens: number;
  };
  supported_parameters: string[];
  created: number;
  knowledge_cutoff?: string;
  per_request_limits?: any;
}

export interface ModelsResponse {
  data: ModelInfo[];
  total: number;
  total_all: number;
}

export async function fetchModels(params?: {
  q?: string;
  modality?: string;
  sort?: string;
  min_price?: number;
  max_price?: number;
  min_context?: number;
  category?: string;
  providers?: string;
}): Promise<ModelsResponse> {
  const searchParams = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        searchParams.set(k, String(v));
      }
    }
  }
  const qs = searchParams.toString();
  const resp = await apiFetch(`/api/models${qs ? `?${qs}` : ""}`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch models: ${resp.status}`);
  }
  return resp.json();
}

/* ── Rewrite ──────────────────────────── */

export interface RewritePromptsData {
  system_prompt: string;
  user_prompt: string;
}

export interface RewriteModelData {
  model: string;
}

/** Полное состояние rewrite: none | running | completed | failed */
export interface RewriteState {
  status: string;
  error: string;
  rewritten_text: string;
  rewritten_at: string;
  started_at: string;
}

export async function getRewriteModel(): Promise<RewriteModelData> {
  const resp = await apiFetch(`/api/admin/rewrite-model`);
  return resp.json();
}

export async function updateRewriteModel(model: string): Promise<RewriteModelData> {
  const resp = await apiFetch(`/api/admin/rewrite-model`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  return resp.json();
}

export async function getRewritePrompts(): Promise<RewritePromptsData> {
  const resp = await apiFetch(`/api/admin/rewrite-prompts`);
  return resp.json();
}

export async function updateRewritePrompts(
  system_prompt: string,
  user_prompt: string
): Promise<RewritePromptsData> {
  const resp = await apiFetch(`/api/admin/rewrite-prompts`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system_prompt, user_prompt }),
  });
  return resp.json();
}

export async function resetRewritePrompts(): Promise<RewritePromptsData> {
  const resp = await apiFetch(`/api/admin/rewrite-prompts/reset`, {
    method: "POST",
  });
  return resp.json();
}

/** Запускает rewrite в фоне. Возвращает статус немедленно (не блокирует до готовности). */
export async function startRewrite(
  article_text: string,
  gaps: Array<Record<string, unknown>>,
  model?: string,
  analysis_id?: string,
): Promise<RewriteState> {
  const resp = await apiFetch(`/api/rewrite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ article_text, gaps, model, analysis_id }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(err);
  }
  return resp.json();
}

/** Поллинг состояния rewrite. 404 = анализ не найден. */
export async function getRewriteStatus(analysisId: string): Promise<RewriteState> {
  const resp = await apiFetch(`/api/rewrite/${analysisId}/status`);
  if (!resp.ok) {
    throw new Error(resp.status === 404 ? "Analysis not found" : `Failed: HTTP ${resp.status}`);
  }
  return resp.json();
}