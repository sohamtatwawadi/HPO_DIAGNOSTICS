"""
Parser for annotated VCF / VCF.gz into VariMAT-equivalent variant records.

Requires gene annotation (VEP CSQ or SnpEff ANN) and preferably ACMG / ClinVar
and gnomAD fields in INFO. Bare callsets without gene symbols are skipped.
"""
from __future__ import annotations

from typing import Any, Optional

from varimat_parser import (
    TIER_UNKNOWN,
    _extract_inheritance_mode,
    _maf_warning,
    _to_float,
    _vaf_warning,
    normalize_tier,
)


class VcfParseError(ValueError):
    pass


def _info_str(variant, key: str) -> str:
    try:
        val = variant.INFO.get(key)
    except Exception:
        return ""
    if val is None:
        return ""
    if isinstance(val, (list, tuple)):
        val = val[0] if val else ""
    if isinstance(val, bytes):
        val = val.decode("utf-8", errors="replace")
    return str(val).strip()


def _parse_csq_format(header_line: str) -> list[str]:
    """Extract CSQ Format: field list from a VEP INFO header Description."""
    marker = "Format:"
    idx = header_line.find(marker)
    if idx < 0:
        marker = "Format: "
        idx = header_line.find("Format:")
    if idx < 0:
        return []
    fmt = header_line[idx + len("Format:") :].strip().strip('"').strip("'")
    # Description may end with ">
    if "|" in fmt:
        fmt = fmt.split('"')[0].split(">")[0]
    return [p.strip() for p in fmt.split("|") if p.strip()]


def _zygosity_from_gt(gt: str) -> str:
    g = (gt or "").replace("|", "/").strip()
    if not g or g in {".", "./.", ".|."}:
        return ""
    alleles = g.split("/")
    if len(alleles) != 2:
        if len(alleles) == 1 and alleles[0] not in {".", "0"}:
            return "hemizygous"
        return ""
    a, b = alleles
    if a == "." or b == ".":
        return ""
    if a == b:
        if a == "0":
            return ""  # homozygous ref — not a called alt
        return "homozygous"
    if a == "0" or b == "0":
        return "heterozygous"
    return "heterozygous"


def _pick_csq_transcript(csq_raw: str, fields: list[str]) -> dict[str, str]:
    """Pick best CSQ allele annotation: prefer MANE_SELECT / CANONICAL."""
    if not csq_raw or not fields:
        return {}
    best: dict[str, str] = {}
    best_score = -1
    for entry in csq_raw.split(","):
        parts = entry.split("|")
        row = {fields[i]: (parts[i] if i < len(parts) else "") for i in range(len(fields))}
        symbol = row.get("SYMBOL") or row.get("Gene") or ""
        if not symbol:
            continue
        score = 0
        mane = (row.get("MANE_SELECT") or row.get("MANE") or "").strip()
        if mane and mane not in {"0", "False", "false"}:
            score += 3
        canon = (row.get("CANONICAL") or "").strip().upper()
        if canon in {"YES", "Y", "1", "TRUE"}:
            score += 2
        if score > best_score:
            best_score = score
            best = row
    return best


def _pick_ann_transcript(ann_raw: str) -> dict[str, str]:
    """SnpEff ANN: Allele|Annotation|Impact|Gene_Name|Gene_ID|Feature_Type|Feature_ID|..."""
    if not ann_raw:
        return {}
    best: dict[str, str] = {}
    for entry in ann_raw.split(","):
        parts = entry.split("|")
        if len(parts) < 4:
            continue
        gene = parts[3].strip()
        if not gene:
            continue
        row = {
            "SYMBOL": gene,
            "Consequence": parts[1] if len(parts) > 1 else "",
            "Feature": parts[6] if len(parts) > 6 else "",
            "HGVSp": parts[10] if len(parts) > 10 else "",
            "HGVSc": parts[9] if len(parts) > 9 else "",
        }
        # Prefer first coding-looking annotation
        consequence = (row["Consequence"] or "").lower()
        if any(x in consequence for x in ("missense", "stop", "frameshift", "splice", "nonsense")):
            return row
        if not best:
            best = row
    return best


def _classification_from_info(variant) -> tuple[int, str]:
    for key in (
        "ACMG_Prediction",
        "autoACMGPrediction",
        "ACMG",
        "CLNSIG",
        "ClinVar_Significance",
        "clinvar_clnsig",
    ):
        raw = _info_str(variant, key)
        if not raw:
            continue
        # ClinVar may be Pathogenic/Likely_pathogenic
        cleaned = raw.replace("_", " ").replace("/", " ").split("|")[0].split(",")[0].strip()
        tier, label = normalize_tier(cleaned)
        if tier != TIER_UNKNOWN:
            return tier, label if label else cleaned
        # Map common ClinVar multi-word fragments
        low = cleaned.lower()
        if "pathogenic" in low and "likely" in low:
            return normalize_tier("Likely Pathogenic")
        if "pathogenic" in low and "benign" not in low:
            return normalize_tier("Pathogenic")
        if "likely benign" in low:
            return normalize_tier("Likely Benign")
        if "benign" in low:
            return normalize_tier("Benign")
        if "uncertain" in low or low == "vus":
            return normalize_tier("Uncertain Significance")
    return TIER_UNKNOWN, "Unclassified"


