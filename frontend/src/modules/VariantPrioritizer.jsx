import { useState } from "react";
import { C } from "../tokens";
import Card from "../components/Card";
import Topbar from "../components/Topbar";
import Textarea from "../components/Textarea";
import CTA from "../components/CTA";
import ResultTable from "../components/ResultTable";
import ScoreBar from "../components/ScoreBar";
import MetricCard from "../components/MetricCard";
import Badge from "../components/Badge";
import { useVariantPrioritize } from "../hooks/useAPI";
import { linesToQueries, scoreWidths, SIGNAL_TOOLTIP, VARIANT_COLUMN_HELP } from "../lib/utils";

const modeSelect = {
  marginTop: 12,
  padding: 8,
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  fontSize: 13,
  color: C.text,
  background: C.surfaceAlt,
  maxWidth: 360,
};

export default function VariantPrioritizer() {
  const [hpo, setHpo] = useState("HP:0002650\nHP:0001166");
  const [genes, setGenes] = useState("FBN1\nTTN\nUNKNOWNGENE");
  const [mode, setMode] = useState("diagnostic");
  const mutation = useVariantPrioritize();

  const run = () =>
    mutation.mutate({
      hpo_queries: linesToQueries(hpo),
      candidate_genes: linesToQueries(genes),
      mode,
    });

  const pri = mutation.data?.prioritized ?? [];
  const resMode = mutation.data?.mode ?? mode;
  const isResearch = resMode === "research";

  const widths = isResearch
    ? scoreWidths(pri, "score")
    : scoreWidths(pri, { key: "similarity", higherIsBetter: true });

  const geneLabel = (r) => r.gene ?? r.name ?? "—";

  const rows = pri.map((r, i) => {
    if (isResearch) {
      return [
        i + 1,
        geneLabel(r),
        <span style={{ fontFamily: C.fontMono }}>{r.score.toExponential(3)}</span>,
        <ScoreBar pct={widths[i]} title={SIGNAL_TOOLTIP.research} />,
      ];
    }
    return [
      r.rank ?? i + 1,
        geneLabel(r),
        r.similarity.toFixed(4),
        `${(r.coverage * 100).toFixed(0)}%`,
        r.overlap,
        r.has_match ? (
          <Badge tone="ok">Match</Badge>
        ) : (
          <Badge tone="warn">No overlap</Badge>
        ),
        <ScoreBar pct={widths[i]} title={SIGNAL_TOOLTIP.diagnostic} />,
    ];
  });

  const missingRows = (mutation.data?.missing ?? []).map((g, i) => [
    pri.length + i + 1,
    <span>
      {g}{" "}
      <Badge tone="warn">{isResearch ? "No enrichment hit" : "Not in ontology"}</Badge>
    </span>,
    ...(isResearch
      ? [<span style={{ fontFamily: C.fontMono }}>—</span>, <ScoreBar pct={8} title={SIGNAL_TOOLTIP.research} />]
      : [
          "—",
          "—",
          "—",
          <Badge tone="warn">—</Badge>,
          <ScoreBar pct={8} title={SIGNAL_TOOLTIP.diagnostic} />,
        ]),
  ]);

  const headers = isResearch ? ["Rank", "Gene", "p-value", "Signal"] : ["Rank", "Gene", "Sim.", "Cov.", "Overlap", "", "Signal"];

  const subtitle =
    mode === "research"
      ? "Research mode: hypergeometric gene enrichment filtered to your VCF list."
      : "Diagnostic mode: semantic similarity plus coverage over your candidate genes only.";

  const withMatch = pri.filter((r) => (r.overlap ?? 0) > 0).length;

  return (
    <div>
      <Topbar title="Variant prioritizer" subtitle={subtitle} />
      <div style={{ marginTop: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary }}>Analysis mode </span>
        <select value={mode} onChange={(e) => setMode(e.target.value)} style={modeSelect}>
          <option value="diagnostic">Diagnostic (similarity)</option>
          <option value="research">Research (hypergeometric)</option>
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <Card>
          <Textarea label="Patient HPO" value={hpo} onChange={(e) => setHpo(e.target.value)} />
        </Card>
        <Card>
          <Textarea label="Candidate genes" value={genes} onChange={(e) => setGenes(e.target.value)} />
        </Card>
      </div>
      <Card style={{ marginTop: 16 }}>
        <CTA onClick={run} disabled={mutation.isPending}>
          {mutation.isPending ? "Running…" : "Prioritize variants"}
        </CTA>
        {mutation.isError && (
          <div style={{ color: C.red, marginTop: 12, fontSize: 13 }}>{mutation.error.message}</div>
        )}
        {mutation.data && (
          <>
            <p style={{ fontSize: 13, color: C.textSecondary, marginTop: 12 }}>
              Mode: <strong>{mutation.data.mode}</strong>
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 8 }}>
              <MetricCard label="Candidates" value={linesToQueries(genes).length} />
              <MetricCard
                label={isResearch ? "Ranked (enrichment)" : "With HPO overlap"}
                value={isResearch ? String(pri.length) : String(withMatch)}
              />
              <MetricCard label="Top gene" value={geneLabel(pri[0]) ?? "—"} />
            </div>
            <ResultTable
              title="Prioritized"
              headers={headers}
              rows={[...rows, ...missingRows]}
              columnHelp={isResearch ? VARIANT_COLUMN_HELP.research : VARIANT_COLUMN_HELP.diagnostic}
            />
          </>
        )}
      </Card>
    </div>
  );
}
