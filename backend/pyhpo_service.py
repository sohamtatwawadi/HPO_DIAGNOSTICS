"""
PyHPO service layer — ontology + enrichment models cached per process.
"""
from __future__ import annotations

import threading
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


# Process-lifetime memoization for pairwise term similarity. Ontology terms are
# loaded once at startup and never mutated, so (term_index, term_index, kind,
# method) -> score is stable for the life of the process. Scoring a large
# catalog (thousands of genes/diseases) against a small, fixed patient term
# set produces massive repetition here -- many entities share overlapping HPO
# annotations, so the number of *unique* pairs is far smaller than the number
# of calls. Plain dict, not lru_cache: unbounded growth is fine here (each
# entry is a few dozen bytes; even a million entries is tens of MB) and we
# want cross-request reuse, which lru_cache's default eviction would fight.
_pair_sim_cache: dict[tuple[int, int, str, str], float] = {}


def _cached_pair_similarity(term1, term2, kind: str, method: str) -> float:
    key = (int(term1), int(term2), kind, method)
    cached = _pair_sim_cache.get(key)
    if cached is not None:
        return cached
    score = float(term1.similarity_score(term2, kind=kind, method=method))
    _pair_sim_cache[key] = score
    return score


def _one_way_sim(
    patient_hposet,
    entity_hposet,
    kind: str = "omim",
    method: str = "resnik",
) -> float:
    """
    Pure patient→entity similarity. Not affected by entity annotation set size.

    For each patient term, find its best Resnik score against any term in the
    entity's annotation set. Return the average of those best scores.

    This is the correct metric for diagnosis:
      "How well does each of the patient's phenotypes match this gene/disease?"

    PyHPO's built-in combine methods (funSimAvg, funSimMax, BMA) are all
    bidirectional — they average in the entity→patient direction, which
    penalises genes/diseases with large annotation sets. That is wrong for
    diagnostic use: SCN5A has 105 annotations (well-studied gene) but 7/7
    patient terms matched; RANGRF has 12 annotations and 6/7 matched. BMA/
    funSimAvg rank RANGRF above SCN5A. This function ranks SCN5A correctly.
    """
    entity_terms = list(entity_hposet)
    if not entity_terms:
        return 0.0
    n = len(patient_hposet)
    if n == 0:
        return 0.0
    total = 0.0
    for pt in patient_hposet:
        best = max(_cached_pair_similarity(pt, et, kind, method) for et in entity_terms)
        total += best
    return total / n


def _ic_weighted_one_way_sim(
    patient_hposet,
    entity_hposet,
    kind: str = "omim",
    method: str = "resnik",
) -> float:
    """
    IC-weighted variant of _one_way_sim.

    Like _one_way_sim but weights each patient term's best-match score by that
    term's IC before averaging. A highly specific term (IC 7.2) drives the score
    more than a vague term (IC 0.8).

    Formula: sum(IC(pt) * max_sim(pt, entity)) / sum(IC(pt))
    """
    entity_terms = list(entity_hposet)
    if not entity_terms:
        return 0.0
    patient_terms = list(patient_hposet)
    if not patient_terms:
        return 0.0

    total_weight = 0.0
    weighted_sum = 0.0
    for pt in patient_terms:
        ic = float(pt.information_content.omim)
        if ic <= 0:
            ic = 0.1
        best = max(_cached_pair_similarity(pt, et, kind, method) for et in entity_terms)
        weighted_sum += ic * best
        total_weight += ic

    return weighted_sum / total_weight if total_weight > 0 else 0.0


def rank_by_similarity(
    patient_hposet,
    catalog,
    *,
    kind: str = "omim",
    method: str = "resnik",
    combine: str = "funSimAvg",
    top_n: int = 20,
    min_overlap: int = 1,
) -> list[dict[str, Any]]:
    """
    Rank genes or diseases by semantic similarity to the patient HPOSet.

    Sorting priority:
      1. similarity (descending) — one-way semantic match (patient→entity)
      2. coverage   (descending) — fraction of patient terms explained
      3. rev_coverage (descending) — overlap ÷ entity annotation count (focus tiebreaker)
      4. overlap    (descending) — raw exact term count as tiebreaker

    Parameters
    ----------
    patient_hposet : HPOSet
        The patient's resolved, cleaned HPOSet.
    catalog : iterable
        Ontology.genes  OR  Ontology.omim_diseases  OR  Ontology.orpha_diseases
    kind : str
        IC annotation source for similarity: "omim" | "gene" | "orpha"
    method : str
        Similarity method: "resnik" | "lin" | "jc" | "graphic" | "dist"
    combine : str
        Reserved for API compatibility; ranking uses :func:`_one_way_sim` only
        (patient→entity averages of per-term best scores). PyHPO set-level combine
        methods are bidirectional and are not used here.
    top_n : int
        Number of results to return.
    min_overlap : int
        Skip entities with fewer than this many exact overlapping terms.
        Keeps results clinically relevant and dramatically speeds up the loop.
    """
    from pyhpo import HPOSet

    patient_indices = {int(t.id.replace("HP:", "")) for t in patient_hposet}
    n_patient = len(patient_hposet)
    results = []

    for entity in catalog:
        entity_hpo_indices = entity.hpo
        overlap_count = len(patient_indices & entity_hpo_indices)

        if overlap_count < min_overlap:
            continue

        coverage = round(overlap_count / n_patient, 4)
        # Reverse coverage: fraction of the entity's own annotation set that the
        # patient's terms cover. Used as tiebreaker — more focused entities rank higher.
        n_entity = len(entity_hpo_indices)
        rev_coverage = round(overlap_count / n_entity if n_entity > 0 else 0.0, 4)

        try:
            from pyhpo import Ontology

            entity_terms = [Ontology[idx] for idx in entity_hpo_indices]
            entity_hposet = HPOSet(entity_terms)
        except Exception:
            continue

        try:
            sim = _one_way_sim(patient_hposet, entity_hposet, kind=kind, method=method)
        except Exception:
            sim = 0.0

        results.append(
            {
                "name": getattr(entity, "name", str(entity)),
                "id": str(getattr(entity, "id", "")),
                "similarity": round(sim, 4),
                "coverage": coverage,
                "rev_coverage": rev_coverage,
                "overlap": overlap_count,
                "total_annotations": len(entity_hpo_indices),
            }
        )

    results.sort(
        key=lambda x: (
            -x["similarity"],
            -x["coverage"],
            -x["rev_coverage"],
            -x["overlap"],
        ),
    )

    for i, r in enumerate(results[:top_n]):
        r["rank"] = i + 1

    return results[:top_n]


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
    mode: str = "diagnostic",
    sim_kind: str = "omim",
    sim_method: str = "resnik",
    sim_combine: str = "funSimAvg",
) -> dict[str, Any]:
    """
    mode="diagnostic"  → rank by semantic similarity + coverage  (default)
    mode="research"    → rank by hypergeometric p-value (original behaviour, for GWAS)
    """
    hposet, failed = build_hposet_from_queries(
        queries,
        remove_modifiers=remove_modifiers,
        replace_obsolete=replace_obsolete,
    )
    if hposet is None or len(hposet) == 0:
        raise ValueError("No valid HPO terms")

    if mode == "research":
        model = get_enrichment_model(source)
        results = model.enrichment(method="hypergeom", hposet=hposet)
        top = results[: max(0, top_n)]
        return {
            "mode": "research",
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
            "failed": failed,
        }

    from pyhpo import Ontology

    if source == "gene":
        catalog = Ontology.genes
    elif source == "orpha":
        catalog = Ontology.orpha_diseases
    elif source == "decipher":
        catalog = Ontology.decipher_diseases
    else:
        catalog = Ontology.omim_diseases

    ranked = rank_by_similarity(
        hposet,
        catalog,
        kind=sim_kind,
        method=sim_method,
        combine="funSimAvg",  # patient→entity; sim_combine ignored for diagnostic mode
        top_n=top_n,
        min_overlap=1,
    )

    return {
        "mode": "diagnostic",
        "results": ranked,
        "hposet_size": len(hposet),
        "failed": failed,
    }


