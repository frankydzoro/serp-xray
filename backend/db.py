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

        -- Индексы
        CREATE INDEX IF NOT EXISTS idx_analyses_created
            ON analyses(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_entities_cache_extracted
            ON entities_cache(extracted_at);
    """)

    # Миграция: добавляем колонки если их нет
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

    conn.commit()
    conn.close()


def create_running_analysis(
    analysis_id: str,
    query: str,
    model: str,
    url: str | None = None,
) -> None:
    """Создаёт запись анализа со статусом running."""
    conn = get_connection()
    conn.execute(
        "INSERT INTO analyses (id, query, url, model_used, result_json, status, stage) VALUES (?, ?, ?, ?, '{}', 'running', 'searching')",
        (analysis_id, query, url, model),
    )
    conn.commit()
    conn.close()


def update_analysis_status(analysis_id: str, stage: str) -> None:
    """Обновляет стадию без изменения статуса."""
    conn = get_connection()
    conn.execute(
        "UPDATE analyses SET stage = ? WHERE id = ?", (stage, analysis_id)
    )
    conn.commit()
    conn.close()


def complete_analysis(analysis_id: str, result: dict) -> None:
    """Завершает анализ: сохраняет результат, ставит status=completed."""
    conn = get_connection()
    conn.execute(
        "UPDATE analyses SET result_json = ?, status = 'completed', stage = 'done' WHERE id = ?",
        (json.dumps(result, ensure_ascii=False), analysis_id),
    )
    conn.commit()
    conn.close()


def fail_analysis(analysis_id: str, error: str) -> None:
    """Помечает анализ как failed."""
    conn = get_connection()
    conn.execute(
        "UPDATE analyses SET result_json = ?, status = 'failed', stage = 'error' WHERE id = ?",
        (json.dumps({"error": error}), analysis_id),
    )
    conn.commit()
    conn.close()


def get_analysis_status(analysis_id: str, timeout_minutes: int = 20) -> dict | None:
    """Возвращает статус и stage анализа. Автоматически помечает как failed при таймауте."""
    conn = get_connection()
    row = conn.execute(
        "SELECT id, status, stage, result_json, created_at FROM analyses WHERE id = ?",
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

    # Таймаут для застрявших анализов
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
    """Совместимость: сохраняет завершённый анализ (старый интерфейс)."""
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
    """Помечает rewrite как running. Возвращает rewrite_started_at (ISO) или None, если анализ не найден."""
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
    """Сохраняет завершённый rewrite: текст + status=completed."""
    conn = get_connection()
    conn.execute(
        "UPDATE analyses SET rewritten_text = ?, rewritten_at = ?, "
        "rewrite_status = 'completed', rewrite_error = '' WHERE id = ?",
        (rewritten_text, datetime.now(timezone.utc).isoformat(), analysis_id),
    )
    conn.commit()
    conn.close()


def fail_rewrite(analysis_id: str, error: str) -> None:
    """Помечает rewrite как failed с текстом ошибки."""
    conn = get_connection()
    conn.execute(
        "UPDATE analyses SET rewrite_status = 'failed', rewrite_error = ? WHERE id = ?",
        (error, analysis_id),
    )
    conn.commit()
    conn.close()


def get_rewrite(analysis_id: str, timeout_minutes: int = REWRITE_TIMEOUT_MINUTES) -> dict:
    """Возвращает текущее состояние rewrite.

    Результат: {status: none|running|completed|failed|not_found, error,
                rewritten_text, rewritten_at, started_at}

    Застрявшие в 'running' дольше timeout_minutes автоматически помечаются failed
    (защита от рестарта сервера посреди генерации).
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
    # Легаси-строки (до миграции): есть текст, но нет статуса → считаем completed
    status = d["rewrite_status"] or ("completed" if (d["rewritten_text"] or "").strip() else "none")

    # Авто-таймаут застрявших rewrite
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