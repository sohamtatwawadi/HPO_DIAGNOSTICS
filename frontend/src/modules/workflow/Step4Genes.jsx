import { useState } from "react";
import { C } from "../../tokens";
import Textarea from "../../components/Textarea";
import CTA from "../../components/CTA";
import { useGeneHpoEnrichment } from "../../hooks/useAPI";
import { linesToQueries } from "../../lib/utils";

export default function Step4Genes({ stepData, setStepData, onNext }) {
  const [g, setG] = useState(stepData.vcfGenes ?? "FBN1\nTP53");
  const m = useGeneHpoEnrichment();

  const run = async () => {
    const genes = linesToQueries(g);
    const res = await m.mutateAsync({ genes, min_count: 1, top_n: 40 });
    setStepData((s) => ({ ...s, vcfGenes: g, geneHpoEnrichment: res }));
  };

  return (
    <div>
      <p style={{ color: C.textSecondary, fontSize: 14 }}>
        POST /api/gene-hpo-enrichment on VCF / panel gene symbols.
      </p>
      <Textarea label="Gene symbols" value={g} onChange={(e) => setG(e.target.value)} />
      <CTA onClick={run} disabled={m.isPending}>
        {m.isPending ? "Running…" : "Run gene → HPO enrichment"}
      </CTA>
      {stepData.geneHpoEnrichment && (
        <p style={{ fontSize: 13, color: C.textSecondary, marginTop: 10 }}>
          Top enriched term:{" "}
          <strong>{stepData.geneHpoEnrichment.results[0]?.name ?? "—"}</strong>
        </p>
      )}
      <div style={{ marginTop: 16 }}>
        <CTA disabled={!stepData.geneHpoEnrichment} onClick={onNext}>
          Continue → Cohort similarity
        </CTA>
      </div>
    </div>
  );
}