def compute_similarity(
    patient1: list[str],
    patient2: list[str],
    *,
    kind: str = "omim",
    method: str = "resnik",
    combine: str = "BMA",
    one_way: bool = False,
) -> dict[str, Any]:
    """
    one_way=False (default): BMA bidirectional — correct for patient vs patient.
    one_way=True: pure patient1→patient2 — correct for patient vs disease profile.

    Why the distinction matters:
    Disease profiles have 40–100+ HPO terms spanning the full disease spectrum.
    BMA's reverse direction (disease→patient) averages scores for all those disease
    terms against the patient's small term set — most score near zero, dragging the
    result down. one_way asks only "how well does the patient match the disease?" which
    is exactly the diagnostic validation question.
    """
    h1, _ = build_hposet_from_queries(patient1)
    h2, _ = build_hposet_from_queries(patient2)
    if h1 is None or len(h1) == 0 or h2 is None or len(h2) == 0:
        raise ValueError("Invalid HPO terms in one or both patients")

    if one_way:
        score = _one_way_sim(h1, h2, kind=kind or "omim", method=method or "resnik")
    else:
        score = float(
            h1.similarity(
                h2,
                kind=kind or "omim",
                method=method or "resnik",
                combine=combine or "BMA",
            )
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


def prioritize_variants(
    hpo_queries: list[str],
    candidate_genes: list[str],
    *,
    mode: str = "diagnostic",
) -> dict[str, Any]:
    """
    Ranks VCF candidate genes against the patient's HPO profile.

    mode="diagnostic": semantic similarity + coverage — the clinically correct ranking.
    mode="research":   hypergeometric p-value — kept for reference / GWAS use.
    """
    hposet, _ = build_hposet_from_queries(hpo_queries)
    if hposet is None or len(hposet) == 0:
        raise ValueError("No valid HPO terms")

    from pyhpo.annotations import Gene

    user_genes = {g.upper().strip() for g in candidate_genes if g.strip()}

    if mode == "research":
        gene_model = get_enrichment_model("gene")
        gene_results = gene_model.enrichment(method="hypergeom", hposet=hposet)
        prioritized = [
            r
            for r in gene_results
            if getattr(r["item"], "name", "").upper() in user_genes
        ]
        missing = sorted(
            user_genes - {getattr(r["item"], "name", "").upper() for r in prioritized}
        )
        return {
            "mode": "research",
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

    candidate_gene_objects = []
    not_found = []
    for sym in user_genes:
        try:
            candidate_gene_objects.append(Gene.get(sym))
        except Exception:
            not_found.append(sym)

    if not candidate_gene_objects:
        raise ValueError("None of the candidate genes were found in the ontology")

    ranked = rank_by_similarity(
        hposet,
        candidate_gene_objects,
        kind="omim",
        method="resnik",
        combine="funSimAvg",
        top_n=len(candidate_gene_objects),
        min_overlap=0,
    )

    for r in ranked:
        r["has_match"] = r["overlap"] > 0

    return {
        "mode": "diagnostic",
        "prioritized": ranked,
        "missing": not_found,
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
    from pyhpo import Ontology

    top_sets: list[set] = []
    id_to_name: dict[Any, str] = {}
    for s in sets:
        ranked = rank_by_similarity(
            s,
            Ontology.omim_diseases,
            kind="omim",
            method="resnik",
            combine="funSimAvg",
            top_n=20,
            min_overlap=1,
        )
        top_sets.append({r["id"] for r in ranked})
        for r in ranked:
            id_to_name[r["id"]] = r["name"]

    shared = set.intersection(*top_sets) if top_sets else set()
    shared_rows = [{"omim_id": oid, "name": id_to_name.get(oid, "")} for oid in sorted(shared)]
    return {
        "matrix": mat,
        "labels": labels,
        "shared_omim_candidates": shared_rows,
    }


# ── Gene prioritization pipeline (separate from run_enrichment / rank_by_similarity) ──
_ANNOTATION_SPARSE_THRESHOLD = 25
_HPOSET_SPARSE_THRESHOLD = 4
_MEAN_IC_SPARSE_THRESHOLD = 1.5


def _expand_with_ic_filter(
    hposet: Any,
    ic_threshold: float = 2.0,
) -> tuple[Any, list[dict[str, Any]]]:
    """
    Expand each patient term to include ancestor terms with IC >= ic_threshold.
    Returns the expanded HPOSet and a list of added term dicts for display.
    """
    from pyhpo import HPOSet

    expanded: set = set(hposet)
    added_terms: list[dict[str, Any]] = []
    existing_ids = {int(t.id.replace("HP:", "")) for t in hposet}

    for term in list(hposet):
        for ancestor in term.all_parents:
            ic = float(ancestor.information_content.omim)
            idx = int(ancestor.id.replace("HP:", ""))
            if ic >= ic_threshold and idx not in existing_ids:
                expanded.add(ancestor)
                existing_ids.add(idx)
                added_terms.append(
                    {
                        "id": ancestor.id,
                        "name": ancestor.name,
                        "ic": round(ic, 3),
                    }
                )

    added_terms.sort(key=lambda x: -x["ic"])
    return HPOSet(list(expanded)), added_terms


def _score_one_entity(
    hposet: Any,
    patient_indices: set[int],
    n_patient: int,
    patient_ic_total: float,
    patient_by_idx: dict[int, Any],
    entity_name: str,
    entity_id: str,
    entity_indices: set[int],
    *,
    kind: str,
    method: str,
) -> "dict[str, Any] | None":
    """
    Score a patient HPOSet against one phenotype-annotation set (``entity_indices``).
    ``entity_name``/``entity_id`` are carried through as-is on the result -- the
    caller decides whose identity they represent (e.g. scoring a gene against
    one of *its* specific OMIM diseases' HPO set still returns a row identified
    by the gene, not the disease). Returns None if there's no overlap at all.
    """
    from pyhpo import HPOSet, Ontology

    matched = patient_indices & entity_indices
    if not matched:
        return None

    overlap = len(matched)
    fwd_cov = overlap / n_patient
    ic_sum = sum(float(patient_by_idx[idx].information_content.omim) for idx in matched)
    ic_cov = ic_sum / patient_ic_total if patient_ic_total > 0 else 0.0
    rev_cov = overlap / len(entity_indices) if entity_indices else 0.0

    try:
        entity_terms = [Ontology[idx] for idx in entity_indices]
        entity_hposet = HPOSet(entity_terms)
        sim = _ic_weighted_one_way_sim(hposet, entity_hposet, kind=kind, method=method)
    except Exception:
        sim = 0.0

    combined = 0.45 * sim + 0.30 * ic_cov + 0.15 * fwd_cov + 0.10 * rev_cov

    return {
        "name": entity_name,
        "id": entity_id,
        "combined_score": round(combined, 4),
        "similarity": round(sim, 4),
        "ic_weighted_coverage": round(ic_cov, 4),
        "coverage": round(fwd_cov, 4),
        "rev_coverage": round(rev_cov, 4),
        "overlap": overlap,
        "total_annotations": len(entity_indices),
        "matched_terms": [
            {
                "id": patient_by_idx[idx].id,
                "name": patient_by_idx[idx].name,
                "ic": round(float(patient_by_idx[idx].information_content.omim), 3),
            }
            for idx in sorted(matched)
        ],
        "_hpo_indices": entity_indices,
    }


def _score_catalog(
    hposet: Any,
    catalog: Any,
    top_n: int,
    *,
    kind: str = "omim",
    method: str = "resnik",
    disambiguate_genes: bool = False,
) -> list[dict[str, Any]]:
    """
    Score a full catalog (genes or diseases) against a patient HPOSet.
    Returns every scored entity, sorted by combined score, with ``rank`` set on each row.
    ``top_n`` is ignored for slicing; callers slice with ``[:top_n]`` when needed.

    disambiguate_genes: when scoring a gene catalog, ~27% of genes cause more
    than one OMIM disease. Scoring against the gene's blended annotation set
    (the union of every phenotype ever linked to it, across all its diseases)
    dilutes the signal for these genes -- a strong match to one specific
    disease gets averaged down by an unrelated one. When True, any entity
    with a direct OMIM mapping (see :func:`_gene_omim_map`) is instead scored
    against each of its diseases' own HPO set individually, keeping the best
    match. The winning disease is attached as ``_disambiguated_disease``
    (id/name/causal_overlap) so callers can use it as the authoritative
    "best patient match" (see :func:`_bridge_disease_for`). Entities with no
    OMIM mapping (e.g. Orpha-only genes) fall back to the original
    blended-annotation scoring, unchanged.
    """
    from pyhpo.annotations import Omim

    patient_indices = {int(t.id.replace("HP:", "")) for t in hposet}
    n_patient = len(hposet)
    patient_ic_total = sum(float(t.information_content.omim) for t in hposet)
    patient_by_idx = {int(t.id.replace("HP:", "")): t for t in hposet}

    results: list[dict[str, Any]] = []
    for entity in catalog:
        entity_name = getattr(entity, "name", str(entity))
        entity_id = str(getattr(entity, "id", ""))
        row = None

        if disambiguate_genes:
            omim_ids = _gene_omim_map().get(entity_name.upper())
            if omim_ids:
                best = None
                best_disease = None
                for omim_id in omim_ids:
                    try:
                        disease = Omim.get(omim_id)
                    except (KeyError, ValueError):
                        continue
                    candidate = _score_one_entity(
                        hposet, patient_indices, n_patient, patient_ic_total, patient_by_idx,
                        entity_name, entity_id, disease.hpo, kind=kind, method=method,
                    )
                    if candidate is not None and (best is None or candidate["combined_score"] > best["combined_score"]):
                        best = candidate
                        best_disease = disease
                if best is not None:
                    n_disease = len(best_disease.hpo)
                    best["_disambiguated_disease"] = {
                        "id": best_disease.id,
                        "name": best_disease.name,
                        "causal_overlap": round(
                            len(entity.hpo & best_disease.hpo) / n_disease if n_disease else 0.0, 3
                        ),
                    }
                    row = best

        if row is None:
            row = _score_one_entity(
                hposet, patient_indices, n_patient, patient_ic_total, patient_by_idx,
                entity_name, entity_id, entity.hpo, kind=kind, method=method,
            )
        if row is None:
            continue
        results.append(row)

    results.sort(
        key=lambda x: (
            -x["combined_score"],
            -x["ic_weighted_coverage"],
            -x["coverage"],
            -x["overlap"],
        ),
    )

    for i, r in enumerate(results):
        r["rank"] = i + 1

    return results


@lru_cache(maxsize=1)
def _gene_omim_map() -> dict[str, set[int]]:
    """
    Direct gene -> OMIM disease ID map, parsed straight from HPO's own
    genes_to_phenotype.txt (the ``disease_id`` column). This is the
    authoritative "this gene causes this disease" relationship as HPO/OMIM
    define it -- independent of any patient phenotype. PyHPO's own gene
    parser (pyhpo/parser/genes.py) discards this column when loading the
    Ontology (it only keeps HPO term associations), so it isn't available
    anywhere else and has to be read directly from the same data file.

    Not to be confused with :func:`_bridge_disease_for`, which picks whichever
    of *this specific gene's own* diseases (from this same mapping) best
    matches this patient's HPO profile -- useful for genes that cause several
    diseases. Both are useful and shown together.
    """
    import csv
    import os

    import pyhpo

    data_dir = os.path.join(os.path.dirname(pyhpo.__file__), "data")
    path = os.path.join(data_dir, "genes_to_phenotype.txt")

    mapping: dict[str, set[int]] = {}
    try:
        with open(path, encoding="utf-8") as fh:
            reader = csv.reader(fh, delimiter="\t")
            header = next(reader, None)
            if not header or "gene_symbol" not in header or "disease_id" not in header:
                return mapping
            gene_i = header.index("gene_symbol")
            disease_i = header.index("disease_id")
            for row in reader:
                if len(row) <= max(gene_i, disease_i):
                    continue
                disease_id = row[disease_i]
                if not disease_id.startswith("OMIM:"):
                    continue
                try:
                    omim_id = int(disease_id.split(":", 1)[1])
                except ValueError:
                    continue
                mapping.setdefault(row[gene_i].upper(), set()).add(omim_id)
    except OSError:
        return mapping
    return mapping


def gene_omim_phenotypes(gene_name: str) -> list[dict[str, Any]]:
    """The OMIM disease(s) this gene is directly annotated as causing, per HPO's own database."""
    from pyhpo.annotations import Omim

    ids = _gene_omim_map().get(gene_name.upper(), set())
    results = []
    for omim_id in sorted(ids):
        try:
            disease = Omim.get(omim_id)
        except (KeyError, ValueError):
            continue
        results.append({"id": disease.id, "name": disease.name})
    return sorted(results, key=lambda d: d["name"])


def _bridge_disease_for(gr: dict[str, Any], disease_results_full: list[dict[str, Any]]) -> "dict[str, Any] | None":
    """
    The disease found during per-disease gene scoring (see _score_catalog's
    disambiguate_genes), if any -- guaranteed to be one of the gene's own
    OMIM diseases (ground truth from HPO's gene-disease file), picked because
    it best matches this patient among the gene's confirmed diseases.

    Returns None -- not a guess -- when no such match exists (the gene has no
    direct OMIM mapping, or none of its listed diseases have any phenotype
    overlap with this patient). An earlier version fell back to a
    causal-overlap heuristic that searched the independently-ranked disease
    list for *any* disease with term overlap against the gene's blended
    annotation profile, regardless of whether the gene is actually known to
    cause it. That surfaced real mismatches (AGRN bridging to PREPL's own
    disease; PURA bridging to an unrelated neurodevelopmental disorder it has
    no confirmed association with) -- a plausible-looking wrong disease name
    is worse than no disease name for a diagnostic tool, caveat or not. The
    gene's actual disease record is still available via omim_phenotypes.
    """
    disambiguated = gr.get("_disambiguated_disease")
    if disambiguated is None:
        return None
    match = next((d for d in disease_results_full if d["id"] == str(disambiguated["id"])), None)
    return {
        "disease_name": disambiguated["name"],
        "disease_id": str(disambiguated["id"]),
        "disease_rank": match["rank"] if match else None,
        "disease_score": match["combined_score"] if match else None,
        "causal_overlap": disambiguated["causal_overlap"],
    }


def gene_prioritization_pipeline(
    queries: list[str],
    *,
    remove_modifiers: bool = False,
    replace_obsolete: bool = True,
    expand_ic: bool = True,
    ic_expansion_threshold: float = 2.0,
    top_n: int = 20,
) -> dict[str, Any]:
    """
    Gene prioritization pipeline — separate from run_enrichment().

    Pass 1: rank genes; Pass 2: rank OMIM diseases; combine with bridge disease per gene.
    """
    from pyhpo import Ontology

    hposet, failed = build_hposet_from_queries(
        queries,
        remove_modifiers=remove_modifiers,
        replace_obsolete=replace_obsolete,
    )
    if hposet is None or len(hposet) == 0:
        raise ValueError("No valid HPO terms resolved")

    expanded_terms: list[dict[str, Any]] = []
    if expand_ic and len(hposet) > 0:
        hposet, expanded_terms = _expand_with_ic_filter(hposet, ic_threshold=ic_expansion_threshold)

    warnings: list[dict[str, Any]] = []
    n_terms = len(hposet)
    ic_vals = [float(t.information_content.omim) for t in hposet]
    mean_ic = sum(ic_vals) / n_terms if n_terms else 0.0

    if n_terms < _HPOSET_SPARSE_THRESHOLD:
        warnings.append(
            {
                "type": "sparse_input",
                "level": "warning",
                "message": (
                    f"Only {n_terms} HPO terms in profile. "
                    "Fewer than 4 terms makes it very difficult to discriminate "
                    "between genes. Add more specific phenotypes for better results."
                ),
            }
        )

    if mean_ic < _MEAN_IC_SPARSE_THRESHOLD:
        warnings.append(
            {
                "type": "low_ic",
                "level": "warning",
                "message": (
                    f"Mean IC of {mean_ic:.2f} is low — most entered terms are "
                    "non-specific and appear in many diseases. "
                    "Consider adding more specific phenotypes (e.g. subtype of seizure, "
                    "specific metabolite abnormality, or pathognomonic finding)."
                ),
            }
        )

    if failed:
        warnings.append(
            {
                "type": "unresolved_terms",
                "level": "info",
                "message": f"{len(failed)} term(s) could not be resolved: {', '.join(failed[:5])}",
            }
        )

    # Score all genes with ≥1 overlap but cap the returned full list at 1000.
    # Ranks beyond that are incidental weak matches; payload stays ~<200KB.
    _SEARCH_CAP = 1000
    gene_results_scored = _score_catalog(
        hposet,
        Ontology.genes,
        top_n=_SEARCH_CAP,
        disambiguate_genes=True,
    )
    gene_results_full = gene_results_scored[:_SEARCH_CAP]
    gene_results = gene_results_full[:top_n]
    # Score all diseases; bridge resolution uses the top ~200 by patient score.
    disease_results_full = _score_catalog(
        hposet,
        Ontology.omim_diseases,
        top_n=min(200, max(top_n, 200)),
    )

    for gr in gene_results_full:
        if gr["total_annotations"] < _ANNOTATION_SPARSE_THRESHOLD:
            gr["annotation_warning"] = (
                f"Gene has only {gr['total_annotations']} HPO annotations — "
                "sparse coverage in database. Disease ranking below is more "
                "reliable for this candidate."
            )
        else:
            gr["annotation_warning"] = None

        gr["bridge_disease"] = _bridge_disease_for(gr, disease_results_full)
        gr["omim_phenotypes"] = gene_omim_phenotypes(gr["name"])

    def _clean(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [{k: v for k, v in r.items() if not k.startswith("_")} for r in results]

    return {
        "genes": _clean(gene_results),
        "all_genes": _clean(gene_results_full),
        "total_genes_scored": len(gene_results_full),
        "diseases": _clean(disease_results_full[:top_n]),
        "warnings": warnings,
        "expanded_terms": expanded_terms,
        "hposet_size": n_terms,
        "mean_ic": round(mean_ic, 3),
        "remove_modifiers_used": remove_modifiers,
        "expand_ic_used": expand_ic,
        "ic_expansion_threshold": ic_expansion_threshold,
    }


# ── VariMAT variant-file cross-reference (separate from gene_prioritization_pipeline) ──
_VARIANT_PRIMARY_TIERS = {0, 1}  # Pathogenic, Likely Pathogenic
_VARIANT_FALLBACK_TIERS = {2}  # Uncertain Significance

# Inheritance-mode tokens (parsed from the file's own ACMG_Criteria, see
# varimat_parser._extract_inheritance_mode) that mean "recessive only" --
# a single heterozygous hit cannot by itself explain disease for these.
_RECESSIVE_ONLY_MODES = {"AR"}


# OMIM disease HPO annotation sets include inheritance-mode terms directly
# (e.g. HP:0000007 "Autosomal recessive inheritance" is itself one of a
# disease's annotated terms) -- confirmed by direct inspection, not assumed.
# This is the authoritative source: the disease's own curated record, not the
# variant caller's per-variant ACMG tag.
_INHERITANCE_TERM_LABELS: dict[int, str] = {
    6: "AD",
    7: "AR",
    1417: "XL",
    1419: "XLR",
    1423: "XLD",
    1425: "YL",
}


def _gene_disease_inheritance_modes(gene_name: str) -> "set[str] | None":
    """
    Union of OMIM's own recorded inheritance mode(s) across all of this gene's
    known diseases (see :func:`_gene_omim_map`). Conservative by design: if
    ANY of the gene's diseases can be inherited dominantly, a lone
    heterozygous variant can't be ruled out on inheritance grounds alone --
    regardless of which specific disease this patient's phenotype points to.
    """
    from pyhpo.annotations import Omim

    omim_ids = _gene_omim_map().get(gene_name.upper())
    if not omim_ids:
        return None
    modes: set[str] = set()
    for omim_id in omim_ids:
        try:
            disease = Omim.get(omim_id)
        except (KeyError, ValueError):
            continue
        modes |= {label for idx, label in _INHERITANCE_TERM_LABELS.items() if idx in disease.hpo}
    return modes or None


def _zygosity_warning(
    candidate_variants: list[dict[str, Any]],
    disease_inheritance_modes: "set[str] | None" = None,
) -> "str | None":
    """
    Flag genes whose qualifying variant(s) can't structurally explain disease
    given the declared inheritance mode: a lone heterozygous variant in an
    autosomal-recessive-only (AR) gene needs a second variant (compound het)
    or a homozygous call to actually be causal.

    Conservative by design: only warns when *every* candidate variant has a
    positively-identified AR-only mode per the file's own ACMG criteria.
    Missing/unknown inheritance, or any AD/AD_AR/XL variant in the mix, means
    dominant inheritance can't be ruled out, so a single heterozygous hit
    stays unflagged.

    ``disease_inheritance_modes``, when available (the gene's own OMIM
    disease record -- see :func:`_gene_disease_inheritance_modes`,
    more authoritative than the variant caller's per-variant tag), is used to
    veto a false positive: if OMIM says this disease can also be inherited
    dominantly, the warning does not fire even though the file's own ACMG
    criteria say AR for this specific variant.
    """
    modes = {v.get("inheritance_mode", "") for v in candidate_variants}
    if not modes or not modes.issubset(_RECESSIVE_ONLY_MODES):
        return None

    if disease_inheritance_modes and not disease_inheritance_modes.issubset(_RECESSIVE_ONLY_MODES):
        return None  # OMIM's own record says dominant inheritance is also possible for this disease

    if any(v.get("zygosity", "").lower() == "homozygous" for v in candidate_variants):
        return None  # a homozygous AR variant is sufficient on its own

    heterozygous = [v for v in candidate_variants if v.get("zygosity", "").lower() == "heterozygous"]
    distinct_variants = {v.get("variant_id") for v in heterozygous}
    if len(distinct_variants) >= 2:
        return None  # >=2 distinct het variants: plausible compound het, not flagged

    if len(distinct_variants) == 1:
        source = (
            "the associated disease's own OMIM inheritance record and the file's ACMG criteria both mark"
            if disease_inheritance_modes
            else "the file's ACMG criteria mark"
        )
        return (
            f"This gene's only qualifying variant is a single heterozygous hit, but {source} "
            "this gene's inheritance as recessive-only (AR). A lone heterozygous variant cannot by "
            "itself explain an autosomal recessive disease — a second variant (compound heterozygous) "
            "or a homozygous call would be needed."
        )
    return None


def _tier_pick(pool: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Prefer Pathogenic/Likely Pathogenic; fall back to VUS if none are P/LP."""
    primary = [v for v in pool if v["classification_tier"] in _VARIANT_PRIMARY_TIERS]
    if primary:
        return primary
    return [v for v in pool if v["classification_tier"] in _VARIANT_FALLBACK_TIERS]


def _select_candidate_variants(
    variants: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Filter-then-rank, QC status first: a flagged call (LowQD/LowCoverage/
    SnpCluster/...) is never treated as equivalent to a clean PASS call -- the
    variant caller itself doubts it's real, so it must not compete for rank
    alongside genuinely clean evidence. A gene whose only qualifying variant
    is QC-flagged is kept out of the ranked ``candidates`` pool entirely
    (callers should route it to a separate "low quality only" bucket) rather
    than letting it dilute/outrank genes with clean support.

    Within whichever QC pool is used, prefer Pathogenic/Likely Pathogenic;
    fall back to VUS if none are P/LP. Benign/Likely Benign/unclassified are
    never candidates.

    Returns (pass_candidates, flagged_candidates, ruled_out) -- exactly one of
    the first two is non-empty when there's a qualifying variant at all.
    ``ruled_out`` is reported rather than dropped, so nothing is hidden.
    """
    passing_qc = [v for v in variants if v.get("passes_qc")]
    flagged_qc = [v for v in variants if not v.get("passes_qc")]

    pass_candidates = _tier_pick(passing_qc)
    if pass_candidates:
        keep = {id(v) for v in pass_candidates}
        return pass_candidates, [], [v for v in variants if id(v) not in keep]

    flagged_candidates = _tier_pick(flagged_qc)
    if flagged_candidates:
        keep = {id(v) for v in flagged_candidates}
        return [], flagged_candidates, [v for v in variants if id(v) not in keep]

    return [], [], list(variants)


def _quality_warning(candidate_variants: list[dict[str, Any]]) -> "str | None":
    """None of the selected candidates passed the variant caller's own QC filter."""
    if not candidate_variants or any(v.get("passes_qc") for v in candidate_variants):
        return None
    tags = sorted({v.get("filter_status") or "unspecified" for v in candidate_variants})
    return (
        f"None of this gene's candidate variant(s) passed the file's own quality filter "
        f"(flagged: {', '.join(tags)}). The call may be a sequencing/alignment artifact rather "
        "than a real variant -- confirm with raw read data before treating this as a finding."
    )


def _resolve_gene(symbol: str) -> Any | None:
    from pyhpo.annotations import Gene

    for candidate in (symbol, symbol.upper()):
        try:
            return Gene.get(candidate)
        except Exception:
            continue
    return None


# ── Short-lived server-side cache for variant-file drill-down lookups ──
# At whole-exome/genome scale, the "no phenotype overlap" bucket can hold
# thousands of genes -- too much to inline in full detail on every request.
# The main response returns a lightweight summary + a token; a follow-up call
# to variant_file_gene_detail() fetches full variant detail for genes the
# user actually wants to inspect, without re-uploading or re-parsing the file.
_VARIANT_FILE_CACHE_TTL_SECONDS = 20 * 60
_variant_file_cache: dict[str, tuple[float, dict[str, list[dict[str, Any]]]]] = {}


def _cache_variant_file(variants_by_canonical: dict[str, list[dict[str, Any]]]) -> str:
    import time
    import uuid

    now = time.time()
    # Opportunistic cleanup so this dict doesn't grow unbounded across uploads.
    expired = [tok for tok, (exp, _) in _variant_file_cache.items() if exp < now]
    for tok in expired:
        del _variant_file_cache[tok]

    token = uuid.uuid4().hex
    _variant_file_cache[token] = (now + _VARIANT_FILE_CACHE_TTL_SECONDS, variants_by_canonical)
    return token


def variant_file_gene_detail(token: str, genes: list[str]) -> dict[str, Any]:
    """Look up full variant detail for specific genes from a cached upload (see :func:`variant_prioritization_from_file`)."""
    import time

    entry = _variant_file_cache.get(token)
    if entry is None:
        raise ValueError("This upload has expired or was never cached. Re-run the cross-reference to look up genes again.")
    expiry, variants_by_canonical = entry
    if expiry < time.time():
        del _variant_file_cache[token]
        raise ValueError("This upload has expired. Re-run the cross-reference to look up genes again.")

    results = []
    for raw_name in genes:
        gene_obj = _resolve_gene(raw_name.strip())
        canonical = gene_obj.name if gene_obj is not None else raw_name.strip().upper()
        variants = variants_by_canonical.get(canonical, [])
        pass_candidates, flagged_candidates, ruled_out_variants = _select_candidate_variants(variants)
        results.append(
            {
                "name": canonical,
                "found": bool(variants),
                "candidate_variants": pass_candidates or flagged_candidates,
                "ruled_out_variants": ruled_out_variants,
                "zygosity_warning": (
                    _zygosity_warning(pass_candidates, _gene_disease_inheritance_modes(canonical))
                    if pass_candidates
                    else None
                ),
                "quality_warning": _quality_warning(flagged_candidates) if flagged_candidates else None,
                "omim_phenotypes": gene_omim_phenotypes(canonical),
            }
        )
    return {"results": results}


_GZIP_MAGIC = b"\x1f\x8b"
_MAX_DECOMPRESSED_BYTES = 6 * 1024 * 1024 * 1024  # 6GB -- headroom above the ~5GB whole-genome case


class _SizeLimitedLines:
    """
    Wraps a line iterator (file, gzip stream, ...) and enforces a cumulative
    byte ceiling as lines are consumed. Protects against decompression bombs
    -- a small malicious/corrupt .gz that would expand far past what a real
    VariMAT export ever needs -- without ever holding the content it counts
    in memory at once (it just measures and passes each line through).
    """

    def __init__(self, lines, max_bytes: int) -> None:
        self._lines = lines
        self._max_bytes = max_bytes
        self._total = 0

    def __iter__(self):
        for line in self._lines:
            self._total += len(line.encode("utf-8", errors="ignore"))
            if self._total > self._max_bytes:
                from varimat_parser import VarimatParseError

                raise VarimatParseError(
                    f"Decompressed content exceeds the {self._max_bytes // (1024 ** 3)}GB limit"
                )
            yield line


def _open_varimat_lines(path: str):
    """
    Open a VariMAT upload for streaming, transparently handling gzip.

    Detected by magic bytes, not the file extension. Both branches stream --
    gzip.open(..., "rt") decompresses on read rather than all at once, so
    memory use stays bounded regardless of how large the file is decompressed.
    """
    import gzip

    with open(path, "rb") as probe:
        magic = probe.read(2)
    if magic == _GZIP_MAGIC:
        fh = gzip.open(path, mode="rt", encoding="utf-8-sig")
    else:
        fh = open(path, mode="rt", encoding="utf-8-sig")
    return _SizeLimitedLines(fh, _MAX_DECOMPRESSED_BYTES), fh


COMPOSITE_RANKING_ENABLED = True


def _pathogenicity_weight(classification: str) -> float:
    mapping = {
        "pathogenic": 1.0,
        "likely pathogenic": 0.85,
        "uncertain significance": 0.3,
        "vus": 0.3,
        "likely benign": 0.05,
        "benign": 0.0,
    }
    return mapping.get((classification or "").strip().lower(), 0.3)


def _inheritance_weight(inheritance_mode: str, zygosity: str) -> float:
    """
    Key fix: AR genes with a single heterozygous hit get 0.2 penalty.
    This stops VUS/intronic AR+het variants from outranking
    Pathogenic homozygous hits purely on HPO score.
    """
    mode = (inheritance_mode or "").upper()
    zyg = (zygosity or "").lower()

    has_ar = "AR" in mode
    has_ad = "AD" in mode
    has_xl = any(x in mode for x in ("XLD", "XLR", "XL"))

    if has_ar and not has_ad:
        # Purely recessive
        if zyg == "homozygous":
            return 1.0
        if "compound" in zyg:
            return 1.0
        if zyg == "heterozygous":
            return 0.2
        return 0.4

    if has_ad and has_ar:
        # Mixed (AD_AR, AD_DD_AR)
        return 0.7 if zyg == "heterozygous" else 0.5

    if has_ad and not has_ar:
        # Purely dominant (AD, AD_DD)
        return 1.0 if zyg == "heterozygous" else 0.5

    if has_xl:
        if "hemizygous" in zyg:
            return 1.0
        if zyg == "heterozygous":
            return 0.5
        return 0.5

    return 0.5  # unknown / missing / empty


def _frequency_weight(gnomad_af) -> float:
    try:
        af = float(gnomad_af) if gnomad_af is not None else 0.0
    except (TypeError, ValueError):
        af = 0.0
    if af == 0.0:
        return 1.0
    if af < 0.0001:
        return 0.9
    if af < 0.001:
        return 0.7
    if af < 0.005:
        return 0.5
    if af < 0.01:
        return 0.3
    return 0.1


def _composite_score(gene_row: dict) -> float:
    """
    composite = combined_score
                × best pathogenicity weight across variants
                × best inheritance weight across variants
                × worst frequency weight across variants

    Uses candidate_variants[].classification, .zygosity,
    .inheritance_mode, .gnomad_af — all confirmed present
    from _build_variant_record().

    Falls back to combined_score if no variants present.
    """
    variants = gene_row.get("candidate_variants") or []
    if not variants:
        return gene_row.get("combined_score", 0.0)

    p_weights = [_pathogenicity_weight(v.get("classification", "")) for v in variants]
    i_weights = [
        _inheritance_weight(v.get("inheritance_mode", ""), v.get("zygosity", ""))
        for v in variants
    ]
    f_weights = [_frequency_weight(v.get("gnomad_af")) for v in variants]

    return (
        gene_row.get("combined_score", 0.0)
        * max(p_weights)
        * max(i_weights)
        * min(f_weights)
    )


def _inheritance_flag(gene_row: dict) -> str | None:
    """
    Discrete flag for frontend badge rendering.
    Reads from candidate_variants[].classification, .zygosity,
    .inheritance_mode, .gnomad_af — all from _build_variant_record().
    Evaluated in priority order: positive signals first, warnings second.
    """
    variants = gene_row.get("candidate_variants") or []
    if not variants:
        return None

    # Positive signals — check first
    for v in variants:
        cls = (v.get("classification") or "").lower()
        zyg = (v.get("zygosity") or "").lower()
        is_plp = cls in ("pathogenic", "likely pathogenic")

        if is_plp and zyg == "homozygous":
            return "PATHOGENIC_HOM"
        if is_plp and "compound" in zyg:
            return "PATHOGENIC_COMPHET"

    # Warning signals
    for v in variants:
        mode = (v.get("inheritance_mode") or "").upper()
        zyg = (v.get("zygosity") or "").lower()
        af = v.get("gnomad_af")

        if "AR" in mode and "AD" not in mode and zyg == "heterozygous":
            return "AR_SINGLE_HET"

        try:
            if af is not None and float(af) > 0.01:
                return "HIGH_AF_VARIANT"
        except (TypeError, ValueError):
            pass

    # Clean fit
    for v in variants:
        mode = (v.get("inheritance_mode") or "").upper()
        zyg = (v.get("zygosity") or "").lower()
        if mode == "AD" and zyg == "heterozygous":
            return "AD_FIT"

    return None


def variant_prioritization_from_file(
    queries: list[str],
    varimat_path: str,
    *,
    remove_modifiers: bool = False,
    replace_obsolete: bool = True,
    expand_ic: bool = True,
    ic_expansion_threshold: float = 2.0,
    top_n: int = 100,
) -> dict[str, Any]:
    """
    Cross-reference a VariMAT variant export against the patient's HPO profile.

    ``varimat_path`` is a path to the uploaded file on disk (plain text or
    gzip) rather than pre-loaded content -- it's streamed and parsed line by
    line (see :func:`_open_varimat_lines`, :func:`varimat_parser.parse_varimat_lines`)
    so a multi-GB whole-genome export never needs to be held in memory whole.

    Genes present in both the file and the ontology are ranked by HPO
    similarity (reusing :func:`_score_catalog`, same as the gene
    prioritization pipeline). Each ranked gene is annotated with its
    Pathogenic/Likely Pathogenic variants from the file (VUS as fallback if
    none), plus a bridge disease via :func:`_bridge_disease_for`.

    Three result buckets, so nothing with a clinically relevant classification
    is silently dropped:
      * ``candidates``            -- genes with >=1 qualifying variant, ranked
        by HPO similarity to the patient.
      * ``ruled_out``             -- genes that matched the patient's
        phenotype but only have Benign/Likely Benign variants in the file.
      * ``no_phenotype_overlap``  -- genes with a qualifying variant in the
        file that share zero HPO terms with the (possibly IC-expanded)
        patient profile, so they can't be ranked but are still worth a look.
    """
    from pyhpo import Ontology
    from varimat_parser import parse_varimat_lines

    hposet, failed_hpo = build_hposet_from_queries(
        queries, remove_modifiers=remove_modifiers, replace_obsolete=replace_obsolete
    )
    if hposet is None or len(hposet) == 0:
        raise ValueError("No valid HPO terms resolved")

    expanded_terms: list[dict[str, Any]] = []
    if expand_ic:
        hposet, expanded_terms = _expand_with_ic_filter(hposet, ic_threshold=ic_expansion_threshold)

    # Only genes with an HPO annotation can ever be scored -- typically ~5k of the
    # ~20k genes in a raw whole-exome/genome export. Filtering by this allowlist
    # during parsing (rather than after) skips full record-building for the ~75%
    # of rows that would be discarded anyway, which is where nearly all parsing
    # time/memory goes at that scale.
    gene_allowlist = {g.name.upper() for g in Ontology.genes}
    lines, fh = _open_varimat_lines(varimat_path)
    try:
        try:
            parsed = parse_varimat_lines(lines, gene_allowlist=gene_allowlist)
        except (OSError, EOFError) as exc:
            raise ValueError("Could not decompress .gz file — is it a valid gzip archive?") from exc
    finally:
        fh.close()

    resolved_by_name: dict[str, Any] = {}
    unresolved_genes: list[str] = []
    variants_by_canonical: dict[str, list[dict[str, Any]]] = {}
    for symbol, variants in parsed["variants_by_gene"].items():
        gene_obj = _resolve_gene(symbol)
        if gene_obj is None:
            unresolved_genes.append(symbol)
            continue
        resolved_by_name[gene_obj.name] = gene_obj
        variants_by_canonical.setdefault(gene_obj.name, []).extend(variants)

    if not resolved_by_name:
        raise ValueError(
            f"None of the {parsed['genes_seen_total']} gene symbol(s) in the VariMAT file "
            "could be matched to the PyHPO ontology."
        )

    resolved_genes = list(resolved_by_name.values())
    gene_scores = _score_catalog(hposet, resolved_genes, top_n=len(resolved_genes), disambiguate_genes=True)
    scored_names = {gr["name"] for gr in gene_scores}

    disease_results_full = _score_catalog(hposet, Ontology.omim_diseases, top_n=200)

    def _attach_variants(gr: dict[str, Any]) -> dict[str, Any]:
        variants = variants_by_canonical.get(gr["name"], [])
        pass_candidates, flagged_candidates, ruled_out_variants = _select_candidate_variants(variants)
        shown = pass_candidates or flagged_candidates
        row = {k: v for k, v in gr.items() if not k.startswith("_")}
        row["hpo_rank"] = row.pop("rank", None)
        row["bridge_disease"] = _bridge_disease_for(gr, disease_results_full)
        row["omim_phenotypes"] = gene_omim_phenotypes(row["name"])
        row["candidate_variants"] = shown
        row["ruled_out_variants"] = ruled_out_variants
        row["zygosity_warning"] = (
            _zygosity_warning(pass_candidates, _gene_disease_inheritance_modes(row["name"]))
            if pass_candidates
            else None
        )
        row["quality_warning"] = _quality_warning(flagged_candidates) if flagged_candidates else None
        row["_qc_clean_candidate"] = bool(pass_candidates)
        return row

    candidates: list[dict[str, Any]] = []
    low_quality_only: list[dict[str, Any]] = []
    ruled_out: list[dict[str, Any]] = []
    for gr in gene_scores:
        row = _attach_variants(gr)
        is_qc_clean = row.pop("_qc_clean_candidate")
        if row["candidate_variants"] and is_qc_clean:
            candidates.append(row)
        elif row["candidate_variants"]:
            # Qualifying variant exists, but only as a QC-flagged (LowQD/LowCoverage/
            # SnpCluster/...) call -- kept out of the ranked pool entirely so it can't
            # outrank or dilute genes with a genuinely clean supporting variant.
            low_quality_only.append(row)
        else:
            ruled_out.append(row)

    if COMPOSITE_RANKING_ENABLED:
        for r in candidates:
            r["composite_score"] = round(_composite_score(r), 6)

            # Rank breakdown — pick the best variant for display
            variants = r.get("candidate_variants") or []
            if variants:
                best_v = max(
                    variants,
                    key=lambda v: (
                        _pathogenicity_weight(v.get("classification", ""))
                        * _inheritance_weight(v.get("inheritance_mode", ""), v.get("zygosity", ""))
                    ),
                )
                r["rank_breakdown"] = {
                    "hpo_combined_score": r.get("combined_score"),
                    "pathogenicity_weight": round(
                        _pathogenicity_weight(best_v.get("classification", "")), 3
                    ),
                    "inheritance_weight": round(
                        _inheritance_weight(
                            best_v.get("inheritance_mode", ""),
                            best_v.get("zygosity", ""),
                        ),
                        3,
                    ),
                    "frequency_weight": round(
                        _frequency_weight(best_v.get("gnomad_af")), 3
                    ),
                }
            else:
                r["rank_breakdown"] = {
                    "hpo_combined_score": r.get("combined_score"),
                }

        for r in candidates:
            r["inheritance_flag"] = _inheritance_flag(r)

        candidates.sort(
            key=lambda x: (
                -x.get("composite_score", 0.0),
                -x.get("combined_score", 0.0),
            )
        )

    for i, r in enumerate(candidates):
        r["rank"] = i + 1
    low_quality_only.sort(key=lambda r: -r["combined_score"])

    # Genes with a qualifying variant but zero HPO overlap with the (possibly
    # IC-expanded) patient profile: can't be ranked, but a real Pathogenic/VUS
    # finding should never just vanish because the phenotype list didn't cover
    # it. At whole-exome scale this bucket can hold thousands of genes, so the
    # main response carries only a lightweight summary per gene; full detail
    # for any of them is available via variant_file_gene_detail() + the token.
    no_phenotype_overlap_summary: list[dict[str, Any]] = []
    for gene_obj in resolved_genes:
        if gene_obj.name in scored_names:
            continue
        pass_cand, flagged_cand, ro = _select_candidate_variants(variants_by_canonical.get(gene_obj.name, []))
        cand = pass_cand or flagged_cand
        if not cand:
            continue
        no_phenotype_overlap_summary.append(
            {
                "name": gene_obj.name,
                "best_classification": cand[0]["classification"],
                "best_classification_tier": cand[0]["classification_tier"],
                "candidate_variant_count": len(cand),
                "ruled_out_variant_count": len(ro),
                "has_zygosity_warning": bool(pass_cand) and _zygosity_warning(pass_cand) is not None,
                "has_quality_warning": bool(flagged_cand),
            }
        )
    no_phenotype_overlap_summary.sort(key=lambda r: (r["best_classification_tier"], r["name"]))

    lookup_token = _cache_variant_file(variants_by_canonical)

    return {
        "candidates": candidates[:top_n],
        "low_quality_only": low_quality_only,
        "ruled_out": ruled_out,
        "no_phenotype_overlap": {
            "count": len(no_phenotype_overlap_summary),
            "summary": no_phenotype_overlap_summary,
        },
        "lookup_token": lookup_token,
        "unresolved_genes": unresolved_genes,
        "unresolved_hpo_terms": failed_hpo,
        "expanded_terms": expanded_terms,
        "file_summary": {
            "total_rows": parsed["total_rows"],
            "total_variants": parsed["total_variants"],
            "skipped_rows": parsed["skipped_rows"],
            "skipped_no_hpo_annotation_rows": parsed["skipped_unresolved_gene_rows"],
            "variants_dropped_no_canonical_transcript": parsed["variants_dropped_no_canonical_transcript"],
            "genes_seen_total": parsed["genes_seen_total"],
            "genes_with_hpo_annotation": len(resolved_genes),
        },
        "hposet_size": len(hposet),
    }


def warm_all_caches() -> None:
    ensure_ontology_loaded()
    for cat in ("omim", "gene", "orpha", "decipher"):
        get_enrichment_model(cat)
    get_hpo_enrichment("gene")
    get_hpo_enrichment("omim")


# ── Async job/poll pattern for variant-file cross-reference ──
# A whole-exome/genome VariMAT upload can take several seconds to tens of
# seconds to process even after optimization -- too long to trust a single
# synchronous HTTP request against reverse-proxy/gateway timeouts. The submit
# endpoint validates + decodes the upload (fast) and hands the actual
# parse+score work to a background thread, returning a job_id immediately;
# the frontend polls the status endpoint until the job finishes.
MAX_VARIMAT_WORKERS = 2
_VARIANT_JOB_TTL_SECONDS = 30 * 60
_variant_job_executor = ThreadPoolExecutor(max_workers=MAX_VARIMAT_WORKERS)
_variant_jobs: dict[str, dict[str, Any]] = {}
_variant_jobs_lock = threading.Lock()


def _prune_variant_jobs() -> None:
    import time

    now = time.time()
    with _variant_jobs_lock:
        expired = [jid for jid, j in _variant_jobs.items() if j["expires_at"] < now]
        for jid in expired:
            del _variant_jobs[jid]


def _run_variant_job(job_id: str, queries: list[str], varimat_path: str, kwargs: dict[str, Any]) -> None:
    import os
    import time

    with _variant_jobs_lock:
        if job_id not in _variant_jobs:
            os.unlink(varimat_path)  # pruned/expired before it started -- still owns the temp file
            return
        _variant_jobs[job_id]["status"] = "running"

    try:
        result = variant_prioritization_from_file(queries, varimat_path, **kwargs)
        with _variant_jobs_lock:
            if job_id in _variant_jobs:
                _variant_jobs[job_id]["status"] = "done"
                _variant_jobs[job_id]["result"] = result
    except Exception as exc:  # noqa: BLE001
        with _variant_jobs_lock:
            if job_id in _variant_jobs:
                _variant_jobs[job_id]["status"] = "error"
                _variant_jobs[job_id]["error"] = str(exc)
    finally:
        with _variant_jobs_lock:
            if job_id in _variant_jobs:
                _variant_jobs[job_id]["expires_at"] = time.time() + _VARIANT_JOB_TTL_SECONDS
        try:
            os.unlink(varimat_path)  # the uploaded temp file is single-use; job owns its lifecycle
        except OSError:
            pass


def submit_variant_prioritization_job(queries: list[str], varimat_path: str, **kwargs: Any) -> str:
    """
    Kick off variant_prioritization_from_file() in a background thread; returns
    a poll-able job_id. ``varimat_path`` is a temp file the caller has already
    written the upload to -- ownership (including deletion once the job
    finishes, success or error) transfers to this job.
    """
    import time
    import uuid

    _prune_variant_jobs()
    job_id = uuid.uuid4().hex
    with _variant_jobs_lock:
        _variant_jobs[job_id] = {
            "status": "queued",
            "result": None,
            "error": None,
            # Generous TTL while queued/running so a slow job is never pruned out from under itself;
            # tightened to _VARIANT_JOB_TTL_SECONDS once it finishes (see _run_variant_job's finally).
            "expires_at": time.time() + max(_VARIANT_JOB_TTL_SECONDS, 3600),
        }
    _variant_job_executor.submit(_run_variant_job, job_id, queries, varimat_path, kwargs)
    return job_id


def get_variant_prioritization_job(job_id: str) -> dict[str, Any]:
    with _variant_jobs_lock:
        job = _variant_jobs.get(job_id)
        if job is None:
            raise ValueError("Job not found or expired. Re-submit the file.")
        return {
            "status": job["status"],
            "result": job["result"] if job["status"] == "done" else None,
            "error": job["error"] if job["status"] == "error" else None,
        }