def _gnomad_af(variant) -> "float | None":
    for key in (
        "gnomAD_AF",
        "gnomad_AF",
        "gnomAD_AF_POPMAX",
        "AF_popmax",
        "AF",
        "MAX_AF",
    ):
        raw = _info_str(variant, key)
        if not raw:
            continue
        # Take first numeric token
        token = raw.split(",")[0].split("|")[0]
        af = _to_float(token)
        if af is not None:
            return af
    return None


def _build_record_from_variant(
    variant,
    csq_fields: list[str],
    sample_idx: int = 0,
) -> "dict[str, Any] | None":
    csq_raw = _info_str(variant, "CSQ")
    ann_raw = _info_str(variant, "ANN")
    tx = _pick_csq_transcript(csq_raw, csq_fields) if csq_raw else {}
    if not tx and ann_raw:
        tx = _pick_ann_transcript(ann_raw)
    if not tx:
        # Fallback INFO gene tags
        gene = _info_str(variant, "GENE_NAME") or _info_str(variant, "GENE") or _info_str(variant, "Gene")
        if not gene:
            return None
        tx = {"SYMBOL": gene}

    gene = (tx.get("SYMBOL") or tx.get("Gene") or "").strip()
    if not gene:
        return None

    chrom = str(variant.CHROM)
    pos = int(variant.POS)
    ref = variant.REF or ""
    alts = variant.ALT or []
    alt = alts[0] if alts else ""
    variant_id = f"{chrom}-{pos}-{ref}-{alt}"

    filter_status = variant.FILTER
    if filter_status is None or filter_status is False:
        filter_status = "PASS"
    elif isinstance(filter_status, (list, tuple)):
        filter_status = ";".join(str(x) for x in filter_status) if filter_status else "PASS"
    else:
        filter_status = str(filter_status)
    passes_qc = filter_status.upper() == "PASS" or filter_status == "."

    # GT / depths from first sample when present
    zygosity = ""
    ref_depth: "int | None" = None
    alt_depth: "int | None" = None
    vaf: "float | None" = None
    try:
        if getattr(variant, "genotypes", None) and len(variant.genotypes) > sample_idx:
            gt = variant.genotypes[sample_idx]
            # cyvcf2 genotype: [a1, a2, phased]
            if isinstance(gt, (list, tuple)) and len(gt) >= 2:
                a1, a2 = gt[0], gt[1]
                if a1 == -1 or a2 == -1:
                    zygosity = ""
                elif a1 == a2:
                    zygosity = "" if a1 == 0 else "homozygous"
                else:
                    zygosity = "heterozygous" if 0 in (a1, a2) else "heterozygous"
        gts = variant.gt_bases
        if gts is not None and len(gts) > sample_idx and not zygosity:
            zygosity = _zygosity_from_gt(str(gts[sample_idx]))
        depths = getattr(variant, "gt_depths", None)
        alt_depths = getattr(variant, "gt_alt_depths", None)
        ref_depths = getattr(variant, "gt_ref_depths", None)
        if ref_depths is not None and len(ref_depths) > sample_idx and ref_depths[sample_idx] >= 0:
            ref_depth = int(ref_depths[sample_idx])
        if alt_depths is not None and len(alt_depths) > sample_idx and alt_depths[sample_idx] >= 0:
            alt_depth = int(alt_depths[sample_idx])
        if ref_depth is not None and alt_depth is not None and (ref_depth + alt_depth) > 0:
            vaf = alt_depth / (ref_depth + alt_depth)
    except Exception:
        pass

    tier_rank, tier_label = _classification_from_info(variant)
    acmg_criteria = (
        _info_str(variant, "ACMG_Criteria")
        or _info_str(variant, "autoACMGRules")
        or _info_str(variant, "ACMG_Criteria_Raw")
    )
    gnomad_af = _gnomad_af(variant)

    cadd_raw = (
        _info_str(variant, "CADD_phred")
        or _info_str(variant, "CADD_PHRED")
        or tx.get("CADD_PHRED")
        or tx.get("CADD_phred")
        or ""
    )
    sift = (
        _info_str(variant, "SIFT_pred")
        or tx.get("SIFT")
        or tx.get("SIFT_pred")
        or ""
    )
    # VEP SIFT format: "deleterious(0.01)" or "tolerated(...)"
    if "(" in sift:
        sift = sift.split("(")[0].strip()
    if sift.lower().startswith("deleterious") or sift.upper().startswith("D"):
        sift_pred = "D"
    elif sift:
        sift_pred = sift
    else:
        sift_pred = ""

    varclass = (
        (tx.get("Consequence") or tx.get("Annotation") or "")
        .split("&")[0]
        .upper()
        .replace(" ", "_")
    )
    aa_change = tx.get("HGVSp") or tx.get("Amino_acids") or ""
    cdna_change = tx.get("HGVSc") or ""
    transcript = tx.get("Feature") or tx.get("MANE_SELECT") or tx.get("MANE") or ""

    return {
        "variant_id": variant_id,
        "gene": gene,
        "chrom": chrom,
        "start": str(pos),
        "ref": ref,
        "alt": alt,
        "hgvsg": f"{chrom}:g.{pos}{ref}>{alt}" if ref and alt else "",
        "aa_change": aa_change,
        "cdna_change": cdna_change,
        "varclass": varclass,
        "vep_impact": tx.get("IMPACT") or "",
        "transcript": transcript,
        "transcript_count": 1,
        "zygosity": zygosity,
        "filter_status": filter_status,
        "passes_qc": passes_qc,
        "classification": tier_label,
        "classification_tier": tier_rank,
        "acmg_criteria": acmg_criteria,
        "inheritance_mode": _extract_inheritance_mode(acmg_criteria),
        "gnomad_af": gnomad_af,
        "maf_warning": _maf_warning(tier_rank, gnomad_af),
        "var_qual": float(variant.QUAL) if variant.QUAL is not None else None,
        "read_depth": str(ref_depth + alt_depth) if ref_depth is not None and alt_depth is not None else "",
        "ref_depth": ref_depth,
        "alt_depth": alt_depth,
        "vaf": round(vaf, 4) if vaf is not None else None,
        "vaf_warning": _vaf_warning(zygosity, vaf),
        "clinvar_significance": _info_str(variant, "CLNSIG") or _info_str(variant, "ClinVar_Significance"),
        "clinvar_disease": _info_str(variant, "CLNDN") or "",
        "clinvar_ids": [],
        "cadd_phred": _to_float(cadd_raw),
        "sift_prediction": sift_pred,
        "sift_score": None,
        "polyphen2_prediction": "",
        "polyphen2_score": None,
        "spliceai_max_score": None,
        "spliceai_raw": "",
    }


