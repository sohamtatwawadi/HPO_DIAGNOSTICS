"""
PyHPO — basic Streamlit app (single file, no multipage).

Run from the repository root::

    pip install -r requirements-ui.txt
    streamlit run app/main.py
"""

from __future__ import annotations

import streamlit as st

import _path  # noqa: F401 — ensure app/ is on sys.path

from ui.components import render_ic_table, render_term_chips, term_link
from ui.helpers import safe_get_term
from ui.ontology_loader import get_ontology

st.set_page_config(
    page_title="PyHPO",
    page_icon="🧬",
    layout="wide",
)

st.title("PyHPO")
st.caption("Browse the Human Phenotype Ontology (basic demo).")

with st.spinner("Loading ontology (first time can take a minute)…"):
    Ontology = get_ontology()

tab_overview, tab_find, tab_path = st.tabs(["Overview", "Find a term", "Path between two terms"])

with tab_overview:
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("HPO terms", f"{len(Ontology):,}")
    c2.metric("Genes", f"{len(Ontology.genes):,}")
    c3.metric("OMIM diseases", f"{len(Ontology.omim_diseases):,}")
    c4.metric("Orpha diseases", f"{len(Ontology.orpha_diseases):,}")
    c5.metric("Decipher", f"{len(Ontology.decipher_diseases):,}")
    st.info(
        "Data is read from `pyhpo/data/` when the ontology loads. "
        "Use **Find a term** to search or look up an HPO id or name. "
        "Use **Path** to see the shortest connection between two terms."
    )

with tab_find:
    st.markdown("Search by **substring** in term names or synonyms, or look up an **exact** id or name.")
    col_a, col_b = st.columns((1, 2))

    with col_a:
        mode = st.radio("Mode", ["Substring search", "Exact lookup"], horizontal=False)
        if mode == "Substring search":
            q = st.text_input("Search text", placeholder="e.g. scoliosis")
            limit = st.number_input("Max results", min_value=5, max_value=300, value=80)
        else:
            q = st.text_input("Query (HP:…, numeric id, or full name)", placeholder="HP:0002650")

    with col_b:
        selected = None
        if mode == "Substring search" and q.strip():
            hits = list(Ontology.search(q.strip()))[: int(limit)]
            if not hits:
                st.warning("No matches.")
            else:
                labels = [term_link(t) for t in hits]
                idx = st.selectbox(f"Matches ({len(hits)})", range(len(labels)), format_func=lambda i: labels[i])
                selected = hits[idx]
        elif mode == "Exact lookup" and q.strip():
            try:
                selected = safe_get_term(q)
            except Exception as exc:  # noqa: BLE001
                st.error(str(exc))

    if selected is not None:
        st.divider()
        st.subheader(term_link(selected))
        d1, d2 = st.columns(2)
        with d1:
            st.markdown(f"**Obsolete:** `{selected.is_obsolete}`")
            if selected.definition:
                st.markdown("**Definition**")
                st.write(selected.definition)
            if selected.comment:
                st.markdown("**Comment**")
                st.write(selected.comment)
            if selected.synonym:
                st.caption("Synonyms: " + ", ".join(selected.synonym[:20]) + ("…" if len(selected.synonym) > 20 else ""))
        with d2:
            render_ic_table(selected)
            st.caption(
                f"Genes: {len(selected.genes)} · OMIM: {len(selected.omim_diseases)} · "
                f"Orpha: {len(selected.orpha_diseases)} · Decipher: {len(selected.decipher_diseases)}"
            )
        pc1, pc2 = st.columns(2)
        with pc1:
            render_term_chips("Parents", selected.parents, "p")
        with pc2:
            render_term_chips("Children", selected.children, "c")

with tab_path:
    st.markdown("Enter two terms (HPO id, numeric id, or name). Uses `Ontology.path`.")
    p1 = st.text_input("Term A", placeholder="Scoliosis")
    p2 = st.text_input("Term B", placeholder="HP:0009121")
    if st.button("Compute path", type="primary"):
        if not p1.strip() or not p2.strip():
            st.warning("Enter both terms.")
        else:
            try:
                t1 = safe_get_term(p1)
                t2 = safe_get_term(p2)
            except Exception as exc:  # noqa: BLE001
                st.error(str(exc))
            else:
                length, path, steps_a, steps_b = Ontology.path(t1, t2)
                st.metric("Path length", length)
                c1, c2 = st.columns(2)
                c1.metric("Steps from A to common ancestor", steps_a)
                c2.metric("Steps from B to common ancestor", steps_b)
                st.subheader("Path (A → … → B)")
                st.code("\n".join(term_link(t) for t in path), language=None)
