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
from typing import Any, Iterable, Optional, Sequence

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
    "REF_DEPTH",
    "ALT_DEPTH",
    "ClinVar_Significance",
    "ClinVar_Disease",
    "ClinVar_ID",
    "CADD_phred",
    "SIFT_pred",
    "SIFT_sc",
    "PP2_pred",
    "PP2_score",
    "SpliceAI",
)

# ACMG BA1 (stand-alone benign): a population allele frequency above this is
# too common for *any* Mendelian disease, regardless of inheritance mode --
# https://doi.org/10.1038/gim.2015.30. A "Pathogenic"/"Likely Pathogenic"
# call above this threshold directly contradicts its own classification.
_MAF_BA1_THRESHOLD = 0.05

# Expected variant allele fraction bands. A het/hom call whose read support
# doesn't roughly match these is worth a second look -- could be a real
# biological signal (mosaicism, CNV) or a sequencing/alignment artifact.
_HET_VAF_RANGE = (0.20, 0.80)
_HOM_VAF_MIN = 0.80


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


def _is_canonical_row(row: Sequence[str], mane_i: "int | None", canon_i: "int | None") -> bool:
    """True if this row is the MANE-select transcript or flagged canonical."""
    mane = row[mane_i] if mane_i is not None and mane_i < len(row) else ""
    if _clean(mane):
        return True
    canon = row[canon_i] if canon_i is not None and canon_i < len(row) else ""
    return _clean(canon).upper() == "Y"


def _pick_representative(rows: "list[_RowView]") -> "_RowView":
    """
    Every row here already passed _is_canonical_row. Prefer the MANE-select
    transcript over a merely canonical-flagged one; ties broken by first seen.
    """
    for row in rows:
        if _clean(row.get("MANE")):
            return row
    return rows[0]


def _parse_spliceai(raw: str) -> "float | None":
    """
    SpliceAI field format: GENE|DS_AG|DS_AL|DS_DG|DS_DL|DP_AG|DP_AL|DP_DG|DP_DL
    (delta scores for acceptor/donor gain/loss, then their positions). Returns
    the max of the four delta scores (0-1) -- SpliceAI's own convention for
    "how splice-altering is this variant," regardless of which mechanism.
    >0.2 = low-precision hit, >0.5 = high precision, >0.8 = very high.
    """
    parts = _clean(raw).split("|")
    if len(parts) < 5:
        return None
    scores = []
    for p in parts[1:5]:
        try:
            scores.append(float(p))
        except ValueError:
            continue
    return max(scores) if scores else None


def _to_int(value: "str | None") -> "int | None":
    v = _clean(value)
    if not v:
        return None
    try:
        return int(float(v))
    except ValueError:
        return None


def _maf_warning(classification_tier: int, gnomad_af: "float | None") -> "str | None":
    """A Pathogenic/Likely Pathogenic call at a population frequency too common for any Mendelian disease."""
    if gnomad_af is None or classification_tier not in (TIER_PATHOGENIC, TIER_LIKELY_PATHOGENIC):
        return None
    if gnomad_af <= _MAF_BA1_THRESHOLD:
        return None
    return (
        f"gnomAD allele frequency ({gnomad_af * 100:.2g}%) exceeds {_MAF_BA1_THRESHOLD * 100:.0f}% -- "
        "per ACMG BA1, this is too common in the general population for any Mendelian disease, "
        "regardless of inheritance mode. Contradicts this variant's own Pathogenic/Likely Pathogenic call."
    )


def _vaf_warning(zygosity: str, vaf: "float | None") -> "str | None":
    """Read-support allele balance inconsistent with the stated zygosity call."""
    if vaf is None:
        return None
    zyg = zygosity.strip().lower()
    if zyg == "heterozygous":
        lo, hi = _HET_VAF_RANGE
        if vaf < lo or vaf > hi:
            return (
                f"Variant allele fraction ({vaf * 100:.0f}%) is unusual for a heterozygous call "
                f"(expected roughly {lo * 100:.0f}-{hi * 100:.0f}%) -- possible artifact, mosaicism, or a "
                "nearby copy-number change skewing read support."
            )
    elif zyg == "homozygous":
        if vaf < _HOM_VAF_MIN:
            return (
                f"Variant allele fraction ({vaf * 100:.0f}%) is low for a homozygous call "
                f"(expected roughly {_HOM_VAF_MIN * 100:.0f}%+) -- possible artifact or a mixed/contaminated sample."
            )
    return None


