import { useState, useEffect } from "react";
import { C } from "../tokens";
import Card from "../components/Card";
import Topbar from "../components/Topbar";
import Textarea from "../components/Textarea";
import CTA from "../components/CTA";
import MetricCard from "../components/MetricCard";
import { useGenePrioritization } from "../hooks/useAPI";
import { linesToQueries } from "../lib/utils";

const surfaceAlt = "#F8FAFC";
const amberSoft = "rgba(217, 119, 6, 0.1)";
const accentSoft = "rgba(37, 99, 235, 0.08)";
const blueSoft = "rgba(37, 99, 235, 0.12)";
const blueBorder = "#BFDBFE";
const greenSoft = "rgba(22, 163, 74, 0.1)";

function GeneSearchCard({ gene, patientTermCount, C: tokens }) {
  const bd = gene.bridge_disease;
  const unmatchedCount = gene.total_annotations - gene.overlap;

  const rankColor =
    gene.rank <= 5 ? tokens.green : gene.rank <= 20 ? tokens.accent : gene.rank <= 100 ? tokens.amber : tokens.red;

  return (
    <div
      style={{
        marginTop: 12,
        background: surfaceAlt,
        border: `0.5px solid ${tokens.borderEmphasis}`,
        borderRadius: 8,
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontFamily: tokens.fontMono, fontWeight: 600, fontSize: 16, color: tokens.text }}>
          {gene.name}
        </span>
        <span style={{ fontFamily: tokens.fontMono, fontWeight: 600, fontSize: 14, color: rankColor }}>
          Rank #{gene.rank}
        </span>
        {gene.annotation_warning && (
          <span
            style={{
              fontSize: 11,
              color: tokens.amber,
              background: amberSoft,
              padding: "2px 8px",
              borderRadius: 999,
            }}
          >
            ⚠ Sparse annotations
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 12 }}>
        {[
          { label: "Score", value: gene.combined_score != null ? gene.combined_score.toFixed(3) : "—" },
          {
            label: "IC Cov",
            value: `${((gene.ic_weighted_coverage ?? 0) * 100).toFixed(0)}%`,
          },
          {
            label: "Coverage",
            value: `${((gene.coverage ?? 0) * 100).toFixed(0)}% (${gene.overlap}/${patientTermCount} terms)`,
          },
          { label: "Overlap", value: gene.overlap },
          { label: "Annot", value: gene.total_annotations },
        ].map(({ label, value }) => (
          <div key={label}>
            <div
              style={{
                fontSize: 10,
                color: tokens.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 2,
              }}
            >
              {label}
            </div>
            <div style={{ fontFamily: tokens.fontMono, fontSize: 13, fontWeight: 500, color: tokens.text }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {bd && (
        <div style={{ marginBottom: 10, fontSize: 12 }}>
          <span style={{ color: tokens.textMuted }}>Bridge disease: </span>
          <span style={{ color: tokens.accent, fontWeight: 500 }}>{bd.disease_name}</span>
          <span style={{ color: tokens.textMuted }}>
            {" "}
            · Gene #{bd.gene_rank ?? gene.rank} · Dis #{bd.disease_rank}
          </span>
        </div>
      )}

      <div style={{ marginBottom: 6 }}>
        <div
          style={{
            fontSize: 11,
            color: tokens.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 6,
          }}
        >
          Matched patient terms ({gene.matched_terms?.length || 0})
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(gene.matched_terms || []).map((t) => (
            <span
              key={t.id}
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                background: greenSoft,
                color: "#15803D",
                fontFamily: tokens.fontMono,
              }}
            >
              {t.id} · {t.name} · IC {t.ic != null ? t.ic.toFixed(2) : "—"}
            </span>
          ))}
        </div>
      </div>

      {unmatchedCount > 0 && (
        <div style={{ fontSize: 11, color: tokens.textMuted, marginTop: 4 }}>
          + {unmatchedCount} gene annotations not in patient profile
        </div>
      )}

      {gene.annotation_warning && (
        <div
          style={{
            marginTop: 10,
            fontSize: 11,
            color: tokens.amber,
            background: amberSoft,
            padding: "6px 10px",
            borderRadius: 6,
          }}
        >
          {gene.annotation_warning}
        </div>
      )}
    </div>
  );
}

function PipelineResults({ data }) {
  const [allGenes, setAllGenes] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [searchNotFound, setSearchNotFound] = useState(false);
  const lowIc = (data.mean_ic ?? 0) < 1.5;

  useEffect(() => {
    setAllGenes(data.all_genes ?? []);
    setSearchQuery("");
    setSearchResult(null);
    setSearchNotFound(false);
  }, [data]);

  const handleGeneSearch = (query) => {
    const q = query.trim().toUpperCase();
    setSearchQuery(query);
    if (!q) {
      setSearchResult(null);
      setSearchNotFound(false);
      return;
    }
    const found = allGenes.find((g) => g.name.toUpperCase() === q);
    if (found) {
      setSearchResult(found);
      setSearchNotFound(false);
    } else {
      setSearchResult(null);
      setSearchNotFound(q.length >= 2);
    }
  };

  return (
    <div>
      {data.warnings?.map((w, i) => (
        <div
          key={i}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            marginBottom: 8,
            fontSize: 13,
            background: w.level === "warning" ? amberSoft : accentSoft,
            border: `1px solid ${w.level === "warning" ? C.amber : C.accent}`,
            color: w.level === "warning" ? C.amber : C.accent,
          }}
        >
          <strong>{w.level === "warning" ? "⚠ " : "ℹ "}</strong>
          {w.message}
        </div>
      ))}

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
          <strong style={{ color: C.accent }}>
            {data.expanded_terms.length} terms added by IC expansion (IC ≥ {data.ic_expansion_threshold}):
          </strong>{" "}
          {data.expanded_terms
            .slice(0, 5)
            .map((t) => `${t.name} (IC ${t.ic})`)
            .join(" · ")}
          {data.expanded_terms.length > 5 && ` · +${data.expanded_terms.length - 5} more`}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <MetricCard label="HPO terms (final)" value={data.hposet_size} />
        <Card style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 600 }}>Mean IC</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginTop: 4 }}>
            {data.mean_ic?.toFixed?.(2) ?? data.mean_ic}
          </div>
          <div style={{ fontSize: 11, color: lowIc ? C.amber : C.green, marginTop: 4 }}>
            {lowIc ? "⚠ low — add specific terms" : "Good specificity"}
          </div>
        </Card>
        <MetricCard label="Expanded terms" value={data.expanded_terms?.length ?? 0} />
        <MetricCard label="Remove modifiers" value={data.remove_modifiers_used ? "On" : "Off"} />
      </div>

      <div
        style={{
          background: C.card,
          border: `0.5px solid ${C.border}`,
          borderRadius: 10,
          padding: "14px 16px",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 10,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: C.textMuted,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Gene Search
          </span>
          <span style={{ fontSize: 11, color: C.textMuted }}>
            {(data.total_genes_scored ?? allGenes.length).toLocaleString()} genes scored · showing top{" "}
            {data.genes?.length ?? 0}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Search any gene (e.g. CFTR, HEXA, SCN5A)..."
            value={searchQuery}
            onChange={(e) => handleGeneSearch(e.target.value)}
            style={{
              flex: 1,
              padding: "8px 12px",
              border: `1px solid ${C.borderEmphasis}`,
              borderRadius: 6,
              fontSize: 13,
              fontFamily: C.fontMono,
              color: C.text,
              background: surfaceAlt,
              outline: "none",
            }}
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setSearchResult(null);
                setSearchNotFound(false);
              }}
              style={{
                fontSize: 12,
                color: C.textMuted,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px 8px",
              }}
            >
              Clear
            </button>
          ) : null}
        </div>

        {searchNotFound && !searchResult ? (
          <div style={{ marginTop: 10, fontSize: 12, color: C.textMuted, fontStyle: "italic" }}>
            {`"${searchQuery}" was not scored — it may have zero overlap with the patient's HPO terms.`}
          </div>
        ) : null}

        {searchResult ? <GeneSearchCard gene={searchResult} patientTermCount={data.hposet_size} C={C} /> : null}
      </div>

      <DualRankingTable genes={data.genes} />
    </div>
  );
}

