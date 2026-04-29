import { useState, useCallback, useEffect } from "react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import {
  useResolveTerms,
  useICProfile,
  useEnrichment,
  useSimilarity,
  useVariantPrioritize,
  useGeneHPO,
  useCohort,
  useSerialize,
  useTerm,
  useDisease,
  useHealth,
  scoreWidths,
  API_BASE,
  apiPost,
} from "./hooks/useAPI";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// ─── DESIGN TOKENS — blue/white clinical theme ────────────────────────────────
const C = {
  // backgrounds
  pageBg:    "#F0F4FA",
  surface:   "#FFFFFF",
  surfaceAlt:"#F7F9FD",
  card:      "#FFFFFF",
  sidebarBg: "#0F2A52",
  sidebarDeep:"#0A1E3D",

  // blue scale
  blue900:   "#0F2A52",
  blue700:   "#185FA5",
  blue500:   "#2E7DD1",
  blue400:   "#378ADD",
  blue200:   "#B5D4F4",
  blue100:   "#DAE9FA",
  blue50:    "#EFF5FC",

  // accent
  accent:    "#2563EB",
  accentSoft:"rgba(37,99,235,0.09)",
  accentMid: "rgba(37,99,235,0.18)",

  // text
  text:      "#0F172A",
  textSub:   "#475569",
  textMuted: "#94A3B8",
  textOnDark:"#E2EAF4",
  textMutedDark:"#7B9DC4",

  // semantic
  green:     "#16A34A",
  greenSoft: "rgba(22,163,74,0.10)",
  amber:     "#D97706",
  amberSoft: "rgba(217,119,6,0.10)",
  red:       "#DC2626",
  redSoft:   "rgba(220,38,38,0.10)",

  // borders
  border:    "#E2E8F0",
  borderMid: "#CBD5E1",
  mono:      "'DM Mono','Fira Code',monospace",
  sans:      "'DM Sans',system-ui,sans-serif",
};

// ─── NAV STRUCTURE ────────────────────────────────────────────────────────────
const NAV = [
  {
    group: "Guided workflow",
    items: [
      { key: "workflow", label: "7-Step Workflow", icon: "◈", badge: "guided" },
    ],
  },
  {
    group: "Individual modules",
    items: [
      { key: "ddx",      label: "Differential Diagnosis", icon: "⬡" },
      { key: "similarity",label: "Patient Similarity",    icon: "◎" },
      { key: "gene",     label: "Gene Enrichment",        icon: "◈" },
      { key: "cohort",   label: "Cohort Analysis",        icon: "⬢" },
      { key: "variant",  label: "Variant Prioritizer",    icon: "◇" },
      { key: "disease",  label: "Disease Deep-Dive",      icon: "▣" },
      { key: "explorer", label: "HPO Term Explorer",      icon: "◉" },
    ],
  },
  {
    group: "New modules",
    items: [
      { key: "ic",       label: "IC Profiler",            icon: "★", badge: "new" },
      { key: "report",   label: "Report Builder",         icon: "★", badge: "new" },
    ],
  },
];

const WORKFLOW_STEPS = [
  { id:1, label:"Enter phenotypes",       api:"HPOSet.from_queries()"         },
  { id:2, label:"IC specificity check",   api:"term.information_content"      },
  { id:3, label:"Disease ranking",        api:"HPOSet.similarity vs OMIM (diagnostic)" },
  { id:4, label:"Gene ranking",           api:"HPOSet.similarity vs genes (diagnostic)" },
  { id:5, label:"Cohort matching",        api:"HPOSet.similarity()"           },
  { id:6, label:"Validate disease profile",api:"disease.hpo_set.similarity()" },
  { id:7, label:"Save & retrieve",        api:"hposet.serialize()"            },
];

const SIGNAL_TOOLTIP = {
  diagnostic:
    "How rows are ranked (server): (1) semantic similarity — Resnik with funSimAvg in the patient→entity direction only (each patient term scored against the entity’s HPO set, then averaged; avoids BMA’s bidirectional penalty on large annotation sets); (2) coverage = exact overlapping terms ÷ number of your terms; (3) overlap count as a tiebreaker. " +
    "How this bar is drawn (UI only): in result tables, similarity is scaled between the lowest and highest similarity on this page (8–100% bar width). In compact gene/variant rows, the bar is similarity ÷ the strongest similarity in that list (0–100%). The bar never mixes coverage or overlap and does not change server rank.",
  research:
    "How rows are ranked (server): hypergeometric enrichment p-value (stronger association to your HPO profile = smaller p-value, listed first). " +
    "How this bar is drawn (UI only): in tables, p-values are min–max scaled so smaller p-values yield a longer bar (8–100%). In compact variant rows, the bar uses 1 − (p ÷ the largest p in the list). The bar does not change server rank.",
};

const SIGNAL_TOOLTIP_GENE_HPO =
  "Hypergeometric enrichment of HPO terms across your gene list. Bar length maps enrichment scores in this table so stronger enrichment (typically lower p-value) shows a longer bar.";

const ENRICHMENT_COLUMN_HELP = {
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

const VARIANT_COLUMN_HELP = {
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

const GENE_HPO_COLUMN_HELP = [
  "Rank by enrichment strength in this result set.",
  "HPO term label.",
  "HPO identifier (HP:…).",
  "Count: how many genes in your list are annotated with this term (used in the test).",
  "Enrichment: hypergeometric p-value from HPOEnrichment across your gene list.",
  SIGNAL_TOOLTIP_GENE_HPO,
];

// ─── SHARED PRIMITIVES ────────────────────────────────────────────────────────
const s = {
  card: {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 12,
    padding: "16px 18px",
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: ".07em",
    textTransform: "uppercase",
    color: C.textMuted,
    marginBottom: 10,
    fontFamily: C.sans,
  },
  label: {
    fontSize: 11,
    color: C.textMuted,
    marginBottom: 4,
    fontFamily: C.sans,
  },
};

function Badge({ children, variant = "default" }) {
  const map = {
    default: { bg: C.blue50,    color: C.blue700  },
    accent:  { bg: C.accentSoft,color: C.accent   },
    green:   { bg: C.greenSoft, color: C.green    },
    amber:   { bg: C.amberSoft, color: C.amber    },
    red:     { bg: C.redSoft,   color: C.red      },
    new:     { bg: "#EEF2FF",   color: "#4F46E5"  },
    guided:  { bg: "#FFF7ED",   color: "#C2410C"  },
  };
  const c = map[variant] || map.default;
  return (
    <span style={{ background: c.bg, color: c.color, fontSize: 9, fontWeight: 700,
      padding: "2px 7px", borderRadius: 20, letterSpacing: ".05em",
      textTransform: "uppercase", fontFamily: C.sans }}>
      {children}
    </span>
  );
}

function Pill({ children, mono = true }) {
  return (
    <span style={{ background: C.blue50, color: C.blue700, fontSize: 11,
      padding: "2px 8px", borderRadius: 5, fontFamily: mono ? C.mono : C.sans,
      border: `1px solid ${C.blue100}`, display: "inline-block" }}>
      {children}
    </span>
  );
}

function ScoreBar({ pct, color = C.accent, title }) {
  return (
    <div
      title={title}
      style={{
        background: C.blue50,
        borderRadius: 4,
        height: 6,
        minWidth: 80,
        overflow: "hidden",
      }}
    >
      <div style={{ width: `${Math.max(4, Math.min(100, pct))}%`, height: 6,
        background: color, borderRadius: 4, transition: "width .35s ease" }} />
    </div>
  );
}

function Card({ children, style = {} }) {
  return <div style={{ ...s.card, ...style }}>{children}</div>;
}

function MetricCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={s.label}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent || C.text, fontFamily: C.mono, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.accent, marginTop: 4, fontFamily: C.sans }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={s.sectionTitle}>{children}</div>;
}

function CTA({ children, onClick, secondary, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={{
        padding: "9px 20px",
        background: secondary ? C.surface : C.accent,
        color: secondary ? C.accent : "#fff",
        border: secondary ? `1.5px solid ${C.accent}` : "none",
        borderRadius: 8,
        fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 700,
        fontFamily: C.sans,
        transition: "opacity .15s",
        opacity: disabled ? 0.55 : 1,
      }}
      onMouseOver={(e) => {
        if (!disabled) e.currentTarget.style.opacity = ".85";
      }}
      onMouseOut={(e) => {
        if (!disabled) e.currentTarget.style.opacity = "1";
      }}
    >
      {children}
    </button>
  );
}

function Textarea({ value, onChange, rows = 6, placeholder }) {
  return (
    <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows}
      style={{ width: "100%", background: C.surfaceAlt, border: `1px solid ${C.border}`,
        borderRadius: 8, color: C.text, fontFamily: C.mono, fontSize: 12,
        padding: "9px 11px", resize: "none", outline: "none",
        boxSizing: "border-box", lineHeight: 1.6 }} />
  );
}

function Input({ value, onChange, placeholder }) {
  return (
    <input value={value} onChange={onChange} placeholder={placeholder}
      style={{ width: "100%", background: C.surfaceAlt, border: `1px solid ${C.border}`,
        borderRadius: 8, color: C.text, fontFamily: C.sans, fontSize: 13,
        padding: "8px 11px", outline: "none", boxSizing: "border-box" }} />
  );
}

function PageHeader({ title, sub, api }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 3px", fontFamily: C.sans }}>{title}</h2>
      {sub && <p style={{ fontSize: 13, color: C.textSub, margin: "0 0 4px", fontFamily: C.sans }}>{sub}</p>}
      {api && <code style={{ fontSize: 11, color: C.blue500, fontFamily: C.mono }}>{api}</code>}
    </div>
  );
}

