"""Load the HPO ontology once per Streamlit server process."""

from __future__ import annotations

import streamlit as st
from pyhpo import Ontology


@st.cache_resource(show_spinner="Loading Human Phenotype Ontology (this may take a minute)…")
def load_ontology():
    """Initialize the singleton ontology (reads OBO + annotation files)."""
    _ = Ontology()
    return Ontology


def get_ontology():
    """Return the initialized :class:`pyhpo.ontology.OntologyClass` singleton."""
    return load_ontology()
