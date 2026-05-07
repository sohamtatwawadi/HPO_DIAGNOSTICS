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
        best = max(
            float(pt.similarity_score(et, kind=kind, method=method))
            for et in entity_terms
        )
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
        best = max(
            float(pt.similarity_score(et, kind=kind, method=method))
            for et in entity_terms
        )
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

            entity_terms = [
                Ontology.get_hpo_object(f"HP:{str(idx).zfill(7)}")
                for idx in entity_hpo_indices
            ]
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


@lru_cache(maxsize=1)
def _all_gene_disease_expanded_hpo() -> dict[str, frozenset[int]]:
    """
    One pass over (genes × OMIM diseases): for each gene, union of its own HPO
    indices plus disease.hpo for every disease where causal overlap >= 15%.
    Cached for O(1) lookup per gene during scoring (avoids O(diseases) per gene).
    """
    from pyhpo import Ontology

    acc: dict[str, set[int]] = {}
    genes_list = list(Ontology.genes)
    for gene in genes_list:
        nm = getattr(gene, "name", None)
        if nm:
            acc[nm] = set(gene.hpo)

    for disease in Ontology.omim_diseases:
        d_hpo = disease.hpo
        if not d_hpo:
            continue
        nd = len(d_hpo)
        for gene in genes_list:
            gh = gene.hpo
            if not gh:
                continue
            gn = getattr(gene, "name", None)
            if not gn:
                continue
            if len(gh & d_hpo) / nd >= 0.15:
                acc[gn] |= d_hpo

    return {k: frozenset(v) for k, v in acc.items() if k}


def _get_disease_expanded_hpo(gene_name: str) -> frozenset[int]:
    """Union of gene HPO + causal OMIM disease HPO terms (see _all_gene_disease_expanded_hpo)."""
    return _all_gene_disease_expanded_hpo().get(gene_name, frozenset())


def _score_catalog(
    hposet: Any,
    catalog: Any,
    top_n: int,
    *,
    kind: str = "omim",
    method: str = "resnik",
    use_disease_expansion: bool = False,
) -> list[dict[str, Any]]:
    """
    Score a full catalog (genes or diseases) against a patient HPOSet.
    Returns top_n rows sorted by combined score.
    """
    from pyhpo import HPOSet, Ontology

    patient_indices = {int(t.id.replace("HP:", "")) for t in hposet}
    n_patient = len(hposet)
    patient_ic_total = sum(float(t.information_content.omim) for t in hposet)
    patient_by_idx = {int(t.id.replace("HP:", "")): t for t in hposet}

    results: list[dict[str, Any]] = []
    for entity in catalog:
        gene_name = getattr(entity, "name", None)

        if use_disease_expansion and gene_name:
            entity_indices_raw = entity.hpo
            entity_indices_expanded = _get_disease_expanded_hpo(gene_name)
            entity_indices_for_match = entity_indices_expanded
        else:
            entity_indices_raw = entity.hpo
            entity_indices_for_match = entity_indices_raw

        matched = patient_indices & entity_indices_for_match
        if not matched:
            continue

        overlap = len(matched)
        fwd_cov = overlap / n_patient
        ic_sum = sum(
            float(patient_by_idx[idx].information_content.omim) for idx in matched
        )
        ic_cov = ic_sum / patient_ic_total if patient_ic_total > 0 else 0.0
        n_raw = len(entity_indices_raw) if entity_indices_raw else 1
        rev_cov = overlap / n_raw

        try:
            entity_terms = [
                Ontology.get_hpo_object(f"HP:{str(idx).zfill(7)}")
                for idx in entity_indices_for_match
            ]
            entity_hposet = HPOSet(entity_terms)
            sim = _ic_weighted_one_way_sim(hposet, entity_hposet, kind=kind, method=method)
        except Exception:
            sim = 0.0

        combined = 0.45 * sim + 0.30 * ic_cov + 0.15 * fwd_cov + 0.10 * rev_cov

        results.append(
            {
                "name": getattr(entity, "name", str(entity)),
                "id": str(getattr(entity, "id", "")),
                "combined_score": round(combined, 4),
                "similarity": round(sim, 4),
                "ic_weighted_coverage": round(ic_cov, 4),
                "coverage": round(fwd_cov, 4),
                "rev_coverage": round(rev_cov, 4),
                "overlap": overlap,
                "total_annotations": len(entity_indices_raw),
                "expanded_annotations": (
                    len(entity_indices_for_match) if use_disease_expansion else None
                ),
                "matched_terms": [
                    {
                        "id": patient_by_idx[idx].id,
                        "name": patient_by_idx[idx].name,
                        "ic": round(float(patient_by_idx[idx].information_content.omim), 3),
                    }
                    for idx in sorted(matched)
                ],
                "_hpo_indices": entity_indices_raw,
            }
        )

    results.sort(
        key=lambda x: (
            -x["combined_score"],
            -x["ic_weighted_coverage"],
            -x["coverage"],
            -x["overlap"],
        ),
    )

    for i, r in enumerate(results[:top_n]):
        r["rank"] = i + 1

    return results[:top_n]


