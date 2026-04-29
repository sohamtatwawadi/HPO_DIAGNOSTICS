import { C } from "../../tokens";
import CTA from "../../components/CTA";
import ResultTable from "../../components/ResultTable";
import Pill from "../../components/Pill";
import ScoreBar from "../../components/ScoreBar";
import { useEnrichment } from "../../hooks/useAPI";
import { scoreWidths, SIGNAL_TOOLTIP, ENRICHMENT_COLUMN_HELP } from "../../lib/utils";

export default function Step3Disease({ stepData, setStepData, onNext }) {
  const m = useEnrichment();

  const run = async () => {
    const res = await m.mutateAsync({
      queries: stepData.resolvedIds,
      source: "omim",
      top_n: 15,
      mode: "diagnostic",
    });
    setStepData((s) => ({ ...s, omimEnrichment: res }));
  };

  const res = stepData.omimEnrichment;
  const isResearch = res?.mode === "research";
  const rows =
    res?.results?.map((d, i) => {
      const w = isResearch
        ? scoreWidths(res.results)[i]
        : scoreWidths(res.results, { key: "similarity", higherIsBetter: true })[i];
      if (isResearch) {
        return [
          d.rank,
          d.name,
          <Pill key={i}>{d.id}</Pill>,
          d.count,
          d.enrichment.toExponential(2),
          <ScoreBar pct={w} title={SIGNAL_TOOLTIP.research} />,
        ];
      }
      return [
        d.rank,
        d.name,
        <Pill key={i}>{d.id}</Pill>,
        d.similarity.toFixed(4),
        `${(d.coverage * 100).toFixed(0)}%`,
        d.overlap,
        <ScoreBar pct={w} title={SIGNAL_TOOLTIP.diagnostic} />,
      ];
    }) ?? [];

  const headers = isResearch
    ? ["#", "Disease", "ID", "Count", "Enrich.", "Signal"]
    : ["#", "Disease", "ID", "Similarity", "Cov.", "Overlap", "Signal"];

  return (
    <div>
      <p style={{ color: C.textSecondary, fontSize: 14 }}>
        POST /api/enrichment (source=omim, mode=diagnostic) — similarity + coverage ranking.
      </p>
      <CTA onClick={run} disabled={m.isPending || !stepData.resolvedIds?.length}>
        {m.isPending ? "Running…" : "Run OMIM differential"}
      </CTA>
      {res && (
        <ResultTable
          title="Top OMIM"
          headers={headers}
          rows={rows}
          columnHelp={isResearch ? ENRICHMENT_COLUMN_HELP.research : ENRICHMENT_COLUMN_HELP.diagnostic}
        />
      )}
      <div style={{ marginTop: 16 }}>
        <CTA disabled={!res} onClick={onNext}>
          Continue → Gene cross-check
        </CTA>
      </div>
    </div>
  );
}
