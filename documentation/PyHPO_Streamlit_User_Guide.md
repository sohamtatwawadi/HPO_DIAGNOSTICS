# PyHPO Streamlit UI — User Guide and Use Cases

**Version:** aligned with the `app/` Streamlit explorer in this repository.  
**Audience:** researchers and engineers who want to browse the Human Phenotype Ontology (HPO), compare phenotype sets, and run enrichment without writing Python first.

---

## 1. What this application is

The **PyHPO Streamlit UI** is a thin browser-based front end on top of the **pyhpo** Python library. It does **not** change the library; it imports `Ontology`, `HPOTerm`, `HPOSet`, and (where applicable) `EnrichmentModel`, and exposes common workflows as separate pages.

**How it works (high level):**

1. When you open the app, Streamlit calls `Ontology()` once and caches the result (`@st.cache_resource`). That constructor loads bundled files from `pyhpo/data/` (OBO ontology plus gene–phenotype and disease–phenotype annotations), builds every `HPOTerm`, connects parents and children, attaches genes and diseases to terms, and computes **information content (IC)** used by several similarity methods.
2. Each page uses the **public pyhpo API** only: search (`Ontology.search`), lookup (`Ontology.get_hpo_object`), paths (`Ontology.path` / `HPOTerm.path_to_other`), set operations (`HPOSet`), enrichment (`EnrichmentModel`), and optional **pyvis** for a local graph.
3. **scipy** is required only for the **Enrichment** page, because `pyhpo.stats` imports SciPy at import time.

---

## 2. Installation and launch

From the repository root (with a virtual environment activated):

```bash
pip install -r requirements-ui.txt
streamlit run app/main.py
```

Open the URL shown in the terminal (typically `http://localhost:8501`). Use the sidebar to switch pages.

**First load:** reading and parsing `hp.obo` and annotation files can take **tens of seconds** and uses noticeable memory; subsequent interactions reuse the cached ontology in the same Streamlit server process.

---

## 3. End-to-end data flow (library)

Understanding this flow explains every page in the UI.

1. **Files** under `pyhpo/data/` include at minimum `hp.obo`, `phenotype.hpoa`, `genes_to_phenotype.txt`, and `phenotype_to_genes.txt` (exact set as shipped with your pyhpo version).
2. **`Ontology()`** (`pyhpo/ontology.py`): parses OBO into `HPOTerm` objects, links `parents` / `children`, then `build_ontology_annotations` in `pyhpo/parser` attaches genes and diseases to terms.
3. **`HPOTerm`**: holds metadata (name, definition, synonyms, xrefs, obsolete flags), graph helpers (`path_to_other`, `child_of`, `parent_of`), association sets (`genes`, `omim_diseases`, `orpha_diseases`, `decipher_diseases`, plus excluded-disease sets where modeled), and `similarity_score` / IC.
4. **`HPOSet`**: a set of `HPOTerm` instances, often built with `HPOSet.from_queries([...])`. It supports **similarity** between two sets, **variance** of pairwise graph distances, **information_content** summaries, **child_nodes** (most specific terms only), **remove_modifier**, and **replace_obsolete**.
5. **`EnrichmentModel`** (`pyhpo/stats.py`): hypergeometric-style enrichment of genes or diseases **given** an `HPOSet` (requires scipy).

---

## 4. Query formats (all pages that accept “queries”)

Each non-empty line is passed to `Ontology.get_hpo_object`, which accepts:

- **HPO id string:** `HP:0002650`
- **Integer id:** `2650` (same term as above)
- **Primary name or synonym:** e.g. `Scoliosis` (exact match on name or synonym per library rules)

Invalid lines produce an error listing the failed line and the exception message.

---

## 5. Use cases by page

### 5.1 Home (`app/main.py`)

**Purpose:** Confirm the ontology loaded and see global counts (terms, genes, OMIM, Orpha, Decipher).

**Typical use case:** After deployment, open Home once to verify the environment and data bundle are healthy before deep exploration.

---

### 5.2 Term Explorer

**Purpose:** Find a phenotype term, read its clinical and ontology metadata, optionally list associated genes and diseases, and **compare two terms** with ontology-based similarity.

**Use case A — Literature review of a phenotype**

1. Enter a substring in **Search** (e.g. `ataxia`).
2. Pick a hit from the dropdown.
3. Read **Definition**, **Comment**, **Synonyms**, and **Information content** table.
4. Expand **Parents / children** to see where the term sits in the hierarchy.

**Use case B — Drill-down to linked biology**

1. After selecting a term, open **Drill-down lists** and enable **List genes** or **List OMIM diseases** (lists can be large).
2. Download CSV for offline filtering in Excel or R.

**Use case C — Quantify similarity between two phenotypes**

1. Select or look up term A.
2. In **Compare two terms**, enter term B (id or name).
3. Choose **IC kind** (`omim`, `gene`, `orpha`, `decipher`) and **Method** (`resnik`, `lin`, `jc`, `graphic`, `dist`, etc.).
4. Click **Compute**. The score is from `HPOTerm.similarity_score`.

