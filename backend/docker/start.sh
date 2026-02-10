#!/usr/bin/env bash
set -e

# миграции
alembic upgrade head

# dev-run (можно потом заменить на gunicorn+uvicorn workers)
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
