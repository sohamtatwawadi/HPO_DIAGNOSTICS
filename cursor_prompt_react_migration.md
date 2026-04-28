# Cursor Prompt — HPO Diagnostic Explorer (React + FastAPI)
## Full implementation guide to migrate from Streamlit to production React + Python backend

---

## Project overview

You are migrating and extending a Streamlit app (`app.py`) built on **PyHPO 4.0** into a production
**React frontend + FastAPI backend** architecture. The app serves genetic analysts, clinical geneticists,
and researchers.

### Stack
- **Frontend**: React 18, Vite, Tailwind CSS (optional), `react-query` for data fetching
- **Backend**: FastAPI + PyHPO 4.0 + uvicorn
- **No database required initially** — serialized patient profiles stored as strings; optionally SQLite via SQLAlchemy

---

## Design system (blue / white clinical theme)

All colours are already defined in `HPODiagnosticsApp.jsx` in the `C` token object.
Do not deviate from these tokens. Key rules:

- **Background**: `#F0F4FA` page, `#FFFFFF` cards, `#0F2A52` sidebar
- **Accent/CTA**: `#2563EB` (blue-600)
- **Text**: `#0F172A` primary, `#475569` secondary, `#94A3B8` muted
- **Sidebar text**: `#E2EAF4` on dark, `#7B9DC4` muted-on-dark
- **Borders**: `#E2E8F0` default, `#CBD5E1` emphasis
- **Semantic**: green `#16A34A`, amber `#D97706`, red `#DC2626`
- **Typography**: `DM Sans` for UI, `DM Mono` for HPO IDs, scores, code
- **No gradients** on cards. Flat surfaces only. Subtle `box-shadow: 0 1px 3px rgba(0,0,0,.06)` allowed on cards.

---

## File structure to create

```
project/
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx                   ← root with sidebar + routing
│   │   ├── tokens.js                 ← design tokens (C object from HPODiagnosticsApp.jsx)
│   │   ├── components/
│   │   │   ├── Sidebar.jsx
│   │   │   ├── Topbar.jsx
│   │   │   ├── Badge.jsx
│   │   │   ├── Pill.jsx
│   │   │   ├── ScoreBar.jsx
│   │   │   ├── Card.jsx
│   │   │   ├── MetricCard.jsx
│   │   │   ├── ResultTable.jsx
│   │   │   ├── Textarea.jsx
│   │   │   ├── Input.jsx
│   │   │   └── CTA.jsx
│   │   ├── modules/
│   │   │   ├── workflow/
│   │   │   │   ├── WorkflowView.jsx  ← step rail + step panels
│   │   │   │   ├── Step1Enter.jsx
│   │   │   │   ├── Step2IC.jsx
│   │   │   │   ├── Step3Disease.jsx
│   │   │   │   ├── Step4Genes.jsx
│   │   │   │   ├── Step5Cohort.jsx
│   │   │   │   ├── Step6Validate.jsx
│   │   │   │   └── Step7Save.jsx
│   │   │   ├── DDX.jsx
│   │   │   ├── PatientSimilarity.jsx
│   │   │   ├── GeneEnrichment.jsx
│   │   │   ├── CohortAnalysis.jsx
│   │   │   ├── VariantPrioritizer.jsx
│   │   │   ├── DiseaseDeepDive.jsx
│   │   │   ├── HPOTermExplorer.jsx
│   │   │   ├── ICProfiler.jsx
│   │   │   └── ReportBuilder.jsx
│   │   └── hooks/
│   │       └── useAPI.js             ← react-query wrappers
│   ├── index.html
│   └── vite.config.js
├── backend/
│   ├── main.py                       ← FastAPI app
│   ├── pyhpo_service.py              ← all PyHPO logic, cached with @lru_cache
│   └── requirements.txt
└── README.md
```

---

## Backend — FastAPI (`backend/main.py`)

### Ontology loading (must be cached — loading takes ~3s)

```python
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from functools import lru_cache
import pyhpo
from pyhpo.stats import EnrichmentModel

app = FastAPI(title="HPO Diagnostics API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@lru_cache(maxsize=1)
def get_ontology():
    ont = pyhpo.Ontology()
    return ont

@lru_cache(maxsize=4)
def get_enrichment_model(category: str) -> EnrichmentModel:
    """Cache each EnrichmentModel — they are expensive to instantiate."""
    return EnrichmentModel(category)
```

