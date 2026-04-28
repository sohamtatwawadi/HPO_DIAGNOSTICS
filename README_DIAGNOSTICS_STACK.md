# HPO Diagnostics — React + FastAPI

Production-style UI and API alongside the PyHPO library. The Streamlit app (`app.py`) remains unchanged; this stack lives under `backend/` and `frontend/`.

## Prerequisites

- Python 3.9+ with dependencies:

  ```bash
  # From repository root (parent of backend/)
  pip install -r backend/requirements.txt
  ```

**Using this Git checkout:** `backend/main.py` adds the repo root to `sys.path` when it sees `pyhpo/__init__.py` next to `backend/`, so `import pyhpo` works even if you only run `cd backend && uvicorn …` and never `pip install -e .`.

**Using a copy of `backend/` alone** (no sibling `pyhpo/` package): install PyHPO from PyPI — `pip install pyhpo` — or run from a full clone as above.

- Node 18+ for the frontend.

## Backend

**`main.py` lives in `backend/`, not the repo root.** Use either:

```bash
# Option A — from the backend folder (matches most tutorials)
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

```bash
# Option B — from the repository root (no cd)
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Running `uvicorn main:app` **from `pyhpo/`** will fail with `Could not import module "main"` because there is no `main.py` in that directory.

- **Warm-up:** On startup, the app loads the ontology and constructs `EnrichmentModel` / `HPOEnrichment` caches (several seconds).
- **Health:** `GET /api/health` → `{ "status": "ready", "terms": N }`.

### Main endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/resolve` | Resolve HP IDs / names / synonyms |
| POST | `/api/ic-profile` | Set + per-term information content |
| POST | `/api/enrichment` | `EnrichmentModel` (omim / gene / orpha / decipher) on an **HPO term list** |
| POST | `/api/gene-hpo-enrichment` | `HPOEnrichment('gene')` — gene symbols → enriched HPO terms (matches Streamlit gene module) |
| POST | `/api/similarity` | `HPOSet.similarity` between two patients |
| POST | `/api/cohort` | Pairwise matrix + shared OMIM top-20 |
| POST | `/api/variant-prioritize` | Gene enrichment filtered to VCF list |
| GET | `/api/disease` | OMIM / Orpha disease profile |
| GET | `/api/term` | Term explorer payload |
| POST | `/api/term-path` | Shortest path between two terms |
| POST | `/api/serialize` / `/api/deserialize` | `HPOSet` serialization |

## Frontend

```bash
cd frontend
npm install
npm run dev
```

With the default Vite proxy, leave `VITE_API_URL` unset so `/api` is proxied to `http://127.0.0.1:8000`.

For production builds against a remote API:

```bash
echo 'VITE_API_URL=https://your-api.example.com' > .env
npm run build
```

## Design tokens

Clinical palette is defined in `frontend/src/tokens.js` (`C` object): page `#F0F4FA`, cards `#FFFFFF`, sidebar `#0F2A52`, accent `#2563EB`, etc.

## Modules checklist

| UI route | API |
|----------|-----|
| `/workflow` | resolve → ic-profile → enrichment → gene-hpo-enrichment → similarity → disease + similarity → serialize |
| `/ddx` | POST `/api/enrichment` |
| `/patient-similarity` | POST `/api/similarity` |
| `/gene-enrichment` | POST `/api/gene-hpo-enrichment` |
| `/cohort` | POST `/api/cohort` |
| `/variant-prioritizer` | POST `/api/variant-prioritize` |
| `/disease` | GET `/api/disease` + POST `/api/similarity` |
| `/term-explorer` | GET `/api/term` + POST `/api/term-path` |
| `/ic-profiler` | POST `/api/ic-profile` |
| `/report` | Combines several mutations client-side |
