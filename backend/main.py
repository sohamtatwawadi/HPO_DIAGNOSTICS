"""
HPO Diagnostics API — FastAPI + PyHPO 4.
"""
from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Support both: `cd backend && uvicorn main:app` and `uvicorn backend.main:app` from repo root.
_backend_dir = Path(__file__).resolve().parent
_repo_root = _backend_dir.parent
_local_pyhpo_pkg = _repo_root / "pyhpo" / "__init__.py"
# Local checkout: package lives at <repo>/pyhpo/ — cwd is often backend/, so site-packages alone is not enough.
if _local_pyhpo_pkg.is_file() and str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

import pyhpo_service as svc
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


@asynccontextmanager
async def lifespan(app: FastAPI):
    svc.warm_all_caches()
    yield


app = FastAPI(title="HPO Diagnostics API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TermsInput(BaseModel):
    queries: list[str]
    remove_modifiers: bool = True
    replace_obsolete: bool = True


class EnrichmentInput(BaseModel):
    queries: list[str]
    source: str = "omim"
    top_n: int = 20
    remove_modifiers: bool = True
    replace_obsolete: bool = True


class SimilarityInput(BaseModel):
    patient1: list[str]
    patient2: list[str]
    kind: str = "omim"
    method: str = "resnik"
    combine: str = "BMA"


class VariantInput(BaseModel):
    hpo_queries: list[str]
    candidate_genes: list[str]


class SerializedBody(BaseModel):
    serialized: str


class CohortInput(BaseModel):
    patients: list[list[str]]
    kind: str = ""
    method: str = ""
    combine: str = "funSimAvg"


class GeneHpoEnrichmentInput(BaseModel):
    genes: list[str]
    min_count: int = 1
    top_n: int = 80


class TermPathInput(BaseModel):
    term_a: str
    term_b: str


@app.get("/api/health")
def health():
    try:
        n = svc.ontology_term_count()
    except Exception:
        return {"status": "not_ready", "terms": 0}
    return {"status": "ready", "terms": n}


@app.post("/api/resolve")
def api_resolve_terms(body: TermsInput):
    try:
        return svc.resolve_terms(
            body.queries,
            remove_modifiers=body.remove_modifiers,
            replace_obsolete=body.replace_obsolete,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/ic-profile")
def ic_profile(body: TermsInput):
    try:
        return svc.ic_profile(
            body.queries,
            remove_modifiers=body.remove_modifiers,
            replace_obsolete=body.replace_obsolete,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/gene-hpo-enrichment")
def gene_hpo_enrichment(body: GeneHpoEnrichmentInput):
    try:
        return svc.gene_list_hpo_enrichment(
            body.genes,
            min_count=body.min_count,
            top_n=body.top_n,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/enrichment")
def run_enrichment(body: EnrichmentInput):
    if body.source not in {"omim", "gene", "orpha", "decipher"}:
        raise HTTPException(400, "source must be omim | gene | orpha | decipher")
    try:
        return svc.run_enrichment(
            body.queries,
            source=body.source,
            top_n=body.top_n,
            remove_modifiers=body.remove_modifiers,
            replace_obsolete=body.replace_obsolete,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/similarity")
def compute_similarity(body: SimilarityInput):
    try:
        return svc.compute_similarity(
            body.patient1,
            body.patient2,
            kind=body.kind,
            method=body.method,
            combine=body.combine,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/variant-prioritize")
def prioritize_variants(body: VariantInput):
    try:
        return svc.prioritize_variants(body.hpo_queries, body.candidate_genes)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.get("/api/disease")
def get_disease(query: str, source: str = "omim"):
    if source not in {"omim", "orpha"}:
        raise HTTPException(400, "source must be omim | orpha")
    try:
        return svc.get_disease(query, source=source)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.get("/api/term")
def explore_term(query: str):
    try:
        return svc.explore_term(query)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(404, f"Term not found: {query!r}") from exc


@app.post("/api/term-path")
def term_path(body: TermPathInput):
    try:
        return svc.term_path_to_other(body.term_a, body.term_b)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/serialize")
def serialize_profile(body: TermsInput):
    try:
        return svc.serialize_profile(body.queries)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/deserialize")
def deserialize_profile(body: SerializedBody):
    try:
        return svc.deserialize_profile(body.serialized)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/cohort")
def cohort(body: CohortInput):
    try:
        return svc.cohort_analysis(
            body.patients,
            kind=body.kind,
            method=body.method,
            combine=body.combine,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


# Production (Docker/Railway): Vite build copied to <parent-of-backend>/static/
_static_dir = Path(__file__).resolve().parent.parent / "static"
if _static_dir.is_dir() and (_static_dir / "index.html").is_file():
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="spa")