### Endpoint: resolve HPO terms

```python
from pydantic import BaseModel

class TermsInput(BaseModel):
    queries: list[str]            # HP IDs or names
    remove_modifiers: bool = True
    replace_obsolete: bool = True

@app.post("/api/resolve")
def resolve_terms(body: TermsInput):
    ont = get_ontology()
    resolved, failed = [], []
    for q in body.queries:
        try:
            # Try exact match first, then synonym
            try:
                t = ont.get_hpo_object(q.strip())
            except Exception:
                t = ont.synonym_match(q.strip())
            resolved.append({
                "id": t.id, "name": t.name,
                "definition": t.definition or "",
                "is_obsolete": t.is_obsolete,
                "is_modifier": t.is_modifier,
                "ic_omim": float(t.information_content.omim),
                "ic_gene": float(t.information_content.gene),
                "ic_orpha": float(t.information_content.orpha),
                "depth": t.longest_path_to_root(),
            })
        except Exception:
            failed.append(q)
    return {"resolved": resolved, "failed": failed}
```

### Endpoint: information content profile

```python
@app.post("/api/ic-profile")
def ic_profile(body: TermsInput):
    ont = get_ontology()
    terms = []
    for q in body.queries:
        try:
            t = ont.get_hpo_object(q.strip())
            terms.append(t)
        except Exception:
            pass
    if not terms:
        raise HTTPException(400, "No valid HPO terms")

    hposet = pyhpo.HPOSet(terms)
    if body.remove_modifiers:
        hposet = hposet.remove_modifier()

    set_ic = hposet.information_content()  # {mean, total, max, all}

    term_profiles = []
    for t in hposet:
        term_profiles.append({
            "id": t.id,
            "name": t.name,
            "ic_omim":  float(t.information_content.omim),
            "ic_gene":  float(t.information_content.gene),
            "ic_orpha": float(t.information_content.orpha),
            "depth": t.longest_path_to_root(),
        })

    return {
        "set_summary": {
            "mean":  float(set_ic["mean"]),
            "total": float(set_ic["total"]),
            "max":   float(set_ic["max"]),
        },
        "terms": sorted(term_profiles, key=lambda x: -x["ic_omim"]),
    }
```

### Endpoint: differential diagnosis (disease enrichment)

```python
class EnrichmentInput(BaseModel):
    queries: list[str]
    source: str = "omim"          # omim | orpha | decipher | gene
    top_n: int = 20
    remove_modifiers: bool = True

@app.post("/api/enrichment")
def run_enrichment(body: EnrichmentInput):
    ont = get_ontology()
    terms = [ont.get_hpo_object(q.strip()) for q in body.queries
             if _safe_get(ont, q)]
    if not terms:
        raise HTTPException(400, "No valid HPO terms")

    hposet = pyhpo.HPOSet(terms)
    if body.remove_modifiers:
        hposet = hposet.remove_modifier()

    model = get_enrichment_model(body.source)
    results = model.enrichment(method="hypergeom", hposet=hposet)

    return {
        "results": [
            {
                "rank": i + 1,
                "name": getattr(r["item"], "name", str(r["item"])),
                "id":   str(getattr(r["item"], "id", "")),
                "count": int(r["count"]),
                "enrichment": float(r["enrichment"]),
            }
            for i, r in enumerate(results[:body.top_n])
        ],
        "hposet_size": len(hposet),
    }

def _safe_get(ont, q):
    try:
        ont.get_hpo_object(q.strip())
        return True
    except Exception:
        return False
```

### Endpoint: patient similarity

