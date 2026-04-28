import { useState } from "react";
import { C } from "../../tokens";
import Textarea from "../../components/Textarea";
import CTA from "../../components/CTA";
import { useResolveTerms } from "../../hooks/useAPI";
import { linesToQueries } from "../../lib/utils";

export default function Step1Enter({ stepData, setStepData, onNext }) {
  const [raw, setRaw] = useState(stepData.rawHpo ?? "HP:0002650\nScoliosis");
  const m = useResolveTerms();

  const run = async () => {
    const queries = linesToQueries(raw);
    const res = await m.mutateAsync(queries);
    const ids = res.resolved.map((t) => t.id);
    setStepData((s) => ({
      ...s,
      rawHpo: raw,
      resolved: res.resolved,
      failed: res.failed,
      resolvedIds: ids,
    }));
  };

  return (
    <div>
      <p style={{ color: C.textSecondary, fontSize: 14 }}>
        Enter free-text or HP IDs. We resolve via{" "}
        <code style={{ fontFamily: "DM Mono, monospace" }}>POST /api/resolve</code>.
      </p>
      <Textarea label="Phenotype lines" value={raw} onChange={(e) => setRaw(e.target.value)} />
      <CTA onClick={run} disabled={m.isPending}>
        {m.isPending ? "Resolving…" : "Resolve terms"}
      </CTA>
      {stepData.resolved && (
        <div style={{ marginTop: 12, fontSize: 13, color: C.textSecondary }}>
          Resolved <strong>{stepData.resolved.length}</strong> terms
          {stepData.failed?.length > 0 && (
            <>
              {" "}
              · Failed: {stepData.failed.join(", ")}
            </>
          )}
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <CTA disabled={!stepData.resolvedIds?.length} onClick={onNext}>
          Continue → IC profile
        </CTA>
      </div>
    </div>
  );
}
