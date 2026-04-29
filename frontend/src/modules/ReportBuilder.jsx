import { useState } from "react";
import { C } from "../tokens";
import Card from "../components/Card";
import Topbar from "../components/Topbar";
import Textarea from "../components/Textarea";
import CTA from "../components/CTA";
import { useEnrichment, useSimilarity, useVariantPrioritize } from "../hooks/useAPI";
import { linesToQueries } from "../lib/utils";

export default function ReportBuilder() {
  const [caseId, setCaseId] = useState("CASE-001");
  const [notes, setNotes] = useState("");
  const [hpo, setHpo] = useState("HP:0002650\nHP:0001166");
  const [genes, setGenes] = useState("FBN1");

  const ddx = useEnrichment();
  const sim = useSimilarity();
  const vp = useVariantPrioritize();

  const build = async () => {
    const queries = linesToQueries(hpo);
    const g = linesToQueries(genes);
    await ddx.mutateAsync({ queries, source: "omim", top_n: 10, mode: "diagnostic" });
    if (queries.length >= 2) {
      await sim.mutateAsync({
        patient1: [queries[0]],
        patient2: [queries[1]],
        kind: "omim",
        method: "resnik",
        combine: "BMA",
      });
    }
    if (g.length) await vp.mutateAsync({ hpo_queries: queries, candidate_genes: g, mode: "diagnostic" });
  };

  const bundle = {
    caseId,
    notes,
    generated: new Date().toISOString(),
    ddx: ddx.data,
    similarity: sim.data,
    variants: vp.data,
  };
  const json = JSON.stringify(bundle, null, 2);

  return (
    <div>
      <Topbar
        title="Report builder"
        subtitle="Compose a JSON evidence bundle from diagnostic ranking (similarity + coverage), similarity, and variant prioritization."
      />
      <Card>
        <label style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
          Case ID
          <input
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            style={{
              display: "block",
              width: "100%",
              marginTop: 6,
              padding: 10,
              borderRadius: 8,
              border: `1px solid ${C.border}`,
            }}
          />
        </label>
        <div style={{ marginTop: 12 }}>
          <Textarea label="Clinical notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <Textarea label="HPO terms" value={hpo} onChange={(e) => setHpo(e.target.value)} />
        <Textarea label="Genes (optional)" value={genes} onChange={(e) => setGenes(e.target.value)} />
        <CTA style={{ marginTop: 12 }} onClick={build} disabled={ddx.isPending || sim.isPending || vp.isPending}>
          {ddx.isPending || sim.isPending || vp.isPending ? "Building…" : "Build bundle"}
        </CTA>
      </Card>
      {(ddx.data || sim.data || vp.data) && (
        <Card style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Preview</h3>
          <pre style={{ fontSize: 11, overflow: "auto", maxHeight: 360, fontFamily: "DM Mono, monospace" }}>
            {json}
          </pre>
          <a
            href={`data:application/json;charset=utf-8,${encodeURIComponent(json)}`}
            download={`${caseId || "report"}_bundle.json`}
            style={{
              display: "inline-block",
              marginTop: 12,
              padding: "10px 16px",
              background: C.accent,
              color: "#fff",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Download JSON
          </a>
        </Card>
      )}
    </div>
  );
}