```python
class SimilarityInput(BaseModel):
    patient1: list[str]
    patient2: list[str]
    kind:    str = "omim"         # omim | gene | orpha
    method:  str = "resnik"       # resnik | lin | jc | graphic | dist
    combine: str = "BMA"          # BMA | funSimAvg | funSimMax

@app.post("/api/similarity")
def compute_similarity(body: SimilarityInput):
    ont = get_ontology()
    def make_set(queries):
        terms = []
        for q in queries:
            try: terms.append(ont.get_hpo_object(q.strip()))
            except Exception: pass
        return pyhpo.HPOSet(terms) if terms else None

    p1 = make_set(body.patient1)
    p2 = make_set(body.patient2)
    if not p1 or not p2:
        raise HTTPException(400, "Invalid HPO terms in one or both patients")

    score = float(p1.similarity(p2, kind=body.kind, method=body.method, combine=body.combine))

    s1, s2 = set(p1), set(p2)
    shared = [{"id": t.id, "name": t.name} for t in sorted(s1 & s2, key=int)]
    only1  = [{"id": t.id, "name": t.name} for t in sorted(s1 - s2, key=int)]
    only2  = [{"id": t.id, "name": t.name} for t in sorted(s2 - s1, key=int)]

    return {
        "score": score,
        "shared": shared,
        "only_in_patient1": only1,
        "only_in_patient2": only2,
    }
```

### Endpoint: variant prioritizer

```python
class VariantInput(BaseModel):
    hpo_queries: list[str]
    candidate_genes: list[str]    # symbols from VCF

@app.post("/api/variant-prioritize")
def prioritize_variants(body: VariantInput):
    ont = get_ontology()
    terms = [ont.get_hpo_object(q) for q in body.hpo_queries if _safe_get(ont, q)]
    hposet = pyhpo.HPOSet(terms)

    gene_model = get_enrichment_model("gene")
    gene_results = gene_model.enrichment(method="hypergeom", hposet=hposet)

    user_genes = {g.upper().strip() for g in body.candidate_genes}
    prioritized = [r for r in gene_results
                   if getattr(r["item"], "name", "").upper() in user_genes]
    missing = sorted(user_genes - {getattr(r["item"], "name", "").upper() for r in prioritized})

    return {
        "prioritized": [
            {"gene": r["item"].name, "score": float(r["enrichment"]), "count": int(r["count"])}
            for r in prioritized
        ],
        "missing": missing,
    }
```

### Endpoint: disease deep-dive

```python
@app.get("/api/disease")
def get_disease(query: str, source: str = "omim"):
    ont = get_ontology()
    catalog = ont.omim_diseases if source == "omim" else ont.orpha_diseases
    matches = [d for d in catalog
               if str(d.id) == query or query.lower() in (d.name or "").lower()]
    if not matches:
        raise HTTPException(404, "No disease matched")
    d = matches[0]
    disease_set = d.hpo_set()
    terms = list(disease_set)
    return {
        "id": d.id, "name": d.name,
        "hpo_count": len(terms),
        "hpo_terms": [{"id": t.id, "name": t.name} for t in sorted(terms, key=int)],
        "genes": [{"name": g.name, "id": g.id}
                  for g in sorted(disease_set.all_genes(), key=lambda g: g.name)[:100]],
    }
```

### Endpoint: HPO term explorer

```python
@app.get("/api/term")
def explore_term(query: str):
    ont = get_ontology()
    try:
        t = ont.get_hpo_object(query.strip())
    except Exception:
        raise HTTPException(404, f"Term not found: {query}")

    root = ont.get_hpo_object("HP:0000001")
    try:
        _length, path, _a, _b = t.path_to_other(root)
        path_to_root = [{"id": p.id, "name": p.name} for p in path]
    except Exception:
        path_to_root = []

    return {
        "id": t.id, "name": t.name,
        "definition": t.definition or "",
        "comment": t.comment or "",
        "synonym": list(t.synonym),
        "is_obsolete": t.is_obsolete, "is_modifier": t.is_modifier,
        "parents":  [{"id": p.id, "name": p.name} for p in sorted(t.parents,  key=int)],
        "children": [{"id": c.id, "name": c.name} for c in sorted(t.children, key=int)],
        "path_to_root": path_to_root,
        "ic": {
            "omim": float(t.information_content.omim),
            "gene": float(t.information_content.gene),
            "orpha": float(t.information_content.orpha),
        },
        "longest_path_to_root":   t.longest_path_to_root(),
        "shortest_path_to_root":  t.shortest_path_to_root(),
        "longest_path_to_bottom": t.longest_path_to_bottom(),
        "genes":  [{"name": g.name, "id": g.id} for g in sorted(t.genes, key=lambda g: g.name)[:30]],
        "omim_diseases": [{"id": d.id, "name": d.name} for d in sorted(t.omim_diseases, key=lambda d: d.id)[:30]],
    }
```

