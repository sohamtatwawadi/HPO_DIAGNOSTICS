"""
PyHPO service layer — ontology + enrichment models cached per process.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from typing import Any

MAX_COHORT_PARALLEL = 4


@lru_cache(maxsize=1)
def _init_ontology() -> bool:
    from pyhpo import Ontology

    Ontology()
    return True


def ensure_ontology_loaded() -> None:
    _init_ontology()


@lru_cache(maxsize=4)
def get_enrichment_model(category: str):
    from pyhpo.stats import EnrichmentModel

    return EnrichmentModel(category)


@lru_cache(maxsize=2)
def get_hpo_enrichment(category: str):
    """Gene or OMIM list → enriched HPO terms (HPOEnrichment)."""
    from pyhpo.stats import HPOEnrichment

    return HPOEnrichment(category)


def ontology_term_count() -> int:
    from pyhpo import Ontology

    return len(Ontology)


def _resolve_single(raw: str):
    from pyhpo import Ontology

    try:
        return Ontology.get_hpo_object(raw)
    except Exception:
        try:
            return Ontology.synonym_match(raw)
        except Exception:
            return None


def build_hposet_from_queries(
    queries: list[str],
    *,
    remove_modifiers: bool = True,
    replace_obsolete: bool = True,
) -> tuple[Any | None, list[str]]:
    from pyhpo import HPOSet

    terms: list = []
    failed: list[str] = []
    for q in queries:
        raw = (q or "").strip()
        if not raw:
            continue
        t = _resolve_single(raw)
        if t is None:
            failed.append(raw)
        else:
            terms.append(t)
    if not terms:
        return None, failed
    hposet = HPOSet(terms)
    if replace_obsolete:
        hposet = hposet.replace_obsolete()
    if remove_modifiers:
        hposet = hposet.remove_modifier()
    return hposet, failed


def resolve_terms(
    queries: list[str],
    *,
    remove_modifiers: bool = True,
    replace_obsolete: bool = True,
) -> dict[str, Any]:
    resolved: list[dict[str, Any]] = []
    failed: list[str] = []
    for q in queries:
        raw = (q or "").strip()
        if not raw:
            continue
        t = _resolve_single(raw)
        if t is None:
            failed.append(raw)
            continue
        if replace_obsolete and t.is_obsolete:
            from pyhpo import HPOSet

            tmp = HPOSet([t]).replace_obsolete()
            if len(tmp) == 1:
                t = next(iter(tmp))
        if remove_modifiers and t.is_modifier:
            continue
        resolved.append(
            {
                "id": t.id,
                "name": t.name,
                "definition": t.definition or "",
                "is_obsolete": t.is_obsolete,
                "is_modifier": t.is_modifier,
                "ic_omim": float(t.information_content.omim),
                "ic_gene": float(t.information_content.gene),
                "ic_orpha": float(t.information_content.orpha),
                "depth": t.longest_path_to_root(),
            }
        )
    return {"resolved": resolved, "failed": failed}


def ic_profile(
    queries: list[str],
    *,
    remove_modifiers: bool = True,
    replace_obsolete: bool = True,
) -> dict[str, Any]:
    hposet, _failed = build_hposet_from_queries(
        queries,
        remove_modifiers=remove_modifiers,
        replace_obsolete=replace_obsolete,
    )
    if hposet is None or len(hposet) == 0:
        raise ValueError("No valid HPO terms")

    set_ic = hposet.information_content("omim")
    term_profiles = []
    for t in hposet:
        term_profiles.append(
            {
                "id": t.id,
                "name": t.name,
                "ic_omim": float(t.information_content.omim),
                "ic_gene": float(t.information_content.gene),
                "ic_orpha": float(t.information_content.orpha),
                "depth": t.longest_path_to_root(),
            }
        )
    return {
        "set_summary": {
            "mean": float(set_ic["mean"]),
            "total": float(set_ic["total"]),
            "max": float(set_ic["max"]),
        },
        "terms": sorted(term_profiles, key=lambda x: -x["ic_omim"]),
        "hposet_size": len(hposet),
    }


def gene_list_hpo_enrichment(
    gene_symbols: list[str],
    *,
    min_count: int = 1,
    top_n: int = 80,
) -> dict[str, Any]:
    """RNA-seq style: gene symbols → enriched HPO terms."""
    from pyhpo.annotations import Gene  # GeneDict singleton .get

    gene_objects = []
    skipped: list[str] = []
    for g in gene_symbols:
        raw = (g or "").strip()
        if not raw:
            continue
        try:
            gene_objects.append(Gene.get(raw))
        except Exception:
            skipped.append(raw)
    if not gene_objects:
        raise ValueError("No valid genes found")
    enrich = get_hpo_enrichment("gene")
    results = enrich.enrichment(method="hypergeom", annotation_sets=gene_objects)
    filtered = [r for r in results if int(r["count"]) >= min_count][:top_n]
    return {
        "results": [
            {
                "rank": i + 1,
                "name": r["hpo"].name,
                "id": r["hpo"].id,
                "count": int(r["count"]),
                "enrichment": float(r["enrichment"]),
            }
            for i, r in enumerate(filtered)
        ],
        "skipped_genes": skipped,
        "gene_count": len(gene_objects),
    }


def run_enrichment(
    queries: list[str],
    *,
    source: str = "omim",
    top_n: int = 20,
    remove_modifiers: bool = True,
    replace_obsolete: bool = True,
) -> dict[str, Any]:
    hposet, _f = build_hposet_from_queries(
        queries,
        remove_modifiers=remove_modifiers,
        replace_obsolete=replace_obsolete,
    )
    if hposet is None or len(hposet) == 0:
        raise ValueError("No valid HPO terms")

    model = get_enrichment_model(source)
    results = model.enrichment(method="hypergeom", hposet=hposet)
    top = results[: max(0, top_n)]
    return {
        "results": [
            {
                "rank": i + 1,
                "name": getattr(r["item"], "name", str(r["item"])),
                "id": str(getattr(r["item"], "id", "")),
                "count": int(r["count"]),
                "enrichment": float(r["enrichment"]),
            }
            for i, r in enumerate(top)
        ],
        "hposet_size": len(hposet),
    }


def compute_similarity(
    patient1: list[str],
    patient2: list[str],
    *,
    kind: str = "omim",
    method: str = "resnik",
    combine: str = "BMA",
) -> dict[str, Any]:
    h1, _ = build_hposet_from_queries(patient1)
    h2, _ = build_hposet_from_queries(patient2)
    if h1 is None or len(h1) == 0 or h2 is None or len(h2) == 0:
        raise ValueError("Invalid HPO terms in one or both patients")

    score = float(
        h1.similarity(h2, kind=kind or "omim", method=method or "resnik", combine=combine or "BMA")
    )
    s1, s2 = set(h1), set(h2)
    shared = [{"id": t.id, "name": t.name} for t in sorted(s1 & s2, key=int)]
    only1 = [{"id": t.id, "name": t.name} for t in sorted(s1 - s2, key=int)]
    only2 = [{"id": t.id, "name": t.name} for t in sorted(s2 - s1, key=int)]
    return {
        "score": score,
        "shared": shared,
        "only_in_patient1": only1,
        "only_in_patient2": only2,
    }


def prioritize_variants(hpo_queries: list[str], candidate_genes: list[str]) -> dict[str, Any]:
    hposet, _ = build_hposet_from_queries(hpo_queries)
    if hposet is None or len(hposet) == 0:
        raise ValueError("No valid HPO terms")

    gene_model = get_enrichment_model("gene")
    gene_results = gene_model.enrichment(method="hypergeom", hposet=hposet)
    user_genes = {g.upper().strip() for g in candidate_genes if g.strip()}
    prioritized = [
        r
        for r in gene_results
        if getattr(r["item"], "name", "").upper() in user_genes
    ]
    seen = {getattr(r["item"], "name", "").upper() for r in prioritized}
    missing = sorted(user_genes - seen)
    return {
        "prioritized": [
            {
                "gene": r["item"].name,
                "score": float(r["enrichment"]),
                "count": int(r["count"]),
            }
            for r in prioritized
        ],
        "missing": missing,
    }


def get_disease(query: str, source: str = "omim") -> dict[str, Any]:
    from pyhpo import Ontology

    q = (query or "").strip()
    if not q:
        raise ValueError("Empty query")
    catalog = Ontology.omim_diseases if source == "omim" else Ontology.orpha_diseases
    matches = [d for d in catalog if str(d.id) == q or (d.name and q.lower() in d.name.lower())]
    if not matches:
        raise LookupError("No disease matched")
    d = matches[0]
    disease_set = d.hpo_set()
    terms = list(disease_set)
    genes = sorted(disease_set.all_genes(), key=lambda g: g.name)[:100]
    return {
        "id": d.id,
        "name": d.name,
        "hpo_count": len(terms),
        "hpo_terms": [{"id": t.id, "name": t.name} for t in sorted(terms, key=int)],
        "genes": [{"name": g.name, "id": g.id} for g in genes],
    }


def explore_term(query: str) -> dict[str, Any]:
    from pyhpo import Ontology

    t = Ontology.get_hpo_object(query.strip())
    root = Ontology.get_hpo_object("HP:0000001")
    path_to_root: list[dict[str, str]] = []
    try:
        _length, path, _a, _b = t.path_to_other(root)
        path_to_root = [{"id": p.id, "name": p.name} for p in path]
    except Exception:
        pass

    sibs: list = []
    for p in t.parents:
        for c in p.children:
            if c != t:
                sibs.append(c)
    sibs = list({int(s): s for s in sibs}.values())

    orpha = sorted(t.orpha_diseases, key=lambda d: d.id)[:30]

    return {
        "id": t.id,
        "name": t.name,
        "definition": t.definition or "",
        "comment": t.comment or "",
        "synonym": list(t.synonym),
        "is_obsolete": t.is_obsolete,
        "is_modifier": t.is_modifier,
        "parents": [{"id": p.id, "name": p.name} for p in sorted(t.parents, key=int)],
        "children": [{"id": c.id, "name": c.name} for c in sorted(t.children, key=int)],
        "siblings": [{"id": s.id, "name": s.name} for s in sorted(sibs, key=int)],
        "path_to_root": path_to_root,
        "ic": {
            "omim": float(t.information_content.omim),
            "gene": float(t.information_content.gene),
            "orpha": float(t.information_content.orpha),
        },
        "longest_path_to_root": t.longest_path_to_root(),
        "shortest_path_to_root": t.shortest_path_to_root(),
        "longest_path_to_bottom": t.longest_path_to_bottom(),
        "genes": [{"name": g.name, "id": g.id} for g in sorted(t.genes, key=lambda g: g.name)[:30]],
        "omim_diseases": [{"id": d.id, "name": d.name} for d in sorted(t.omim_diseases, key=lambda d: d.id)[:30]],
        "orpha_diseases": [{"id": d.id, "name": d.name} for d in orpha],
    }


def term_path_to_other(query_a: str, query_b: str) -> dict[str, Any]:
    from pyhpo import Ontology

    a = Ontology.get_hpo_object(query_a.strip())
    b = Ontology.get_hpo_object(query_b.strip())
    dlen, path, _, _ = a.path_to_other(b)
    return {
        "distance": int(dlen),
        "path": [{"id": p.id, "name": p.name} for p in path],
    }


def serialize_profile(queries: list[str]) -> dict[str, str]:
    hposet, _ = build_hposet_from_queries(queries)
    if hposet is None or len(hposet) == 0:
        raise ValueError("No valid HPO terms")
    return {"serialized": hposet.serialize()}


def deserialize_profile(serialized: str) -> dict[str, Any]:
    from pyhpo import HPOSet

    hposet = HPOSet.from_serialized(serialized.strip())
    return {"terms": [{"id": t.id, "name": t.name} for t in sorted(hposet, key=int)]}


def _one_similarity(args: tuple) -> tuple[tuple[int, int], float]:
    meta, a, b = args
    i, j, kind, method, combine = meta
    score = float(a.similarity(b, kind=kind, method=method, combine=combine))
    return (i, j), score


def cohort_analysis(
    patients: list[list[str]],
    *,
    kind: str = "",
    method: str = "",
    combine: str = "funSimAvg",
) -> dict[str, Any]:
    """Pairwise similarity matrix + shared OMIM in top-20 for all patients."""
    sets: list = []
    for plist in patients:
        hs, _ = build_hposet_from_queries(plist)
        if hs is None or len(hs) == 0:
            raise ValueError("One cohort member has no valid HPO terms")
        sets.append(hs)
    n = len(sets)
    if n < 2:
        raise ValueError("At least two patients required")

    mat = [[0.0] * n for _ in range(n)]
    if n > 10:
        tasks = []
        for i in range(n):
            for j in range(n):
                tasks.append(((i, j, kind, method, combine), sets[i], sets[j]))
        with ThreadPoolExecutor(max_workers=MAX_COHORT_PARALLEL) as ex:
            futures = [ex.submit(_one_similarity, t) for t in tasks]
            for fut in futures:
                (i, j), sc = fut.result()
                mat[i][j] = round(sc, 3)
    else:
        for i, a in enumerate(sets):
            for j, b in enumerate(sets):
                mat[i][j] = round(float(a.similarity(b, kind=kind, method=method, combine=combine)), 3)

    labels = [f"P{k + 1}" for k in range(n)]
    omim = get_enrichment_model("omim")
    top_sets: list[set] = []
    for s in sets:
        res = omim.enrichment(method="hypergeom", hposet=s)
        top_sets.append({r["item"].id for r in res[:20]})
    shared = set.intersection(*top_sets) if top_sets else set()
    id_to_name: dict[Any, str] = {}
    for s in sets:
        res = omim.enrichment(method="hypergeom", hposet=s)
        for r in res:
            d = r["item"]
            id_to_name[d.id] = d.name
    shared_rows = [{"omim_id": oid, "name": id_to_name.get(oid, "")} for oid in sorted(shared)]
    return {
        "matrix": mat,
        "labels": labels,
        "shared_omim_candidates": shared_rows,
    }


def warm_all_caches() -> None:
    ensure_ontology_loaded()
    for cat in ("omim", "gene", "orpha", "decipher"):
        get_enrichment_model(cat)
    get_hpo_enrichment("gene")
    get_hpo_enrichment("omim")