def _build_variant_record(row: "_RowView", transcript_count: int) -> "dict[str, Any]":
    tier_rank, tier_label = normalize_tier(row.get("ACMG_Prediction") or row.get("autoACMGPrediction"))
    acmg_criteria = _clean(row.get("ACMG_Criteria")) or _clean(row.get("autoACMGRules"))
    filter_status = _clean(row.get("VARIANT_FILTER_STATUS"))
    zygosity = _clean(row.get("ZYGOSITY"))
    gnomad_af = _to_float(row.get("gnomAD_AF"))

    ref_depth = _to_int(row.get("REF_DEPTH"))
    alt_depth = _to_int(row.get("ALT_DEPTH"))
    vaf = None
    if ref_depth is not None and alt_depth is not None and (ref_depth + alt_depth) > 0:
        vaf = alt_depth / (ref_depth + alt_depth)

    clinvar_id_raw = _clean(row.get("ClinVar_ID"))
    clinvar_ids = [c.strip() for c in clinvar_id_raw.split("|") if c.strip()] if clinvar_id_raw else []

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
        "zygosity": zygosity,
        "filter_status": filter_status,
        # Only an exact "PASS" counts -- any QC flag (LowQD, LowCoverage,
        # SnpCluster, etc.) or a blank/unevaluated status is treated as
        # not-passing. These flags mean the variant *caller* itself doubts
        # the call is real; a flagged "Pathogenic" is not equivalent to a
        # clean "Pathogenic" and must not outrank one in candidate selection.
        "passes_qc": filter_status.upper() == "PASS",
        "classification": tier_label,
        "classification_tier": tier_rank,
        "acmg_criteria": acmg_criteria,
        "inheritance_mode": _extract_inheritance_mode(acmg_criteria),
        "gnomad_af": gnomad_af,
        "maf_warning": _maf_warning(tier_rank, gnomad_af),
        "var_qual": _to_float(row.get("VAR_QUAL")),
        "read_depth": _clean(row.get("OVERALL_READ_DEPTH")),
        "ref_depth": ref_depth,
        "alt_depth": alt_depth,
        "vaf": round(vaf, 4) if vaf is not None else None,
        "vaf_warning": _vaf_warning(zygosity, vaf),
        "clinvar_significance": _clean(row.get("ClinVar_Significance")),
        "clinvar_disease": _clean(row.get("ClinVar_Disease")),
        "clinvar_ids": clinvar_ids,
        "cadd_phred": _to_float(row.get("CADD_phred")),
        "sift_prediction": _clean(row.get("SIFT_pred")),
        "sift_score": _to_float(row.get("SIFT_sc")),
        "polyphen2_prediction": _clean(row.get("PP2_pred")),
        "polyphen2_score": _to_float(row.get("PP2_score")),
        "spliceai_max_score": _parse_spliceai(row.get("SpliceAI")),
        "spliceai_raw": _clean(row.get("SpliceAI")),
    }


def parse_varimat(
    content: str,
    gene_allowlist: Optional[set[str]] = None,
) -> "dict[str, Any]":
    """Convenience wrapper: parse an already-in-memory string. See :func:`parse_varimat_lines`."""
    return parse_varimat_lines(io.StringIO(content), gene_allowlist=gene_allowlist)


