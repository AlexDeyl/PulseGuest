FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# system deps (psycopg / Pillow и т.п. — по мере надобности расширим)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
  && rm -rf /var/lib/apt/lists/*

# create non-root user
RUN useradd -m appuser

# deps
COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# project
COPY . /app

RUN chmod +x /app/docker/entrypoint.sh /app/docker/start.sh \
  && chown -R appuser:appuser /app

USER appuser

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["/app/docker/start.sh"]
