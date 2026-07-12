import { useRef, useState } from "react";
import { C } from "../tokens";
import Card from "../components/Card";
import Topbar from "../components/Topbar";
import Textarea from "../components/Textarea";
import CTA from "../components/CTA";
import MetricCard from "../components/MetricCard";
import Badge from "../components/Badge";
import SaveCaseButton from "../components/SaveCaseButton";
import { useVariantPrioritizeFile, useVariantFileGeneDetail } from "../hooks/useAPI";

const surfaceAlt = "#F8FAFC";
const amberSoft = "rgba(217, 119, 6, 0.1)";
const accentSoft = "rgba(37, 99, 235, 0.08)";
const blueSoft = "rgba(37, 99, 235, 0.12)";
const blueBorder = "#BFDBFE";

const TIER_TONE = ["danger", "warn", "neutral", "ok", "ok"]; // Pathogenic..Benign, index = classification_tier

const JOB_STATUS_LABEL = {
  queued: "Queued…",
  running: "Scoring against the ontology…",
};

function ClassificationBadge({ tier, label }) {
  const tone = TIER_TONE[tier] ?? "neutral";
  return <Badge tone={tone}>{label}</Badge>;
}

/** gnomAD AF as a readable percentage, e.g. 6.57e-6 -> "0.000657%". */
function formatMafPercent(af) {
  const pct = af * 100;
  if (pct === 0) return "0%";
  return `${pct.toPrecision(3)}%`;
}

