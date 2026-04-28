"""Reusable Streamlit fragments for term display and exports."""

from __future__ import annotations

from typing import Iterable, List, Optional

import pandas as pd
import streamlit as st

from pyhpo import HPOTerm


def ic_dataframe(term: HPOTerm) -> pd.DataFrame:
    ic = term.information_content
    rows = [
        ("gene", ic.gene),
        ("omim", ic.omim),
        ("orpha", ic.orpha),
        ("decipher", ic.decipher),
    ]
    for k, v in sorted(ic.custom.items()):
        rows.append((f"custom:{k}", v))
    return pd.DataFrame(rows, columns=["kind", "information_content"])


def render_ic_table(term: HPOTerm) -> None:
    st.subheader("Information content")
    st.dataframe(ic_dataframe(term), use_container_width=True, hide_index=True)


def term_link(term: HPOTerm) -> str:
    return f"{term.id} | {term.name}"


def render_term_chips(label: str, terms: Iterable[HPOTerm], key: str) -> None:
    st.caption(label)
    lines = [term_link(t) for t in sorted(terms, key=lambda x: int(x))]
    if lines:
        st.text("\n".join(lines))
    else:
        st.info("None")


def dataframe_download_button(
    df: pd.DataFrame,
    filename: str,
    label: str = "Download CSV",
    *,
    button_key: Optional[str] = None,
) -> None:
    st.download_button(
        label,
        data=df.to_csv(index=False).encode("utf-8"),
        file_name=filename,
        mime="text/csv",
        key=button_key or f"dl_{filename}",
    )


def similarity_kinds() -> List[str]:
    return ["omim", "orpha", "decipher", "gene"]


def similarity_methods() -> List[str]:
    return ["resnik", "lin", "jc", "jc2", "rel", "ic", "graphic", "dist", "equal"]


def combine_methods() -> List[str]:
    return ["funSimAvg", "funSimMax", "BMA"]
