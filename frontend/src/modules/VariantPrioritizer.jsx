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
import { linesToQueries, scoreWidths } from "../lib/utils";

export default function VariantPrioritizer() {
  const [hpo, setHpo] = useState("HP:0002650\nHP:0001166");
  const [genes, setGenes] = useState("FBN1\nTTN\nUNKNOWNGENE");
  const mutation = useVariantPrioritize();

  const run = () =>
    mutation.mutate({
      hpo_queries: linesToQueries(hpo),
      candidate_genes: linesToQueries(genes),
    });

  const pri = mutation.data?.prioritized ?? [];
  const widths = scoreWidths(pri, "score");
  const rows = pri.map((r, i) => [
    i + 1,
    r.gene,
    <span style={{ fontFamily: C.fontMono }}>{r.score.toExponential(3)}</span>,
    <ScoreBar pct={widths[i]} />,
  ]);
  const missingRows = (mutation.data?.missing ?? []).map((g, i) => [
    pri.length + i + 1,
    <span>
      {g} <Badge tone="warn">No HPO association</Badge>
    </span>,
    <span style={{ fontFamily: C.fontMono }}>0</span>,
    <ScoreBar pct={8} />,
  ]);

  return (
    <div>
      <Topbar title="Variant prioritizer" subtitle="Re-rank VCF gene candidates by phenotype enrichment." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 16 }}>
              <MetricCard label="Candidates" value={linesToQueries(genes).length} />
              <MetricCard label="With HPO match" value={pri.length} />
              <MetricCard label="Top gene" value={pri[0]?.gene ?? "—"} />
            </div>
            <ResultTable
              title="Prioritized"
              headers={["Rank", "Gene", "Score", "Signal"]}
              rows={[...rows, ...missingRows]}
            />
          </>
        )}
      </Card>
    </div>
  );
}
