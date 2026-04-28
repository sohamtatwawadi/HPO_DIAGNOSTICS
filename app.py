"""
PyHPO Genetic Diagnostic Explorer — Streamlit UI (v2 layout).

Visual system aligned with ``pyhpo_diagnostic_explorer_v2.html`` (cards, sidebar stats,
result tables with pills + score bars, path-to-root tree).

Run::

    pip install -r requirements.txt
    streamlit run app.py
"""

from __future__ import annotations

import html
import sys
import traceback
from datetime import datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if (_ROOT / "pyhpo" / "__init__.py").is_file() and str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import pandas as pd
import streamlit as st

# --- Defaults ---
DEFAULT_DDX = """HP:0002650
HP:0001166
HP:0004322
HP:0000545
HP:0002751"""

DEFAULT_P1 = """HP:0002943
HP:0008458
HP:0100884
HP:0002944
HP:0002751"""

DEFAULT_P2 = """HP:0002650
HP:0010674
HP:0000925
HP:0009121"""

DEFAULT_GENES = """FBN1
PAPSS2
COL1A1
COL2A1"""

DEFAULT_TERM = "Scoliosis"


def _inject_v2_css() -> None:
    st.markdown(
        """
<style>
  :root {
    --dx-bg: #0b0f14;
    --dx-card: #141b26;
    --dx-border: #243044;
    --dx-accent: #3d8bfd;
    --dx-accent-soft: rgba(61, 139, 253, 0.12);
    --dx-text: #e6edf3;
    --dx-muted: #8b9cb3;
    --dx-pill-bg: #1e2a3d;
    --dx-bar-track: #243044;
  }
  .block-container { padding-top: 1.25rem !important; max-width: 1400px; }
  div[data-testid="stSidebar"] {
    background: linear-gradient(180deg, #141b26 0%, #0f1419 100%);
    border-right: 1px solid var(--dx-border);
  }
  div[data-testid="stSidebar"] .block-container { padding-top: 1rem; }
  .dx-sidebar-brand {
    font-size: 1.05rem; font-weight: 600; color: var(--dx-text);
    margin-bottom: 0.15rem; letter-spacing: -0.02em;
  }
  .dx-sidebar-sub { font-size: 0.75rem; color: var(--dx-muted); margin-bottom: 1rem; }
  .dx-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.45rem; margin-top: 0.5rem; }
  .dx-stat-card {
    background: #0b0f14; border: 1px solid var(--dx-border); border-radius: 10px;
    padding: 0.55rem 0.65rem;
  }
  .dx-stat-card .k {
    font-size: 0.62rem; color: var(--dx-muted); text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .dx-stat-card .v { font-size: 1rem; font-weight: 700; color: var(--dx-accent); margin-top: 0.1rem; }
  .dx-main-hero {
    font-size: 1.35rem; font-weight: 600; color: var(--dx-text); margin-bottom: 0.35rem;
  }
  .dx-main-sub { font-size: 0.88rem; color: var(--dx-muted); margin-bottom: 1.1rem; }
  .dx-card-html {
    background: var(--dx-card); border: 1px solid var(--dx-border); border-radius: 14px;
    padding: 1rem 1.15rem; margin-bottom: 1rem;
  }
  .dx-card-html h3 { margin: 0 0 0.75rem; font-size: 1rem; font-weight: 600; color: var(--dx-text); }
  .pill {
    display: inline-block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem; padding: 0.12rem 0.5rem; border-radius: 999px;
    background: var(--dx-pill-bg); color: #c9d1d9; border: 1px solid var(--dx-border);
  }
  table.dx-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; color: var(--dx-text); }
  table.dx-table th {
    text-align: left; color: var(--dx-muted); font-weight: 500; font-size: 0.68rem;
    text-transform: uppercase; letter-spacing: 0.06em; padding: 0.45rem 0.65rem;
    border-bottom: 1px solid var(--dx-border);
  }
  table.dx-table td { padding: 0.55rem 0.65rem; border-bottom: 1px solid var(--dx-border); vertical-align: middle; }
  table.dx-table tr:hover td { background: var(--dx-accent-soft); }
  .dx-bar-wrap { min-width: 100px; max-width: 180px; }
  .dx-bar { height: 8px; border-radius: 4px; background: var(--dx-bar-track); overflow: hidden; }
  .dx-bar > span {
    display: block; height: 100%; border-radius: 4px;
    background: linear-gradient(90deg, #238636, #3fb950);
  }
  ul.tree, ul.tree ul { list-style: none; margin: 0; padding: 0; }
  ul.tree ul { margin-left: 0.85rem; padding-left: 0.65rem; border-left: 2px solid var(--dx-border); }
  ul.tree li { margin: 0.35rem 0; padding-left: 0.15rem; }
  .tree-node { display: flex; align-items: baseline; gap: 0.45rem; flex-wrap: wrap; }
  .tree-node .nm { color: var(--dx-text); font-size: 0.88rem; }
  .dx-history-item { font-size: 0.72rem; color: var(--dx-muted); margin-bottom: 0.35rem; border-bottom: 1px solid var(--dx-border); padding-bottom: 0.25rem; }
  .dx-quick-hit { font-size: 0.72rem; margin: 0.15rem 0; }
  .dx-copy { color: var(--dx-accent); cursor: pointer; }
</style>
        """,
        unsafe_allow_html=True,
    )


