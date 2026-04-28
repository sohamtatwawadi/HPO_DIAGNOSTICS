import { useState } from "react";
import { C } from "../tokens";
import Card from "../components/Card";
import Topbar from "../components/Topbar";
import Textarea from "../components/Textarea";
import CTA from "../components/CTA";
import ResultTable from "../components/ResultTable";
import Pill from "../components/Pill";
import ScoreBar from "../components/ScoreBar";
import { useGeneHpoEnrichment } from "../hooks/useAPI";
import { linesToQueries, scoreWidths } from "../lib/utils";

export default function GeneEnrichment() {
  const [genes, setGenes] = useState("BRCA1\nTP53\nFBN1");
  const [minCount, setMinCount] = useState(1);
  const mutation = useGeneHpoEnrichment();

  const run = () => {
    const g = linesToQueries(genes);
    mutation.mutate({ genes: g, min_count: minCount, top_n: 80 });
  };

  const rows =
    mutation.data?.results?.map((d, i) => {
      const w = scoreWidths(mutation.data.results)[i];
      return [
        d.rank,
        d.name,
        <Pill key={i}>{d.id}</Pill>,
        d.count,
        <span style={{ fontFamily: C.fontMono }}>{d.enrichment.toExponential(3)}</span>,
        <ScoreBar pct={w} />,
      ];
    }) ?? [];

  return (
    <div>
      <Topbar title="Gene enrichment" subtitle="Gene-level HPO enrichment from a gene symbol list." />
      <Card>
        <Textarea label="Gene symbols (one per line)" value={genes} onChange={(e) => setGenes(e.target.value)} />
        <label style={{ display: "block", marginTop: 12, fontSize: 13, color: C.text }}>
          Minimum count threshold: {minCount}
          <input
            type="range"
            min={1}
            max={20}
            value={minCount}
            onChange={(e) => setMinCount(Number(e.target.value))}
            style={{ width: "100%", marginTop: 6 }}
          />
        </label>
        <CTA style={{ marginTop: 12 }} onClick={run} disabled={mutation.isPending}>
          {mutation.isPending ? "Running…" : "Run enrichment"}
        </CTA>
        {mutation.isError && (
          <div style={{ color: C.red, marginTop: 12, fontSize: 13 }}>{mutation.error.message}</div>
        )}
        {mutation.data && (
          <>
            <p style={{ fontSize: 13, color: C.textSecondary }}>
              Genes used: <strong>{mutation.data.gene_count}</strong>
              {mutation.data.skipped_genes?.length > 0 && (
                <>
                  {" "}
                  · Skipped: {mutation.data.skipped_genes.join(", ")}
                </>
              )}
            </p>
            <ResultTable
              title="Enriched HPO terms"
              headers={["#", "HPO term", "ID", "Count", "Enrichment", "Signal"]}
              rows={rows}
            />
          </>
        )}
      </Card>
    </div>
  );
}
