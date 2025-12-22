#!/usr/bin/env bash
set -e

# Эти команды безопасны: если БД недоступна — контейнер упадёт (так и надо в проде)
python manage.py migrate --noinput
python manage.py collectstatic --noinput || true

# gunicorn (WSGI). Позже при желании переведём на ASGI + uvicorn.
gunicorn config.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers 3 \
  --timeout 60