def _e(s: str | int | float) -> str:
    return html.escape(str(s), quote=True)


def _score_bar_widths(scores: list[float], *, lower_is_better: bool) -> list[float]:
    """Map scores to 8–100% bar width for display."""
    if not scores:
        return []
    lo, hi = min(scores), max(scores)
    if hi <= lo:
        return [72.0] * len(scores)
    out = []
    for s in scores:
        if lower_is_better:
            t = (hi - s) / (hi - lo + 1e-15)
        else:
            t = (s - lo) / (hi - lo + 1e-15)
        out.append(max(8.0, min(100.0, 100.0 * t)))
    return out


def _render_dx_table(
    *,
    headers: list[str],
    rows_html: list[str],
    title: str | None = None,
) -> None:
    head = "".join(f"<th>{_e(h)}</th>" for h in headers)
    body = "".join(f"<tr>{r}</tr>" for r in rows_html)
    ttl = f'<h3>{_e(title)}</h3>' if title else ""
    st.markdown(
        f'<div class="dx-card-html">{ttl}<table class="dx-table"><thead><tr>{head}</tr></thead>'
        f"<tbody>{body}</tbody></table></div>",
        unsafe_allow_html=True,
    )


def _render_path_tree(path: tuple, *, title: str = "Path toward root (All)") -> None:
    items = []
    for t in path:
        items.append(
            "<li><div class=\"tree-node\"><span class=\"pill\">"
            f"{_e(t.id)}</span><span class=\"nm\">{_e(t.name)}</span></div></li>"
        )
    inner = "".join(items)
    st.markdown(
        f'<div class="dx-card-html"><h3>{_e(title)}</h3><ul class="tree">{inner}</ul></div>',
        unsafe_allow_html=True,
    )


def _sidebar_stats(Ontology) -> None:
    st.sidebar.markdown(
        '<div class="dx-sidebar-brand">🧬 PyHPO Diagnostic Explorer</div>'
        '<div class="dx-sidebar-sub">Ontology snapshot</div>'
        '<div class="dx-stat-grid">'
        f'<div class="dx-stat-card"><div class="k">HPO terms</div><div class="v">{len(Ontology):,}</div></div>'
        f'<div class="dx-stat-card"><div class="k">Genes</div><div class="v">{len(Ontology.genes):,}</div></div>'
        f'<div class="dx-stat-card"><div class="k">OMIM</div><div class="v">{len(Ontology.omim_diseases):,}</div></div>'
        f'<div class="dx-stat-card"><div class="k">Orpha</div><div class="v">{len(Ontology.orpha_diseases):,}</div></div>'
        "</div>"
        f'<div class="dx-stat-grid" style="grid-template-columns:1fr;margin-top:0.45rem">'
        f'<div class="dx-stat-card"><div class="k">Decipher</div><div class="v">{len(Ontology.decipher_diseases):,}</div></div>'
        "</div>",
        unsafe_allow_html=True,
    )


@st.cache_resource
def load_ontology():
    from pyhpo import Ontology

    _ = Ontology()
    return Ontology


def _parse_lines(text: str) -> list[str]:
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def _safe_hposet_from_queries(lines: list[str]):
    from pyhpo import HPOSet, Ontology

    terms = []
    for raw in lines:
        try:
            terms.append(Ontology.get_hpo_object(raw))
        except Exception:  # noqa: BLE001
            st.warning(f"Term {raw!r} not found, skipping")
    if not terms:
        return None
    return HPOSet(terms)


def _interpret_similarity(score: float) -> str:
    if score >= 0.8:
        return "Very similar phenotype"
    if score >= 0.5:
        return "Moderate phenotypic overlap"
    return "Low phenotypic similarity"


def _init_session_state() -> None:
    if "patients" not in st.session_state:
        st.session_state["patients"] = []
    if "history" not in st.session_state:
        st.session_state["history"] = []


def _history_append(module: str, summary: str, result: str) -> None:
    st.session_state["history"].append(
        {"module": module, "input": summary[:200], "result": result[:200], "time": datetime.now()}
    )
    st.session_state["history"] = st.session_state["history"][-10:]


def _history_sidebar() -> None:
    with st.sidebar.expander("Session history (last 10)", expanded=False):
        if not st.session_state["history"]:
            st.caption("No analyses yet.")
        else:
            for h in reversed(st.session_state["history"]):
                t = h["time"].strftime("%H:%M:%S")
                st.markdown(
                    f'<div class="dx-history-item"><strong>{_e(h["module"])}</strong> · {t}<br/>'
                    f'{_e(h["input"][:80])}… → {_e(h["result"][:60])}…</div>',
                    unsafe_allow_html=True,
                )


def _quick_term_lookup(Ontology) -> None:
    with st.sidebar.expander("Quick term lookup", expanded=False):
        q = st.text_input("Name fragment", key="quick_term_q", placeholder="scolio…")
        if q and len(q) >= 2:
            try:
                hits = list(Ontology.search(q))[:5]
            except Exception:  # noqa: BLE001
                hits = []
            for t in hits:
                line = f"{t.id} · {t.name}"
                c1, c2 = st.columns([4, 1])
                with c1:
                    st.markdown(f'<div class="dx-quick-hit">{_e(line)}</div>', unsafe_allow_html=True)
                with c2:
                    st.code(t.id, language=None)


