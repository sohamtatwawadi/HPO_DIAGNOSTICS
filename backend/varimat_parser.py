"""
Parser for VariMAT (VarMiner2 / VariMAT2.6.1-style) variant annotation exports.

The file is a tab-delimited table with one row per (genomic variant, transcript)
pair -- the same variant appears multiple times across different transcript
annotations. This module collapses each group down to a single representative
record per VARIANT_ID (preferring the MANE-select transcript, then the row
flagged canonical), grouped by gene symbol.

At whole-exome/genome scale (~20k genes, 100k+ rows), only genes with an HPO
annotation in the ontology (~5k of ~20k protein-coding genes) can ever be
scored or ranked -- the rest are structurally unusable to this pipeline. To
avoid paying full parsing cost (and holding full per-row detail in memory) for
rows that will be discarded moments later, callers can pass a
``gene_allowlist`` (uppercased gene symbols known to the ontology). Rows for
genes outside the allowlist are counted but never materialized into a full
record, which is where nearly all of the parsing time/memory goes.
"""
from __future__ import annotations

import csv
import io
from typing import Any, Optional, Sequence

TIER_PATHOGENIC = 0
TIER_LIKELY_PATHOGENIC = 1
TIER_VUS = 2
TIER_LIKELY_BENIGN = 3
TIER_BENIGN = 4
TIER_UNKNOWN = 5

_ACMG_TIER_ORDER: dict[str, int] = {
    "pathogenic": TIER_PATHOGENIC,
    "likely pathogenic": TIER_LIKELY_PATHOGENIC,
    "uncertain significance": TIER_VUS,
    "likely benign": TIER_LIKELY_BENIGN,
    "benign": TIER_BENIGN,
}

_REQUIRED_COLUMNS = {"GENE_NAME", "VARIANT_ID"}
_NA_VALUES = {"", ".", "NA", "N/A", "na"}

# Columns pulled into a variant record. Kept as a single ordered list so the
# positional row -> record mapping has one source of truth.
_RECORD_COLUMNS = (
    "VARIANT_ID",
    "GENE_NAME",
    "CHROM",
    "START",
    "REF",
    "ALT",
    "HGVSg",
    "AA_CHG",
    "CDNA_CHG",
    "VARCLASS",
    "VEP_VAR_IMPACT",
    "MANE",
    "REFSEQ_ID",
    "CANNONICAL_TRAS",
    "ZYGOSITY",
    "VARIANT_FILTER_STATUS",
    "ACMG_Prediction",
    "autoACMGPrediction",
    "ACMG_Criteria",
    "autoACMGRules",
    "gnomAD_AF",
    "VAR_QUAL",
    "OVERALL_READ_DEPTH",
    "ClinVar_Significance",
    "ClinVar_Disease",
)


class VarimatParseError(ValueError):
    pass


def _clean(value: "str | None") -> str:
    v = (value or "").strip()
    return "" if v in _NA_VALUES else v


def _to_float(value: "str | None") -> "float | None":
    v = _clean(value)
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def normalize_tier(raw: "str | None") -> "tuple[int, str]":
    """Map a raw ACMG classification string to (sort_rank, display_label)."""
    key = _clean(raw).lower()
    if key in _ACMG_TIER_ORDER:
        return _ACMG_TIER_ORDER[key], _clean(raw)
    return TIER_UNKNOWN, (_clean(raw) or "Unclassified")


def _extract_inheritance_mode(acmg_criteria: str) -> str:
    """
    Pull the OMIM inheritance-mode token (e.g. AR, AD, AD_AR, XL) out of an
    ACMG_Criteria / autoACMGRules string like
    ``"OMIMINHERIT_AR;PM2moderate;PP3"``. Empty string if not present -- the
    classifier didn't record inheritance for this variant, so callers should
    treat that as "unknown," not "dominant."
    """
    for token in acmg_criteria.split(";"):
        token = token.strip()
        if token.startswith("OMIMINHERIT_"):
            return token[len("OMIMINHERIT_"):]
    return ""


class _RowView:
    """Cheap positional accessor: row[col_idx[name]] with an index-map, once per file."""

    __slots__ = ("_row", "_idx")

    def __init__(self, row: Sequence[str], idx: dict[str, int]) -> None:
        self._row = row
        self._idx = idx

    def get(self, col: str) -> str:
        i = self._idx.get(col)
        if i is None or i >= len(self._row):
            return ""
        return self._row[i]


def _pick_representative(rows: "list[_RowView]") -> "_RowView":
    """
    A VARIANT_ID group has one row per transcript annotation. Prefer the
    MANE-select transcript, then the row flagged canonical, else the first row.
    """
    for row in rows:
        if _clean(row.get("MANE")):
            return row
    for row in rows:
        if _clean(row.get("CANNONICAL_TRAS")).upper() == "Y":
            return row
    return rows[0]


