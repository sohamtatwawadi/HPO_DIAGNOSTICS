# ─── Dockerfile ───────────────────────────────────────────────────────────────
# Multi-stage build: Node (frontend) → Python (backend + static files)
# Designed for Railway's 4 GB builder memory limit.
#
# Key decisions:
#  - numpy installed alone first  → resolves fast, no conflict surface
#  - scipy installed alone second → wheel is pre-built, ~105 MB, no compilation
#  - pyhpo + rest installed last  → tiny resolver graph, no heavy deps
#  - pandas REMOVED               → not used in main.py or pyhpo_service.py
#  - --no-cache-dir on every pip  → saves ~200 MB of builder disk
#  - NODE_OPTIONS=--max-old-space-size=512 → caps Vite's heap during frontend build

# ── Stage 1: build the React frontend ─────────────────────────────────────────
FROM node:20-slim AS frontend

WORKDIR /app/frontend

# Copy package files first for layer caching
COPY frontend/package*.json ./

# Cap Node heap to 512 MB — Vite only needs ~200 MB, this is plenty
ENV NODE_OPTIONS=--max-old-space-size=512

RUN npm ci --prefer-offline

COPY frontend/ ./
RUN npm run build
# Output: /app/frontend/dist

# ── Stage 2: Python backend + serve frontend as static files ──────────────────
FROM python:3.11-slim AS backend

# python:3.11-slim is ~50 MB smaller than 3.12-slim and scipy has proven wheels for 3.11
# Use 3.12 if your code requires it — just swap the tag

WORKDIR /app

# System deps needed by scipy/numpy (already present in slim, but be explicit)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# ── Install Python deps in three isolated steps to minimise peak resolver RAM ──
#
# Step A: numpy alone
#   scipy's only real dependency; installing it first means scipy's resolver
#   finds it in the local cache immediately and does zero network work.
RUN pip install --no-cache-dir "numpy>=1.26,<3"

# Step B: scipy alone
#   Pre-built wheel for linux/amd64, ~105 MB. No compilation.
#   Pinning to <1.14 avoids pulling numpy 2.x as an upgrade.
RUN pip install --no-cache-dir "scipy>=1.11,<1.14"

# Step C: everything else (tiny resolver graph — all heavy deps already satisfied)
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./

# Copy built frontend into static/ so FastAPI serves it
COPY --from=frontend /app/frontend/dist ./static/

# Railway injects PORT at runtime; default to 8000 locally
ENV PORT=8000
EXPOSE 8000

# Warm all PyHPO caches at startup (ontology + 4 enrichment models)
# This takes ~15 s on first boot but means the first request is instant.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