def _branch_under_all(Ontology, term) -> str:
    """Label the major branch (child of All) on the path from term to root."""
    from pyhpo import HPOTerm

    root = Ontology.get_hpo_object("HP:0000001")
    if not isinstance(term, HPOTerm):
        return "Unknown"
    if int(term) == int(root):
        return "HP:0000001 | All"
    try:
        _d, path, _a, _b = term.path_to_other(root)
        if len(path) >= 2:
            b = path[-2]
            return f"{b.id} | {b.name}"
    except Exception:  # noqa: BLE001
        pass
    return term.id


def _expand_ancestors_hops(term, max_hops: int) -> set:
    cur = {term}
    for _ in range(max_hops):
        nxt = set()
        for t in cur:
            nxt.update(t.parents)
        cur = cur | nxt
    return cur


def _venn_style_summary(p1, p2) -> str:
    s1, s2 = set(p1), set(p2)
    only1 = len(s1 - s2)
    only2 = len(s2 - s1)
    exact = len(s1 & s2)
    ex1 = set()
    for t in s1:
        ex1 |= _expand_ancestors_hops(t, 2)
    ex2 = set()
    for t in s2:
        ex2 |= _expand_ancestors_hops(t, 2)
    z = len(ex1 & ex2)
    return (
        f"Patient 1 has **{only1}** unique terms · Patient 2 has **{only2}** unique terms · "
        f"**{exact}** exact shared terms · **{z}** terms lie in the intersection of "
        "2-hop ancestor expansions (coarse overlap signal)."
    )


def _friendly_error(exc: BaseException) -> None:
    st.error("Something went wrong. See details below.")
    with st.expander("Technical details"):
        st.code(traceback.format_exc())


# --------------------------------------------------------------------------- #
st.set_page_config(
    page_title="PyHPO Diagnostic Explorer",
    page_icon="🧬",
    layout="wide",
    initial_sidebar_state="expanded",
)

_inject_v2_css()

with st.spinner("Loading Human Phenotype Ontology…"):
    try:
        Ontology = load_ontology()
    except Exception as exc:  # noqa: BLE001
        st.error(f"Failed to load ontology: {exc}")
        st.stop()

_init_session_state()
_sidebar_stats(Ontology)
_history_sidebar()
_quick_term_lookup(Ontology)

st.sidebar.markdown("---")
MODULE_OPTIONS = [
    "Differential Diagnosis",
    "Patient Similarity",
    "Gene Enrichment",
    "Cohort Analysis",
    "Variant Prioritizer",
    "Disease Deep-Dive",
    "HPO Term Explorer",
]
module = st.sidebar.radio("Module", MODULE_OPTIONS, index=0, key="module_radio")
st.sidebar.markdown("---")
st.sidebar.caption("Powered by PyHPO + Human Phenotype Ontology")

st.markdown('<p class="dx-main-hero">Clinical genomics workspace</p>', unsafe_allow_html=True)
st.markdown(
    '<p class="dx-main-sub">Diagnosis · patients · genes · cohorts · variants · diseases · terms</p>',
    unsafe_allow_html=True,
)

