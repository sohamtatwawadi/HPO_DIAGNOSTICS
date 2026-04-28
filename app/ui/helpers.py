"""Parsing and HPOSet construction helpers."""

from __future__ import annotations

from typing import List, Tuple

from pyhpo import HPOSet, Ontology


def parse_query_lines(text: str) -> List[str]:
    """Split user textarea into non-empty stripped lines."""
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def build_hposet_from_lines(lines: List[str]) -> Tuple[HPOSet, List[str]]:
    """
    Build an HPOSet from query strings (name, HP:…, or numeric id).

    Returns
    -------
    hposet, errors
        ``errors`` lists human-readable lines for failed lookups.
    """
    errors: List[str] = []
    terms = []
    for raw in lines:
        try:
            terms.append(Ontology.get_hpo_object(raw))
        except Exception as exc:  # noqa: BLE001 — show any lookup failure to the user
            errors.append(f"{raw!r}: {exc}")
    return HPOSet(terms), errors


def safe_get_term(query: str):
    """Return ``HPOTerm`` or raise with message suitable for ``st.error``."""
    return Ontology.get_hpo_object(query.strip())