function ResultTable({ headers, rows, columnHelp }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th
              key={`${String(h)}-${i}`}
              title={columnHelp?.[i]}
              style={{ textAlign: "left", fontSize: 10, color: C.textMuted, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: ".06em", padding: "6px 8px",
                borderBottom: `1px solid ${C.border}`, fontFamily: C.sans }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ background: i === 0 ? C.accentSoft : "transparent" }}>
            {row.map((cell, j) => (
              <td key={j} title={columnHelp?.[j]} style={{ padding: "8px 8px", borderBottom: `1px solid ${C.border}`,
                color: C.text, verticalAlign: "middle", fontFamily: C.sans }}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ICBand({ ic }) {
  if (ic >= 2.0) return <Badge variant="green">Very high</Badge>;
  if (ic >= 1.5) return <Badge variant="accent">High</Badge>;
  if (ic >= 0.8) return <Badge variant="amber">Medium</Badge>;
  return <Badge>Low</Badge>;
}

function ApiState({ mutation, loadingText = "Running analysis…" }) {
  if (mutation.isPending)
    return (
      <div style={{ padding: "16px", color: C.textMuted, fontSize: 13, fontFamily: C.sans }}>{loadingText}</div>
    );
  if (mutation.isError)
    return (
      <div
        style={{
          padding: "12px 14px",
          background: C.redSoft,
          border: `1px solid ${C.red}`,
          borderRadius: 8,
          color: C.red,
          fontSize: 13,
          fontFamily: C.sans,
        }}
      >
        {mutation.error?.message || "Request failed"}
      </div>
    );
  return null;
}

// ─── WORKFLOW STEPS ───────────────────────────────────────────────────────────
function WFStep1({ onComplete }) {
  const [raw, setRaw] = useState("");
  const mut = useResolveTerms();
  const resolved = mut.data?.resolved ?? [];
  const failed = mut.data?.failed ?? [];

  const handleResolve = () => {
    const queries = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!queries.length) return;
    mut.mutate({ queries, remove_modifiers: false, replace_obsolete: true });
  };

  const handleClean = () => {
    const queries = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!queries.length) return;
    mut.mutate({ queries, remove_modifiers: true, replace_obsolete: true });
  };

  return (
    <div>
      <SectionTitle>PyHPO: HPOSet.from_queries() · remove_modifier() · replace_obsolete()</SectionTitle>
      <ApiState mutation={mut} loadingText="Resolving terms…" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>HPO term input</div>
          <Textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={7} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <CTA onClick={handleResolve} disabled={mut.isPending}>
              {mut.isPending ? "Resolving…" : "Resolve terms"}
            </CTA>
            {resolved.length > 0 && (
              <CTA secondary onClick={handleClean} disabled={mut.isPending}>
                Remove modifiers
              </CTA>
            )}
          </div>
        </Card>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>
            Resolved {resolved.length > 0 && <Badge variant="accent">{resolved.length} terms</Badge>}
          </div>
          {resolved.length === 0 ? (
            <div style={{ color: C.textMuted, fontSize: 13, paddingTop: 16 }}>Click &quot;Resolve terms&quot; to validate…</div>
          ) : (
            resolved.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: C.surfaceAlt,
                  borderRadius: 8,
                  padding: "7px 10px",
                  marginBottom: 6,
                }}
              >
                <Pill>{t.id}</Pill>
                <span style={{ fontSize: 13, flex: 1, color: C.text }}>{t.name}</span>
                <Badge variant="green">valid</Badge>
              </div>
            ))
          )}
          {failed.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: C.amber }}>
              {failed.length} term(s) not found: {failed.join(", ")}
            </div>
          )}
        </Card>
      </div>
      {resolved.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <CTA onClick={() => onComplete({ terms: resolved })}>Continue to IC check →</CTA>
        </div>
      )}
    </div>
  );
}

function WFStep2({ state, onComplete }) {
  const mut = useICProfile();

  useEffect(() => {
    if (state?.terms?.length) {
      mut.mutate({ queries: state.terms.map((t) => t.id) });
    }
  }, [state?.terms]);

  const terms = mut.data?.terms ?? [];
  const summary = mut.data?.set_summary ?? {};
  const mean = summary.mean != null ? summary.mean.toFixed(3) : "—";
  const maxIc = summary.max ?? 0;
  const sorted = [...terms].sort((a, b) => b.ic_omim - a.ic_omim);
  const high = terms.filter((t) => t.ic_omim >= 1.5).length;
  const icBarColor = (ic) => (ic >= 2.0 ? C.green : ic >= 1.5 ? C.accent : ic >= 0.8 ? C.amber : C.textMuted);

  return (
    <div>
      <SectionTitle>PyHPO: term.information_content.omim · hposet.information_content()</SectionTitle>
      <ApiState mutation={mut} loadingText="Computing IC profile…" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
        <MetricCard label="Mean IC (OMIM)" value={mean} sub="High specificity" accent={C.accent} />
        <MetricCard label="Max IC" value={Number(maxIc).toFixed(2)} />
        <MetricCard label="Total IC" value={summary.total != null ? summary.total.toFixed(2) : "—"} />
        <MetricCard
          label="High-IC terms"
          value={terms.length ? `${high}/${terms.length}` : "—"}
          sub="IC ≥ 1.5"
          accent={C.accent}
        />
      </div>
      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>Per-term information content</div>
        {sorted.length === 0 ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>No data yet.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Term", "Depth", "IC bar", "IC value", "Band"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      fontSize: 10,
                      color: C.textMuted,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                      padding: "5px 6px",
                      borderBottom: `1px solid ${C.border}`,
                      fontFamily: C.sans,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.id}>
                  <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 13, color: C.text, fontWeight: 500 }}>{t.name}</div>
                    <div style={{ fontSize: 10, color: C.textMuted, fontFamily: C.mono }}>{t.id}</div>
                  </td>
                  <td
                    style={{
                      padding: "8px 6px",
                      borderBottom: `1px solid ${C.border}`,
                      fontFamily: C.mono,
                      fontSize: 12,
                      color: C.textSub,
                    }}
                  >
                    {t.depth}
                  </td>
                  <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, minWidth: 90 }}>
                    <ScoreBar pct={maxIc > 0 ? (t.ic_omim / maxIc) * 100 : 0} color={icBarColor(t.ic_omim)} />
                  </td>
                  <td
                    style={{
                      padding: "8px 6px",
                      borderBottom: `1px solid ${C.border}`,
                      fontFamily: C.mono,
                      fontSize: 12,
                      fontWeight: 700,
                      color: C.text,
                    }}
                  >
                    {t.ic_omim.toFixed(3)}
                  </td>
                  <td style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>
                    <ICBand ic={t.ic_omim} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {sorted.length >= 2 && (
        <Card style={{ background: C.accentSoft, border: `1px solid ${C.blue200}`, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 4 }}>Profile interpretation</div>
          <div style={{ fontSize: 13, color: C.text }}>
            <b>{sorted[0].name}</b> (IC {sorted[0].ic_omim.toFixed(3)}) and <b>{sorted[1].name}</b> (IC{" "}
            {sorted[1].ic_omim.toFixed(3)}) are highly specific.{" "}
            <span style={{ color: C.textSub }}>
              {sorted[sorted.length - 1].name} (IC {sorted[sorted.length - 1].ic_omim.toFixed(3)}) contributes less
              diagnostic weight.
            </span>
          </div>
        </Card>
      )}
      <CTA disabled={!terms.length} onClick={() => onComplete({ terms: state?.terms, icMean: mean })}>
        Continue to disease enrichment →
      </CTA>
    </div>
  );
}

function WFStep3({ state, onComplete }) {
  const mut = useEnrichment();

  useEffect(() => {
    if (state?.terms?.length) {
      mut.mutate({ queries: state.terms.map((t) => t.id), source: "omim", top_n: 10, mode: "diagnostic" });
    }
  }, [state?.terms]);

  const diseases = mut.data?.results ?? [];
  const isResearch = mut.data?.mode === "research";
  const widths = isResearch
    ? scoreWidths(
        diseases.map((d) => d.enrichment),
        { lowerIsBetter: true },
      )
    : scoreWidths(
        diseases.map((d) => d.similarity),
        { lowerIsBetter: false },
      );

  return (
    <div>
      <SectionTitle>PyHPO: diagnostic disease ranking · HPOSet.similarity vs OMIM (mode=diagnostic)</SectionTitle>
      <ApiState mutation={mut} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
        <MetricCard
          label="Top disease"
          value={diseases[0]?.name ?? "—"}
          sub={
            diseases[0]
              ? isResearch
                ? `p = ${diseases[0].enrichment.toExponential(2)}`
                : `sim = ${diseases[0].similarity.toFixed(3)}`
              : ""
          }
          accent={C.accent}
        />
        <MetricCard
          label="Terms matched"
          value={diseases[0] ? `${isResearch ? diseases[0].count : diseases[0].overlap}/${mut.data?.hposet_size ?? "—"}` : "—"}
          sub={isResearch ? "hypergeom overlap" : "exact overlap / patient"}
          accent={C.green}
        />
        <MetricCard label="Candidates" value={String(diseases.length)} sub="OMIM source" />
      </div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>Ranked differential diagnoses</div>
        {diseases.length === 0 ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>Run ranking from step 1 terms…</div>
        ) : (
          <ResultTable
            headers={
              isResearch
                ? ["#", "Disease", "OMIM ID", "Count", "p-value", "Signal"]
                : ["#", "Disease", "OMIM ID", "Similarity", "Coverage", "Overlap", "Signal"]
            }
            rows={diseases.map((d, i) => [
              <span
                key={`r-${i}`}
                style={{
                  fontSize: 12,
                  color: i === 0 ? C.accent : C.textMuted,
                  fontFamily: C.mono,
                  fontWeight: 700,
                }}
              >
                {d.rank}
              </span>,
              <span key={`n-${i}`} style={{ fontWeight: i === 0 ? 700 : 400 }}>
                {d.name}
              </span>,
              <Pill key={`p-${i}`}>{d.id}</Pill>,
              ...(isResearch
                ? [
                    <span key={`c-${i}`} style={{ fontFamily: C.mono }}>{d.count}</span>,
                    <span key={`e-${i}`} style={{ fontFamily: C.mono, color: i === 0 ? C.accent : C.textSub }}>
                      {d.enrichment.toFixed(4)}
                    </span>,
                  ]
                : [
                    <span key={`s-${i}`} style={{ fontFamily: C.mono }}>{d.similarity.toFixed(4)}</span>,
                    <span key={`v-${i}`} style={{ fontFamily: C.mono }}>{`${(d.coverage * 100).toFixed(0)}%`}</span>,
                    <span key={`o-${i}`} style={{ fontFamily: C.mono }}>{d.overlap}</span>,
                  ]),
              <ScoreBar
                key={`b-${i}`}
                pct={widths[i] ?? 8}
                color={i === 0 ? C.accent : C.textMuted}
                title={isResearch ? SIGNAL_TOOLTIP.research : SIGNAL_TOOLTIP.diagnostic}
              />,
            ])}
            columnHelp={isResearch ? ENRICHMENT_COLUMN_HELP.research : ENRICHMENT_COLUMN_HELP.diagnostic}
          />
        )}
      </Card>
      <CTA disabled={!diseases.length} onClick={() => onComplete({ diseases })}>
        Continue to gene prioritisation →
      </CTA>
    </div>
  );
}