# --------------------------------------------------------------------------- #
if module == "Differential Diagnosis":
    _ddx_default = st.session_state.pop("ddx_terms_override", None) or DEFAULT_DDX
    with st.container(border=True):
        st.markdown("### Differential Diagnosis")
        st.caption(
            "Rank OMIM / Orpha / DECIPHER entries by hypergeometric enrichment (`EnrichmentModel`) "
            "for your HPO profile."
        )
        terms_in = st.text_area(
            "HPO terms (one per line)",
            value=_ddx_default,
            height=140,
            key="ddx_terms_ta",
        )
        c1, c2, c3 = st.columns((2, 1, 1))
        with c1:
            source = st.selectbox("Source", ["omim", "orpha", "decipher"], index=0)
        with c2:
            top_n = st.slider("Top N", 5, 50, 10)
        with c3:
            st.write("")
            run = st.button("Run diagnosis", type="primary", use_container_width=True)

    if run:
        try:
            lines = _parse_lines(terms_in)
            if not lines:
                st.error("No valid HPO terms found")
            else:
                with st.spinner("Running analysis..."):
                    try:
                        from pyhpo.stats import EnrichmentModel
                    except ImportError as exc:
                        st.error(f"Enrichment requires scipy: {exc}")
                        st.stop()
                    hposet = _safe_hposet_from_queries(lines)
                    if hposet is None or len(hposet) == 0:
                        st.error("No valid HPO terms found")
                        st.stop()
                    model = EnrichmentModel(source)
                    results = model.enrichment(method="hypergeom", hposet=hposet)

                resolved_bits = [f"{t.name} ({t.id})" for t in sorted(hposet, key=int)]
                with st.expander("Resolved HPO terms", expanded=False):
                    st.caption(" · ".join(resolved_bits))

                view = results[:top_n]
                scores = [float(r["enrichment"]) for r in view]
                widths = _score_bar_widths(scores, lower_is_better=True)
                rows_html = []
                for i, r in enumerate(view):
                    item = r["item"]
                    name = getattr(item, "name", str(item))
                    did = getattr(item, "id", "")
                    pill_id = f'<span class="pill">{source.upper()}:{_e(did)}</span>' if did != "" else ""
                    rows_html.append(
                        "<td>"
                        f'{i + 1}</td><td>{_e(name)}</td><td>{pill_id or "—"}</td>'
                        f'<td><span class="pill">{int(r["count"])}</span></td>'
                        f'<td style="font-variant-numeric:tabular-nums">{scores[i]:.4g}</td>'
                        f'<td class="dx-bar-wrap"><div class="dx-bar"><span style="width:{widths[i]:.1f}%"></span></div></td>'
                    )
                _render_dx_table(
                    title="Ranked differential diagnoses",
                    headers=["#", "Disease", "ID", "Count", "Enrichment", "Signal"],
                    rows_html=rows_html,
                )
                df_out = pd.DataFrame(
                    [
                        {
                            "rank": i + 1,
                            "disease": getattr(r["item"], "name", ""),
                            "id": getattr(r["item"], "id", ""),
                            "count": r["count"],
                            "enrichment": r["enrichment"],
                        }
                        for i, r in enumerate(view)
                    ]
                )
                st.download_button(
                    label="Download results (CSV)",
                    data=df_out.to_csv(index=False).encode("utf-8"),
                    file_name=f"pyhpo_differential_diagnosis_{datetime.now():%Y%m%d_%H%M%S}.csv",
                    mime="text/csv",
                    key="dl_ddx",
                )

                with st.expander("Run gene diagnosis too", expanded=False):
                    with st.spinner("Running gene enrichment…"):
                        gmodel = EnrichmentModel("gene")
                        gres = gmodel.enrichment(method="hypergeom", hposet=hposet)[:10]
                    gscores = [float(r["enrichment"]) for r in gres]
                    gwidths = _score_bar_widths(gscores, lower_is_better=True)
                    grow = []
                    for i, r in enumerate(gres):
                        g = r["item"]
                        grow.append(
                            "<td>"
                            f'{i + 1}</td><td>{_e(g.name)}</td><td><span class="pill">HGNC:{_e(g.id)}</span></td>'
                            f'<td><span class="pill">{int(r["count"])}</span></td>'
                            f'<td style="font-variant-numeric:tabular-nums">{gscores[i]:.4g}</td>'
                            f'<td class="dx-bar-wrap"><div class="dx-bar"><span style="width:{gwidths[i]:.1f}%"></span></div></td>'
                        )
                    _render_dx_table(
                        title="Top 10 genes (same HPO profile)",
                        headers=["#", "Gene", "ID", "Count", "Enrichment", "Signal"],
                        rows_html=grow,
                    )

                top_name = getattr(view[0]["item"], "name", "") if view else ""
                _history_append(
                    "Differential Diagnosis",
                    f"{source} · {len(hposet)} terms",
                    top_name or "—",
                )
        except Exception as exc:  # noqa: BLE001
            _friendly_error(exc)

# --------------------------------------------------------------------------- #
elif module == "Patient Similarity":
    st.markdown("### Patient similarity")
    st.caption("`HPOSet.similarity` — compare two phenotype lists.")
    sim_kinds = ["omim", "orpha", "decipher", "gene"]
    sim_methods = ["", "resnik", "lin", "jc", "graphic", "dist", "equal"]
    sim_combine = ["funSimAvg", "funSimMax", "BMA"]
    with st.container(border=True):
        cc1, cc2 = st.columns(2)
        with cc1:
            st.markdown("**Patient 1**")
            t1 = st.text_area("p1", value=DEFAULT_P1, height=180, label_visibility="collapsed")
        with cc2:
            st.markdown("**Patient 2**")
            t2 = st.text_area("p2", value=DEFAULT_P2, height=180, label_visibility="collapsed")
        sk, sm, sc = st.columns(3)
        with sk:
            sim_kind = st.selectbox("IC kind", sim_kinds, index=0, key="ps_kind")
        with sm:
            sim_method = st.selectbox("Method", sim_methods, index=0, format_func=lambda x: x or "(default)")
        with sc:
            sim_combine_v = st.selectbox("Combine", sim_combine, index=0, key="ps_comb")

    if st.button("Compare patients", type="primary"):
        try:
            with st.spinner("Running analysis..."):
                p1 = _safe_hposet_from_queries(_parse_lines(t1))
                p2 = _safe_hposet_from_queries(_parse_lines(t2))
                if p1 is None or len(p1) == 0:
                    st.error("No valid HPO terms found for Patient 1")
                    st.stop()
                if p2 is None or len(p2) == 0:
                    st.error("No valid HPO terms found for Patient 2")
                    st.stop()
                kw = {}
                if sim_method:
                    kw["method"] = sim_method
                if sim_kind:
                    kw["kind"] = sim_kind
                if sim_method != "equal":
                    kw["combine"] = sim_combine_v
                score = float(p1.similarity(p2, **kw))

            m1, m2, m3 = st.columns((1, 1, 2))
            with m1:
                st.metric("Similarity", f"{score:.4f}")
            with m2:
                st.metric("Overlap", _interpret_similarity(score))
            with m3:
                st.markdown(_venn_style_summary(p1, p2))
            with st.expander("HPO terms — Patient 1"):
                st.markdown(
                    " ".join(f'<span class="pill">{_e(t.id)}</span>' for t in sorted(p1, key=int)),
                    unsafe_allow_html=True,
                )
                st.caption(" · ".join(t.name for t in sorted(p1, key=int)))
            with st.expander("HPO terms — Patient 2"):
                st.markdown(
                    " ".join(f'<span class="pill">{_e(t.id)}</span>' for t in sorted(p2, key=int)),
                    unsafe_allow_html=True,
                )
                st.caption(" · ".join(t.name for t in sorted(p2, key=int)))

            rows_csv = [{"patient": "1", "hpo_id": t.id, "name": t.name} for t in sorted(p1, key=int)]
            rows_csv += [{"patient": "2", "hpo_id": t.id, "name": t.name} for t in sorted(p2, key=int)]
            rows_csv.append({"patient": "metric", "hpo_id": "similarity", "name": f"{score:.6f}"})
            st.download_button(
                label="Download results (CSV)",
                data=pd.DataFrame(rows_csv).to_csv(index=False).encode("utf-8"),
                file_name=f"pyhpo_patient_similarity_{datetime.now():%Y%m%d_%H%M%S}.csv",
                mime="text/csv",
                key="dl_ps",
            )
            _history_append("Patient Similarity", f"{len(p1)} vs {len(p2)} terms", f"score={score:.3f}")
        except Exception as exc:  # noqa: BLE001
            _friendly_error(exc)