**Note:** The method `equal` is for **HPOSet** comparisons, not term–term; the UI warns if you select it here.

---

### 5.3 Path Finder

**Purpose:** Show the **shortest path** in the ontology between two terms (via their most informative common ancestors), including path length and step counts toward the common ancestor from each side.

**Use case — Explain “how far apart” two findings are clinically**

1. Enter **Term A** and **Term B** (ids or names).
2. Click **Find path**.
3. Copy the textual path for reports or supplemental material.

**API:** `Ontology.path` wraps `HPOTerm.path_to_other`.

---

### 5.4 Set tools (HPOSet similarity and analytics)

**Purpose:** Treat each textarea as a **patient-like phenotype list** (or any HPO term list), then compare sets, optionally visualize a **term–term score matrix**, and inspect **set-level statistics**.

**Use case A — Similarity between two cohorts / patients**

1. Paste one HPO id or name per line into **Set A** and **Set B**.
2. Choose **kind**, **method**, and **combine** (`funSimAvg`, `funSimMax`, `BMA`). For exact overlap only, pick method **`equal`**.
3. Click **Run** and read the scalar similarity.

**Use case B — Heatmap of which terms in A best match which in B**

1. Enable **Show term–term score matrix / heatmap**.
2. Run again. Download the CSV of the matrix if needed.

**Use case C — Data hygiene before downstream analysis**

1. Open **Set analytics** and inspect:
   - **Serialized** form of the set (`HPOSet.serialize()`).
   - **Information content** summary for a chosen kind.
   - **Pairwise path variance** (average/min/max distances between all pairs).
   - **child_nodes** (keep only the most specific terms in the set).
   - **remove_modifier** (strip modifier subtrees such as mode of inheritance where applicable).
   - **replace_obsolete** (swap obsolete terms for replacements when defined).

---

### 5.5 Enrichment

**Purpose:** Given a phenotype set, rank **genes** or **diseases** (OMIM / Orpha / Decipher) by hypergeometric enrichment using the full ontology as reference (via `EnrichmentModel`).

**Use case — Prioritize genes from a clinical HPO panel**

1. Paste HPO queries (one per line) that represent the patient or cohort.
2. Select category **gene** (or a disease database).
3. Adjust **Show top N** and click **Run enrichment**.
4. Sort in the table by enrichment p-value column; download full results CSV.

**Requirement:** **scipy** must be installed; otherwise the page shows an install message.

---

### 5.6 Annotations

**Purpose:** Browse **positive** gene and disease associations for a **single term**, or the **union** of associations across an **HPOSet**. For a single term, also view **excluded** disease associations where the model provides them.

**Use case A — Single term association export**

1. Choose **Single term**, enter query, review tabs **Genes**, **OMIM**, **Orpha**, **Decipher**.
2. Use **Excluded / negative** to see explicitly excluded diseases when present.

**Use case B — Union over a clinical list**

1. Choose **Union over set**, paste lines, click **Load set**.
2. Export union tables per tab for pathway or overlap analysis.

---

### 5.7 Graph view

**Purpose:** Visualize a **local directed neighborhood** (parents up *k* levels, children down *k* levels) around one term using **pyvis**.

**Use case — Teaching or presentation**

1. Enter a center term, set parent and child depth (small values keep the graph readable).
2. Click **Build graph** and pan/zoom in the embedded HTML widget.

---

### 5.8 Help & Workflow

**Purpose:** In-app summary of modules, the data pipeline, and the mapping from **page → pyhpo API**. Optional Mermaid diagram if `streamlit-mermaid` is installed.

---

## 6. Design and performance notes

- **Caching:** Ontology load is cached at the Streamlit resource layer so each user session on the same server process does not re-parse files.
- **Heavy operations:** Large gene or disease tables are optional or paginated via the dataframe widget; matrix heatmaps are optional and scale with set sizes (very large sets may be slow).
- **Correctness:** The UI does not write back to ontology data; all operations are read-only on the in-memory graph.

---

## 7. Generating this guide as a PDF

The Markdown source of this document lives at:

`documentation/PyHPO_Streamlit_User_Guide.md`

To build a PDF artifact for sharing or printing:

```bash
pip install -r documentation/requirements-pdf.txt
python scripts/generate_user_guide_pdf.py
```

Output path (default):

`documentation/PyHPO_Streamlit_User_Guide.pdf`

The script uses **ReportLab** to turn the same Markdown file into a styled multi-page PDF (headings, paragraphs, and bullet lists; fenced code blocks are rendered in monospace).

---

## 8. References

- **pyhpo** upstream documentation: https://pyhpo.readthedocs.io/
- **HPO** project: https://hpo.jax.org/

---

*This guide is part of the repository documentation for the Streamlit explorer. For library API details, see the official pyhpo docs and docstrings.*