function VariantRow({ v }) {
  const [showCriteria, setShowCriteria] = useState(false);
  const criteriaTokens = v.acmg_criteria ? v.acmg_criteria.split(";").map((c) => c.trim()).filter(Boolean) : [];

  return (
    <div style={{ marginBottom: 6 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          padding: "8px 10px",
          borderRadius: showCriteria ? "6px 6px 0 0" : 6,
          background: surfaceAlt,
          border: `0.5px solid ${C.border}`,
          borderBottom: showCriteria ? "none" : `0.5px solid ${C.border}`,
          fontSize: 12,
        }}
      >
        <ClassificationBadge tier={v.classification_tier} label={v.classification} />
        <span style={{ fontFamily: C.fontMono, fontWeight: 600, color: C.text }}>
          {v.aa_change || v.cdna_change || v.hgvsg || "—"}
        </span>
        {v.varclass && <span style={{ color: C.textMuted }}>{v.varclass}</span>}
        {v.zygosity && <span style={{ color: C.textMuted }}>{v.zygosity}</span>}
        {v.inheritance_mode && (
          <span style={{ color: C.textMuted, fontFamily: C.fontMono }} title="Inheritance mode from the file's own ACMG criteria">
            {v.inheritance_mode}
          </span>
        )}
        <span
          style={{ color: v.gnomad_af == null ? C.green : C.textMuted, fontFamily: C.fontMono }}
          title="gnomAD population allele frequency (MAF) from the file"
        >
          {v.gnomad_af == null ? "Not in gnomAD" : `gnomAD ${formatMafPercent(v.gnomad_af)}`}
        </span>
        {v.transcript && (
          <span style={{ color: C.textMuted, fontFamily: C.fontMono }}>{v.transcript}</span>
        )}
        {v.transcript_count > 1 && (
          <span style={{ color: C.textMuted }}>{v.transcript_count} transcripts</span>
        )}
        {v.filter_status && v.filter_status !== "PASS" && (
          <Badge tone="warn">{v.filter_status}</Badge>
        )}
        {criteriaTokens.length > 0 && (
          <button
            type="button"
            onClick={() => setShowCriteria((s) => !s)}
            style={{
              color: C.accent,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              padding: 0,
              textDecoration: "underline",
              marginLeft: "auto",
            }}
          >
            {showCriteria ? "Hide criteria" : "ACMG criteria ⓘ"}
          </button>
        )}
      </div>
      {showCriteria && criteriaTokens.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 5,
            padding: "8px 10px",
            borderRadius: "0 0 6px 6px",
            background: C.pageBg,
            border: `0.5px solid ${C.border}`,
            borderTop: "none",
          }}
        >
          {criteriaTokens.map((token, i) => (
            <span
              key={`${token}-${i}`}
              style={{
                fontSize: 11,
                fontFamily: C.fontMono,
                padding: "2px 8px",
                borderRadius: 4,
                background: C.card,
                color: C.textSecondary,
                border: `1px solid ${C.border}`,
              }}
            >
              {token}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ZygosityWarning({ text }) {
  if (!text) return null;
  return (
    <div
      style={{
        marginBottom: 10,
        padding: "8px 12px",
        background: amberSoft,
        border: `1px solid ${C.amber}`,
        borderRadius: 8,
        fontSize: 12,
        color: C.amber,
      }}
    >
      ⚠ {text}
    </div>
  );
}

function GeneCard({ row, tone = "candidate" }) {
  const [showRuledOut, setShowRuledOut] = useState(false);
  const bd = row.bridge_disease;
  const isCandidate = tone === "candidate";
  const isRuledOut = tone === "ruled_out";

  return (
    <div
      style={{
        marginBottom: 10,
        background: isCandidate ? C.card : surfaceAlt,
        border: `0.5px solid ${isRuledOut ? C.border : C.borderEmphasis}`,
        borderRadius: 8,
        padding: "14px 16px",
        opacity: isRuledOut ? 0.85 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        {row.rank && (
          <span style={{ fontFamily: C.fontMono, fontWeight: 700, fontSize: 15, color: C.accent }}>
            #{row.rank}
          </span>
        )}
        <span style={{ fontFamily: C.fontMono, fontWeight: 700, fontSize: 16, color: C.text }}>
          {row.name}
        </span>
        {row.combined_score != null && (
          <span style={{ fontSize: 12, color: C.textMuted }}>
            HPO score {row.combined_score.toFixed(3)} · coverage {(row.coverage * 100).toFixed(0)}%
          </span>
        )}
        {isRuledOut && <Badge tone="ok">Benign/Likely benign only — ruled out</Badge>}
        {row.found === false && <Badge tone="warn">Not in this file</Badge>}
        {row.annotation_warning && <Badge tone="warn">Sparse gene annotations</Badge>}
      </div>

      <ZygosityWarning text={row.zygosity_warning} />

      {bd && (
        <div style={{ marginBottom: 10, fontSize: 12 }}>
          <span style={{ color: C.textMuted }}>Bridge disease: </span>
          <span style={{ color: C.accent, fontWeight: 500 }}>{bd.disease_name}</span>
          <span style={{ color: C.textMuted }}> · Dis #{bd.disease_rank} · causal overlap {(bd.causal_overlap * 100).toFixed(0)}%</span>
        </div>
      )}

      {row.matched_terms?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            Matched patient terms ({row.matched_terms.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {row.matched_terms.map((t) => (
              <span
                key={t.id}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "rgba(22,163,74,0.10)",
                  color: "#15803D",
                  fontFamily: C.fontMono,
                }}
              >
                {t.id} · {t.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {row.candidate_variants?.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
            {isRuledOut ? "Benign variant(s)" : `Candidate variant${row.candidate_variants.length > 1 ? "s" : ""} (${row.candidate_variants.length})`}
          </div>
          {row.candidate_variants.map((v, i) => (
            <VariantRow key={`${v.variant_id}-${i}`} v={v} />
          ))}
        </div>
      )}

      {row.ruled_out_variants?.length > 0 && !isRuledOut && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowRuledOut((s) => !s)}
            style={{
              fontSize: 11,
              color: C.textMuted,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
            }}
          >
            {showRuledOut ? "Hide" : "Show"} {row.ruled_out_variants.length} lower-tier variant(s) also seen in this gene
          </button>
          {showRuledOut && (
            <div style={{ marginTop: 6 }}>
              {row.ruled_out_variants.map((v, i) => (
                <VariantRow key={`${v.variant_id}-ro-${i}`} v={v} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GeneLookupPanel({ query, onQueryChange, onLookup, lookupMut }) {
  const result = lookupMut.data?.results?.[0];

  return (
    <div
      id="gene-lookup-panel"
      style={{
        background: C.card,
        border: `0.5px solid ${C.border}`,
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 500, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
        Look up any gene in this file
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          placeholder="Gene symbol (e.g. CFTR, MUSK)…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onLookup()}
          style={{
            flex: 1,
            padding: "8px 12px",
            border: `1px solid ${C.borderEmphasis}`,
            borderRadius: 6,
            fontSize: 13,
            fontFamily: C.fontMono,
          }}
        />
        <CTA onClick={() => onLookup()} disabled={lookupMut.isPending || !query.trim()}>
          {lookupMut.isPending ? "Looking up…" : "Look up"}
        </CTA>
      </div>
      {lookupMut.isError && <div style={{ marginTop: 10, fontSize: 12, color: C.red }}>{lookupMut.error.message}</div>}
      {result && !result.found && (
        <div style={{ marginTop: 10, fontSize: 12, color: C.textMuted, fontStyle: "italic" }}>
          "{result.name}" has no variants in this file (or wasn't matched to the ontology).
        </div>
      )}
      {result?.found && <GeneCard row={result} tone="candidate" />}
    </div>
  );
}

function NoOverlapSummary({ summary, count, onLookup }) {
  const [showAll, setShowAll] = useState(false);
  if (count === 0) return null;
  const shown = showAll ? summary : summary.slice(0, 15);

  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        marginBottom: 16,
        background: blueSoft,
        border: `1px solid ${blueBorder}`,
      }}
    >
      <div style={{ fontSize: 12, color: C.text, marginBottom: 8 }}>
        <strong>{count} gene(s)</strong> have a Pathogenic/Likely Pathogenic/VUS variant in the file but share no HPO
        terms with your entered profile — they can't be ranked, but nothing with a real classification is dropped.
        Click a gene to see its variant detail above.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {shown.map((g) => (
          <button
            key={g.name}
            type="button"
            onClick={() => onLookup(g.name)}
            title={`${g.candidate_variant_count} candidate variant(s)`}
            style={{
              fontSize: 11,
              fontFamily: C.fontMono,
              padding: "4px 10px",
              borderRadius: 999,
              border: `1px solid ${TIER_TONE[g.best_classification_tier] === "danger" ? C.red : C.borderEmphasis}`,
              background: C.card,
              color: C.text,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            {g.name}
            <span style={{ color: C.textMuted }}>({g.best_classification})</span>
            {g.has_zygosity_warning && <span title="Zygosity/inheritance warning">⚠</span>}
          </button>
        ))}
      </div>
      {summary.length > 15 && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          style={{ marginTop: 8, fontSize: 11, color: C.accent, background: "none", border: "none", cursor: "pointer" }}
        >
          {showAll ? "Show fewer" : `Show all ${summary.length}`}
        </button>
      )}
    </div>
  );
}

export default function VariantFilePrioritization() {
  const [terms, setTerms] = useState("");
  const [fileName, setFileName] = useState("");
  const [expandIC, setExpandIC] = useState(true);
  const [icThreshold, setIcThreshold] = useState(2.0);
  const [topN, setTopN] = useState(100);
  const [jobStatus, setJobStatus] = useState(null);
  const [lookupQuery, setLookupQuery] = useState("");
  const [formCollapsed, setFormCollapsed] = useState(false);
  const fileRef = useRef(null);
  const mut = useVariantPrioritizeFile();
  const lookupMut = useVariantFileGeneDetail();

  const runLookup = (symbol) => {
    const q = (symbol ?? lookupQuery).trim().toUpperCase();
    if (!q || !mut.data?.lookup_token) return;
    setLookupQuery(q);
    lookupMut.mutate({ token: mut.data.lookup_token, genes: [q] });
    document.getElementById("gene-lookup-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleRun = () => {
    const file = fileRef.current?.files?.[0];
    if (!terms.trim() || !file) return;
    setJobStatus(null);
    mut.mutate(
      {
        hpoTerms: terms,
        file,
        expandIc: expandIC,
        icExpansionThreshold: icThreshold,
        topN,
        onStatusChange: setJobStatus,
      },
      { onSuccess: () => setFormCollapsed(true) }
    );
  };

  const data = mut.data;
  const runLabel = mut.isPending ? JOB_STATUS_LABEL[jobStatus] ?? "Starting…" : "Run cross-reference";

  return (
    <div>
      <Topbar
        title="Variant file prioritization"
        subtitle="Upload a VariMAT-style variant export; genes are ranked by HPO similarity and cross-referenced against ACMG classification. Runs as a background job for large (whole-exome/genome) files."
      />

      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: formCollapsed ? 0 : 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
            {formCollapsed
              ? `${terms.split("\n").filter((l) => l.trim()).length} HPO term(s) · ${fileName || "no file"} · top ${topN}`
              : "Inputs"}
          </div>
          <button
            type="button"
            onClick={() => setFormCollapsed((c) => !c)}
            style={{ fontSize: 12, color: C.accent, background: "none", border: "none", cursor: "pointer" }}
          >
            {formCollapsed ? "Edit inputs" : "Collapse"}
          </button>
        </div>

        <div style={{ display: formCollapsed ? "none" : "grid", gridTemplateColumns: "1fr 260px", gap: 14 }}>
            <div>
              <Textarea
                label="Patient HPO terms (one per line — ID or name)"
                rows={8}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder={"HP:0000508\nHP:0001324\n..."}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label
                style={{
                  display: "block",
                  padding: "10px 12px",
                  background: surfaceAlt,
                  border: `1px dashed ${C.borderEmphasis}`,
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>VariMAT file (.txt / .tsv, up to 500MB)</div>
                <div style={{ color: C.textMuted, wordBreak: "break-all", overflowWrap: "anywhere" }}>
                  {fileName || "Click to choose a file…"}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.tsv,text/tab-separated-values,text/plain"
                  onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
                  style={{ display: "none" }}
                />
              </label>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>Max ranked genes</div>
                <input
                  type="range"
                  min={5}
                  max={1000}
                  step={5}
                  value={topN}
                  onChange={(e) => setTopN(+e.target.value)}
                  style={{ width: "100%" }}
                />
                <div style={{ fontSize: 11, color: C.textMuted }}>Top {topN}</div>
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  background: surfaceAlt,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                <input type="checkbox" checked={expandIC} onChange={(e) => setExpandIC(e.target.checked)} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>IC-filtered term expansion</div>
                  <div style={{ fontSize: 10, color: C.textMuted }}>
                    Adds parent terms with IC ≥ {icThreshold}. Improves recall for annotation-sparse genes.
                  </div>
                </div>
              </label>

              {expandIC && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>
                    IC threshold: {icThreshold.toFixed(1)}
                  </div>
                  <input
                    type="range"
                    min={1.0}
                    max={5.0}
                    step={0.5}
                    value={icThreshold}
                    onChange={(e) => setIcThreshold(+e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
              )}

              <CTA onClick={handleRun} disabled={mut.isPending || !terms.trim() || !fileName}>
                {runLabel}
              </CTA>
            </div>
          </div>
      </Card>

      {mut.isError && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            background: "rgba(220, 38, 38, 0.08)",
            border: `1px solid ${C.red}`,
            color: C.red,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {mut.error?.message ?? "Request failed"}
        </div>
      )}

      {data && (
        <div>
          <div style={{ marginBottom: 14 }}>
            <SaveCaseButton
              kind="variant-file-prioritization"
              params={{ hpo_terms: terms, expand_ic: expandIC, ic_expansion_threshold: icThreshold, top_n: topN, file_name: fileName }}
              result={data}
              defaultName={fileName ? `Variant file — ${fileName}` : ""}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <MetricCard label="Variants in file" value={data.file_summary.total_variants} />
            <MetricCard label="Genes seen (total)" value={data.file_summary.genes_seen_total} />
            <MetricCard label="Genes with HPO annotation" value={data.file_summary.genes_with_hpo_annotation} />
            <MetricCard label="HPO terms (final)" value={data.hposet_size} />
            <MetricCard label="Candidate genes" value={data.candidates.length} />
          </div>

          {data.unresolved_genes?.length > 0 && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                marginBottom: 8,
                fontSize: 13,
                background: amberSoft,
                border: `1px solid ${C.amber}`,
                color: C.amber,
              }}
            >
              <strong>⚠ </strong>
              {data.unresolved_genes.length} gene symbol(s) from the file were not found in the ontology:{" "}
              {data.unresolved_genes.slice(0, 10).join(", ")}
              {data.unresolved_genes.length > 10 && ` · +${data.unresolved_genes.length - 10} more`}
            </div>
          )}

          {data.file_summary.variants_dropped_no_canonical_transcript > 0 && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                marginBottom: 8,
                fontSize: 13,
                background: accentSoft,
                border: `1px solid ${blueBorder}`,
                color: C.textSecondary,
              }}
            >
              <strong>ℹ </strong>
              {data.file_summary.variants_dropped_no_canonical_transcript} variant(s) had transcript annotations in
              the file but none flagged MANE/canonical, so no reliable single annotation could be chosen — excluded
              rather than guessed at.
            </div>
          )}

          {data.unresolved_hpo_terms?.length > 0 && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                marginBottom: 8,
                fontSize: 13,
                background: amberSoft,
                border: `1px solid ${C.amber}`,
                color: C.amber,
              }}
            >
              <strong>⚠ </strong>
              {data.unresolved_hpo_terms.length} HPO term(s) could not be resolved: {data.unresolved_hpo_terms.join(", ")}
            </div>
          )}

          {data.expanded_terms?.length > 0 && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                marginBottom: 12,
                background: accentSoft,
                border: `1px solid ${blueBorder}`,
                fontSize: 12,
              }}
            >
              <strong style={{ color: C.accent }}>{data.expanded_terms.length} terms added by IC expansion:</strong>{" "}
              {data.expanded_terms
                .slice(0, 5)
                .map((t) => `${t.name} (IC ${t.ic})`)
                .join(" · ")}
              {data.expanded_terms.length > 5 && ` · +${data.expanded_terms.length - 5} more`}
            </div>
          )}

          <GeneLookupPanel
            query={lookupQuery}
            onQueryChange={setLookupQuery}
            onLookup={runLookup}
            lookupMut={lookupMut}
          />

          <NoOverlapSummary
            summary={data.no_phenotype_overlap.summary}
            count={data.no_phenotype_overlap.count}
            onLookup={runLookup}
          />

          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8, marginTop: 4 }}>
            Ranked candidates
          </div>
          {data.candidates.length === 0 && (
            <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 12 }}>
              No genes in the file had a Pathogenic/Likely Pathogenic/VUS variant that also matched the entered HPO
              profile.
            </div>
          )}
          {data.candidates.map((row) => (
            <GeneCard key={row.name} row={row} tone="candidate" />
          ))}

          {data.ruled_out?.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8, marginTop: 18 }}>
                Ruled out — HPO-matched genes with only benign variants ({data.ruled_out.length})
              </div>
              {data.ruled_out.map((row) => (
                <GeneCard key={row.name} row={row} tone="ruled_out" />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
