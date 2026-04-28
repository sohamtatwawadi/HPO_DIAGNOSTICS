import { C } from "../../tokens";
import CTA from "../../components/CTA";
import ResultTable from "../../components/ResultTable";
import Pill from "../../components/Pill";
import ScoreBar from "../../components/ScoreBar";
import { useEnrichment } from "../../hooks/useAPI";
import { scoreWidths } from "../../lib/utils";

export default function Step3Disease({ stepData, setStepData, onNext }) {
  const m = useEnrichment();

  const run = async () => {
    const res = await m.mutateAsync({
      queries: stepData.resolvedIds,
      source: "omim",
      top_n: 15,
    });
    setStepData((s) => ({ ...s, omimEnrichment: res }));
  };

  const rows =
    stepData.omimEnrichment?.results?.map((d, i) => {
      const w = scoreWidths(stepData.omimEnrichment.results)[i];
      return [d.rank, d.name, <Pill key={i}>{d.id}</Pill>, d.count, d.enrichment.toExponential(2), <ScoreBar pct={w} />];
    }) ?? [];

  return (
    <div>
      <p style={{ color: C.textSecondary, fontSize: 14 }}>POST /api/enrichment (source=omim).</p>
      <CTA onClick={run} disabled={m.isPending || !stepData.resolvedIds?.length}>
        {m.isPending ? "Running…" : "Run OMIM differential"}
      </CTA>
      {stepData.omimEnrichment && (
        <ResultTable
          title="Top OMIM"
          headers={["#", "Disease", "ID", "Count", "Enrich.", "Signal"]}
          rows={rows}
        />
      )}
      <div style={{ marginTop: 16 }}>
        <CTA disabled={!stepData.omimEnrichment} onClick={onNext}>
          Continue → Gene cross-check
        </CTA>
      </div>
    </div>
  );
}