# --------------------------------------------------------------------------- #
elif module == "Gene Enrichment":
    with st.container(border=True):
        st.markdown("### Gene → HPO enrichment")
        st.caption("`HPOEnrichment('gene')` across your gene list.")
        genes_in = st.text_area("Genes", value=DEFAULT_GENES, height=120, label_visibility="collapsed")
        min_count = st.slider("Minimum count threshold", 1, 20, 1, key="ge_minct")
    if st.button("Find enriched HPO terms", type="primary"):
        try:
            symbols = _parse_lines(genes_in)
            if not symbols:
                st.error("Enter at least one gene symbol.")
            else:
                with st.spinner("Running analysis..."):
                    try:
                        from pyhpo.annotations import Gene
                        from pyhpo.stats import HPOEnrichment
                    except ImportError as exc:
                        st.error(f"HPOEnrichment requires scipy: {exc}")
                        st.stop()
                    gene_objects = []
                    for g in symbols:
                        try:
                            gene_objects.append(Gene.get(g))
                        except Exception:  # noqa: BLE001
                            st.warning(f"Gene {g!r} not found in ontology, skipping")
                    if not gene_objects:
                        st.error("No valid genes found after filtering.")
                        st.stop()
                    enrichment = HPOEnrichment("gene")
                    results = enrichment.enrichment(method="hypergeom", annotation_sets=gene_objects)

                filtered = [r for r in results if int(r["count"]) >= min_count][:80]
                if not filtered:
                    st.warning("No rows pass the count threshold.")
                else:
                    scores = [float(r["enrichment"]) for r in filtered]
                    widths = _score_bar_widths(scores, lower_is_better=True)
                    rows_html = []
                    for i, r in enumerate(filtered):
                        h = r["hpo"]
                        rows_html.append(
                            "<td>"
                            f'{i + 1}</td><td>{_e(h.name)}</td><td><span class="pill">{_e(h.id)}</span></td>'
                            f'<td><span class="pill">{int(r["count"])}</span></td>'
                            f'<td style="font-variant-numeric:tabular-nums">{scores[i]:.4g}</td>'
                            f'<td class="dx-bar-wrap"><div class="dx-bar"><span style="width:{widths[i]:.1f}%"></span></div></td>'
                        )
                    _render_dx_table(
                        title="Enriched HPO terms (best hits first)",
                        headers=["#", "HPO term", "HP ID", "Count", "Enrichment", "Signal"],
                        rows_html=rows_html,
                    )
                    df_ge = pd.DataFrame(
                        [
                            {
                                "hpo_name": r["hpo"].name,
                                "hpo_id": r["hpo"].id,
                                "count": r["count"],
                                "enrichment": r["enrichment"],
                            }
                            for r in filtered
                        ]
                    )
                    st.download_button(
                        label="Download results (CSV)",
                        data=df_ge.to_csv(index=False).encode("utf-8"),
                        file_name=f"pyhpo_gene_enrichment_{datetime.now():%Y%m%d_%H%M%S}.csv",
                        mime="text/csv",
                        key="dl_ge",
                    )

                    st.subheader("HPO category breakdown")
                    cat_counts: dict[str, int] = {}
                    for r in filtered:
                        br = _branch_under_all(Ontology, r["hpo"])
                        cat_counts[br] = cat_counts.get(br, 0) + 1
                    if cat_counts:
                        cdf = pd.DataFrame(
                            sorted(cat_counts.items(), key=lambda x: -x[1]), columns=["Branch", "Terms"]
                        )
                        st.bar_chart(cdf.set_index("Branch"))
                    _history_append(
                        "Gene Enrichment",
                        f"{len(gene_objects)} genes",
                        filtered[0]["hpo"].id if filtered else "—",
                    )
        except Exception as exc:  # noqa: BLE001
            _friendly_error(exc)

