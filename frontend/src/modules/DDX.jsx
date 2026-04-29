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
import { linesToQueries, scoreWidths, SIGNAL_TOOLTIP, ENRICHMENT_COLUMN_HELP } from "../lib/utils";

const selectStyle = {
  marginLeft: 8,
  padding: 8,
  borderRadius: 8,
  border: `1px solid ${C.border}`,
  fontSize: 13,
  color: C.text,
  background: C.surfaceAlt,
};

export default function DDX() {
  const [terms, setTerms] = useState("HP:0002650\nHP:0001166");
  const [source, setSource] = useState("omim");
  const [mode, setMode] = useState("diagnostic");
  const mutation = useEnrichment();

  const run = () => {
    const queries = linesToQueries(terms);
    mutation.mutate({ queries, source, top_n: 20, mode });
  };

  const resMode = mutation.data?.mode ?? mode;
  const isResearch = resMode === "research";

  const rows =
    mutation.data?.results?.map((d, i) => {
      const w = isResearch
        ? scoreWidths(mutation.data.results)[i]
        : scoreWidths(mutation.data.results, { key: "similarity", higherIsBetter: true })[i];
      if (isResearch) {
        return [
          d.rank,
          d.name,
          <Pill key={`id-${i}`}>{d.id}</Pill>,
          d.count,
          <span style={{ fontFamily: C.fontMono }}>{d.enrichment.toExponential(3)}</span>,
          <ScoreBar key={`b-${i}`} pct={w} title={SIGNAL_TOOLTIP.research} />,
        ];
      }
      return [
        d.rank,
        d.name,
        <Pill key={`id-${i}`}>{d.id}</Pill>,
        d.similarity.toFixed(4),
        `${(d.coverage * 100).toFixed(0)}%`,
        d.overlap,
        <ScoreBar key={`b-${i}`} pct={w} title={SIGNAL_TOOLTIP.diagnostic} />,
      ];
    }) ?? [];

  const subtitle =
    mode === "research"
      ? "Research mode: hypergeometric enrichment (GWAS-style) — not tuned for bedside ranking."
      : "Diagnostic mode: semantic similarity (Resnik + funSimAvg, patient→entity) plus coverage of your HPO terms — decision support only.";

  const headers = isResearch
    ? ["#", "Name", "ID", "Count", "p-value", "Signal"]
    : ["#", "Name", "ID", "Similarity", "Coverage", "Overlap", "Signal"];

  return (
    <div>
      <Topbar title="Differential diagnosis" subtitle={subtitle} />
      <Card>
        <Textarea label="HPO terms (one per line)" value={terms} onChange={(e) => setTerms(e.target.value)} />
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary }}>Source </span>
            <select value={source} onChange={(e) => setSource(e.target.value)} style={selectStyle}>
              <option value="omim">OMIM</option>
              <option value="orpha">Orphanet</option>
              <option value="decipher">Decipher</option>
              <option value="gene">Gene</option>
            </select>
          </div>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary }}>Analysis mode </span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} style={selectStyle}>
              <option value="diagnostic">Diagnostic (similarity)</option>
              <option value="research">Research (hypergeometric)</option>
            </select>
          </div>
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
              Mode: <strong>{mutation.data.mode}</strong> · HPOSet size: <strong>{mutation.data.hposet_size}</strong>
            </p>
            <ResultTable
              title="Top results"
              headers={headers}
              rows={rows}
              columnHelp={isResearch ? ENRICHMENT_COLUMN_HELP.research : ENRICHMENT_COLUMN_HELP.diagnostic}
            />
          </>
        )}
      </Card>
    </div>
  );
}