def _find_bridge_disease(
    gene_name: str,
    disease_results: list[dict[str, Any]],
    min_causal_overlap: float = 0.15,
) -> dict[str, Any] | None:
    """
    Find the disease this gene most specifically causes that also matches
    the patient's phenotype profile.

    Algorithm:
      1. For each disease in disease_results, compute causal_overlap:
             causal_overlap = len(gene.hpo & disease.hpo) / len(disease.hpo)
         This is "what fraction of the disease's phenotypes does this gene cover?"
         A gene that causes a disease typically covers 50–100% of its HPO terms.

      2. Keep diseases where causal_overlap >= min_causal_overlap (default 0.15).

      3. Sort by causal_overlap DESC, then patient score DESC.
         → Each gene gets its OWN most-specific disease, not just the top
           patient-scoring disease (which would be the same for all genes
           in a gene-panel disease like Noonan syndrome).

    Why not sort by patient score first:
      All Noonan genes have the same top patient-scoring disease (Noonan syndrome 8
      or whichever Noonan subtype happens to score highest). Sorting by causal_overlap
      first ensures RAF1 gets Noonan syndrome 5, PTPN11 gets Leopard syndrome 1, etc.

    Searches within disease_results[:200] for speed. If disease_results was
    generated with top_n < 200, searches the full list regardless.
    """
    try:
        from pyhpo.annotations import Gene as GeneAnnot

        gene_obj = GeneAnnot.get(gene_name)
        gene_hpo = gene_obj.hpo  # set of integer HPO indices
    except Exception:
        return None

    search_pool = disease_results[:200] if len(disease_results) > 200 else disease_results

    candidates = []
    for dr in search_pool:
        d_hpo = dr.get("_hpo_indices")
        if not d_hpo:
            continue
        n_dis = len(d_hpo)
        if n_dis == 0:
            continue
        causal = len(gene_hpo & d_hpo) / n_dis
        if causal >= min_causal_overlap:
            candidates.append(
                {
                    "disease_name": dr["name"],
                    "disease_id": dr["id"],
                    "disease_rank": dr["rank"],
                    "disease_score": dr["combined_score"],
                    "causal_overlap": round(causal, 3),
                }
            )

    if not candidates:
        return None

    return sorted(
        candidates,
        key=lambda x: (-x["causal_overlap"], -x["disease_score"]),
    )[0]


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

    gene_results = _score_catalog(
        hposet,
        Ontology.genes,
        top_n=top_n,
        use_disease_expansion=True,
    )
    # Score up to 200 diseases so bridge resolution can use subtype-specific OMIM rows
    # (e.g. rank #21) while the API still returns only top_n disease rows.
    disease_results = _score_catalog(
        hposet,
        Ontology.omim_diseases,
        top_n=min(200, max(top_n, 200)),
    )

    for gr in gene_results:
        raw_annot = gr["total_annotations"]
        exp_annot = gr.get("expanded_annotations")
        if raw_annot < _ANNOTATION_SPARSE_THRESHOLD:
            if exp_annot and exp_annot > raw_annot:
                gr["annotation_warning"] = (
                    f"Gene has only {raw_annot} direct HPO annotations. "
                    f"Score boosted using {exp_annot} terms from associated diseases. "
                    "Disease ranking is also shown for verification."
                )
            else:
                gr["annotation_warning"] = (
                    f"Gene has only {raw_annot} HPO annotations — "
                    "sparse coverage in database. Disease ranking below is more "
                    "reliable for this candidate."
                )
        else:
            gr["annotation_warning"] = None

        gr["bridge_disease"] = _find_bridge_disease(gr["name"], disease_results)

    def _clean(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [{k: v for k, v in r.items() if not k.startswith("_")} for r in results]

    return {
        "genes": _clean(gene_results),
        "diseases": _clean(disease_results[:top_n]),
        "warnings": warnings,
        "expanded_terms": expanded_terms,
        "hposet_size": n_terms,
        "mean_ic": round(mean_ic, 3),
        "remove_modifiers_used": remove_modifiers,
        "expand_ic_used": expand_ic,
        "ic_expansion_threshold": ic_expansion_threshold,
    }


def warm_all_caches() -> None:
    ensure_ontology_loaded()
    for cat in ("omim", "gene", "orpha", "decipher"):
        get_enrichment_model(cat)
    get_hpo_enrichment("gene")
    get_hpo_enrichment("omim")
    # Do not call _all_gene_disease_expanded_hpo() here — it is O(genes×diseases) and
    # blocks FastAPI lifespan, so Railway's /api/health check times out during deploy.
    # The index is built lazily on first gene-prioritization request (same @lru_cache).
