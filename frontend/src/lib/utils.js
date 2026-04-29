/** Hover text for the “Signal” column (native `title` on the bar). */
export const SIGNAL_TOOLTIP = {
  diagnostic:
    "How rows are ranked (server): (1) semantic similarity — Resnik with funSimAvg in the patient→entity direction only (each patient term scored against the entity’s HPO set, then averaged; avoids BMA’s bidirectional penalty on large annotation sets); (2) coverage = exact overlapping terms ÷ number of your terms; (3) overlap count as a tiebreaker. " +
    "How this bar is drawn (UI only): in result tables, similarity is scaled between the lowest and highest similarity on this page (8–100% bar width). In compact gene/variant rows, the bar is similarity ÷ the strongest similarity in that list (0–100%). The bar never mixes coverage or overlap and does not change server rank.",
  research:
    "How rows are ranked (server): hypergeometric enrichment p-value (stronger association to your HPO profile = smaller p-value, listed first). " +
    "How this bar is drawn (UI only): in tables, p-values are min–max scaled so smaller p-values yield a longer bar (8–100%). In compact variant rows, the bar uses 1 − (p ÷ the largest p in the list). The bar does not change server rank.",
};

/** Hover for gene-list → enriched HPO terms (hypergeom only). */
export const SIGNAL_TOOLTIP_GENE_HPO =
  "Hypergeometric enrichment of HPO terms across your gene list. Bar length maps enrichment scores in this table so stronger enrichment (typically lower p-value) shows a longer bar (8–100%).";

/** Per-column `title` text (header + whole cell) for POST /api/enrichment tables. */
export const ENRICHMENT_COLUMN_HELP = {
  diagnostic: [
    "Rank: order returned by the server — higher similarity first, then higher coverage, then larger overlap.",
    "Name of the disease or gene from the PyHPO ontology.",
    "Identifier for the selected source (e.g. OMIM id).",
    "Similarity: PyHPO HPOSet.similarity(patient, entity, kind=OMIM IC by default, method=Resnik, combine=funSimAvg). Patient→entity only: for each patient term, best Resnik match into the entity’s annotations, then averaged across patient terms. Higher = better phenotypic fit for diagnosis.",
    "Coverage: (number of your patient HPO terms that appear exactly in the entity’s annotation set) divided by the number of terms in your cleaned patient set. Shown as a percentage; equals overlap ÷ patient term count.",
    "Overlap: count of your patient HPO terms that have an exact ID match in the entity’s HPO annotations.",
    SIGNAL_TOOLTIP.diagnostic,
  ],
  research: [
    "Rank: strongest hypergeometric hit first (smallest p-value among returned rows).",
    "Name of the disease or gene from the PyHPO ontology.",
    "Identifier for the selected source (e.g. OMIM id).",
    "Count: how many of your patient HPO terms overlap the entity’s annotations — used as the overlap statistic in the hypergeometric enrichment test.",
    "p-value: hypergeometric enrichment from PyHPO EnrichmentModel; smaller = stronger association between your HPO profile and this entity than expected by chance.",
    SIGNAL_TOOLTIP.research,
  ],
};

/** Per-column help for POST /api/variant-prioritize tables (headers must match column count). */
export const VARIANT_COLUMN_HELP = {
  diagnostic: [
    "Rank: order among your submitted genes after server scoring (similarity, then coverage, then overlap).",
    "Gene symbol (HGNC) resolved in the ontology.",
    "Similarity: same as DDx — Resnik + funSimAvg (patient→gene) vs this gene’s annotated HPO terms (IC from OMIM by default).",
    "Coverage: overlapping HPO term count ÷ number of terms in your cleaned patient set.",
    "Overlap: exact count of your patient HPO terms found on this gene.",
    "Match / No overlap: whether the gene shares at least one exact HPO term with the patient (server field has_match).",
    SIGNAL_TOOLTIP.diagnostic,
  ],
  research: [
    "Rank among your candidates after filtering genome-wide hypergeometric results to your gene list.",
    "Gene symbol.",
    "p-value: hypergeometric enrichment score for this gene vs your HPO profile (from PyHPO).",
    SIGNAL_TOOLTIP.research,
  ],
};

/** Gene → HPO term enrichment table (hypergeom). */
export const GENE_HPO_COLUMN_HELP = [
  "Rank by enrichment strength in this result set.",
  "HPO term label.",
  "HPO identifier (HP:…).",
  "Count: how many genes in your list are annotated with this term (used in the test).",
  "Enrichment: hypergeometric p-value from HPOEnrichment across your gene list.",
  SIGNAL_TOOLTIP_GENE_HPO,
];

export function linesToQueries(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Map a numeric field on each row to 8–100 bar width for ScoreBar.
 * @param {object[]} results
 * @param {string | { key?: string; higherIsBetter?: boolean }} [keyOrOpts]
 *   String: field name (default `"enrichment"`). Lower values → wider bar unless `higherIsBetter`.
 *   Object: `{ key, higherIsBetter }` — e.g. `{ key: "similarity", higherIsBetter: true }`.
 */
export function scoreWidths(results, keyOrOpts = "enrichment") {
  let key = "enrichment";
  let higherIsBetter = false;
  if (typeof keyOrOpts === "object" && keyOrOpts !== null && !Array.isArray(keyOrOpts)) {
    key = keyOrOpts.key ?? "enrichment";
    higherIsBetter = keyOrOpts.higherIsBetter ?? false;
  } else if (typeof keyOrOpts === "string") {
    key = keyOrOpts;
  }

  const vals = results.map((r) => r[key]).filter((v) => Number.isFinite(v));
  if (!vals.length) return results.map(() => 8);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return results.map((r) => {
    const v = r[key];
    if (!Number.isFinite(v)) return 8;
    if (hi === lo) return 50;
    const t = (v - lo) / (hi - lo);
    const widthFrac = higherIsBetter ? t : 1 - t;
    return 8 + widthFrac * 92;
  });
}
