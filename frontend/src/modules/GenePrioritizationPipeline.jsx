import { useState } from "react";
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

function PipelineResults({ data }) {
  const lowIc = (data.mean_ic ?? 0) < 1.5;

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
              <span style={{ fontSize: 11, color: C.textSecondary }}>
                {(g.coverage * 100).toFixed(0)}% ({g.overlap} terms)
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: C.fontMono,
                  color: g.ic_weighted_coverage > 0.5 ? C.green : C.textSecondary,
                }}
              >
                {(g.ic_weighted_coverage * 100).toFixed(0)}%
              </span>
              <span style={{ fontSize: 11, fontFamily: C.fontMono, color: C.textMuted }}>
                {g.total_annotations}
              </span>
              <span style={{ fontSize: 11 }}>
                {g.annotation_warning ? (
                  <span title={g.annotation_warning} style={{ color: C.amber }}>
                    ⚠ sparse
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
                max={100}
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
