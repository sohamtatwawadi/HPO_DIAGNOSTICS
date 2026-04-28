# PyHPO Genetic Diagnostic Explorer

Streamlit app **`app.py`** at the repository root exercises core **PyHPO** flows: differential diagnosis (disease enrichment), patient HPO-set similarity, gene-list → HPO term enrichment, and single-term exploration. The v2 layout (cards, sidebar stat tiles, tables with pills + signal bars, path tree) matches the static reference **[pyhpo_diagnostic_explorer_v2.html](pyhpo_diagnostic_explorer_v2.html)**.

## Requirements

- Python 3.8+
- Dependencies in **`requirements.txt`** (includes `streamlit`, `scipy`, `pandas`, `pydantic` for the library and enrichment)

Install **PyHPO** either:

- **From this checkout:** `app.py` prepends the repo root to `sys.path`, so after `pip install -r requirements.txt` you can run the app **without** installing the package, as long as this repository layout is intact.

- **Editable install (optional):** `pip install -e .` from the repo root (needs a working `pip` in the environment).

- **From PyPI only:** `pip install pyhpo streamlit scipy pandas` in a clean environment (no checkout required).

## Run

From the **repository root** (so the `pyhpo/` package directory is next to `app.py`):

```bash
streamlit run app.py
```

The first run loads ontology data from `pyhpo/data/` and may take **up to a minute**.

## What the app does

| Module | PyHPO API |
|--------|-----------|
| Differential Diagnosis | `HPOSet.from_queries`, `EnrichmentModel('omim' \| 'orpha' \| 'decipher').enrichment(...)` |
| Patient Similarity | `HPOSet.similarity` |
| Gene Enrichment | `Gene.get`, `HPOEnrichment('gene').enrichment(...)` |
| HPO Term Explorer | `Ontology.get_hpo_object`, `term.parents` / `children` / `genes` / `omim_diseases`, `path_to_other` to `HP:0000001` |

## React + FastAPI stack (production UI)

A separate **Vite + React 18** frontend and **FastAPI** backend live under **`frontend/`** and **`backend/`** (same clinical tokens, `react-query`, cached ontology / models). Quick start and endpoint table: **[README_DIAGNOSTICS_STACK.md](README_DIAGNOSTICS_STACK.md)**.

---

For the **pyhpo library** itself, see [README.rst](README.rst) and [https://pyhpo.readthedocs.io/](https://pyhpo.readthedocs.io/).