### Endpoint: serialize / save

```python
@app.post("/api/serialize")
def serialize_profile(body: TermsInput):
    ont = get_ontology()
    terms = [ont.get_hpo_object(q) for q in body.queries if _safe_get(ont, q)]
    hposet = pyhpo.HPOSet(terms)
    return {"serialized": hposet.serialize()}

@app.post("/api/deserialize")
def deserialize_profile(serialized: str):
    hposet = pyhpo.HPOSet.from_serialized(serialized)
    return {"terms": [{"id": t.id, "name": t.name} for t in hposet]}
```

---

## Frontend — React hooks (`frontend/src/hooks/useAPI.js`)

```javascript
import { useQuery, useMutation } from "@tanstack/react-query";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const post = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

const get = async (path, params = {}) => {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${BASE}${path}${qs ? "?" + qs : ""}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

// Resolve HPO terms
export const useResolveTerms = () =>
  useMutation({ mutationFn: (queries) => post("/api/resolve", { queries }) });

// IC profile
export const useICProfile = () =>
  useMutation({ mutationFn: (queries) => post("/api/ic-profile", { queries }) });

// Disease enrichment
export const useEnrichment = () =>
  useMutation({ mutationFn: ({ queries, source, top_n }) =>
    post("/api/enrichment", { queries, source, top_n }) });

// Patient similarity
export const useSimilarity = () =>
  useMutation({ mutationFn: ({ patient1, patient2, kind, method, combine }) =>
    post("/api/similarity", { patient1, patient2, kind, method, combine }) });

// Variant prioritizer
export const useVariantPrioritize = () =>
  useMutation({ mutationFn: ({ hpo_queries, candidate_genes }) =>
    post("/api/variant-prioritize", { hpo_queries, candidate_genes }) });

// Disease deep-dive
export const useDisease = (query, source) =>
  useQuery({ queryKey: ["disease", query, source],
    queryFn: () => get("/api/disease", { query, source }),
    enabled: !!query });

// HPO term explorer
export const useTerm = (query) =>
  useQuery({ queryKey: ["term", query],
    queryFn: () => get("/api/term", { query }),
    enabled: !!query });

// Serialize
export const useSerialize = () =>
  useMutation({ mutationFn: (queries) => post("/api/serialize", { queries }) });
```

---

## Frontend — wiring each module to the API

Replace all `useState(false) + static sample data` patterns in the JSX file with real API calls.

### Pattern for each module

```jsx
import { useEnrichment } from "../hooks/useAPI";

function ModuleDDX() {
  const [terms, setTerms] = useState("");
  const [source, setSource] = useState("omim");
  const mutation = useEnrichment();

  const handleRun = () => {
    const queries = terms.split("\n").map(l => l.trim()).filter(Boolean);
    mutation.mutate({ queries, source, top_n: 20 });
  };

  return (
    <div>
      {/* inputs */}
      <Textarea value={terms} onChange={e => setTerms(e.target.value)} />
      <CTA onClick={handleRun} disabled={mutation.isPending}>
        {mutation.isPending ? "Running…" : "Run diagnosis"}
      </CTA>

      {/* error */}
      {mutation.isError && (
        <div style={{ color: C.red, fontSize: 13, marginTop: 8 }}>
          {mutation.error.message}
        </div>
      )}

      {/* results */}
      {mutation.data && (
        <ResultTable
          headers={["#", "Disease", "ID", "Count", "p-value", "Signal"]}
          rows={mutation.data.results.map((d, i) => [
            d.rank,
            d.name,
            <Pill key={i}>{d.id}</Pill>,
            d.count,
            d.enrichment.toFixed(4),
            <ScoreBar key={i} pct={scoreWidth(mutation.data.results, i)} />,
          ])}
        />
      )}
    </div>
  );
}
```

Apply the same pattern to every module. Each module maps 1:1 to one API endpoint.

---