def _build_variant_record(row: "_RowView", transcript_count: int) -> "dict[str, Any]":
    tier_rank, tier_label = normalize_tier(row.get("ACMG_Prediction") or row.get("autoACMGPrediction"))
    acmg_criteria = _clean(row.get("ACMG_Criteria")) or _clean(row.get("autoACMGRules"))
    return {
        "variant_id": _clean(row.get("VARIANT_ID")),
        "gene": _clean(row.get("GENE_NAME")),
        "chrom": _clean(row.get("CHROM")),
        "start": _clean(row.get("START")),
        "ref": _clean(row.get("REF")),
        "alt": _clean(row.get("ALT")),
        "hgvsg": _clean(row.get("HGVSg")),
        "aa_change": _clean(row.get("AA_CHG")),
        "cdna_change": _clean(row.get("CDNA_CHG")),
        "varclass": _clean(row.get("VARCLASS")),
        "vep_impact": _clean(row.get("VEP_VAR_IMPACT")),
        "transcript": _clean(row.get("MANE")) or _clean(row.get("REFSEQ_ID")),
        "transcript_count": transcript_count,
        "zygosity": _clean(row.get("ZYGOSITY")),
        "filter_status": _clean(row.get("VARIANT_FILTER_STATUS")),
        "classification": tier_label,
        "classification_tier": tier_rank,
        "acmg_criteria": acmg_criteria,
        "inheritance_mode": _extract_inheritance_mode(acmg_criteria),
        "gnomad_af": _to_float(row.get("gnomAD_AF")),
        "var_qual": _to_float(row.get("VAR_QUAL")),
        "read_depth": _clean(row.get("OVERALL_READ_DEPTH")),
        "clinvar_significance": _clean(row.get("ClinVar_Significance")),
        "clinvar_disease": _clean(row.get("ClinVar_Disease")),
    }


def parse_varimat(
    content: str,
    gene_allowlist: Optional[set[str]] = None,
) -> "dict[str, Any]":
    """
    Parse VariMAT tab-delimited text into per-gene, deduplicated variant records.

    Parameters
    ----------
    content: the raw file text.
    gene_allowlist: optional set of UPPERCASED gene symbols to keep. When
        given, rows for any other gene are counted in
        ``skipped_unresolved_gene_rows`` and never turned into a full record
        -- this is the whole-exome/genome fast path, since ~75% of a raw
        variant export's genes typically have no HPO annotation at all and
        can never be scored downstream.

    Returns
    -------
    dict with:
      variants_by_gene: dict[str, list[variant dict]] -- keyed by the gene
        symbol exactly as it appears in the file (case as-is)
      total_rows: int          -- raw data rows in the file
      total_variants: int      -- unique (gene, VARIANT_ID) records kept
      skipped_rows: int        -- rows dropped (missing gene or VARIANT_ID)
      skipped_unresolved_gene_rows: int -- rows dropped by gene_allowlist
      genes: list[str]         -- sorted unique gene symbols found (kept genes only)
    """
    reader = csv.reader(io.StringIO(content), delimiter="\t")
    try:
        header = next(reader)
    except StopIteration as exc:
        raise VarimatParseError("File is empty or has no header row") from exc

    col_idx = {name: i for i, name in enumerate(header)}
    missing = _REQUIRED_COLUMNS - set(col_idx)
    if missing:
        raise VarimatParseError(
            f"Missing required column(s): {', '.join(sorted(missing))}. "
            "Expected a tab-delimited VariMAT export with a header row."
        )

    gene_i = col_idx["GENE_NAME"]
    vid_i = col_idx["VARIANT_ID"]
    keep_cols = {c: col_idx[c] for c in _RECORD_COLUMNS if c in col_idx}

    groups: "dict[tuple[str, str], list[list[str]]]" = {}
    all_genes_seen: set[str] = set()
    total_rows = 0
    skipped_rows = 0
    skipped_unresolved_gene_rows = 0
    for row in reader:
        total_rows += 1
        gene = _clean(row[gene_i]) if gene_i < len(row) else ""
        variant_id = _clean(row[vid_i]) if vid_i < len(row) else ""
        if not gene or not variant_id:
            skipped_rows += 1
            continue
        all_genes_seen.add(gene.upper())
        if gene_allowlist is not None and gene.upper() not in gene_allowlist:
            skipped_unresolved_gene_rows += 1
            continue
        groups.setdefault((gene, variant_id), []).append(row)

    variants_by_gene: "dict[str, list[dict[str, Any]]]" = {}
    for (gene, _variant_id), rows in groups.items():
        views = [_RowView(r, keep_cols) for r in rows]
        rep = _pick_representative(views)
        record = _build_variant_record(rep, transcript_count=len(views))
        variants_by_gene.setdefault(gene, []).append(record)

    for gene_variants in variants_by_gene.values():
        gene_variants.sort(key=lambda v: v["classification_tier"])

    return {
        "variants_by_gene": variants_by_gene,
        "total_rows": total_rows,
        "total_variants": sum(len(v) for v in variants_by_gene.values()),
        "skipped_rows": skipped_rows,
        "skipped_unresolved_gene_rows": skipped_unresolved_gene_rows,
        "genes": sorted(variants_by_gene.keys()),
        "genes_seen_total": len(all_genes_seen),
    }
