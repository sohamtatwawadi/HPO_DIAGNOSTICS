"""
HPO Diagnostics API — FastAPI + PyHPO 4.
"""
from __future__ import annotations

import logging
import os
import sys
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

# Support both: `cd backend && uvicorn main:app` and `uvicorn backend.main:app` from repo root.
_backend_dir = Path(__file__).resolve().parent
_repo_root = _backend_dir.parent
_local_pyhpo_pkg = _repo_root / "pyhpo" / "__init__.py"
# Local checkout: package lives at <repo>/pyhpo/ — cwd is often backend/, so site-packages alone is not enough.
if _local_pyhpo_pkg.is_file() and str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

import auth as auth_mod
import cases_store
import pyhpo_service as svc
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Cap on bytes actually received over HTTP (plain text or gzip). Uploads are
# streamed straight to a temp file in chunks (see variant_prioritize_file),
# never buffered whole in memory, so this is a sanity/disk-space ceiling, not
# a memory-safety one. Whole-genome VariMAT exports run ~150-250MB gzipped
# per the real files this is built against; 2GB leaves generous headroom,
# including for uncompressed uploads. The *decompressed* content can be much
# larger -- see pyhpo_service._MAX_DECOMPRESSED_BYTES (6GB), enforced while
# streaming during parsing, not here.
_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    auth_mod.init_users_db()
    cases_store.init_db()
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
    mode: str = "diagnostic"
    sim_kind: str = "omim"
    sim_method: str = "resnik"
    sim_combine: str = "funSimAvg"


class SimilarityInput(BaseModel):
    patient1: list[str]
    patient2: list[str]
    kind: str = "omim"
    method: str = "resnik"
    combine: str = "BMA"
    one_way: bool = False


class VariantInput(BaseModel):
    hpo_queries: list[str]
    candidate_genes: list[str]
    mode: str = "diagnostic"


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


class GenePrioritizationInput(BaseModel):
    queries: list[str]
    remove_modifiers: bool = False
    replace_obsolete: bool = True
    expand_ic: bool = True
    ic_expansion_threshold: float = 2.0
    top_n: int = 20


class TermPathInput(BaseModel):
    term_a: str
    term_b: str


class AuthCredentials(BaseModel):
    email: str
    password: str = Field(min_length=8)


@app.get("/api/health")
def health():
    try:
        n = svc.ontology_term_count()
    except Exception:
        return {"status": "not_ready", "terms": 0}
    return {"status": "ready", "terms": n}


@app.post("/api/auth/signup")
def auth_signup(body: AuthCredentials):
    try:
        user = auth_mod.create_user(body.email, body.password)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    token = auth_mod.issue_token(user)
    return {"access_token": token, "token_type": "bearer", "user": user}


@app.post("/api/auth/login")
def auth_login(body: AuthCredentials):
    try:
        user = auth_mod.authenticate_user(body.email, body.password)
    except ValueError as exc:
        raise HTTPException(401, str(exc)) from exc
    token = auth_mod.issue_token(user)
    return {"access_token": token, "token_type": "bearer", "user": user}


@app.get("/api/auth/me")
def auth_me(user: dict = Depends(auth_mod.get_current_user)):
    return {"user": user}