# --------------------------------------------------------------------------- #
elif module == "Cohort Analysis":
    st.markdown("### Cohort analysis")
    st.caption("Pairwise patient similarity and shared OMIM disease candidates (top-20 overlap across all).")
    if st.button("+ Add patient", key="cohort_add"):
        st.session_state["patients"].append("")
        st.rerun()
    for i in range(len(st.session_state["patients"])):
        st.text_area(
            f"Patient {i + 1} (one HPO per line)",
            value=st.session_state["patients"][i],
            height=100,
            key=f"cohort_w_{i}",
        )
    if st.button("Run cohort analysis", type="primary", key="cohort_run"):
        try:
            from pyhpo.stats import EnrichmentModel

            patient_lists = []
            for i in range(len(st.session_state["patients"])):
                raw = str(st.session_state.get(f"cohort_w_{i}", "") or "")
                patient_lists.append(_parse_lines(raw))
            patient_lists = [p for p in patient_lists if p]
            if len(patient_lists) < 2:
                st.error("Add at least two patients with non-empty HPO lines.")
            else:
                with st.spinner("Running analysis..."):
                    sets = []
                    for pl in patient_lists:
                        hs = _safe_hposet_from_queries(pl)
                        if hs is None or len(hs) == 0:
                            st.error("No valid HPO terms found for one cohort member.")
                            st.stop()
                        sets.append(hs)
                    n = len(sets)
                    mat = []
                    for i, a in enumerate(sets):
                        row = []
                        for j, b in enumerate(sets):
                            row.append(round(float(a.similarity(b)), 3))
                        mat.append(row)
                    labels = [f"P{k+1}" for k in range(n)]
                    dfm = pd.DataFrame(mat, index=labels, columns=labels)
                    st.dataframe(
                        dfm.style.background_gradient(cmap="Blues", axis=None),
                        use_container_width=True,
                    )
                    st.download_button(
                        label="Download results (CSV)",
                        data=dfm.to_csv().encode("utf-8"),
                        file_name=f"pyhpo_cohort_matrix_{datetime.now():%Y%m%d_%H%M%S}.csv",
                        mime="text/csv",
                        key="dl_cohort_m",
                    )

                    omim = EnrichmentModel("omim")
                    top_sets = []
                    for s in sets:
                        res = omim.enrichment(method="hypergeom", hposet=s)
                        top_ids = {r["item"].id for r in res[:20]}
                        top_sets.append(top_ids)
                    shared = set.intersection(*top_sets) if top_sets else set()
                    id_to_name = {}
                    for s in sets:
                        res = omim.enrichment(method="hypergeom", hposet=s)
                        for r in res:
                            d = r["item"]
                            id_to_name[d.id] = d.name
                    shared_rows = [{"omim_id": oid, "name": id_to_name.get(oid, "")} for oid in sorted(shared)]
                    st.subheader("Shared disease candidates (in top-20 for every patient)")
                    if not shared_rows:
                        st.info("No OMIM diseases appear in all patients' top-20 lists.")
                    else:
                        sdf = pd.DataFrame(shared_rows)
                        st.dataframe(sdf, use_container_width=True, hide_index=True)
                        bcdf = sdf.set_index("name").assign(shared=1.0)[["shared"]]
                        st.bar_chart(bcdf)
                    _history_append(
                        "Cohort Analysis",
                        f"{n} patients",
                        f"{len(shared)} shared OMIM",
                    )
        except Exception as exc:  # noqa: BLE001
            _friendly_error(exc)

# --------------------------------------------------------------------------- #
elif module == "Variant Prioritizer":
    st.markdown("### Variant prioritizer")
    st.caption("Re-rank VCF gene candidates by hypergeometric phenotype match (`EnrichmentModel('gene')`).")
    with st.container(border=True):
        cva, cvb = st.columns(2)
        with cva:
            st.markdown("**Patient HPO terms**")
            vp_hpo = st.text_area("vp_hpo", value=DEFAULT_DDX, height=200, label_visibility="collapsed")
        with cvb:
            st.markdown("**Candidate genes (VCF)**")
            vp_genes = st.text_area("vp_genes", value=DEFAULT_GENES, height=200, label_visibility="collapsed")
    if st.button("Prioritize variants", type="primary", key="vp_run"):
        try:
            from pyhpo.stats import EnrichmentModel

            with st.spinner("Running analysis..."):
                pt_lines = _parse_lines(vp_hpo)
                patient_set = _safe_hposet_from_queries(pt_lines)
                if patient_set is None or len(patient_set) == 0:
                    st.error("No valid HPO terms found")
                    st.stop()
                gene_model = EnrichmentModel("gene")
                gene_results = gene_model.enrichment(method="hypergeom", hposet=patient_set)
                user_genes = {g.upper().strip() for g in _parse_lines(vp_genes)}
                prioritized = [
                    r
                    for r in gene_results
                    if getattr(r["item"], "name", "").upper() in user_genes
                ]
                seen = {getattr(r["item"], "name", "").upper() for r in prioritized}
                missing = sorted(user_genes - seen)

            rows_html: list[str] = []
            scores = [float(r["enrichment"]) for r in prioritized]
            widths = _score_bar_widths(scores, lower_is_better=True) if scores else []
            for i, r in enumerate(prioritized):
                g = r["item"]
                w = widths[i] if widths else 8.0
                rows_html.append(
                    "<td>"
                    f'{i + 1}</td><td>{_e(g.name)}</td>'
                    f'<td style="font-variant-numeric:tabular-nums">{scores[i]:.4g}</td>'
                    f'<td class="dx-bar-wrap"><div class="dx-bar"><span style="width:{w:.1f}%"></span></div></td>'
                )
            rank0 = len(prioritized)
            for j, sym in enumerate(missing):
                st.warning(f"No HPO association in ranked results: **{sym}** (score 0)")
                rows_html.append(
                    "<td>"
                    f'{rank0 + j + 1}</td><td>{_e(sym)} <span class="pill">no match</span></td>'
                    '<td style="font-variant-numeric:tabular-nums">0</td>'
                    '<td class="dx-bar-wrap"><div class="dx-bar"><span style="width:8%"></span></div></td>'
                )
            if rows_html:
                _render_dx_table(
                    title="Prioritized genes (phenotype match)",
                    headers=["Priority", "Gene", "Match score", "Signal"],
                    rows_html=rows_html,
                )

            m1, m2, m3 = st.columns(3)
            with m1:
                st.metric("Candidate genes", len(user_genes))
            with m2:
                st.metric("With HPO match", len(prioritized))
            with m3:
                top_g = getattr(prioritized[0]["item"], "name", "—") if prioritized else "—"
                st.metric("Top gene", top_g)

            rows_df = [
                {"rank": i + 1, "gene": getattr(r["item"], "name", ""), "score": r["enrichment"]}
                for i, r in enumerate(prioritized)
            ]
            for j, sym in enumerate(missing):
                rows_df.append({"rank": rank0 + j + 1, "gene": sym, "score": 0.0})
            df_vp = pd.DataFrame(rows_df) if rows_df else pd.DataFrame(columns=["rank", "gene", "score"])
            st.download_button(
                label="Download results as CSV",
                data=df_vp.to_csv(index=False).encode("utf-8"),
                file_name=f"pyhpo_variant_prioritizer_{datetime.now():%Y%m%d_%H%M%S}.csv",
                mime="text/csv",
                key="dl_vp",
            )
            _history_append("Variant Prioritizer", f"{len(user_genes)} genes", top_g)
        except Exception as exc:  # noqa: BLE001
            _friendly_error(exc)

