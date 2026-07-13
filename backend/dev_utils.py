"""Development and QA utilities for the HPO Diagnostics backend."""


def compare_rankings(original_candidates: list, reranked_candidates: list) -> dict:
    """
    QA utility — compare HPO-only vs composite-scored rank order.
    Pass the candidates list before and after the composite sort.

    Usage:
        original = sorted(candidates, key=lambda x: -x["combined_score"])
        reranked  = candidates  # after composite sort + rank assignment
        compare_rankings(original, reranked)
    """
    orig_lookup = {r["name"]: i + 1 for i, r in enumerate(original_candidates)}
    new_lookup = {r["name"]: r["rank"] for r in reranked_candidates}

    rows = []
    for r in reranked_candidates:
        gene = r["name"]
        old = orig_lookup.get(gene, "-")
        new = new_lookup.get(gene, "-")
        delta = (old - new) if isinstance(old, int) and isinstance(new, int) else 0
        rows.append(
            {
                "gene": gene,
                "old_rank": old,
                "new_rank": new,
                "delta": delta,
                "hpo_score": r.get("combined_score"),
                "composite_score": r.get("composite_score"),
                "inheritance_flag": r.get("inheritance_flag"),
                "rank_breakdown": r.get("rank_breakdown"),
            }
        )

    rows.sort(key=lambda x: x["new_rank"] if isinstance(x["new_rank"], int) else 999)

    header = f"{'Gene':<20} {'Old':>5} {'New':>5} {'Δ':>6}  {'HPO':>7}  {'Composite':>10}  Flag"
    print(header)
    print("─" * len(header))
    for r in rows:
        if isinstance(r["delta"], int):
            delta_str = (
                f"▲{r['delta']}"
                if r["delta"] > 0
                else (f"▼{abs(r['delta'])}" if r["delta"] < 0 else "–")
            )
        else:
            delta_str = "–"
        flag = r["inheritance_flag"] or ""
        highlight = "  ◄◄ LARGE MOVE" if abs(r["delta"]) > 5 else ""
        print(
            f"{r['gene']:<20} {str(r['old_rank']):>5} {str(r['new_rank']):>5} "
            f"{delta_str:>6}  {str(r['hpo_score']):>7}  "
            f"{str(r['composite_score']):>10}  {flag}{highlight}"
        )

    large_movements = [r for r in rows if abs(r["delta"]) > 5]
    pathogenic_hom = [r for r in rows if r["inheritance_flag"] == "PATHOGENIC_HOM"]

    if pathogenic_hom:
        ph = pathogenic_hom[0]
        print(
            f"\n★  PATHOGENIC_HOM  '{ph['gene']}':  "
            f"rank {ph['old_rank']} → {ph['new_rank']}  "
            f"(composite {ph['composite_score']})"
        )

    return {
        "total_genes": len(rows),
        "large_movements": large_movements,
        "pathogenic_hom_rank_before": pathogenic_hom[0]["old_rank"] if pathogenic_hom else None,
        "pathogenic_hom_rank_after": pathogenic_hom[0]["new_rank"] if pathogenic_hom else None,
    }
