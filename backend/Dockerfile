FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Ровно 1 воркер: SQLite + in-memory rate limit корректны только в одном процессе.
# Запуск без --reload (релоадер ломает импорты / меняет cwd).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]