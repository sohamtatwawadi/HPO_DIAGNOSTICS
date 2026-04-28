import { useState } from "react";
import { C } from "../tokens";
import Card from "../components/Card";
import Topbar from "../components/Topbar";
import Textarea from "../components/Textarea";
import CTA from "../components/CTA";
import ResultTable from "../components/ResultTable";
import MetricCard from "../components/MetricCard";
import { useICProfile } from "../hooks/useAPI";
import { linesToQueries } from "../lib/utils";

export default function ICProfiler() {
  const [terms, setTerms] = useState("HP:0002650\nHP:0001166");
  const mutation = useICProfile();

  const run = () => mutation.mutate(linesToQueries(terms));

  const rows =
    mutation.data?.terms?.map((t) => [
      t.id,
      t.name,
      t.ic_omim.toFixed(3),
      t.ic_gene.toFixed(3),
      t.ic_orpha.toFixed(3),
      t.depth,
    ]) ?? [];

  return (
    <div>
      <Topbar title="IC profiler" subtitle="Information content per term and set-level summary." />
      <Card>
        <Textarea label="HPO terms" value={terms} onChange={(e) => setTerms(e.target.value)} />
        <CTA style={{ marginTop: 12 }} onClick={run} disabled={mutation.isPending}>
          {mutation.isPending ? "Running…" : "Run IC profile"}
        </CTA>
        {mutation.isError && (
          <div style={{ color: C.red, marginTop: 12, fontSize: 13 }}>{mutation.error.message}</div>
        )}
        {mutation.data && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 16 }}>
              <MetricCard label="Mean IC (OMIM)" value={mutation.data.set_summary.mean.toFixed(4)} />
              <MetricCard label="Total IC" value={mutation.data.set_summary.total.toFixed(4)} />
              <MetricCard label="Max IC" value={mutation.data.set_summary.max.toFixed(4)} />
            </div>
            <ResultTable
              title="Per-term IC"
              headers={["ID", "Name", "IC omim", "IC gene", "IC orpha", "Depth"]}
              rows={rows}
            />
          </>
        )}
      </Card>
    </div>
  );
}