function DualRankingTable({ genes }) {
  const [expanded, setExpanded] = useState(null);
  const maxScore = genes?.length ? Math.max(...genes.map((r) => r.combined_score ?? 0)) : 0;

  return (
    <Card>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 10 }}>
        Gene prioritization — dual ranking
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "32px 80px 1fr 90px 70px 56px 56px 120px 28px",
          gap: 6,
          padding: "5px 6px",
          borderBottom: `1px solid ${C.border}`,
          marginBottom: 4,
        }}
      >
        {["#", "Gene", "Score", "Coverage", "Overlap", "IC cov", "Annot", "Bridge disease", ""].map((h) => (
          <div
            key={h}
            style={{
              fontSize: 10,
              color: C.textMuted,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".06em",
              fontFamily: C.fontUi,
            }}
          >
            {h}
          </div>
        ))}
      </div>

      {genes?.map((g, i) => {
        const dn = g.bridge_disease?.disease_name;
        const dnShort =
          dn && dn.length > 24 ? `${dn.slice(0, 22)}…` : dn;

        return (
          <div key={`${g.name}-${i}`}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setExpanded(expanded === i ? null : i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpanded(expanded === i ? null : i);
                }
              }}
              style={{
                display: "grid",
                gridTemplateColumns: "32px 80px 1fr 90px 70px 56px 56px 120px 28px",
                gap: 6,
                padding: "8px 6px",
                alignItems: "center",
                cursor: "pointer",
                borderBottom: `1px solid ${C.border}`,
                background: expanded === i ? accentSoft : "transparent",
              }}
            >
              <span style={{ fontSize: 12, color: C.textMuted, fontFamily: C.fontMono }}>{g.rank}</span>
              <div>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: C.fontMono,
                    color: g.annotation_warning ? C.amber : C.text,
                  }}
                >
                  {g.name}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <div
                  style={{
                    flex: 1,
                    background: "rgba(37, 99, 235, 0.12)",
                    borderRadius: 999,
                    overflow: "hidden",
                    height: 10,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      width: `${maxScore > 0 ? Math.min(100, ((g.combined_score ?? 0) / maxScore) * 100) : 0}%`,
                      height: "100%",
                      background: C.accent,
                      borderRadius: 999,
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: C.fontMono,
                    fontSize: 12,
                    fontWeight: 500,
                    color: C.text,
                    minWidth: 36,
                    textAlign: "right",
                  }}
                >
                  {(g.combined_score ?? 0).toFixed(2)}
                </span>
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: C.textSecondary,
                  whiteSpace: "nowrap",
                }}
              >
                {(g.coverage * 100).toFixed(0)}% ({g.overlap} terms)
              </span>
              <span
                style={{
                  fontFamily: C.fontMono,
                  fontSize: 12,
                  color: C.textSecondary,
                }}
              >
                {(g.coverage * 100).toFixed(0)}%
              </span>
              <span
                style={{
                  fontFamily: C.fontMono,
                  fontSize: 12,
                  color: (g.ic_weighted_coverage ?? 0) >= 0.5 ? C.green : C.textMuted,
                }}
              >
                {((g.ic_weighted_coverage ?? 0) * 100).toFixed(0)}%
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontFamily: C.fontMono,
                  fontSize: 12,
                  color: C.textMuted,
                }}
              >
                {g.total_annotations}
                {g.annotation_warning ? (
                  <span title={g.annotation_warning} style={{ color: C.amber, fontSize: 11 }}>
                    ⚠
                  </span>
                ) : null}
              </span>
              <div style={{ fontSize: 11, lineHeight: 1.4 }}>
                {g.bridge_disease ? (
                  <>
                    <div style={{ color: C.accent, fontWeight: 600, fontSize: 10 }}>{dnShort}</div>
                    <div style={{ color: C.textMuted }}>
                      Gene #{g.rank} · Dis #{g.bridge_disease.disease_rank}
                    </div>
                  </>
                ) : (
                  <span style={{ color: C.textMuted }}>—</span>
                )}
              </div>
              <span style={{ color: C.textMuted, fontSize: 13 }}>{expanded === i ? "▲" : "▼"}</span>
            </div>

            {expanded === i && (
              <div
                style={{
                  padding: "10px 14px",
                  background: surfaceAlt,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                {g.annotation_warning && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: amberSoft,
                      border: `1px solid ${C.amber}`,
                      borderRadius: 8,
                      fontSize: 12,
                      color: C.amber,
                      marginBottom: 10,
                    }}
                  >
                    ⚠ {g.annotation_warning}
                  </div>
                )}

                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 6 }}>
                  Matched terms ({g.matched_terms?.length ?? 0})
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                  {g.matched_terms?.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 20,
                        fontSize: 11,
                        background: t.ic > 5 ? accentSoft : surfaceAlt,
                        border: `1px solid ${t.ic > 5 ? blueBorder : C.border}`,
                      }}
                    >
                      <span style={{ color: C.text }}>{t.name}</span>{" "}
                      <span
                        style={{
                          fontFamily: C.fontMono,
                          fontSize: 10,
                          color: t.ic > 5 ? C.accent : t.ic > 3 ? C.amber : C.textMuted,
                        }}
                      >
                        IC {t.ic}
                      </span>
                    </div>
                  ))}
                </div>

                {g.bridge_disease && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: blueSoft,
                      border: `1px solid ${blueBorder}`,
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ fontWeight: 600, color: C.text }}>Bridge disease: </span>
                    <span style={{ color: C.accent }}>{g.bridge_disease.disease_name}</span>
                    {" · "}
                    <span style={{ color: C.textMuted }}>
                      Gene rank #{g.rank} · Disease rank #{g.bridge_disease.disease_rank}
                    </span>
                    {g.annotation_warning && (
                      <div style={{ marginTop: 4, color: C.textSecondary, fontSize: 11 }}>
                        Gene HPO annotations are sparse — the disease rank (#{g.bridge_disease.disease_rank}) is
                        the more reliable signal for this candidate.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

export default function GenePrioritizationPipeline() {
  const [terms, setTerms] = useState("");
  const [topN, setTopN] = useState(20);
  const [removeModif, setRemoveModif] = useState(false);
  const [expandIC, setExpandIC] = useState(true);
  const [icThreshold, setIcThreshold] = useState(2.0);
  const mut = useGenePrioritization();

  const handleRun = () => {
    const queries = linesToQueries(terms);
    if (!queries.length) return;
    mut.mutate({
      queries,
      remove_modifiers: removeModif,
      expand_ic: expandIC,
      ic_expansion_threshold: icThreshold,
      top_n: topN,
    });
  };

  return (
    <div>
      <Topbar
        title="Gene Prioritization Pipeline"
        subtitle="Semantic similarity ranking with dual gene + disease scoring, annotation density flags, and IC-filtered term expansion. API: POST /api/gene-prioritization"
      />

      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 14 }}>
          <div>
            <Textarea
              label="HPO terms (one per line — ID or name)"
              rows={8}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder={"HP:0001250\nHP:0001263\n..."}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>Top N results</div>
              <input
                type="range"
                min={5}
                max={5000}
                step={5}
                value={topN}
                onChange={(e) => setTopN(+e.target.value)}
                style={{ width: "100%" }}
              />
              <div style={{ fontSize: 11, color: C.textMuted }}>Top {topN} genes</div>
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
              <input
                type="checkbox"
                checked={removeModif}
                onChange={(e) => setRemoveModif(e.target.checked)}
              />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Remove modifier terms</div>
                <div style={{ fontSize: 10, color: C.textMuted }}>
                  Strips severity, frequency, fever. Off by default — fever matters in HLH.
                </div>
              </div>
            </label>

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

            <CTA onClick={handleRun} disabled={mut.isPending}>
              {mut.isPending ? "Running…" : "Run pipeline"}
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

      {mut.isSuccess && mut.data && <PipelineResults data={mut.data} />}
    </div>
  );
}
