# PyHPO repository — AI handoff document

This file summarizes **what this project is**, **how the pieces connect**, and **where to change things**. It is intended for other AI assistants or developers joining cold.

---

## 1. What this project is

**PyHPO** is a Python library (v4.x) for working with the **Human Phenotype Ontology (HPO)**: terms, parent/child structure, gene and disease annotations (OMIM, Orpha, Decipher), **information content (IC)**, **semantic similarity** between term sets, and **enrichment** statistics.

This **repository** contains:

1. The **`pyhpo/`** package — the library itself (`Ontology`, `HPOTerm`, `HPOSet`, parsers, `stats` enrichment, `similarity`, annotations).
2. **Clinical / diagnostic UIs** that exercise the library for rare-disease style workflows: enter patient HPO terms → rank diseases/genes → compare patients → cohorts → variant gene lists → term exploration.

There is **no single “the app”**: there are **parallel frontends** sharing the same underlying PyHPO concepts.

---

## 2. High-level repository layout

| Path | Role |
|------|------|
| `pyhpo/` | Core library: `ontology.py`, `term.py`, `set.py`, `matrix.py`, `stats.py`, `similarity/`, `parser/` (OBO, genes, diseases), `annotations.py`, `config.py`. Version in `pyhpo/__init__.py` (e.g. 4.0.0). |
| `tests/` | pytest suite for parsers, sets, matrix, similarity, stats, integration. |
| `app.py` | **Primary Streamlit** “Genetic Diagnostic Explorer” — DDx, patient similarity, gene→HPO enrichment, term explorer; v2 UI styling. Run: `streamlit run app.py` from repo root. |
| `app/` | **Smaller Streamlit demo** (`app/main.py`) — browse ontology, find term, path between terms. Uses `app/ui/*`. Run: `streamlit run app/main.py`. |
| `backend/` | **FastAPI** HTTP API wrapping PyHPO for production-style clients. Entry: `backend/main.py` → logic in `backend/pyhpo_service.py`. |
| `frontend/` | **Vite + React 18** SPA: routes under `frontend/src/App.jsx`, API via `frontend/src/hooks/useAPI.js`, design tokens `frontend/src/tokens.js`. |
| `HPODiagnosticsApp.jsx` | Large **single-file React** variant at repo root (same clinical theme / hooks pattern as `frontend/` in spirit). May be used for Cursor Canvas or quick embedding; **canonical modular UI is `frontend/src/`**. |
| `documentation/`, `docs/` | Sphinx / user guide material. |
| `README.md`, `README_DIAGNOSTICS_STACK.md` | Human-oriented quick start; stack details for React + FastAPI. |

Ontology and annotation files are expected under **`pyhpo/data/`** (see `Ontology` in `pyhpo/ontology.py`: default folder next to the package). First load can take tens of seconds to ~a minute.

---

## 3. User-facing applications (choose the right one)

### 3.1 Streamlit — `app.py` (main diagnostic explorer)

- **Purpose:** Full diagnostic flows aligned with a static reference HTML (mentioned in `README.md`).
- **PyHPO usage (conceptual):** `HPOSet.from_queries`, `EnrichmentModel` for diseases, `HPOSet.similarity`, `HPOEnrichment('gene')` for gene lists, term navigation via `Ontology.get_hpo_object` and graph methods.
- **Run:** repo root, `pip install -r requirements.txt`, `streamlit run app.py`.

### 3.2 Streamlit — `app/main.py` (minimal demo)

- **Purpose:** Lightweight ontology browser, not the full DDx product.
- **Run:** `streamlit run app/main.py` (see `app/main.py` docstring; may use `requirements-ui.txt`).

### 3.3 React + FastAPI — `frontend/` + `backend/`

- **Purpose:** Production-style SPA + REST API; same clinical workflows with caching and clear API contracts.
- **Backend:** `uvicorn main:app` from `backend/` or `uvicorn backend.main:app` from repo root. On startup, **`pyhpo_service.warm_all_caches()`** loads `Ontology` and pre-builds `EnrichmentModel` / `HPOEnrichment` instances.
- **Frontend:** `npm run dev` in `frontend/`; Vite proxies `/api` to `http://127.0.0.1:8000` unless `VITE_API_URL` is set.
- **Combined deploy:** FastAPI can serve the Vite **`dist`** as static files if `index.html` is found under `backend/static`, repo `static/`, `frontend/dist`, or `FRONTEND_STATIC_DIR` (see `backend/main.py`).