def parse_varimat_lines(
    lines: Iterable[str],
    gene_allowlist: Optional[set[str]] = None,
) -> "dict[str, Any]":
    """
    Parse VariMAT tab-delimited text into per-gene, deduplicated variant records.

    Takes a line iterator rather than a full string so the caller can stream
    from disk (or a gzip decompressor) without ever holding the whole file in
    memory -- whole-exome/genome VariMAT exports can be multiple GB
    decompressed. Only rows for genes in ``gene_allowlist`` (and only their
    MANE/canonical transcript row) are ever turned into a full record and
    retained, so the amount of data actually kept in memory is bounded by the
    ontology's HPO-annotated gene count (~5k genes), not by input file size --
    it's specifically the *scanning* phase that needs to be streaming.

    Parameters
    ----------
    lines: iterable of text lines (e.g. an open file, io.StringIO, or a
        generator wrapping a gzip stream).
    gene_allowlist: optional set of UPPERCASED gene symbols to keep. When
        given, rows for any other gene are counted in
        ``skipped_unresolved_gene_rows`` and never turned into a full record
        -- this is the whole-exome/genome fast path, since ~75% of a raw
        variant export's genes typically have no HPO annotation at all and
        can never be scored downstream.

    Only the MANE-select transcript row (or, failing that, the row flagged
    canonical) is kept per variant -- other transcript annotations for the
    same variant are discarded outright rather than used as a fallback.
    Different transcripts can carry different consequences and even
    different ACMG calls for the same genomic variant, so falling back to an
    arbitrary non-canonical row risks a misleading annotation. A variant with
    no MANE/canonical row anywhere in its group is dropped and counted in
    ``variants_dropped_no_canonical_transcript`` rather than silently guessed at.

    Returns
    -------
    dict with:
      variants_by_gene: dict[str, list[variant dict]] -- keyed by the gene
        symbol exactly as it appears in the file (case as-is)
      total_rows: int          -- raw data rows in the file
      total_variants: int      -- unique (gene, VARIANT_ID) records kept
      skipped_rows: int        -- rows dropped (missing gene or VARIANT_ID)
      skipped_unresolved_gene_rows: int -- rows dropped by gene_allowlist
      variants_dropped_no_canonical_transcript: int -- variants with rows,
        but none flagged MANE/canonical, so no reliable annotation to use
      genes: list[str]         -- sorted unique gene symbols found (kept genes only)
    """
    reader = csv.reader(lines, delimiter="\t")
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
    mane_i = col_idx.get("MANE")
    canon_i = col_idx.get("CANNONICAL_TRAS")
    keep_cols = {c: col_idx[c] for c in _RECORD_COLUMNS if c in col_idx}

    groups: "dict[tuple[str, str], list[list[str]]]" = {}
    seen_variant_keys: set[tuple[str, str]] = set()
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
        seen_variant_keys.add((gene, variant_id))
        if not _is_canonical_row(row, mane_i, canon_i):
            continue
        groups.setdefault((gene, variant_id), []).append(row)

    variants_by_gene: "dict[str, list[dict[str, Any]]]" = {}
    for (gene, _variant_id), rows in groups.items():
        views = [_RowView(r, keep_cols) for r in rows]
        rep = _pick_representative(views)
        record = _build_variant_record(rep, transcript_count=len(views))
        variants_by_gene.setdefault(gene, []).append(record)

    for gene_variants in variants_by_gene.values():
        # QC pass/fail first, then classification tier: a flagged (LowQD/
        # LowCoverage/SnpCluster/...) call must never outrank a clean PASS
        # call regardless of ACMG classification.
        gene_variants.sort(key=lambda v: (0 if v["passes_qc"] else 1, v["classification_tier"]))

    return {
        "variants_by_gene": variants_by_gene,
        "total_rows": total_rows,
        "total_variants": sum(len(v) for v in variants_by_gene.values()),
        "skipped_rows": skipped_rows,
        "skipped_unresolved_gene_rows": skipped_unresolved_gene_rows,
        "variants_dropped_no_canonical_transcript": len(seen_variant_keys - set(groups.keys())),
        "genes": sorted(variants_by_gene.keys()),
        "genes_seen_total": len(all_genes_seen),
    }