# --------------------------------------------------------------------------- #
elif module == "Disease Deep-Dive":
    st.markdown("### Disease deep-dive")
    st.caption("Inspect an OMIM or Orphanet disease profile and overlap with a patient list.")
    with st.container(border=True):
        dsrc = st.radio("Catalog", ["omim", "orpha"], horizontal=True, key="dd_src")
        dq = st.text_input("Disease name or ID (e.g. Marfan syndrome or 154700)", key="dd_q")
        ptx = st.text_area("Optional patient HPO terms (one per line)", height=100, key="dd_pt")
    if st.button("Explore disease", type="primary", key="dd_run"):
        try:
            q = (dq or "").strip()
            if not q:
                st.error("Enter a disease query.")
            else:
                matches = []
                if dsrc == "omim":
                    for d in Ontology.omim_diseases:
                        if str(d.id) == q or q.lower() in (d.name or "").lower():
                            matches.append(d)
                else:
                    for d in Ontology.orpha_diseases:
                        if str(d.id) == q or q.lower() in (d.name or "").lower():
                            matches.append(d)
                if not matches:
                    st.warning("No disease matched that query.")
                else:
                    disease = matches[0]
                    disease_set = disease.hpo_set()
                    terms = list(disease_set)

                    with st.container(border=True):
                        st.markdown(f"#### {_e(disease.name)}")
                        st.caption(f"{dsrc.upper()} ID **{disease.id}** · {len(terms)} HPO terms on disease record")
                        genes = sorted(disease.hpo_set().all_genes(), key=lambda g: g.name)[:200]
                        st.markdown("**Associated genes (union via HPOSet)**")
                        if genes:
                            st.dataframe(
                                pd.DataFrame([{"Gene": g.name, "HGNC": g.id} for g in genes[:50]]),
                                use_container_width=True,
                                hide_index=True,
                            )
                        else:
                            st.caption("No genes resolved on this disease slice.")

                    hpo_df = pd.DataFrame([{"HP ID": t.id, "Name": t.name} for t in sorted(terms, key=int)])
                    st.dataframe(hpo_df, use_container_width=True, hide_index=True)

                    pt_lines = _parse_lines(ptx)
                    if pt_lines:
                        patient_set = _safe_hposet_from_queries(pt_lines)
                        if patient_set and len(patient_set):
                            overlap_score = float(patient_set.similarity(disease_set))
                            st.metric("Patient ↔ disease HPOSet similarity", f"{overlap_score:.4f}")
                            inter = {t for t in patient_set} & {t for t in disease_set}
                            st.markdown("**Exact overlapping HPO terms**")
                            if inter:
                                st.markdown(
                                    " ".join(f'<span class="pill">{_e(t.id)}</span>' for t in sorted(inter, key=int)),
                                    unsafe_allow_html=True,
                                )
                            else:
                                st.caption("No exact term overlap; similarity uses ontology structure.")

                    if st.button("Use these terms for diagnosis", key="dd_fill_ddx"):
                        lines = "\n".join(t.id for t in sorted(terms, key=int))
                        pats = st.session_state["patients"]
                        while len(pats) < 2:
                            pats.append("")
                        st.session_state["patients"][0] = lines
                        st.session_state["cohort_w_0"] = lines
                        st.session_state["module_radio"] = "Cohort Analysis"
                        st.success(
                            "Prefilled **Patient 1** in **Cohort Analysis** with this disease’s HPO terms "
                            "(Patient 2 left blank — add a second patient or edit lists there)."
                        )
                    _history_append("Disease Deep-Dive", disease.name, str(disease.id))
        except Exception as exc:  # noqa: BLE001
            _friendly_error(exc)