@app.post("/api/resolve")
def api_resolve_terms(body: TermsInput, user: dict = Depends(auth_mod.get_current_user)):
    try:
        return svc.resolve_terms(
            body.queries,
            remove_modifiers=body.remove_modifiers,
            replace_obsolete=body.replace_obsolete,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/ic-profile")
def ic_profile(body: TermsInput, user: dict = Depends(auth_mod.get_current_user)):
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
def gene_hpo_enrichment(
    body: GeneHpoEnrichmentInput, user: dict = Depends(auth_mod.get_current_user)
):
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


@app.post("/api/gene-prioritization")
def gene_prioritization(
    body: GenePrioritizationInput, user: dict = Depends(auth_mod.get_current_user)
):
    if not 1 <= body.top_n <= 1000:
        raise HTTPException(400, "top_n must be between 1 and 1000")
    if not 0.0 <= body.ic_expansion_threshold <= 10.0:
        raise HTTPException(400, "ic_expansion_threshold must be between 0 and 10")
    try:
        return svc.gene_prioritization_pipeline(
            body.queries,
            remove_modifiers=body.remove_modifiers,
            replace_obsolete=body.replace_obsolete,
            expand_ic=body.expand_ic,
            ic_expansion_threshold=body.ic_expansion_threshold,
            top_n=body.top_n,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/variant-prioritize-file")
async def variant_prioritize_file(
    hpo_terms: str = Form(...),
    file: UploadFile = File(...),
    remove_modifiers: bool = Form(False),
    replace_obsolete: bool = Form(True),
    expand_ic: bool = Form(True),
    ic_expansion_threshold: float = Form(2.0),
    top_n: int = Form(100),
    file_format: str = Form("auto"),
    user: dict = Depends(auth_mod.get_current_user),
):
    """
    Submit a VariMAT upload for background processing. Returns a job_id
    immediately -- poll GET /api/variant-prioritize-file/status/{job_id} for
    the result. A whole-exome/genome file can take a while to score (and, at
    multi-GB scale, a while just to read), which is too long to trust a
    single synchronous request against gateway timeouts.

    The upload is streamed straight to a temp file in bounded chunks -- never
    held whole in memory, however large it is -- and ownership of that temp
    file (including deletion once done) transfers to the background job. Gzip
    is detected and decompressed on read during parsing (see
    pyhpo_service._open_varimat_lines), also streamed, so multi-GB
    decompressed content never needs to fit in memory at once either.
    """
    if not 1 <= top_n <= 1000:
        raise HTTPException(400, "top_n must be between 1 and 1000")
    if not 0.0 <= ic_expansion_threshold <= 10.0:
        raise HTTPException(400, "ic_expansion_threshold must be between 0 and 10")

    queries = [q.strip() for q in hpo_terms.replace(",", "\n").split("\n") if q.strip()]
    if not queries:
        raise HTTPException(400, "No HPO terms provided")

    fmt = (file_format or "auto").strip().lower()
    filename = (file.filename or "").lower()
    if fmt == "auto":
        if filename.endswith(".vcf.gz") or filename.endswith(".vcf"):
            fmt = "vcf"
        else:
            fmt = "varimat"
    if fmt not in {"varimat", "vcf"}:
        raise HTTPException(400, "file_format must be auto | varimat | vcf")

    suffix = ".vcf.upload" if fmt == "vcf" else ".varimat.upload"
    fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    try:
        total = 0
        with os.fdopen(fd, "wb") as tmp:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > _MAX_UPLOAD_BYTES:
                    raise HTTPException(400, f"Upload too large (max {_MAX_UPLOAD_BYTES // (1024 ** 3)}GB)")
                tmp.write(chunk)
        if total == 0:
            raise HTTPException(400, "Uploaded file is empty")
    except Exception:
        os.unlink(tmp_path)
        raise

    job_id = svc.submit_variant_prioritization_job(
        queries,
        tmp_path,
        remove_modifiers=remove_modifiers,
        replace_obsolete=replace_obsolete,
        expand_ic=expand_ic,
        ic_expansion_threshold=ic_expansion_threshold,
        top_n=top_n,
        file_format=fmt,
    )
    return {"job_id": job_id, "status": "queued", "file_format": fmt}


@app.get("/api/variant-prioritize-file/status/{job_id}")
def variant_prioritize_file_status(
    job_id: str, user: dict = Depends(auth_mod.get_current_user)
):
    try:
        return svc.get_variant_prioritization_job(job_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


class VariantFileGeneDetailInput(BaseModel):
    token: str
    genes: list[str]


@app.post("/api/variant-prioritize-file/gene-detail")
def variant_prioritize_file_gene_detail(
    body: VariantFileGeneDetailInput, user: dict = Depends(auth_mod.get_current_user)
):
    if not body.genes:
        raise HTTPException(400, "No genes provided")
    if len(body.genes) > 200:
        raise HTTPException(400, "At most 200 genes per lookup")
    try:
        return svc.variant_file_gene_detail(body.token, body.genes)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/enrichment")
def run_enrichment(body: EnrichmentInput, user: dict = Depends(auth_mod.get_current_user)):
    if body.source not in {"omim", "gene", "orpha", "decipher"}:
        raise HTTPException(400, "source must be omim | gene | orpha | decipher")
    if body.mode not in {"diagnostic", "research"}:
        raise HTTPException(400, "mode must be diagnostic | research")
    try:
        return svc.run_enrichment(
            body.queries,
            source=body.source,
            top_n=body.top_n,
            remove_modifiers=body.remove_modifiers,
            replace_obsolete=body.replace_obsolete,
            mode=body.mode,
            sim_kind=body.sim_kind,
            sim_method=body.sim_method,
            sim_combine=body.sim_combine,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/similarity")
def compute_similarity(body: SimilarityInput, user: dict = Depends(auth_mod.get_current_user)):
    try:
        return svc.compute_similarity(
            body.patient1,
            body.patient2,
            kind=body.kind,
            method=body.method,
            combine=body.combine,
            one_way=body.one_way,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/variant-prioritize")
def prioritize_variants(body: VariantInput, user: dict = Depends(auth_mod.get_current_user)):
    if body.mode not in {"diagnostic", "research"}:
        raise HTTPException(400, "mode must be diagnostic | research")
    try:
        return svc.prioritize_variants(
            body.hpo_queries,
            body.candidate_genes,
            mode=body.mode,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.get("/api/disease")
def get_disease(
    query: str, source: str = "omim", user: dict = Depends(auth_mod.get_current_user)
):
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
def explore_term(query: str, user: dict = Depends(auth_mod.get_current_user)):
    try:
        return svc.explore_term(query)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(404, f"Term not found: {query!r}") from exc


@app.post("/api/term-path")
def term_path(body: TermPathInput, user: dict = Depends(auth_mod.get_current_user)):
    try:
        return svc.term_path_to_other(body.term_a, body.term_b)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/serialize")
def serialize_profile(body: TermsInput, user: dict = Depends(auth_mod.get_current_user)):
    try:
        return svc.serialize_profile(body.queries)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.post("/api/deserialize")
def deserialize_profile(
    body: SerializedBody, user: dict = Depends(auth_mod.get_current_user)
):
    try:
        return svc.deserialize_profile(body.serialized)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/cohort")
def cohort(body: CohortInput, user: dict = Depends(auth_mod.get_current_user)):
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


class SaveCaseInput(BaseModel):
    name: str
    kind: str
    params: dict
    result: dict
    notes: str = ""


@app.post("/api/cases")
def save_case(body: SaveCaseInput, user: dict = Depends(auth_mod.get_current_user)):
    if not body.name.strip():
        raise HTTPException(400, "Case name is required")
    try:
        case_id = cases_store.save_case(
            body.name.strip(),
            body.kind,
            body.params,
            body.result,
            body.notes,
            user_id=user["id"],
        )
        return {"id": case_id}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.get("/api/cases")
def list_cases(
    kind: Optional[str] = None, user: dict = Depends(auth_mod.get_current_user)
):
    try:
        return {"cases": cases_store.list_cases(user_id=user["id"], kind=kind)}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.get("/api/cases/{case_id}")
def get_case(case_id: str, user: dict = Depends(auth_mod.get_current_user)):
    try:
        return cases_store.get_case(case_id, user_id=user["id"])
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc


@app.delete("/api/cases/{case_id}")
def delete_case(case_id: str, user: dict = Depends(auth_mod.get_current_user)):
    try:
        deleted = cases_store.delete_case(case_id, user_id=user["id"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, str(exc)) from exc
    if not deleted:
        raise HTTPException(404, f"No case found for id {case_id!r}")
    return {"deleted": True}


# Production (Docker/Railway): Dockerfile copies Vite dist to ./static next to main.py (/app/static).
# Non-Docker: set FRONTEND_STATIC_DIR, or place dist at backend/static or repo frontend/dist.
_backend_dir_for_static = Path(__file__).resolve().parent
_repo_root_for_static = _backend_dir_for_static.parent
_static_candidates: list[Path] = [
    _backend_dir_for_static / "static",
    _repo_root_for_static / "static",
    _repo_root_for_static / "frontend" / "dist",
]
_env_static = os.environ.get("FRONTEND_STATIC_DIR", "").strip()
if _env_static:
    _static_candidates.insert(0, Path(_env_static).expanduser().resolve())

_log = logging.getLogger("uvicorn.error")
_static_dir = next(
    (p for p in _static_candidates if p.is_dir() and (p / "index.html").is_file()),
    None,
)
if _static_dir is not None:
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    _static_resolved = _static_dir.resolve()

    _log.info("Serving Vite SPA from %s", _static_resolved)

    _assets_dir = _static_dir / "assets"
    if _assets_dir.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=str(_assets_dir)),
            name="vite_assets",
        )

    @app.get("/")
    def spa_index():
        return FileResponse(_static_dir / "index.html")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        # Path traversal guard: only serve files inside dist/
        candidate = (_static_dir / full_path).resolve()
        try:
            candidate.relative_to(_static_resolved)
        except ValueError:
            return FileResponse(_static_dir / "index.html")
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_static_dir / "index.html")

else:
    _log.warning(
        "No frontend bundle found (index.html). Checked: %s. "
        "Set FRONTEND_STATIC_DIR or deploy with the repo-root Dockerfile so /app/static exists. "
        "API-only: use /api/health, /docs.",
        ", ".join(str(p) for p in _static_candidates),
    )

    @app.get("/")
    def root_no_spa():
        return {
            "service": "HPO Diagnostics API",
            "detail": "Frontend static files not found on this server.",
            "api_health": "/api/health",
            "openapi_docs": "/docs",
        }