_DEFAULT_CSQ_FIELDS = [
    "Allele",
    "Consequence",
    "IMPACT",
    "SYMBOL",
    "Gene",
    "Feature_type",
    "Feature",
    "BIOTYPE",
    "EXON",
    "INTRON",
    "HGVSc",
    "HGVSp",
    "cDNA_position",
    "CDS_position",
    "Protein_position",
    "Amino_acids",
    "Codons",
    "Existing_variation",
    "DISTANCE",
    "STRAND",
    "FLAGS",
    "SYMBOL_SOURCE",
    "HGNC_ID",
    "CANONICAL",
    "MANE_SELECT",
]


class _SimpleVariant:
    """Minimal variant stand-in for the stdlib VCF path (uncompressed only)."""

    __slots__ = ("CHROM", "POS", "REF", "ALT", "FILTER", "QUAL", "INFO", "genotypes", "gt_bases")

    def __init__(self, chrom, pos, ref, alt, filt, qual, info, gt: str = ""):
        self.CHROM = chrom
        self.POS = pos
        self.REF = ref
        self.ALT = [alt] if alt else []
        self.FILTER = filt
        self.QUAL = qual
        self.INFO = info
        self.gt_bases = [gt] if gt else []
        self.genotypes = []


def _parse_info_field(raw: str) -> dict[str, Any]:
    info: dict[str, Any] = {}
    if not raw or raw == ".":
        return info
    for token in raw.split(";"):
        if not token:
            continue
        if "=" in token:
            k, v = token.split("=", 1)
            info[k] = v
        else:
            info[token] = True
    return info


