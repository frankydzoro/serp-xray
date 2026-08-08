import sqlite3
import json
import os
from datetime import datetime, timezone

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
            result_json TEXT NOT NULL,
            model_used TEXT NOT NULL,
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

        -- Индексы
        CREATE INDEX IF NOT EXISTS idx_analyses_created
            ON analyses(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_entities_cache_extracted
            ON entities_cache(extracted_at);
    """)
    conn.commit()
    conn.close()


def save_analysis(
    analysis_id: str,
    query: str,
    result: dict,
    model: str,
    url: str | None = None,
) -> None:
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO analyses (id, query, url, result_json, model_used) VALUES (?, ?, ?, ?, ?)",
        (analysis_id, query, url, json.dumps(result, ensure_ascii=False), model),
    )
    conn.commit()
    conn.close()


def get_analysis(analysis_id: str) -> dict | None:
    conn = get_connection()
    row = conn.execute("SELECT * FROM analyses WHERE id = ?", (analysis_id,)).fetchone()
    conn.close()
    if row:
        result = dict(row)
        result["result_json"] = json.loads(result["result_json"])
        return result
    return None


def list_analyses(limit: int = 50) -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, query, url, model_used, created_at, result_json FROM analyses ORDER BY created_at DESC LIMIT ?",
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
        del d["result_json"]
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