## Workflow — wiring steps to API

Each step in `WorkflowView` should call the API and pass data forward via `stepData`:

```jsx
// Step 1 → POST /api/resolve
// Step 2 → POST /api/ic-profile (using step 1 resolved IDs)
// Step 3 → POST /api/enrichment (omim)
// Step 4 → POST /api/enrichment (gene) cross-ref with VCF genes
// Step 5 → POST /api/similarity (patient vs cohort)
// Step 6 → GET  /api/disease + POST /api/similarity (disease vs patient)
// Step 7 → POST /api/serialize + localStorage.setItem(caseId, serialized)
```

For Step 5 (cohort), pass the current patient's resolved IDs as `patient1` and each cohort member as `patient2` in parallel:

```javascript
const cohortScores = await Promise.all(
  cohortPatients.map(p =>
    post("/api/similarity", { patient1: resolvedIds, patient2: p.hpo_ids, kind: "omim", method: "resnik", combine: "BMA" })
  )
);
```

---

## Session persistence (Step 7)

```javascript
// Save
const serialized = await post("/api/serialize", { queries: resolvedIds });
const session = { id: caseId, date: new Date().toISOString(), serialized: serialized.serialized,
  top_disease: diseases[0]?.name, top_gene: genes[0]?.gene };
const existing = JSON.parse(localStorage.getItem("hpo_sessions") || "[]");
localStorage.setItem("hpo_sessions", JSON.stringify([session, ...existing].slice(0, 20)));

// Load
const sessions = JSON.parse(localStorage.getItem("hpo_sessions") || "[]");

// Deserialize
const r = await post("/api/deserialize", { serialized: session.serialized });
// r.terms → resolved HPO term list, feed back into Step 1
```

---

## Performance notes

- `get_ontology()` and `get_enrichment_model()` are `@lru_cache` — they load once per process. On cold start, loading takes ~3–5s. Add a `/api/health` endpoint that returns `{"status": "ready", "terms": len(ont)}` and show a loading overlay on the frontend until it responds.
- For the cohort analysis pairwise matrix with N > 10 patients, run the similarity calls in a `ThreadPoolExecutor(max_workers=4)` on the backend.
- The `EnrichmentModel` stores all annotation sets in memory. Cache all 4 (`omim`, `gene`, `orpha`, `decipher`) at startup with `@app.on_event("startup")`.

```python
@app.on_event("startup")
async def warm_cache():
    get_ontology()
    for cat in ["omim", "gene", "orpha", "decipher"]:
        get_enrichment_model(cat)
```

---

## Quick start commands

```bash
# Backend
cd backend
pip install fastapi uvicorn pyhpo scipy pandas
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm create vite@latest . -- --template react
npm install @tanstack/react-query
npm run dev
```

Set `VITE_API_URL=http://localhost:8000` in `frontend/.env`.

---

## Modules checklist

All 10 modules below must be wired to their API endpoint before shipping.

| Module | JSX file | API endpoint | PyHPO call | Status |
|---|---|---|---|---|
| 7-Step Workflow | WorkflowView.jsx | multiple | all | wire to API |
| Differential Diagnosis | DDX.jsx | POST /api/enrichment | EnrichmentModel("omim") | wire to API |
| Patient Similarity | PatientSimilarity.jsx | POST /api/similarity | HPOSet.similarity() | wire to API |
| Gene Enrichment | GeneEnrichment.jsx | POST /api/enrichment?source=gene | HPOEnrichment | wire to API |
| Cohort Analysis | CohortAnalysis.jsx | POST /api/similarity (parallel) | HPOSet.similarity() × N | wire to API |
| Variant Prioritizer | VariantPrioritizer.jsx | POST /api/variant-prioritize | EnrichmentModel("gene") | wire to API |
| Disease Deep-Dive | DiseaseDeepDive.jsx | GET /api/disease | disease.hpo_set() | wire to API |
| HPO Term Explorer | HPOTermExplorer.jsx | GET /api/term | Ontology.get_hpo_object() | wire to API |
| IC Profiler | ICProfiler.jsx | POST /api/ic-profile | term.information_content | wire to API |
| Report Builder | ReportBuilder.jsx | all of above combined | all | wire to API |