def _parse_vcf_stdlib(path: str, gene_allowlist: Optional[set[str]] = None) -> dict[str, Any]:
    """Uncompressed .vcf reader used when cyvcf2 is unavailable (or for tests)."""
    import gzip

    open_fn = gzip.open if path.endswith(".gz") else open
    mode = "rt"
    csq_fields: list[str] = []
    variants_by_gene: dict[str, list[dict[str, Any]]] = {}
    all_genes_seen: set[str] = set()
    total_rows = 0
    skipped_unresolved = 0
    skipped_no_gene = 0
    seen_keys: set[tuple[str, str]] = set()
    allow = {g.upper() for g in gene_allowlist} if gene_allowlist else None

    try:
        with open_fn(path, mode, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("##"):
                    if "ID=CSQ," in line:
                        csq_fields = _parse_csq_format(line) or csq_fields
                    continue
                if line.startswith("#CHROM"):
                    continue
                line = line.strip()
                if not line:
                    continue
                cols = line.split("\t")
                if len(cols) < 8:
                    continue
                total_rows += 1
                chrom, pos_s, _vid, ref, alt, qual_s, filt, info_s = cols[:8]
                gt = ""
                if len(cols) >= 10:
                    fmt = cols[8].split(":")
                    sample = cols[9].split(":")
                    if "GT" in fmt:
                        gt = sample[fmt.index("GT")]
                try:
                    qual = float(qual_s) if qual_s not in {".", ""} else None
                except ValueError:
                    qual = None
                variant = _SimpleVariant(
                    chrom,
                    int(pos_s),
                    ref,
                    alt.split(",")[0],
                    filt,
                    qual,
                    _parse_info_field(info_s),
                    gt=gt,
                )
                record = _build_record_from_variant(
                    variant, csq_fields or _DEFAULT_CSQ_FIELDS
                )
                if record is None:
                    skipped_no_gene += 1
                    continue
                gene = record["gene"]
                all_genes_seen.add(gene.lower())
                if allow is not None and gene.upper() not in allow:
                    skipped_unresolved += 1
                    continue
                key = (gene.upper(), record["variant_id"])
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                variants_by_gene.setdefault(gene, []).append(record)
    except OSError as exc:
        raise VcfParseError(f"Could not open VCF file: {exc}") from exc

    for gene_variants in variants_by_gene.values():
        gene_variants.sort(key=lambda v: (0 if v["passes_qc"] else 1, v["classification_tier"]))

    return {
        "variants_by_gene": variants_by_gene,
        "total_rows": total_rows,
        "total_variants": sum(len(v) for v in variants_by_gene.values()),
        "skipped_rows": skipped_no_gene,
        "skipped_unresolved_gene_rows": skipped_unresolved,
        "variants_dropped_no_canonical_transcript": 0,
        "genes": sorted(variants_by_gene.keys()),
        "genes_seen_total": len(all_genes_seen),
    }


def parse_vcf_path(
    path: str,
    gene_allowlist: Optional[set[str]] = None,
) -> dict[str, Any]:
    """
    Parse an annotated VCF/VCF.gz into the same summary shape as
    ``varimat_parser.parse_varimat_lines``.
    """
    try:
        from cyvcf2 import VCF
    except ImportError:
        return _parse_vcf_stdlib(path, gene_allowlist=gene_allowlist)

    try:
        vcf = VCF(path)
    except Exception as exc:
        # Fall back for plain VCF if cyvcf2 fails to open the file
        if not path.endswith(".gz"):
            try:
                return _parse_vcf_stdlib(path, gene_allowlist=gene_allowlist)
            except VcfParseError:
                pass
        raise VcfParseError(f"Could not open VCF file: {exc}") from exc

    csq_fields: list[str] = []
    try:
        for h in vcf.raw_header.splitlines():
            if "ID=CSQ," in h or "ID=CSQ>" in h:
                csq_fields = _parse_csq_format(h)
                break
    except Exception:
        csq_fields = []

    if not csq_fields:
        csq_fields = list(_DEFAULT_CSQ_FIELDS)

    variants_by_gene: dict[str, list[dict[str, Any]]] = {}
    all_genes_seen: set[str] = set()
    total_rows = 0
    skipped_unresolved = 0
    skipped_no_gene = 0
    seen_keys: set[tuple[str, str]] = set()

    allow = {g.upper() for g in gene_allowlist} if gene_allowlist else None

    try:
        for variant in vcf:
            total_rows += 1
            record = _build_record_from_variant(variant, csq_fields)
            if record is None:
                skipped_no_gene += 1
                continue
            gene = record["gene"]
            all_genes_seen.add(gene.lower())
            if allow is not None and gene.upper() not in allow:
                skipped_unresolved += 1
                continue
            key = (gene.upper(), record["variant_id"])
            if key in seen_keys:
                continue
            seen_keys.add(key)
            variants_by_gene.setdefault(gene, []).append(record)
    finally:
        try:
            vcf.close()
        except Exception:
            pass

    for gene_variants in variants_by_gene.values():
        gene_variants.sort(key=lambda v: (0 if v["passes_qc"] else 1, v["classification_tier"]))

    return {
        "variants_by_gene": variants_by_gene,
        "total_rows": total_rows,
        "total_variants": sum(len(v) for v in variants_by_gene.values()),
        "skipped_rows": skipped_no_gene,
        "skipped_unresolved_gene_rows": skipped_unresolved,
        "variants_dropped_no_canonical_transcript": 0,
        "genes": sorted(variants_by_gene.keys()),
        "genes_seen_total": len(all_genes_seen),
    }