---

## 4. FastAPI API (`backend/main.py` + `backend/pyhpo_service.py`)

### 4.1 Endpoints (summary)

| Method | Path | Service function | Notes |
|--------|------|------------------|-------|
| GET | `/api/health` | `ontology_term_count()` | `{ status, terms }` |
| POST | `/api/resolve` | `resolve_terms` | HP IDs / text / synonyms → term metadata + IC |
| POST | `/api/ic-profile` | `ic_profile` | Per-term + set IC summary |
| POST | `/api/enrichment` | `run_enrichment` | **Diagnostic** (default) vs **research** mode — see §4.2 |
| POST | `/api/gene-hpo-enrichment` | `gene_list_hpo_enrichment` | Gene symbols → enriched HPO terms (hypergeom) |
| POST | `/api/gene-prioritization` | `gene_prioritization_pipeline` | Two-pass gene + disease ranking, bridge disease, warnings |
| POST | `/api/similarity` | `compute_similarity` | Two `HPOSet`s; supports `one_way` for patient vs large disease profile |
| POST | `/api/variant-prioritize` | `prioritize_variants` | Patient HPO + candidate gene list |
| POST | `/api/cohort` | `cohort_analysis` | Pairwise matrix + shared OMIM top-20 intersection |
| GET | `/api/disease` | `get_disease` | OMIM or Orpha profile + HPO terms + genes |
| GET | `/api/term` | `explore_term` | Term explorer payload (parents, children, genes, diseases, path to root) |
| POST | `/api/term-path` | `term_path_to_other` | Shortest path between two terms |
| POST | `/api/serialize` / `/api/deserialize` | `serialize_profile` / `deserialize_profile` | `HPOSet` wire format |

OpenAPI: `/docs` when the server runs.

### 4.2 Critical semantics: “diagnostic” vs “research” enrichment

Implemented in **`pyhpo_service.run_enrichment`** and related ranking:

- **`mode: "research"`** — Uses PyHPO **`EnrichmentModel`** with **hypergeometric** enrichment (classic overlap p-values). Appropriate for **GWAS-style** “which entity is enriched for these terms?”.