function WFStep4({ state, onComplete }) {
  const mut = useEnrichment();

  useEffect(() => {
    if (state?.terms?.length) {
      mut.mutate({ queries: state.terms.map((t) => t.id), source: "gene", top_n: 15, mode: "diagnostic" });
    }
  }, [state?.terms]);

  const genes = mut.data?.results ?? [];
  const isResearch = mut.data?.mode === "research";
  const maxP = genes.length ? Math.max(...genes.map((g) => g.enrichment)) : 1;
  const maxSim = genes.length ? Math.max(...genes.map((g) => g.similarity ?? 0)) : 1;
  const pColor = (s) => (s < 0.001 ? C.green : s < 0.01 ? C.accent : C.amber);
  const pLabel = (s) => (s < 0.001 ? "P1" : s < 0.01 ? "P2" : "P3");
  const pVariant = (s) => (s < 0.001 ? "green" : s < 0.01 ? "accent" : "amber");
  const simColor = (s) => (s >= 0.65 ? C.green : s >= 0.45 ? C.accent : C.amber);
  const simLabel = (s) => (s >= 0.65 ? "S1" : s >= 0.45 ? "S2" : "S3");
  const simVariant = (s) => (s >= 0.65 ? "green" : s >= 0.45 ? "accent" : "amber");

  return (
    <div>
      <SectionTitle>PyHPO: diagnostic gene ranking · HPOSet.similarity vs genes (mode=diagnostic)</SectionTitle>
      <ApiState mutation={mut} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
        <MetricCard
          label="Top gene"
          value={genes[0]?.name ?? "—"}
          sub={
            genes[0]
              ? isResearch
                ? `${genes[0].count} terms`
                : `${(genes[0].coverage * 100).toFixed(0)}% cov · ${genes[0].overlap} overlap`
              : ""
          }
          accent={C.green}
        />
        <MetricCard label="Gene hits" value={String(genes.length)} sub={isResearch ? "hypergeom rows" : "similarity-ranked"} />
        <MetricCard
          label={isResearch ? "Best p-value" : "Best similarity"}
          value={
            genes[0]
              ? isResearch
                ? genes[0].enrichment.toExponential(2)
                : genes[0].similarity.toFixed(4)
              : "—"
          }
          accent={C.accent}
        />
      </div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>Gene priority ranking</div>
        {genes.length === 0 ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>No results.</div>
        ) : (
          genes.map((g, i) => (
            <div
              key={g.id || g.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 9,
                marginBottom: 7,
                background: i === 0 ? C.accentSoft : C.surfaceAlt,
                border: `1px solid ${i === 0 ? C.blue200 : C.border}`,
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  fontFamily: C.mono,
                  color: i === 0 ? C.accent : C.text,
                  minWidth: 64,
                }}
              >
                {g.name}
              </span>
              <div style={{ flex: 1 }}>
                {isResearch ? (
                  <ScoreBar
                    pct={maxP > 0 ? (1 - g.enrichment / maxP) * 100 : 8}
                    color={pColor(g.enrichment)}
                    title={SIGNAL_TOOLTIP.research}
                  />
                ) : (
                  <ScoreBar
                    pct={maxSim > 0 ? (g.similarity / maxSim) * 100 : 8}
                    color={simColor(g.similarity)}
                    title={SIGNAL_TOOLTIP.diagnostic}
                  />
                )}
              </div>
              <span style={{ fontSize: 11, fontFamily: C.mono, color: C.textMuted, minWidth: 52 }}>
                {isResearch ? g.enrichment.toFixed(4) : g.similarity.toFixed(4)}
              </span>
              <span style={{ fontSize: 12, color: C.textMuted }}>
                {isResearch ? `${g.count} terms` : `${g.overlap} / ${mut.data?.hposet_size ?? "—"}`}
              </span>
              {isResearch ? (
                <Badge variant={pVariant(g.enrichment)}>{pLabel(g.enrichment)}</Badge>
              ) : (
                <Badge variant={simVariant(g.similarity)}>{simLabel(g.similarity)}</Badge>
              )}
            </div>
          ))
        )}
      </Card>
      <CTA disabled={!genes.length} onClick={() => onComplete({ genes })}>
        Continue to cohort matching →
      </CTA>
    </div>
  );
}

function WFStep5({ state, onComplete }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!state?.terms?.length) return;
    const sessions = JSON.parse(localStorage.getItem("hpo_sessions") || "[]");
    if (!sessions.length) {
      setResults([]);
      return;
    }
    const patient1 = state.terms.map((t) => t.id);
    setLoading(true);
    setErr(null);
    const chunk = async (sess) => {
      try {
        const des = await apiPost("/api/deserialize", { serialized: sess.serialized });
        const patient2 = (des.terms || []).map((t) => t.id);
        if (!patient2.length) return null;
        const d = await apiPost("/api/similarity", {
          patient1,
          patient2,
          kind: "omim",
          method: "resnik",
          combine: "BMA",
        });
        return {
          id: sess.id,
          sim: d.score,
          dx: sess.top_disease || sess.dx || "—",
          terms: patient2.length,
        };
      } catch {
        return null;
      }
    };
    Promise.all(sessions.slice(0, 8).map(chunk))
      .then((rows) => {
        const ok = rows.filter(Boolean);
        ok.sort((a, b) => b.sim - a.sim);
        setResults(ok);
      })
      .catch((e) => setErr(e.message || "Cohort compare failed"))
      .finally(() => setLoading(false));
  }, [state?.terms]);

  const simColor = (s) => (s >= 0.85 ? C.green : s >= 0.7 ? C.accent : C.textMuted);
  const hasSessions = results.length > 0;

  return (
    <div>
      <SectionTitle>PyHPO: HPOSet.similarity() — patient cohort matching</SectionTitle>
      {loading && (
        <div style={{ padding: "16px", color: C.textMuted, fontSize: 13, fontFamily: C.sans }}>Comparing to saved sessions…</div>
      )}
      {err && (
        <div
          style={{
            padding: "12px 14px",
            background: C.redSoft,
            border: `1px solid ${C.red}`,
            borderRadius: 8,
            color: C.red,
            fontSize: 13,
            marginBottom: 10,
          }}
        >
          {err}
        </div>
      )}
      {!hasSessions && !loading && (
        <div
          style={{
            padding: "20px 24px",
            background: C.surfaceAlt,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>No saved cases to compare against yet</div>
          <div style={{ fontSize: 13, color: C.textSub, lineHeight: 1.6 }}>
            Cohort matching compares this patient against previously saved cases. Complete Step 7 to save this case — it will
            then appear here when you run future patients through the workflow.
          </div>
        </div>
      )}
      {hasSessions && (
        <>
          <Card style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>Similar patients in cohort</div>
            {results.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 9,
                  marginBottom: 7,
                  background: p.sim >= 0.85 ? C.accentSoft : C.surfaceAlt,
                  border: `1px solid ${p.sim >= 0.85 ? C.blue200 : C.border}`,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: p.sim >= 0.85 ? C.accent : C.blue100,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 800,
                    fontFamily: C.mono,
                    color: p.sim >= 0.85 ? "#fff" : C.blue700,
                  }}
                >
                  {String(p.id).slice(-3)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: p.sim >= 0.85 ? 700 : 400, color: C.text }}>{p.id}</div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>
                    Top Dx: {p.dx} · {p.terms} HPO terms
                  </div>
                </div>
                <div style={{ width: 100 }}>
                  <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 3 }}>Similarity</div>
                  <ScoreBar pct={Math.min(100, p.sim * 100)} color={simColor(p.sim)} />
                </div>
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    fontFamily: C.mono,
                    color: simColor(p.sim),
                    minWidth: 38,
                    textAlign: "right",
                  }}
                >
                  {Number(p.sim).toFixed(2)}
                </span>
                {p.sim >= 0.85 && <Badge variant="green">Strong</Badge>}
              </div>
            ))}
          </Card>
          {results.filter((r) => r.sim >= 0.85).length >= 2 && (
            <Card style={{ background: "#EFF6FF", border: `1px solid ${C.blue200}`, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.blue700, marginBottom: 4 }}>Cohort insight</div>
              <div style={{ fontSize: 13, color: C.text }}>
                Multiple strong phenotypic matches (sim ≥ 0.85). Consider joint clinical review or shared gene panel.
              </div>
            </Card>
          )}
        </>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <CTA onClick={() => onComplete({ cohort: results, skipped: false })}>Continue to disease validation →</CTA>
        <CTA secondary onClick={() => onComplete({ cohort: [], skipped: true })}>
          Skip — no cohort comparison
        </CTA>
      </div>
    </div>
  );
}

