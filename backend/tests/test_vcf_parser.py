"""Annotated VCF parser → VariMAT-equivalent records."""

from __future__ import annotations

import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from vcf_parser import parse_vcf_path

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample_annotated.vcf"


def test_parse_annotated_vcf_classification_and_gene():
    parsed = parse_vcf_path(str(FIXTURE))
    assert "TRAPPC6B" in parsed["variants_by_gene"]
    assert parsed["total_variants"] >= 2

    traps = parsed["variants_by_gene"]["TRAPPC6B"]
    assert len(traps) == 1
    v = traps[0]
    assert v["classification"].lower() == "pathogenic"
    assert v["classification_tier"] == 0
    assert v["passes_qc"] is True
    assert v["zygosity"] == "homozygous"
    assert v["gnomad_af"] == 0.00000658
    assert v["varclass"]  # consequence mapped
    assert "STOP" in v["varclass"] or "stop" in (v.get("aa_change") or "").lower() or v["aa_change"]


def test_parse_vcf_gene_allowlist_filters():
    parsed = parse_vcf_path(str(FIXTURE), gene_allowlist={"TRAPPC6B"})
    assert "TRAPPC6B" in parsed["variants_by_gene"]
    assert "NUMA1" not in parsed["variants_by_gene"]
    assert parsed["skipped_unresolved_gene_rows"] >= 1