- **`mode: "diagnostic"``** (default for clinical UI) — Does **not** use bidirectional BMA/funSimAvg against huge entity annotation sets for ranking. Instead uses **`rank_by_similarity`** built on **`_one_way_sim`**: for each **patient** term, take the **best** Resnik (or chosen method) match against **any** term in the entity’s HPO set, then **average** over patient terms. Tie-breakers: coverage, reverse coverage, overlap. Rationale is documented in code: bidirectional measures **penalize** well-annotated genes/diseases with many HPO terms, which is misleading for **diagnosis**.

- **`compute_similarity`** — Default **`one_way: false`** uses PyHPO **`HPOSet.similarity`** (e.g. BMA) for **patient vs patient**. **`one_way: true`** uses **`_one_way_sim`** for **patient vs disease** (large profile) so the score reflects “how well does the patient fit the disease?” not the reverse dilution.

- **`prioritize_variants`** — Same split: diagnostic mode uses **`rank_by_similarity`** on the user’s gene objects; research mode uses hypergeom on the gene enrichment model filtered to candidates.

### 4.3 Gene prioritization pipeline (`/api/gene-prioritization`)

Separate from simple enrichment: optional **IC-based expansion** of ancestors, **warnings** (sparse profile, low mean IC, unresolved strings), **`_score_catalog`** with a **combined score** (similarity + IC-weighted coverage + forward/reverse coverage), and per-gene **`bridge_disease`** via **`_find_bridge_disease`** (gene’s causal overlap with ranked diseases). Internal `_hpo_indices` keys are stripped before JSON return.

---

## 5. React frontend (`frontend/src/`)

### 5.1 Routes (`App.jsx`)

| URL path | Component | Typical API |
|----------|-----------|-------------|
| `/` | redirect | → `/workflow` |
| `/workflow` | `WorkflowView` | resolve, ic-profile, enrichment, gene-hpo, similarity, disease, serialize, etc. |
| `/ddx` | `DDX` | POST `/api/enrichment` |
| `/patient-similarity` | `PatientSimilarity` | POST `/api/similarity` |
| `/gene-enrichment` | `GeneEnrichment` | POST `/api/gene-hpo-enrichment` |
| `/cohort` | `CohortAnalysis` | POST `/api/cohort` |
| `/variant-prioritizer` | `VariantPrioritizer` | POST `/api/variant-prioritize` |
| `/disease` | `DiseaseDeepDive` | GET `/api/disease`, POST `/api/similarity` |
| `/term-explorer` | `HPOTermExplorer` | GET `/api/term`, POST `/api/term-path` |
| `/ic-profiler` | `ICProfiler` | POST `/api/ic-profile` |
| `/report` | `ReportBuilder` | Client composes several calls |
| `/gene-prioritization` | `GenePrioritizationPipeline` | POST `/api/gene-prioritization` |

### 5.2 API client

- **`frontend/src/hooks/useAPI.js`** — `@tanstack/react-query` `useQuery` / `useMutation` wrappers; **`BASE`** from `import.meta.env.VITE_API_URL` or `""` (same-origin + Vite proxy).

### 5.3 UI tokens

- **`frontend/src/tokens.js`** — `C` object: clinical blue/white palette (aligned with README_DIAGNOSTICS_STACK).

### 5.4 Root `HPODiagnosticsApp.jsx`

- Monolithic app shell + modules in one file; mirrors NAV/workflow concepts. If both exist, prefer **`frontend/src/`** for edits that must ship with Vite build unless the user explicitly works in the single-file app.

---

## 6. PyHPO library (what matters for the apps)

Public exports from **`pyhpo/__init__.py`** include: `HPOTerm`, `Ontology`, `OntologyClass`, `HPOSet`, annotation types (`OmimDisease`, `OrphaDisease`, `DecipherDisease`, etc.), `config`.

**Concepts:**

- **`Ontology()`** — Singleton-style load of terms + annotations.
- **`HPOSet`** — Collection of terms; `similarity`, `information_content`, serialization, obsolete replacement, modifier removal.
- **`stats.EnrichmentModel`** — Disease/gene catalogs vs patient set (hypergeom).
- **`stats.HPOEnrichment`** — e.g. `'gene'`: list of genes → enriched HPO terms.
- **`HPOTerm`** — `parents`, `children`, `genes`, `omim_diseases`, `information_content`, `similarity_score`, `path_to_other`.

---

## 7. Tests and quality

- **`tests/`** — Run with pytest from repo root (see project conventions).
- **`benchmarking.py`** — performance-related.

---

## 8. Dependencies (conceptual)

- **Python:** 3.8+ for Streamlit app per README; **3.9+** suggested for `backend/requirements.txt`.
- **Node:** 18+ for frontend.

---

## 9. Files to read first when debugging

| Goal | Files |
|------|--------|
| API contract / HTTP errors | `backend/main.py` |
| Ranking, similarity, enrichment behavior | `backend/pyhpo_service.py` |
| React routes / health banner | `frontend/src/App.jsx`, `frontend/src/hooks/useAPI.js` |
| Streamlit v2 diagnostic UI | `app.py` |
| Library semantics | `pyhpo/set.py`, `pyhpo/stats.py`, `pyhpo/similarity/` |
| Single-file React variant | `HPODiagnosticsApp.jsx` |

---

## 10. Glossary (quick)

| Term | Meaning |
|------|--------|
| HPO | Human Phenotype Ontology — phenotype terms (`HP:0000001` …). |
| IC | Information content — specificity of a term w.r.t. annotations (OMIM / gene / Orpha channels in PyHPO). |
| DDx | Differential diagnosis — rank diseases given a patient HPO set. |
| Diagnostic mode | Patient→entity one-way semantic ranking + coverage (clinical default in this stack). |
| Research mode | Hypergeometric enrichment p-values (GWAS / exploratory). |

---

*Generated as a stable orientation doc for AI and humans; for install commands and copy-paste run instructions, see `README.md` and `README_DIAGNOSTICS_STACK.md`.*