function WFStep6({ state, onComplete }) {
  const diseaseQuery = state?.topDisease || "";
  const diseaseQ = useDisease(diseaseQuery, "omim");
  const simMut = useSimilarity();

  useEffect(() => {
    if (!state?.terms?.length || !diseaseQ.data?.hpo_terms?.length) return;
    const patient1 = state.terms.map((t) => t.id);
    const patient2 = diseaseQ.data.hpo_terms.map((t) => t.id);
    simMut.mutate({
      patient1,
      patient2,
      kind: "omim",
      method: "resnik",
      combine: "BMA",
      one_way: true,
    });
  }, [diseaseQ.data, state?.terms]);

  const shared = simMut.data?.shared ?? [];
  const miss = simMut.data?.only_in_patient2 ?? [];
  const overlapRows = [...shared.map((t) => ({ ...t, inPt: true })), ...miss.map((t) => ({ ...t, inPt: false }))];
  const matched = shared.length;
  const totalOv = overlapRows.length;
  const sim = simMut.data?.score;
  const dname = diseaseQ.data?.name || diseaseQuery || "—";
  const verdict =
    sim == null ? "—" : sim >= 0.8 ? "Strong" : sim >= 0.5 ? "Moderate" : "Low";

  return (
    <div>
      <SectionTitle>
        PyHPO: disease.hpo_set.similarity(patient) — {dname}
        {diseaseQ.data?.id != null ? ` OMIM:${diseaseQ.data.id}` : ""}
      </SectionTitle>
      <ApiState mutation={simMut} />
      {diseaseQ.isLoading && (
        <div style={{ padding: "12px", color: C.textMuted, fontSize: 13 }}>Loading disease…</div>
      )}
      {diseaseQ.isError && (
        <div style={{ padding: "12px", color: C.red, fontSize: 13 }}>{diseaseQ.error?.message}</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
        <MetricCard
          label="Patient ↔ disease similarity"
          value={sim != null ? sim.toFixed(3) : "—"}
          sub="Resnik · patient→disease (one_way)"
          accent={C.accent}
        />
        <MetricCard
          label="Exact term overlap"
          value={totalOv ? `${matched}/${totalOv}` : "—"}
          sub="shared / disease profile"
          accent={C.green}
        />
        <MetricCard label="Verdict" value={verdict} sub="by score" accent={C.green} />
      </div>
      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>{dname} HPO profile vs patient</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {overlapRows.map((t) => (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 11px",
                borderRadius: 20,
                background: t.inPt ? C.accentSoft : C.surfaceAlt,
                border: `1px solid ${t.inPt ? C.blue200 : C.border}`,
              }}
            >
              <span style={{ fontSize: 12, color: t.inPt ? C.accent : C.textMuted }}>{t.name}</span>
              <span style={{ color: t.inPt ? C.green : C.textMuted, fontSize: 12 }}>{t.inPt ? "✓" : "○"}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: C.textMuted }}>
          <span style={{ color: C.green }}>✓ Blue</span> = shared · <span>○ Gray</span> = in disease only
        </div>
      </Card>
      {sim != null && (
        <Card style={{ background: C.accentSoft, border: `1px solid ${C.blue200}`, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, marginBottom: 4 }}>Validation verdict</div>
          <div style={{ fontSize: 13, color: C.text }}>
            Similarity <b>{sim.toFixed(3)}</b> vs <b>{dname}</b>. Review disease-specific workup per local protocol.
          </div>
        </Card>
      )}
      <CTA
        disabled={sim == null}
        onClick={() => onComplete({ validated: true, disease: dname, similarity: sim })}
      >
        Continue to save & retrieve →
      </CTA>
    </div>
  );
}

function WFStep7({ state }) {
  const serMut = useSerialize();
  const [sessions, setSessions] = useState(() =>
    JSON.parse(typeof localStorage !== "undefined" ? localStorage.getItem("hpo_sessions") || "[]" : "[]"),
  );
  const [caseId, setCaseId] = useState("CASE-" + new Date().toISOString().slice(0, 10));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state?.terms?.length) {
      serMut.mutate({ queries: state.terms.map((t) => t.id) });
    }
  }, [state?.terms]);

  const serialized = serMut.data?.serialized ?? "";
  const simStr =
    typeof state?.similarity === "number"
      ? state.similarity.toFixed(3)
      : state?.similarity != null && state?.similarity !== ""
        ? String(state.similarity)
        : "—";

  const handleSave = () => {
    if (!serialized) return;
    const entry = {
      id: caseId,
      date: new Date().toISOString().slice(0, 10),
      serialized,
      top_disease: state?.topDisease ?? "—",
      top_gene: state?.topGene ?? "—",
      similarity: state?.similarity ?? "—",
      term_count: state?.terms?.length ?? 0,
    };
    const updated = [entry, ...sessions.filter((s) => s.id !== caseId)].slice(0, 20);
    localStorage.setItem("hpo_sessions", JSON.stringify(updated));
    setSessions(updated);
    setSaved(true);
  };

  const metrics = [
    { l: "HPO terms", v: state?.terms?.length ?? "—" },
    { l: "Top disease", v: state?.topDisease ?? "—" },
    { l: "Top gene", v: state?.topGene ?? "—" },
    { l: "Similarity", v: simStr },
  ];

  return (
    <div>
      <SectionTitle>PyHPO: hposet.serialize() · HPOSet.from_serialized() — persistent storage</SectionTitle>
      <ApiState mutation={serMut} loadingText="Serializing profile…" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>Save this session</div>
          <div style={{ marginBottom: 10 }}>
            <div style={s.label}>Case ID</div>
            <Input value={caseId} onChange={(e) => setCaseId(e.target.value)} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={s.label}>Serialized profile (hposet.serialize())</div>
            <div
              style={{
                background: C.blue50,
                border: `1px solid ${C.blue100}`,
                borderRadius: 8,
                padding: "9px 11px",
                fontFamily: C.mono,
                fontSize: 11,
                color: C.accent,
                wordBreak: "break-all",
              }}
            >
              {serialized || "—"}
            </div>
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
              Reload with HPOSet.from_serialized("{serialized || "…"}")
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {metrics.map((m) => (
              <div
                key={m.l}
                style={{ background: C.surfaceAlt, borderRadius: 8, padding: "8px 10px", border: `1px solid ${C.border}` }}
              >
                <div style={{ fontSize: 10, color: C.textMuted }}>{m.l}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.accent, fontFamily: C.mono }}>{m.v}</div>
              </div>
            ))}
          </div>
          <CTA onClick={handleSave} secondary={saved} disabled={!serialized || serMut.isPending}>
            {saved ? "✓ Saved to session" : "Save session"}
          </CTA>
        </Card>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>Saved sessions</div>
          {sessions.length === 0 ? (
            <div style={{ color: C.textMuted, fontSize: 13 }}>No saved sessions yet.</div>
          ) : (
            sessions.map((sess) => (
              <div
                key={sess.id}
                style={{
                  padding: "10px 12px",
                  background: C.surfaceAlt,
                  border: `1px solid ${sess.id === caseId && saved ? C.blue200 : C.border}`,
                  borderRadius: 9,
                  marginBottom: 7,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      fontFamily: C.mono,
                      color: sess.id === caseId && saved ? C.accent : C.text,
                    }}
                  >
                    {sess.id}
                  </span>
                  <span style={{ fontSize: 10, color: C.textMuted }}>{sess.date}</span>
                </div>
                <div style={{ fontSize: 11, color: C.textSub }}>{sess.top_disease || sess.dx || "—"}</div>
                <div
                  style={{
                    fontSize: 10,
                    color: C.textMuted,
                    fontFamily: C.mono,
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {sess.serialized}
                </div>
              </div>
            ))
          )}
          {saved && (
            <div
              style={{
                padding: "10px 12px",
                background: C.accentSoft,
                border: `1px solid ${C.blue200}`,
                borderRadius: 9,
                fontSize: 12,
                color: C.text,
                fontWeight: 600,
              }}
            >
              Workflow complete. All 7 steps executed.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── INDIVIDUAL MODULES ───────────────────────────────────────────────────────
function ModuleDDX() {
  const [terms, setTerms] = useState("");
  const [source, setSource] = useState("omim");
  const [topN, setTopN] = useState(10);
  const [mode, setMode] = useState("diagnostic");
  const mut = useEnrichment();

  const handleRun = () => {
    const queries = terms.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!queries.length) return;
    mut.mutate({ queries, source, top_n: topN, mode });
  };

  const diseases = mut.data?.results ?? [];
  const isResearch = mut.data?.mode === "research";
  const widths = isResearch
    ? scoreWidths(
        diseases.map((d) => d.enrichment),
        { lowerIsBetter: true },
      )
    : scoreWidths(
        diseases.map((d) => d.similarity),
        { lowerIsBetter: false },
      );

  return (
    <div>
      <PageHeader
        title="Differential Diagnosis"
        sub={
          mode === "research"
            ? "Research mode: hypergeometric enrichment (GWAS-style)."
            : "Diagnostic mode: semantic similarity plus coverage of your HPO terms vs OMIM / Orpha / DECIPHER / genes."
        }
        api={
          mode === "research"
            ? "EnrichmentModel(source).enrichment(method='hypergeom', hposet=patient)"
            : "rank_by_similarity(patient_hposet, catalog, sim_kind / sim_method / sim_combine)"
        }
      />
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 120px 160px", gap: 12, alignItems: "end" }}>
          <div>
            <div style={s.label}>HPO terms (one per line)</div>
            <Textarea rows={6} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
          <div>
            <div style={s.label}>Source</div>
            <select value={source} onChange={e => setSource(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`,
                borderRadius: 8, fontSize: 13, color: C.text, background: C.surfaceAlt, fontFamily: C.sans }}>
              <option>omim</option><option>orpha</option><option>decipher</option><option>gene</option>
            </select>
            <div style={{ marginTop: 8 }}>
              <div style={s.label}>Top N: {topN}</div>
              <input type="range" min={5} max={50} value={topN}
                onChange={e => setTopN(+e.target.value)} style={{ width: "100%" }} />
            </div>
          </div>
          <div>
            <div style={s.label}>Analysis mode</div>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                fontSize: 13,
                color: C.text,
                background: C.surfaceAlt,
                fontFamily: C.sans,
              }}
            >
              <option value="diagnostic">Diagnostic (similarity)</option>
              <option value="research">Research (hypergeom)</option>
            </select>
          </div>
          <div>
            <CTA onClick={handleRun} disabled={mut.isPending}>Run diagnosis</CTA>
          </div>
        </div>
      </Card>
      <ApiState mutation={mut} />
      {mut.data && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>
            Ranked differential diagnoses <Badge variant="accent">{source.toUpperCase()}</Badge>{" "}
            <Badge variant="guided">{mut.data.mode}</Badge>
          </div>
          <ResultTable
            headers={
              isResearch
                ? ["#", "Disease", "ID", "Count", "p-value", "Signal"]
                : ["#", "Disease", "ID", "Similarity", "Coverage", "Overlap", "Signal"]
            }
            rows={diseases.map((d, i) => [
              <span key={`rk-${i}`} style={{ fontFamily: C.mono, color: i === 0 ? C.accent : C.textMuted }}>{d.rank}</span>,
              <span key={`nm-${i}`} style={{ fontWeight: i === 0 ? 700 : 400 }}>{d.name}</span>,
              <Pill key={`id-${i}`}>{d.id}</Pill>,
              ...(isResearch
                ? [
                    <span key={`ct-${i}`} style={{ fontFamily: C.mono }}>{d.count}</span>,
                    <span key={`en-${i}`} style={{ fontFamily: C.mono, color: i === 0 ? C.accent : C.textSub }}>
                      {d.enrichment.toFixed(4)}
                    </span>,
                  ]
                : [
                    <span key={`si-${i}`} style={{ fontFamily: C.mono }}>{d.similarity.toFixed(4)}</span>,
                    <span key={`cv-${i}`} style={{ fontFamily: C.mono }}>{`${(d.coverage * 100).toFixed(0)}%`}</span>,
                    <span key={`ov-${i}`} style={{ fontFamily: C.mono }}>{d.overlap}</span>,
                  ]),
              <ScoreBar
                key={`br-${i}`}
                pct={widths[i] ?? 8}
                color={i === 0 ? C.accent : C.textMuted}
                title={isResearch ? SIGNAL_TOOLTIP.research : SIGNAL_TOOLTIP.diagnostic}
              />,
            ])}
            columnHelp={isResearch ? ENRICHMENT_COLUMN_HELP.research : ENRICHMENT_COLUMN_HELP.diagnostic}
          />
        </Card>
      )}
    </div>
  );
}

function ModuleSimilarity() {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [kind, setKind] = useState("omim");
  const [method, setMethod] = useState("resnik");
  const [combine, setCombine] = useState("BMA");
  const mut = useSimilarity();

  const handleRun = () => {
    const patient1 = p1.split("\n").map((l) => l.trim()).filter(Boolean);
    const patient2 = p2.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!patient1.length || !patient2.length) return;
    mut.mutate({ patient1, patient2, kind, method, combine });
  };

  const score = mut.data?.score;
  const shared = mut.data?.shared ?? [];
  const interpret = (x) => (x == null ? "—" : x >= 0.8 ? "Very similar" : x >= 0.5 ? "Moderate" : "Low");

  return (
    <div>
      <PageHeader title="Patient Similarity"
        sub="Compare two HPO term profiles using multiple similarity methods."
        api="HPOSet.similarity(other, kind='omim', method='resnik', combine='BMA')" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Patient 1</div>
          <Textarea rows={6} value={p1} onChange={(e) => setP1(e.target.value)} />
        </Card>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Patient 2</div>
          <Textarea rows={6} value={p2} onChange={(e) => setP2(e.target.value)} />
        </Card>
      </div>
      <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={s.label}>IC kind</div>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            style={{
              padding: "7px 10px",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              fontSize: 13,
              color: C.text,
              background: C.surfaceAlt,
              fontFamily: C.sans,
            }}
          >
            <option>omim</option>
            <option>gene</option>
            <option>orpha</option>
          </select>
        </div>
        <div>
          <div style={s.label}>Method</div>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            style={{
              padding: "7px 10px",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              fontSize: 13,
              color: C.text,
              background: C.surfaceAlt,
              fontFamily: C.sans,
            }}
          >
            <option>resnik</option>
            <option>lin</option>
            <option>jc</option>
            <option>graphic</option>
            <option>dist</option>
          </select>
        </div>
        <div>
          <div style={s.label}>Combine</div>
          <select
            value={combine}
            onChange={(e) => setCombine(e.target.value)}
            style={{
              padding: "7px 10px",
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              fontSize: 13,
              color: C.text,
              background: C.surfaceAlt,
              fontFamily: C.sans,
            }}
          >
            <option>BMA</option>
            <option>funSimAvg</option>
            <option>funSimMax</option>
          </select>
        </div>
        <div style={{ marginTop: 16 }}>
          <CTA onClick={handleRun} disabled={mut.isPending}>
            Compare patients
          </CTA>
        </div>
      </div>
      <ApiState mutation={mut} />
      {mut.data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 12 }}>
            <MetricCard
              label="Similarity score"
              value={score != null ? score.toFixed(4) : "—"}
              sub="Resnik / BMA"
              accent={C.accent}
            />
            <MetricCard label="Interpretation" value={interpret(score)} sub="Phenotypic overlap" />
            <MetricCard label="Exact shared terms" value={String(shared.length)} sub="intersection" />
          </div>
          {shared.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {shared.map((t) => (
                <Pill key={t.id}>
                  {t.id} {t.name}
                </Pill>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ModuleGene() {
  const [genes, setGenes] = useState("");
  const mut = useGeneHPO();

  const handleRun = () => {
    const geneList = genes.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!geneList.length) return;
    mut.mutate({ genes: geneList, min_count: 1, top_n: 80 });
  };

  const results = mut.data?.results ?? [];
  const widths = scoreWidths(
    results.map((r) => r.enrichment),
    { lowerIsBetter: true },
  );

  return (
    <div>
      <PageHeader title="Gene Enrichment"
        sub="Find HPO terms enriched across a set of genes."
        api="HPOEnrichment('gene').enrichment(method='hypergeom', annotation_sets=genes)" />
      <Card style={{ marginBottom: 14 }}>
        <div style={s.label}>Gene symbols (one per line)</div>
        <Textarea rows={5} value={genes} onChange={(e) => setGenes(e.target.value)} />
        <div style={{ marginTop: 10 }}>
          <CTA onClick={handleRun} disabled={mut.isPending}>
            Find enriched HPO terms
          </CTA>
        </div>
      </Card>
      <ApiState mutation={mut} />
      {mut.data && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>Enriched HPO terms</div>
          <ResultTable
            headers={["#", "HPO term", "HP ID", "Count", "Enrichment", "Signal"]}
            columnHelp={GENE_HPO_COLUMN_HELP}
            rows={results.map((r, i) => [
              String(r.rank),
              r.name,
              <Pill key={`${r.id}-pill`}>{r.id}</Pill>,
              String(r.count),
              r.enrichment.toFixed(4),
              <ScoreBar key={`${r.id}-bar`} pct={widths[i] ?? 8} color={C.accent} title={SIGNAL_TOOLTIP_GENE_HPO} />,
            ])}
          />
        </Card>
      )}
    </div>
  );
}

function ModuleCohort() {
  const [patientTexts, setPatientTexts] = useState(["", ""]);
  const mut = useCohort();

  const handleRun = () => {
    const patients = patientTexts
      .map((t) => t.split("\n").map((l) => l.trim()).filter(Boolean))
      .filter((p) => p.length > 0);
    if (patients.length < 2) return;
    mut.mutate({ patients, kind: "omim", method: "resnik", combine: "BMA" });
  };

  const handleAdd = () => setPatientTexts((p) => [...p, ""]);

  const matrix = mut.data?.matrix ?? [];
  const labels = mut.data?.labels ?? [];
  const shared = mut.data?.shared_omim_candidates ?? [];

  const cellColor = (v) => {
    const t = v;
    const r = Math.round(255 - t * (255 - 37));
    const g = Math.round(255 - t * (255 - 99));
    const b = Math.round(255 - t * (255 - 235));
    return `rgb(${r},${g},${b})`;
  };

  return (
    <div>
      <PageHeader title="Cohort Analysis"
        sub="Pairwise patient similarity matrix and shared disease candidates."
        api="HPOSet.similarity() pairwise · EnrichmentModel('omim') per patient" />
      <div style={{ marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        {patientTexts.map((txt, i) => (
          <Card key={i} style={{ minWidth: 160, flex: 1 }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Patient {i + 1}</div>
            <Textarea
              rows={3}
              value={txt}
              onChange={(e) => {
                const v = e.target.value;
                setPatientTexts((prev) => prev.map((p, j) => (j === i ? v : p)));
              }}
            />
          </Card>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <CTA onClick={handleRun} disabled={mut.isPending}>
          Run cohort analysis
        </CTA>
        <CTA secondary onClick={handleAdd}>
          + Add patient
        </CTA>
      </div>
      <ApiState mutation={mut} />
      {mut.data && matrix.length > 0 && (
        <>
          <Card style={{ marginBottom: 14, overflowX: "auto" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>Pairwise similarity matrix</div>
            <table style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ padding: "6px 12px", fontSize: 11, color: C.textMuted }}></th>
                  {labels.map((l) => (
                    <th key={l} style={{ padding: "6px 14px", fontSize: 11, color: C.textMuted, fontFamily: C.mono }}>
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row, i) => (
                  <tr key={labels[i] || i}>
                    <td
                      style={{
                        padding: "6px 12px",
                        fontSize: 12,
                        fontWeight: 700,
                        fontFamily: C.mono,
                        color: C.textSub,
                      }}
                    >
                      {labels[i]}
                    </td>
                    {row.map((v, j) => (
                      <td
                        key={j}
                        style={{
                          padding: "10px 14px",
                          textAlign: "center",
                          fontSize: 13,
                          fontFamily: C.mono,
                          fontWeight: i === j ? 700 : 400,
                          background: cellColor(v),
                          color: v > 0.7 ? "#fff" : C.text,
                          borderRadius: 4,
                        }}
                      >
                        {Number(v).toFixed(3)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>
              Shared disease candidates (top-20 for every patient)
            </div>
            {shared.length === 0 ? (
              <div style={{ fontSize: 13, color: C.textMuted }}>No shared candidates in top-20 for all patients</div>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {shared.map((d) => (
                  <div
                    key={d.omim_id}
                    style={{
                      padding: "6px 14px",
                      background: C.accentSoft,
                      border: `1px solid ${C.blue200}`,
                      borderRadius: 20,
                      fontSize: 12,
                      color: C.accent,
                      fontWeight: 600,
                    }}
                  >
                    {d.name}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function ModuleVariant() {
  const [hpoTerms, setHpoTerms] = useState("");
  const [vcfGenes, setVcfGenes] = useState("");
  const [mode, setMode] = useState("diagnostic");
  const mut = useVariantPrioritize();

  const handleRun = () => {
    const hpo_queries = hpoTerms.split("\n").map((l) => l.trim()).filter(Boolean);
    const candidate_genes = vcfGenes.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!hpo_queries.length || !candidate_genes.length) return;
    mut.mutate({ hpo_queries, candidate_genes, mode });
  };

  const prioritized = mut.data?.prioritized ?? [];
  const missing = mut.data?.missing ?? [];
  const isResearch = mut.data?.mode === "research";
  const maxScore = prioritized.length ? Math.max(...prioritized.map((g) => g.score ?? 0)) : 1;
  const maxSim = prioritized.length ? Math.max(...prioritized.map((g) => g.similarity ?? 0)) : 1;
  const geneLabel = (g) => g.gene ?? g.name ?? "—";

  return (
    <div>
      <PageHeader
        title="Variant Prioritizer"
        sub={
          mode === "research"
            ? "Research mode: hypergeometric gene enrichment restricted to your VCF list."
            : "Diagnostic mode: semantic similarity plus coverage for each candidate gene only."
        }
        api={
          mode === "research"
            ? "EnrichmentModel('gene').enrichment(hypergeom) filtered to candidates"
            : "rank_by_similarity(patient_hposet, candidate_genes)"
        }
      />
      <Card style={{ marginBottom: 14 }}>
        <div style={s.label}>Analysis mode</div>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          style={{
            marginTop: 6,
            maxWidth: 360,
            width: "100%",
            padding: "8px 10px",
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: 13,
            color: C.text,
            background: C.surfaceAlt,
            fontFamily: C.sans,
          }}
        >
          <option value="diagnostic">Diagnostic (similarity)</option>
          <option value="research">Research (hypergeometric)</option>
        </select>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Patient HPO terms</div>
          <Textarea rows={7} value={hpoTerms} onChange={(e) => setHpoTerms(e.target.value)} />
        </Card>
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Candidate genes (VCF)</div>
          <Textarea rows={7} value={vcfGenes} onChange={(e) => setVcfGenes(e.target.value)} />
        </Card>
      </div>
      <CTA onClick={handleRun} disabled={mut.isPending}>
        Prioritize variants
      </CTA>
      <ApiState mutation={mut} />
      {mut.data && (
        <Card style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>
            Prioritized genes <Badge variant="guided">{mut.data.mode}</Badge>
          </div>
          {prioritized.map((g, i) => {
            const pc = isResearch
              ? g.score < 0.001
                ? C.green
                : g.score < 0.01
                  ? C.accent
                  : C.amber
              : (g.similarity ?? 0) >= 0.65
                ? C.green
                : (g.similarity ?? 0) >= 0.45
                  ? C.accent
                  : C.amber;
            const pv = isResearch
              ? g.score < 0.001
                ? "green"
                : g.score < 0.01
                  ? "accent"
                  : "amber"
              : (g.similarity ?? 0) >= 0.65
                ? "green"
                : (g.similarity ?? 0) >= 0.45
                  ? "accent"
                  : "amber";
            const barPct = isResearch
              ? maxScore > 0
                ? (1 - g.score / maxScore) * 100
                : 8
              : maxSim > 0
                ? (g.similarity / maxSim) * 100
                : 8;
            return (
              <div
                key={geneLabel(g) + String(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "9px 12px",
                  borderRadius: 9,
                  marginBottom: 6,
                  background: i === 0 ? C.accentSoft : C.surfaceAlt,
                  border: `1px solid ${i === 0 ? C.blue200 : C.border}`,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    fontFamily: C.mono,
                    color: i === 0 ? C.accent : C.text,
                    minWidth: 64,
                  }}
                >
                  {geneLabel(g)}
                </span>
                <div style={{ flex: 1 }}>
                  <ScoreBar
                    pct={barPct}
                    color={pc}
                    title={isResearch ? SIGNAL_TOOLTIP.research : SIGNAL_TOOLTIP.diagnostic}
                  />
                </div>
                <span style={{ fontSize: 11, fontFamily: C.mono, color: C.textMuted, minWidth: 120, textAlign: "right" }}>
                  {isResearch ? g.score.toExponential(3) : `${g.similarity?.toFixed(4) ?? "—"} · ${((g.coverage ?? 0) * 100).toFixed(0)}%`}
                </span>
                <Badge variant={pv}>{isResearch ? `Priority ${i + 1}` : g.has_match === false || (g.overlap ?? 0) === 0 ? "No overlap" : `Overlap ${g.overlap}`}</Badge>
              </div>
            );
          })}
          {missing.map((sym) => (
            <div key={sym} style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
              {sym} — {isResearch ? "no enrichment hit in candidate list" : "not in gene ontology"}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function ModuleDisease() {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("omim");
  const [patientHpo, setPatientHpo] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const simMut = useSimilarity();

  const diseaseQ = useDisease(submitted ? query : "", source);

  const handleRun = () => setSubmitted(true);

  useEffect(() => {
    if (!diseaseQ.data || !patientHpo.trim()) return;
    const patient1 = patientHpo.split(/[,\n]/).map((l) => l.trim()).filter(Boolean);
    const patient2 = diseaseQ.data.hpo_terms.map((t) => t.id);
    if (!patient1.length || !patient2.length) return;
    simMut.mutate({
      patient1,
      patient2,
      kind: "omim",
      method: "resnik",
      combine: "BMA",
      one_way: true,
    });
  }, [diseaseQ.data, patientHpo]);

  const d = diseaseQ.data;
  const shared = simMut.data?.shared ?? [];
  const miss = simMut.data?.only_in_patient2 ?? [];
  const overlap = [...shared.map((t) => ({ ...t, inPt: true })), ...miss.map((t) => ({ ...t, inPt: false }))];
  const nGenes = d?.genes?.length ?? 0;

  return (
    <div>
      <PageHeader title="Disease Deep-Dive"
        sub="Inspect an OMIM or Orphanet disease profile and overlap with a patient list."
        api="disease.hpo_set() · hposet.similarity()" />
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 12, alignItems: "end" }}>
          <div>
            <div style={s.label}>Catalog</div>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                fontSize: 13,
                color: C.text,
                background: C.surfaceAlt,
                fontFamily: C.sans,
              }}
            >
              <option>omim</option>
              <option>orpha</option>
            </select>
          </div>
          <div>
            <div style={s.label}>Disease name or ID</div>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div>
            <div style={s.label}>Optional patient HPO terms</div>
            <Input value={patientHpo} onChange={(e) => setPatientHpo(e.target.value)} placeholder="HP:… comma or newline" />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <CTA onClick={handleRun} disabled={!query.trim()}>
            Explore disease
          </CTA>
        </div>
      </Card>
      {diseaseQ.isLoading && submitted && (
        <div style={{ padding: "12px", color: C.textMuted, fontSize: 13 }}>Loading disease…</div>
      )}
      {diseaseQ.isError && submitted && (
        <div style={{ padding: "12px", color: C.red, fontSize: 13 }}>{diseaseQ.error?.message}</div>
      )}
      {d && submitted && (
        <>
          <Card style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>{d.name}</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <Pill>
                {source === "omim" ? "OMIM" : "ORPHA"}:{d.id}
              </Pill>
              <Badge variant="accent">{d.hpo_count} HPO terms</Badge>
            </div>
            {patientHpo.trim() ? (
              <>
                <div style={{ fontSize: 12, color: C.textSub, marginBottom: 6 }}>Overlap with patient</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {overlap.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        padding: "4px 10px",
                        background: t.inPt ? C.accentSoft : C.surfaceAlt,
                        border: `1px solid ${t.inPt ? C.blue200 : C.border}`,
                        borderRadius: 20,
                        fontSize: 12,
                        color: t.inPt ? C.accent : C.textMuted,
                      }}
                    >
                      {t.name}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </Card>
          <ApiState mutation={simMut} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
            <MetricCard
              label="Patient similarity"
              value={simMut.data?.score != null ? simMut.data.score.toFixed(4) : patientHpo.trim() ? "—" : "—"}
              sub="Resnik · patient→disease (one_way)"
              accent={C.accent}
            />
            <MetricCard
              label="Exact overlap"
              value={
                patientHpo.trim() && simMut.data
                  ? `${shared.length}/${shared.length + miss.length}`
                  : "—"
              }
              sub="shared terms"
              accent={C.green}
            />
            <MetricCard label="Associated genes" value={String(nGenes)} sub="from disease profile" />
          </div>
          {d.genes && d.genes.length > 0 && (
            <Card>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Genes (first 20)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {d.genes.slice(0, 20).map((g) => (
                  <Pill key={g.id || g.name}>{g.name}</Pill>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function ModuleExplorer() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const termQ = useTerm(submitted);

  const t = termQ.data;

  return (
    <div>
      <PageHeader title="HPO Term Explorer"
        sub="Inspect one term: definition, parents, children, associations, path to root."
        api="Ontology.get_hpo_object(query) · term.path_to_other(root)" />
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <div style={s.label}>HPO ID or name</div>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <CTA onClick={() => setSubmitted(query.trim())} disabled={!query.trim()}>
            Explore term
          </CTA>
        </div>
      </Card>
      {termQ.isPending && submitted && (
        <div style={{ padding: "16px", color: C.textMuted, fontSize: 13, fontFamily: C.sans }}>Loading term…</div>
      )}
      {termQ.isError && submitted && (
        <div style={{ padding: "12px", color: C.red, fontSize: 13 }}>{termQ.error?.message}</div>
      )}
      {t && (
        <>
          <Card style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <Pill>{t.id}</Pill>
              <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{t.name}</span>
            </div>
            <div style={{ fontSize: 13, color: C.textSub, marginBottom: 8, lineHeight: 1.6 }}>{t.definition || "—"}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Badge>IC OMIM: {t.ic?.omim != null ? t.ic.omim.toFixed(2) : "—"}</Badge>
              <Badge variant="accent">Depth: {t.longest_path_to_root ?? "—"}</Badge>
              <Badge variant={t.is_obsolete ? "amber" : "green"}>{t.is_obsolete ? "Obsolete" : "Not obsolete"}</Badge>
            </div>
          </Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Parents</div>
              {(t.parents || []).map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    padding: "6px 8px",
                    background: C.surfaceAlt,
                    borderRadius: 7,
                    marginBottom: 4,
                  }}
                >
                  <Pill>{p.id}</Pill>
                  <span style={{ fontSize: 12, color: C.text }}>{p.name}</span>
                </div>
              ))}
            </Card>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Children</div>
              {(t.children || []).map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: "5px 8px",
                    background: C.surfaceAlt,
                    borderRadius: 7,
                    marginBottom: 4,
                    fontSize: 12,
                    color: C.textSub,
                  }}
                >
                  <Pill>{c.id}</Pill> {c.name}
                </div>
              ))}
            </Card>
          </div>
          <Card style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Path to root (HP:0000001)</div>
            {(t.path_to_root || []).map((node, i) => (
              <div
                key={node.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 0",
                  paddingLeft: i * 14,
                  borderLeft: i > 0 ? `2px solid ${C.border}` : "none",
                  marginLeft: i > 0 ? 7 : 0,
                }}
              >
                <Pill>{node.id}</Pill>
                <span style={{ fontSize: 12, color: i === (t.path_to_root?.length || 0) - 1 ? C.accent : C.textSub }}>
                  {node.name}
                </span>
              </div>
            ))}
          </Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>Genes (first 10)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(t.genes || []).slice(0, 10).map((g) => (
                  <Pill key={g.id || g.name}>{g.name}</Pill>
                ))}
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>OMIM diseases (first 10)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(t.omim_diseases || []).slice(0, 10).map((d) => (
                  <span key={d.id} style={{ fontSize: 12, color: C.textSub }}>
                    {d.name} <span style={{ fontFamily: C.mono, color: C.textMuted }}>({d.id})</span>
                  </span>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function ModuleIC() {
  const [ran, setRan] = useState(false);
  const sorted = [...S_TERMS].sort((a,b)=>b.ic-a.ic);
  const maxIc = 2.41;
  const icBarColor = ic => ic >= 2.0 ? C.green : ic >= 1.5 ? C.accent : ic >= 0.8 ? C.amber : C.textMuted;
  return (
    <div>
      <PageHeader title="IC Profiler"
        sub="Measure how diagnostically specific each HPO term is. High IC terms narrow your differential."
        api="term.information_content.omim · hposet.information_content()" />
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 160px",gap:12,alignItems:"end" }}>
          <div>
            <div style={s.label}>HPO terms</div>
            <Textarea rows={5} value={S_TERMS.map(t=>t.id).join("\n")} onChange={()=>{}} />
          </div>
          <div>
            <div style={s.label}>IC source</div>
            <select style={{width:"100%",padding:"8px 10px",border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,color:C.text,background:C.surfaceAlt,fontFamily:C.sans}}>
              <option>omim</option><option>gene</option><option>orpha</option>
            </select>
            <div style={{marginTop:10}}><CTA onClick={()=>setRan(true)}>Compute IC</CTA></div>
          </div>
        </div>
      </Card>
      {ran && (
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
            <MetricCard label="Mean IC (OMIM)" value="1.708" sub="High specificity" accent={C.accent}/>
            <MetricCard label="Max IC" value="2.41"/>
            <MetricCard label="Total IC" value="8.54"/>
            <MetricCard label="High-IC terms" value="2/5" sub="IC ≥ 1.5" accent={C.accent}/>
          </div>
          <Card>
            <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:10}}>Per-term IC (OMIM)</div>
            {sorted.map(t=>(
              <div key={t.id} style={{display:"grid",gridTemplateColumns:"1fr 60px 100px 60px 80px",gap:8,alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                <div>
                  <div style={{fontSize:13,color:C.text,fontWeight:500}}>{t.name}</div>
                  <div style={{fontSize:10,color:C.textMuted,fontFamily:C.mono}}>{t.id}</div>
                </div>
                <span style={{fontSize:12,fontFamily:C.mono,color:C.textMuted}}>{t.depth}</span>
                <ScoreBar pct={(t.ic/maxIc)*100} color={icBarColor(t.ic)}/>
                <span style={{fontSize:12,fontFamily:C.mono,fontWeight:700}}>{t.ic.toFixed(3)}</span>
                <ICBand ic={t.ic}/>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

function ModuleReport() {
  const [ran, setRan] = useState(false);
  const [caseId, setCaseId] = useState("CASE-2024-003");
  return (
    <div>
      <PageHeader title="Report Builder"
        sub="Generate a complete clinical summary combining IC profile, diagnostic disease/gene ranking, and exports."
        api="IC + POST /api/enrichment (diagnostic) + POST /api/variant-prioritize (diagnostic) combined export" />
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
          <div>
            <div style={s.label}>Case ID</div>
            <Input value={caseId} onChange={e=>setCaseId(e.target.value)} />
          </div>
          <div>
            <div style={s.label}>Disease database</div>
            <select style={{width:"100%",padding:"8px 10px",border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,color:C.text,background:C.surfaceAlt,fontFamily:C.sans}}>
              <option>omim</option><option>orpha</option>
            </select>
          </div>
          <div style={{gridColumn:"span 2"}}>
            <div style={s.label}>HPO terms</div>
            <Textarea rows={4} value={S_TERMS.map(t=>t.id).join("\n")} onChange={()=>{}} />
          </div>
          <div style={{gridColumn:"span 2"}}>
            <div style={s.label}>Clinical notes</div>
            <Textarea rows={2} value="" onChange={()=>{}} placeholder="Free-text clinical notes…" />
          </div>
        </div>
        <div style={{marginTop:12}}><CTA onClick={()=>setRan(true)}>Generate report</CTA></div>
      </Card>
      {ran && (
        <Card style={{background:"#FAFCFF",border:`1px solid ${C.blue100}`}}>
          <div style={{fontSize:15,fontWeight:700,color:C.text,marginBottom:2}}>Clinical genomics report: {caseId}</div>
          <div style={{fontSize:11,color:C.textMuted,marginBottom:14}}>Generated {new Date().toLocaleDateString()} · PyHPO 4.0 · OMIM</div>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,color:C.textSub,marginBottom:6}}>Patient phenotype profile</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {S_TERMS.map(t=><Pill key={t.id}>{t.id}</Pill>)}
            </div>
            <div style={{fontSize:11,color:C.textMuted,marginTop:4}}>Mean IC (OMIM): 1.708 · Max IC: 2.41</div>
          </div>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,color:C.textSub,marginBottom:6}}>Top differential diagnoses</div>
            {S_DISEASES.slice(0,3).map((d,i)=>(
              <div key={d.id} style={{fontSize:13,color:C.text,marginBottom:3}}>
                {i+1}. <b>{d.name}</b> ({d.id}) — p={d.score.toFixed(4)}, {d.count} terms matched
              </div>
            ))}
          </div>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:700,color:C.textSub,marginBottom:6}}>Gene candidates</div>
            {S_GENES.slice(0,2).map(g=>(
              <div key={g.gene} style={{fontSize:13,color:C.text,marginBottom:3}}>
                <b style={{fontFamily:C.mono}}>{g.gene}</b> — phenotype match p={g.score.toFixed(4)}
              </div>
            ))}
          </div>
          <button style={{padding:"8px 18px",background:C.surfaceAlt,border:`1px solid ${C.border}`,
            borderRadius:8,fontSize:12,cursor:"pointer",color:C.textSub,fontFamily:C.sans}}>
            Download CSV report
          </button>
        </Card>
      )}
    </div>
  );
}

// ─── WORKFLOW CONTAINER ───────────────────────────────────────────────────────
function WorkflowView() {
  const [activeStep, setActiveStep] = useState(1);
  const [completed, setCompleted] = useState(new Set());
  const [stepData, setStepData] = useState({});

  const complete = useCallback((id, data) => {
    setStepData(p => ({ ...p, [id]: data }));
    setCompleted(p => new Set([...p, id]));
    setActiveStep(Math.min(7, id + 1));
  }, []);

  const goTo = id => {
    if (id === 1 || completed.has(id - 1) || completed.has(id)) setActiveStep(id);
  };

  const PANELS = {
    1: <WFStep1 onComplete={(d) => complete(1, d)} />,
    2: <WFStep2 state={stepData[1]} onComplete={(d) => complete(2, d)} />,
    3: <WFStep3 state={stepData[1]} onComplete={(d) => complete(3, d)} />,
    4: <WFStep4 state={stepData[1]} onComplete={(d) => complete(4, d)} />,
    5: <WFStep5 state={stepData[1]} onComplete={(d) => complete(5, d)} />,
    6: (
      <WFStep6
        state={{ terms: stepData[1]?.terms, topDisease: stepData[3]?.diseases?.[0]?.name }}
        onComplete={(d) => complete(6, d)}
      />
    ),
    7: (
      <WFStep7
        state={{
          terms: stepData[1]?.terms,
          topDisease: stepData[3]?.diseases?.[0]?.name,
          topGene: stepData[4]?.genes?.[0]?.name,
          similarity: stepData[6]?.similarity,
        }}
      />
    ),
  };

  return (
    <div style={{ display: "flex", gap: 0 }}>
      {/* Step rail */}
      <div style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${C.border}`, paddingRight: 20 }}>
        <div style={{ ...s.sectionTitle, marginBottom: 14 }}>Workflow steps</div>
        {WORKFLOW_STEPS.map((step, i) => {
          const isDone = completed.has(step.id);
          const isActive = activeStep === step.id;
          const avail = step.id === 1 || completed.has(step.id - 1) || isDone;
          const wasSkipped = isDone && stepData[step.id]?.skipped;
          return (
            <div key={step.id}>
              <div onClick={() => avail && goTo(step.id)} style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 10px",
                cursor: avail ? "pointer" : "default",
                background: isActive ? C.accentSoft : "transparent",
                borderLeft: `2px solid ${isActive ? C.accent : isDone ? C.blue200 : "transparent"}`,
                borderRadius: "0 8px 8px 0",
                opacity: avail ? 1 : 0.4, transition: "all .15s",
              }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                  background: wasSkipped ? C.surfaceAlt : isDone ? C.accent : isActive ? C.accentMid : C.blue50,
                  border: `2px solid ${wasSkipped ? C.borderMid : isDone ? C.accent : isActive ? C.accent : C.blue200}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 800, color: wasSkipped ? C.textMuted : isDone ? "#fff" : isActive ? C.accent : C.blue500,
                  fontFamily: C.mono }}>
                  {wasSkipped ? "–" : isDone ? "✓" : step.id}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: isActive ? 700 : 400,
                    color: isActive ? C.text : C.textSub, lineHeight: 1.3 }}>{step.label}</div>
                  <div style={{ fontSize: 9, color: C.textMuted, fontFamily: C.mono, marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{step.api}</div>
                </div>
              </div>
              {i < WORKFLOW_STEPS.length - 1 && (
                <div style={{ marginLeft: 20, width: 2, height: 5,
                  background: isDone ? C.accent : C.border }} />
              )}
            </div>
          );
        })}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <div style={s.sectionTitle}>Progress</div>
          <div style={{ background: C.blue50, borderRadius: 4, height: 6, overflow: "hidden", marginBottom: 4 }}>
            <div style={{ width: `${Math.max(4, (completed.size / 7) * 100)}%`,
              height: 6, background: C.accent, borderRadius: 4, transition: "width .4s" }} />
          </div>
          <div style={{ fontSize: 11, color: C.textMuted }}>{completed.size}/7 complete</div>
        </div>
      </div>

      {/* Step content */}
      <div style={{ flex: 1, paddingLeft: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20,
          paddingBottom: 16, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: C.accentSoft,
            border: `2px solid ${C.accent}`, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 14, fontWeight: 800, color: C.accent, fontFamily: C.mono }}>
            {activeStep}
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.text, fontFamily: C.sans }}>
              {WORKFLOW_STEPS[activeStep - 1]?.label}
            </div>
            <div style={{ fontSize: 10, color: C.textMuted, fontFamily: C.mono }}>Step {activeStep} of 7</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {completed.has(activeStep) ? <Badge variant="green">Completed</Badge>
              : <Badge variant="guided">In progress</Badge>}
          </div>
        </div>
        {PANELS[activeStep]}
      </div>
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({ active, setActive }) {
  const healthQ = useHealth();
  const n = healthQ.data?.terms;
  const statItems = [
    { k: "Terms", v: n != null ? `${(n / 1000).toFixed(0)}k` : "…" },
    { k: "Genes", v: "5.1k" },
    { k: "OMIM", v: "8.4k" },
    { k: "Orpha", v: "4.3k" },
  ];

  return (
    <div style={{ width: 224, flexShrink: 0, background: C.sidebarBg,
      display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Brand */}
      <div style={{ padding: "18px 16px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 3 }}>
          <div style={{ width: 30, height: 30, background: C.blue400, borderRadius: 7,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 15, color: "#fff", fontWeight: 800 }}>⬡</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textOnDark, letterSpacing: "-.01em" }}>
              HPO Diagnostics
            </div>
            <div style={{ fontSize: 10, color: C.textMutedDark }}>PyHPO 4.0 · Clinical</div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, padding: "0 12px 12px" }}>
        {statItems.map((s) => (
          <div key={s.k} style={{ background: "rgba(255,255,255,.07)", borderRadius: 7,
            padding: "7px 9px", border: "1px solid rgba(255,255,255,.08)" }}>
            <div style={{ fontSize: 9, color: C.textMutedDark, textTransform: "uppercase",
              letterSpacing: ".06em", fontFamily: C.sans }}>{s.k}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.blue200,
              fontFamily: C.mono, lineHeight: 1.2 }}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{ height: .5, background: "rgba(255,255,255,.1)", margin: "0 12px 8px" }} />

      {/* Nav */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {NAV.map(group => (
          <div key={group.group} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 9, color: C.textMutedDark, fontWeight: 700, letterSpacing: ".08em",
              textTransform: "uppercase", padding: "8px 16px 4px", fontFamily: C.sans }}>
              {group.group}
            </div>
            {group.items.map(item => {
              const isActive = active === item.key;
              return (
                <div key={item.key} onClick={() => setActive(item.key)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
                    cursor: "pointer",
                    background: isActive ? "rgba(37,99,235,.25)" : "transparent",
                    borderLeft: `2px solid ${isActive ? C.blue300 : "transparent"}`,
                    transition: "all .12s" }}
                  onMouseOver={e => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,.06)"; }}
                  onMouseOut={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ fontSize: 13, color: isActive ? "#fff" : C.textMutedDark, width: 16, textAlign: "center" }}>
                    {item.icon}
                  </span>
                  <span style={{ fontSize: 12, color: isActive ? "#fff" : C.textMutedDark,
                    fontWeight: isActive ? 700 : 400, flex: 1, fontFamily: C.sans }}>
                    {item.label}
                  </span>
                  {item.badge && (
                    <span style={{ fontSize: 8, fontWeight: 800, padding: "2px 6px", borderRadius: 12,
                      background: item.badge === "new" ? "#4F46E5" : "#C2410C",
                      color: "#fff", textTransform: "uppercase", letterSpacing: ".05em" }}>
                      {item.badge}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,.1)" }}>
        <div style={{ fontSize: 10, color: C.textMutedDark }}>HPO release 2024-04</div>
        <div style={{ fontSize: 10, color: C.textMutedDark }}>Powered by PyHPO + pyhpo.readthedocs.io</div>
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
function App() {
  const [active, setActive] = useState("workflow");

  const MODULE_MAP = {
    workflow:   <WorkflowView />,
    ddx:        <ModuleDDX />,
    similarity: <ModuleSimilarity />,
    gene:       <ModuleGene />,
    cohort:     <ModuleCohort />,
    variant:    <ModuleVariant />,
    disease:    <ModuleDisease />,
    explorer:   <ModuleExplorer />,
    ic:         <ModuleIC />,
    report:     <ModuleReport />,
  };

  const PAGE_TITLES = {
    workflow:"7-Step Guided Workflow",ddx:"Differential Diagnosis",similarity:"Patient Similarity",
    gene:"Gene Enrichment",cohort:"Cohort Analysis",variant:"Variant Prioritizer",
    disease:"Disease Deep-Dive",explorer:"HPO Term Explorer",ic:"IC Profiler",report:"Report Builder",
  };

  return (
    <QueryClientProvider client={queryClient}>
    <div style={{ display: "flex", height: "100vh", background: C.pageBg,
      fontFamily: C.sans, overflow: "hidden" }}>
      <Sidebar active={active} setActive={setActive} />

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Topbar */}
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`,
          padding: "0 24px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            Clinical workspace /
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{PAGE_TITLES[active]}</div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 12px",
              background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 8,
              fontSize: 12, color: C.textMuted, cursor: "text" }}>
              <span style={{ fontSize: 13 }}>🔍</span> Search HPO terms…
            </div>
            <button style={{ padding: "6px 14px", background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 8, fontSize: 12, color: C.textSub, cursor: "pointer", fontFamily: C.sans }}>
              Export CSV
            </button>
            <button style={{ padding: "6px 14px", background: C.accent, border: "none",
              borderRadius: 8, fontSize: 12, color: "#fff", cursor: "pointer", fontWeight: 700, fontFamily: C.sans }}>
              + New analysis
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {MODULE_MAP[active]}
        </div>
      </div>
    </div>
    </QueryClientProvider>
  );
}

export default App;
