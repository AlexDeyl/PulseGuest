#!/usr/bin/env bash
set -e

# Здесь только подготовка окружения.
# Миграции/collectstatic — в start.sh (чтобы удобно контролировать режимы)

exec "$@"
