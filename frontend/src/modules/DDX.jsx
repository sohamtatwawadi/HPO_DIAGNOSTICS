import { useState } from "react";
import { C } from "../tokens";
import Card from "../components/Card";
import Topbar from "../components/Topbar";
import Textarea from "../components/Textarea";
import CTA from "../components/CTA";
import ResultTable from "../components/ResultTable";
import Pill from "../components/Pill";
import ScoreBar from "../components/ScoreBar";
import { useEnrichment } from "../hooks/useAPI";
import { linesToQueries, scoreWidths } from "../lib/utils";

export default function DDX() {
  const [terms, setTerms] = useState("HP:0002650\nHP:0001166");
  const [source, setSource] = useState("omim");
  const mutation = useEnrichment();

  const run = () => {
    const queries = linesToQueries(terms);
    mutation.mutate({ queries, source, top_n: 20 });
  };

  const rows =
    mutation.data?.results?.map((d, i) => {
      const w = scoreWidths(mutation.data.results)[i];
      return [
        d.rank,
        d.name,
        <Pill key={`id-${i}`}>{d.id}</Pill>,
        d.count,
        <span style={{ fontFamily: C.fontMono }}>{d.enrichment.toExponential(3)}</span>,
        <ScoreBar key={`b-${i}`} pct={w} />,
      ];
    }) ?? [];

  return (
    <div>
      <Topbar
        title="Differential diagnosis"
        subtitle="Disease enrichment (hypergeometric) from HPO terms — decision support only."
      />
      <Card>
        <Textarea label="HPO terms (one per line)" value={terms} onChange={(e) => setTerms(e.target.value)} />
        <div style={{ marginTop: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary }}>Source </span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            style={{ marginLeft: 8, padding: 8, borderRadius: 8, border: `1px solid ${C.border}` }}
          >
            <option value="omim">OMIM</option>
            <option value="orpha">Orphanet</option>
            <option value="decipher">Decipher</option>
            <option value="gene">Gene</option>
          </select>
        </div>
        <div style={{ marginTop: 14 }}>
          <CTA onClick={run} disabled={mutation.isPending}>
            {mutation.isPending ? "Running…" : "Run diagnosis"}
          </CTA>
        </div>
        {mutation.isError && (
          <div style={{ color: C.red, fontSize: 13, marginTop: 12 }}>{mutation.error.message}</div>
        )}
        {mutation.data && (
          <>
            <p style={{ fontSize: 13, color: C.textSecondary }}>
              HPOSet size: <strong>{mutation.data.hposet_size}</strong>
            </p>
            <ResultTable
              title="Top results"
              headers={["#", "Name", "ID", "Count", "Enrichment", "Signal"]}
              rows={rows}
            />
          </>
        )}
      </Card>
    </div>
  );
}
