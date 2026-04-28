import { useState } from "react";
import { C } from "../../tokens";
import Textarea from "../../components/Textarea";
import CTA from "../../components/CTA";
import { useSimilarity } from "../../hooks/useAPI";
import { linesToQueries } from "../../lib/utils";

export default function Step5Cohort({ stepData, setStepData, onNext }) {
  const [cohortLine, setCohortLine] = useState(stepData.cohortPeer ?? "HP:0001166");
  const m = useSimilarity();

  const run = async () => {
    const p2 = linesToQueries(cohortLine);
    const res = await m.mutateAsync({
      patient1: stepData.resolvedIds,
      patient2: p2,
      kind: "omim",
      method: "resnik",
      combine: "BMA",
    });
    setStepData((s) => ({ ...s, cohortPeer: cohortLine, cohortSimilarity: res }));
  };

  return (
    <div>
      <p style={{ color: C.textSecondary, fontSize: 14 }}>
        POST /api/similarity — index case vs one cohort peer (add more peers sequentially in product).
      </p>
      <Textarea label="Cohort member HPO (one per line)" value={cohortLine} onChange={(e) => setCohortLine(e.target.value)} />
      <CTA onClick={run} disabled={m.isPending || !stepData.resolvedIds?.length}>
        {m.isPending ? "Running…" : "Compare to cohort peer"}
      </CTA>
      {stepData.cohortSimilarity && (
        <p style={{ marginTop: 12, fontSize: 15, fontWeight: 600, color: C.text }}>
          Score: {stepData.cohortSimilarity.score.toFixed(4)}
        </p>
      )}
      <div style={{ marginTop: 16 }}>
        <CTA disabled={!stepData.cohortSimilarity} onClick={onNext}>
          Continue → Disease validation
        </CTA>
      </div>
    </div>
  );
}
