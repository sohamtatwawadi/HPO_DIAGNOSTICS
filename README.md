# HPO Diagnostics

React (Vite) + FastAPI + [PyHPO](https://github.com/COMBINE-lab/pyhpo) clinical phenotype workspace: differential diagnosis, similarity, gene/cohort tools, disease deep-dive, IC profiler, and a 7-step workflow.

## Local development

**Backend** (installs `pyhpo` from PyPI):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend** (proxies `/api` → port 8000):

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (e.g. `http://localhost:5173`). Do **not** set `VITE_API_URL` during local dev unless you intentionally point at another host.

## Production (Docker)

Single image: builds the SPA into `/app/static`, FastAPI serves `/api/*` and the UI at `/`.

```bash
docker build -t hpo-diagnostics .
docker run -p 8000:8000 -e PORT=8000 hpo-diagnostics
```

Health: `GET /api/health` (returns `ready` after ontology + models load; first boot can take **~30–60s** — set a generous health-check timeout).

## [Railway](https://railway.app/)

1. New project → **Deploy from GitHub** → select this repo.
2. Railway detects the **Dockerfile** (or choose **Docker** as the builder).
3. **Variables:** optional; `PORT` is injected automatically.
4. **Resources:** allocate enough **RAM** for PyHPO + annotations (often **≥ 2 GB**; increase if the container OOMs on startup).
5. After deploy, open your service URL — the UI and API share the same origin, so `/api` calls work without `VITE_API_URL`.

If the health check fails during cold start, increase the health check **grace period** / interval in Railway or temporarily disable strict health checks until the first successful `/api/health` with `"status":"ready"`.

## Repository layout

| Path | Role |
|------|------|
| `backend/` | FastAPI app (`main.py`, `pyhpo_service.py`, `requirements.txt`) |
| `frontend/` | Vite + React UI |
| `Dockerfile` | Multi-stage production build |

This repo does **not** vendor the PyHPO source tree; `pyhpo` is installed from PyPI via `backend/requirements.txt`.
