import sqlite3
import json
import os
from datetime import datetime, timezone
from typing import Optional

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_PATH = os.path.join(DB_DIR, "serp-xray.db")


def get_connection() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS analyses (
            id TEXT PRIMARY KEY,
            query TEXT NOT NULL,
            url TEXT,
            result_json TEXT NOT NULL DEFAULT '{}',
            model_used TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            stage TEXT NOT NULL DEFAULT 'searching',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS entities_cache (
            url TEXT PRIMARY KEY,
            entities_json TEXT NOT NULL,
            extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Per-page analysis progress: point-updates from concurrent coroutines;
        -- a race condition is impossible — each row is updated only by its own coroutine
        CREATE TABLE IF NOT EXISTS analysis_pages (
            analysis_id TEXT NOT NULL,
            url TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            position INTEGER NOT NULL DEFAULT 0,
            engine TEXT NOT NULL DEFAULT '',
            step TEXT NOT NULL DEFAULT 'pending',
            chars INTEGER NOT NULL DEFAULT 0,
            entities INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (analysis_id, url)
        );

        -- Auth: session tokens (only the sha256 of the token is stored, not the token itself).
        -- password_sha — hash of the current env password: changing the password instantly
        -- invalidates all old sessions without manual cleanup (compared on every request).
        CREATE TABLE IF NOT EXISTS auth_sessions (
            token_hash TEXT PRIMARY KEY,
            password_sha TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_analyses_created
            ON analyses(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_entities_cache_extracted
            ON entities_cache(extracted_at);
    """)

    # Migration: add columns if they don't exist
    try:
        conn.execute("ALTER TABLE analyses ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE analyses ADD COLUMN stage TEXT NOT NULL DEFAULT 'done'")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE analyses ADD COLUMN rewritten_text TEXT NOT NULL DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE analyses ADD COLUMN rewritten_at TEXT NOT NULL DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE analyses ADD COLUMN rewrite_status TEXT NOT NULL DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE analyses ADD COLUMN rewrite_error TEXT NOT NULL DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        conn.execute("ALTER TABLE analyses ADD COLUMN rewrite_started_at TEXT NOT NULL DEFAULT ''")
    except sqlite3.OperationalError:
        pass
    try:
        # Progress metadata (user_page / gap). Written ONLY from the main pipeline
        # coroutine between stages — no concurrency, so JSON is safe.
        conn.execute("ALTER TABLE analyses ADD COLUMN progress_meta TEXT NOT NULL DEFAULT '{}'")
    except sqlite3.OperationalError:
        pass

    conn.commit()
    conn.close()


def create_running_analysis(
    analysis_id: str,
    query: str,
    model: str,
    url: str | None = None,
) -> None:
    """Creates an analysis record with status=running."""
    conn = get_connection()
    conn.execute(
        "INSERT INTO analyses (id, query, url, model_used, result_json, status, stage) VALUES (?, ?, ?, ?, '{}', 'running', 'searching')",
        (analysis_id, query, url, model),
    )
    conn.commit()
    conn.close()


def update_analysis_status(analysis_id: str, stage: str) -> None:
    """Updates the stage without changing the status."""
    conn = get_connection()
    conn.execute(
        "UPDATE analyses SET stage = ? WHERE id = ?", (stage, analysis_id)
    )
    conn.commit()
    conn.close()


def register_pages(analysis_id: str, pages: list[dict]) -> None:
    """Registers competitor pages with status=pending (before fetch/extract)."""
    conn = get_connection()
    conn.executemany(
        """INSERT OR IGNORE INTO analysis_pages
           (analysis_id, url, title, position, engine, step)
           VALUES (?, ?, ?, ?, ?, 'pending')""",
        [
            (
                analysis_id,
                p["url"],
                p.get("title", ""),
                p.get("position", 0),
                p.get("engine", ""),
            )
            for p in pages
        ],
    )
    conn.commit()
    conn.close()


def update_page(
    analysis_id: str,
    url: str,
    step: str | None = None,
    chars: int | None = None,
    entities: int | None = None,
) -> None:
    """Point-update of a single analysis_pages row. No read-modify-write."""
    sets = ["updated_at = datetime('now')"]
    params: list = []
    if step is not None:
        sets.append("step = ?")
        params.append(step)
    if chars is not None:
        sets.append("chars = ?")
        params.append(chars)
    if entities is not None:
        sets.append("entities = ?")
        params.append(entities)
    params += [analysis_id, url]
    conn = get_connection()
    conn.execute(
        f"UPDATE analysis_pages SET {', '.join(sets)} WHERE analysis_id = ? AND url = ?",
        params,
    )
    conn.commit()
    conn.close()


def set_progress_meta(analysis_id: str, meta: dict) -> None:
    """Updates progress_meta (user_page / gap). Safe: called only from the main
    pipeline coroutine (after asyncio.gather), no races."""
    conn = get_connection()
    row = conn.execute(
        "SELECT progress_meta FROM analyses WHERE id = ?", (analysis_id,)
    ).fetchone()
    current = {}
    if row and row["progress_meta"]:
        try:
            current = json.loads(row["progress_meta"])
        except json.JSONDecodeError:
            current = {}
    current.update(meta)
    conn.execute(
        "UPDATE analyses SET progress_meta = ? WHERE id = ?",
        (json.dumps(current, ensure_ascii=False), analysis_id),
    )
    conn.commit()
    conn.close()


def complete_analysis(analysis_id: str, result: dict) -> None:
    """Completes the analysis: saves the result, sets status=completed."""
    conn = get_connection()
    conn.execute(
        "UPDATE analyses SET result_json = ?, status = 'completed', stage = 'done' WHERE id = ?",
        (json.dumps(result, ensure_ascii=False), analysis_id),
    )
    conn.commit()
    conn.close()


def fail_analysis(analysis_id: str, error: str) -> None:
    """Marks the analysis as failed."""
    conn = get_connection()
    conn.execute(
        "UPDATE analyses SET result_json = ?, status = 'failed', stage = 'error' WHERE id = ?",
        (json.dumps({"error": error}), analysis_id),
    )
    conn.commit()
    conn.close()


def get_analysis_status(analysis_id: str, timeout_minutes: int = 20) -> dict | None:
    """Returns the status, stage and progress of an analysis. Auto-marks as failed on timeout."""
    conn = get_connection()
    row = conn.execute(
        "SELECT id, status, stage, result_json, created_at, progress_meta FROM analyses WHERE id = ?",
        (analysis_id,),
    ).fetchone()
    if not row:
        conn.close()
        return None
    d = dict(row)
    try:
        d["result_json"] = json.loads(d["result_json"])
    except (json.JSONDecodeError, KeyError):
        d["result_json"] = {}

    # Per-page progress: articles + metadata (user_page / gap)
    pages = conn.execute(
        """SELECT url, title, position, engine, step, chars, entities
           FROM analysis_pages
           WHERE analysis_id = ? ORDER BY position ASC""",
        (analysis_id,),
    ).fetchall()
    meta = {}
    try:
        meta = json.loads(d.get("progress_meta") or "{}")
    except json.JSONDecodeError:
        meta = {}
    d["progress"] = {"pages": [dict(p) for p in pages], **meta}
    d.pop("progress_meta", None)

    # Timeout for stuck analyses
    if d["status"] == "running":
        try:
            created_at = datetime.fromisoformat(d["created_at"]).replace(tzinfo=timezone.utc)
            elapsed = (datetime.now(timezone.utc) - created_at).total_seconds()
            if elapsed > timeout_minutes * 60:
                conn.execute(
                    "UPDATE analyses SET result_json = ?, status = 'failed', stage = 'error' WHERE id = ?",
                    (json.dumps({"error": f"Timed out after {int(elapsed)}s"}), analysis_id),
                )
                conn.commit()
                d["status"] = "failed"
                d["stage"] = "error"
                d["result_json"] = {"error": f"Timed out after {int(elapsed)}s"}
        except (ValueError, KeyError):
            pass

    conn.close()
    return d


def save_analysis(
    analysis_id: str,
    query: str,
    result: dict,
    model: str,
    url: str | None = None,
) -> None:
    """Compat: saves a completed analysis (legacy interface)."""
    complete_analysis(analysis_id, result)


def get_analysis(analysis_id: str) -> dict | None:
    conn = get_connection()
    row = conn.execute("SELECT * FROM analyses WHERE id = ?", (analysis_id,)).fetchone()
    conn.close()
    if row:
        result = dict(row)
        try:
            result["result_json"] = json.loads(result["result_json"])
        except (json.JSONDecodeError, KeyError):
            result["result_json"] = {}
        # Keep rewritten_text in the dict
        return result
    return None


def list_analyses(limit: int = 50) -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, query, url, model_used, status, stage, created_at, rewritten_text, rewrite_status, result_json FROM analyses ORDER BY created_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    results = []
    for r in rows:
        d = dict(r)
        try:
            result_data = json.loads(d["result_json"])
            d["entities_found"] = result_data.get("entities_found", 0)
            d["gaps_count"] = len(result_data.get("gaps", []))
        except (json.JSONDecodeError, KeyError):
            d["entities_found"] = 0
            d["gaps_count"] = 0
        # Add rewrite flags
        has_rewrite = bool((d.get("rewritten_text", "") or "").strip())
        d["has_rewrite"] = has_rewrite
        d["rewrite_status"] = d.get("rewrite_status") or ("completed" if has_rewrite else "")
        del d["result_json"]
        del d["rewritten_text"]
        results.append(d)
    return results


def get_setting(key: str) -> str | None:
    conn = get_connection()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value)
    )
    conn.commit()
    conn.close()


def get_cached_entities(url: str, max_age_hours: int = 24) -> list[dict] | None:
    conn = get_connection()
    row = conn.execute(
        "SELECT entities_json, extracted_at FROM entities_cache WHERE url = ?", (url,)
    ).fetchone()
    conn.close()
    if row:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(row["extracted_at"])
        if age.total_seconds() < max_age_hours * 3600:
            return json.loads(row["entities_json"])
    return None


def cache_entities(url: str, entities: list[dict]) -> None:
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO entities_cache (url, entities_json, extracted_at) VALUES (?, ?, ?)",
        (url, json.dumps(entities, ensure_ascii=False), datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()


def delete_analysis(analysis_id: str) -> bool:
    conn = get_connection()
    cursor = conn.execute("DELETE FROM analyses WHERE id = ?", (analysis_id,))
    conn.commit()
    deleted = cursor.rowcount > 0
    conn.close()
    return deleted


def delete_analyses_bulk(ids: list[str]) -> int:
    conn = get_connection()
    placeholders = ",".join("?" for _ in ids)
    cursor = conn.execute(
        f"DELETE FROM analyses WHERE id IN ({placeholders})", ids
    )
    conn.commit()
    deleted = cursor.rowcount
    conn.close()
    return deleted


# ── Rewrite ──────────────────────────────

REWRITE_TIMEOUT_MINUTES = 10


def start_rewrite(analysis_id: str) -> str | None:
    """Marks a rewrite as running. Returns rewrite_started_at (ISO) or None if the analysis was not found."""
    started_at = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    cursor = conn.execute(
        "UPDATE analyses SET rewrite_status = 'running', rewrite_error = '', "
        "rewrite_started_at = ? WHERE id = ?",
        (started_at, analysis_id),
    )
    conn.commit()
    found = cursor.rowcount > 0
    conn.close()
    return started_at if found else None


def save_rewrite(analysis_id: str, rewritten_text: str) -> None:
    """Saves a completed rewrite: text + status=completed."""
    conn = get_connection()
    conn.execute(
        "UPDATE analyses SET rewritten_text = ?, rewritten_at = ?, "
        "rewrite_status = 'completed', rewrite_error = '' WHERE id = ?",
        (rewritten_text, datetime.now(timezone.utc).isoformat(), analysis_id),
    )
    conn.commit()
    conn.close()


def fail_rewrite(analysis_id: str, error: str) -> None:
    """Marks a rewrite as failed with an error message."""
    conn = get_connection()
    conn.execute(
        "UPDATE analyses SET rewrite_status = 'failed', rewrite_error = ? WHERE id = ?",
        (error, analysis_id),
    )
    conn.commit()
    conn.close()


def get_rewrite(analysis_id: str, timeout_minutes: int = REWRITE_TIMEOUT_MINUTES) -> dict:
    """Returns the current rewrite state.

    Result: {status: none|running|completed|failed|not_found, error,
             rewritten_text, rewritten_at, started_at}

    Jobs stuck in 'running' for longer than timeout_minutes are auto-marked failed
    (protection against a server restart mid-generation).
    """
    conn = get_connection()
    row = conn.execute(
        "SELECT rewritten_text, rewritten_at, rewrite_status, rewrite_error, rewrite_started_at "
        "FROM analyses WHERE id = ?",
        (analysis_id,),
    ).fetchone()
    if not row:
        conn.close()
        return {"status": "not_found", "error": "", "rewritten_text": "", "rewritten_at": "", "started_at": ""}

    d = dict(row)
    # Legacy rows (pre-migration): text present but no status → treat as completed
    status = d["rewrite_status"] or ("completed" if (d["rewritten_text"] or "").strip() else "none")

    # Auto-timeout stuck rewrites
    if status == "running" and d["rewrite_started_at"]:
        try:
            started = datetime.fromisoformat(d["rewrite_started_at"])
            elapsed = (datetime.now(timezone.utc) - started).total_seconds()
            if elapsed > timeout_minutes * 60:
                error_msg = f"Timed out after {int(elapsed)}s"
                conn.execute(
                    "UPDATE analyses SET rewrite_status = 'failed', rewrite_error = ? WHERE id = ?",
                    (error_msg, analysis_id),
                )
                conn.commit()
                status = "failed"
                d["rewrite_error"] = error_msg
        except ValueError:
            pass

    conn.close()
    return {
        "status": status,
        "error": d["rewrite_error"] or "",
        "rewritten_text": d["rewritten_text"] if status == "completed" else "",
        "rewritten_at": d["rewritten_at"] or "",
        "started_at": d["rewrite_started_at"] or "",
    }


# ── Auth sessions ─────────────────────────

def create_session(token_hash: str, password_sha: str, expires_at: str) -> None:
    """Creates a session. Only the token hash is stored — the token itself is never persisted."""
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO auth_sessions (token_hash, password_sha, created_at, expires_at) "
        "VALUES (?, ?, ?, ?)",
        (token_hash, password_sha, datetime.now(timezone.utc).isoformat(), expires_at),
    )
    conn.commit()
    conn.close()


def get_session(token_hash: str) -> Optional[dict]:
    """Returns the session by token hash, or None."""
    conn = get_connection()
    row = conn.execute(
        "SELECT token_hash, password_sha, created_at, expires_at FROM auth_sessions WHERE token_hash = ?",
        (token_hash,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def touch_session(token_hash: str, expires_at: str) -> None:
    """Sliding session renewal: pushes expires_at forward."""
    conn = get_connection()
    conn.execute(
        "UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?",
        (expires_at, token_hash),
    )
    conn.commit()
    conn.close()


def delete_expired_sessions() -> None:
    """Deletes expired sessions. Called on a successful login — the table stays small."""
    conn = get_connection()
    conn.execute("DELETE FROM auth_sessions WHERE expires_at < ?", (datetime.now(timezone.utc).isoformat(),))
    conn.commit()
    conn.close()
