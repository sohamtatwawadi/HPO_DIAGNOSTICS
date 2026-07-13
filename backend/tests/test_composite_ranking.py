"""Unit tests for composite variant-file gene ranking helpers."""

import pytest

from backend.pyhpo_service import (
    _composite_score,
    _frequency_weight,
    _inheritance_flag,
    _inheritance_weight,
    _pathogenicity_weight,
)


@pytest.mark.parametrize(
    ("classification", "expected"),
    [
        ("Pathogenic", 1.0),
        ("Likely Pathogenic", 0.85),
        ("Uncertain Significance", 0.3),
        ("Benign", 0.0),
        ("pathogenic", 1.0),
        (None, 0.3),
        ("novel_class", 0.3),
    ],
)
def test_pathogenicity_weight(classification, expected):
    assert _pathogenicity_weight(classification) == expected


@pytest.mark.parametrize(
    ("inheritance_mode", "zygosity", "expected"),
    [
        ("AR", "homozygous", 1.0),
        ("AR", "heterozygous", 0.2),  # penalty unchanged for pure recessive
        ("AR", "compound heterozygous", 1.0),
        ("AD", "heterozygous", 1.0),
        ("AD_AR", "heterozygous", 0.7),
        ("AD_DD", "heterozygous", 1.0),
        ("AD_DD_AR", "heterozygous", 0.7),
        ("AD_DD_AR", "homozygous", 0.5),
        ("XLD", "hemizygous", 1.0),
        ("XLR", "heterozygous", 0.5),
        ("XL_XLD", "hemizygous", 1.0),
        ("XL_XLD", "heterozygous", 0.5),
        ("", "", 0.5),
        (None, None, 0.5),
    ],
)
def test_inheritance_weight(inheritance_mode, zygosity, expected):
    assert _inheritance_weight(inheritance_mode, zygosity) == expected


@pytest.mark.parametrize(
    ("gnomad_af", "expected"),
    [
        (None, 1.0),
        (0.0, 1.0),
        (0.00005, 0.9),
        (0.0005, 0.7),
        (0.003, 0.5),
        (0.007, 0.3),
        (0.05, 0.1),
        ("invalid", 1.0),
    ],
)
def test_frequency_weight(gnomad_af, expected):
    assert _frequency_weight(gnomad_af) == expected


def test_composite_score_trappc6b_vs_taf2_vs_cwf19l1():
    # Mirrors the real TRAPPC6B vs TAF2 situation from this sample
    gene_trappc6b = {
        "combined_score": 1.192,
        "candidate_variants": [
            {
                "classification": "Pathogenic",
                "zygosity": "homozygous",
                "inheritance_mode": "AR",
                "gnomad_af": 0.00000658,
            }
        ],
    }

    gene_taf2 = {
        "combined_score": 1.310,
        "candidate_variants": [
            {
                "classification": "Uncertain Significance",
                "zygosity": "heterozygous",
                "inheritance_mode": "AR",
                "gnomad_af": 0.000579,
            }
        ],
    }

    gene_cwf19l1 = {
        "combined_score": 1.192,
        "candidate_variants": [
            {
                "classification": "Uncertain Significance",
                "zygosity": "heterozygous",
                "inheritance_mode": "AR",
                "gnomad_af": 0.0156,
            }
        ],
    }

    assert _composite_score(gene_trappc6b) > _composite_score(gene_taf2)
    assert _composite_score(gene_taf2) > _composite_score(gene_cwf19l1)


@pytest.mark.parametrize(
    ("gene_row", "expected"),
    [
        (
            {
                "candidate_variants": [
                    {
                        "classification": "Pathogenic",
                        "zygosity": "homozygous",
                        "inheritance_mode": "AR",
                        "gnomad_af": 0.0,
                    }
                ]
            },
            "PATHOGENIC_HOM",
        ),
        (
            {
                "candidate_variants": [
                    {
                        "classification": "Uncertain Significance",
                        "zygosity": "heterozygous",
                        "inheritance_mode": "AR",
                        "gnomad_af": 0.001,
                    }
                ]
            },
            "AR_SINGLE_HET",
        ),
        (
            {
                "candidate_variants": [
                    {
                        "classification": "Uncertain Significance",
                        "zygosity": "heterozygous",
                        "inheritance_mode": "AR",
                        "gnomad_af": 0.05,
                    }
                ]
            },
            "HIGH_AF_VARIANT",
        ),
        (
            {
                "candidate_variants": [
                    {
                        "classification": "Uncertain Significance",
                        "zygosity": "heterozygous",
                        "inheritance_mode": "AD",
                        "gnomad_af": 0.001,
                    }
                ]
            },
            "AD_FIT",
        ),
        ({"candidate_variants": []}, None),
    ],
)
def test_inheritance_flag(gene_row, expected):
    assert _inheritance_flag(gene_row) == expected
