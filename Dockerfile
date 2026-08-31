# syntax=docker/dockerfile:1

# Builds the NextJS static export. Needs network access, because next/font/google
# downloads the font files at build time.
FROM node:24-alpine AS frontend

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
ENV BUILD_STATIC=1
RUN npm run build

FROM python:3.14-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.7 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev

COPY backend/app ./app
COPY --from=frontend /build/out ./static

ENV DB_PATH=/data/pm.db \
    STATIC_DIR=/app/static

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