# --------------------------------------------------------------------------- #
elif module == "HPO Term Explorer":
    with st.container(border=True):
        st.markdown("### HPO term explorer")
        st.caption("Inspect one term: definition, parents, children, associations, path to root.")
        query = st.text_input("HPO ID or name", value=DEFAULT_TERM)
    if st.button("Explore term", type="primary"):
        try:
            with st.spinner("Running analysis..."):
                term = Ontology.get_hpo_object(query.strip())

            with st.container(border=True):
                st.markdown(f"#### `{term.id}` — {term.name}")
                if term.definition:
                    st.write(term.definition)
                st.caption(f"Obsolete: **{term.is_obsolete}**")

            pc1, pc2 = st.columns(2)
            with pc1:
                with st.container(border=True):
                    st.markdown("**Parents**")
                    if term.parents:
                        st.markdown(
                            "<br/>".join(
                                f'<span class="pill">{_e(p.id)}</span> {_e(p.name)}'
                                for p in sorted(term.parents, key=int)
                            ),
                            unsafe_allow_html=True,
                        )
                    else:
                        st.info("None")
            with pc2:
                with st.container(border=True):
                    st.markdown("**Children**")
                    if term.children:
                        st.markdown(
                            "<br/>".join(
                                f'<span class="pill">{_e(c.id)}</span> {_e(c.name)}'
                                for c in sorted(term.children, key=int)
                            ),
                            unsafe_allow_html=True,
                        )
                    else:
                        st.info("None (leaf)")

            sibs: list = []
            for p in term.parents:
                for c in p.children:
                    if c != term:
                        sibs.append(c)
            sibs = list({int(s): s for s in sibs}.values())
            with st.expander("Sibling terms (share a parent)", expanded=False):
                if sibs:
                    st.markdown(
                        "<br/>".join(
                            f'<span class="pill">{_e(s.id)}</span> {_e(s.name)}' for s in sorted(sibs, key=int)
                        ),
                        unsafe_allow_html=True,
                    )
                else:
                    st.caption("No siblings found (single child or no parents).")

            ag1, ag2, ag3 = st.columns(3)
            with ag1:
                with st.expander("Genes (first 20)"):
                    genes = sorted(term.genes, key=lambda g: g.name)[:20]
                    if genes:
                        st.dataframe(
                            pd.DataFrame([{"Gene": g.name, "HGNC": g.id} for g in genes]),
                            use_container_width=True,
                            hide_index=True,
                        )
                    else:
                        st.caption("None in direct set.")
            with ag2:
                with st.expander("OMIM (first 20)"):
                    om = sorted(term.omim_diseases, key=lambda d: d.id)[:20]
                    if om:
                        st.dataframe(
                            pd.DataFrame([{"OMIM": d.id, "Name": d.name} for d in om]),
                            use_container_width=True,
                            hide_index=True,
                        )
                    else:
                        st.caption("None in direct set.")
            with ag3:
                with st.expander("Orpha (first 20)"):
                    orp = sorted(term.orpha_diseases, key=lambda d: d.id)[:20]
                    if orp:
                        st.dataframe(
                            pd.DataFrame([{"Orpha": d.id, "Name": d.name} for d in orp]),
                            use_container_width=True,
                            hide_index=True,
                        )
                    else:
                        st.caption("None in direct set.")

            try:
                root = Ontology.get_hpo_object("HP:0000001")
            except Exception as exc:  # noqa: BLE001
                st.warning(f"Could not load root: {exc}")
            else:
                if int(term) == int(root):
                    st.info("This term is the ontology root (All).")
                else:
                    try:
                        _length, path, _sa, _sb = term.path_to_other(root)
                        _render_path_tree(path, title="Path toward root (HP:0000001 — All)")
                        st.caption(f"Graph path length metric: {_length} · {len(path)} nodes")
                    except Exception as exc:  # noqa: BLE001
                        st.warning(f"Could not compute path to root: {exc}")

            st.markdown("**Compare to another term**")
            ccmp, cbtn = st.columns((3, 1))
            with ccmp:
                cmp_q = st.text_input("Second HPO id or name", key="term_cmp_q", placeholder="HP:0009121")
            with cbtn:
                st.write("")
                do_cmp = st.button("Compare", key="term_cmp_go")
            if do_cmp and cmp_q.strip():
                try:
                    other = Ontology.get_hpo_object(cmp_q.strip())
                    dlen, pth, _, _ = term.path_to_other(other)
                    st.metric("Path length", dlen)
                    st.code("\n".join(f"{t.id} | {t.name}" for t in pth), language=None)
                except Exception as exc:  # noqa: BLE001
                    st.warning(f"Comparison failed: {exc}")

            ex_df = pd.DataFrame(
                [{"HP ID": term.id, "Name": term.name, "definition": (term.definition or "")[:200]}]
            )
            st.download_button(
                label="Download results (CSV)",
                data=ex_df.to_csv(index=False).encode("utf-8"),
                file_name=f"pyhpo_hpo_term_explorer_{datetime.now():%Y%m%d_%H%M%S}.csv",
                mime="text/csv",
                key="dl_hpo_ex",
            )
            _history_append("HPO Term Explorer", term.id, term.name)
        except Exception as exc:  # noqa: BLE001
            _friendly_error(exc)
