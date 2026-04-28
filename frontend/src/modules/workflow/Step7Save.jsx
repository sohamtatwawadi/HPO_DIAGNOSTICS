import { useState } from "react";
import { C } from "../../tokens";
import Input from "../../components/Input";
import CTA from "../../components/CTA";
import { useSerialize } from "../../hooks/useAPI";

const KEY = "hpo_sessions";

export default function Step7Save({ stepData, setStepData }) {
  const [caseId, setCaseId] = useState("CASE-001");
  const ser = useSerialize();

  const save = async () => {
    const { serialized } = await ser.mutateAsync(stepData.resolvedIds);
    const session = {
      id: caseId,
      date: new Date().toISOString(),
      serialized,
      topDisease: stepData.omimEnrichment?.results?.[0]?.name,
      topGeneTerm: stepData.geneHpoEnrichment?.results?.[0]?.name,
      overlap: stepData.diseaseOverlapScore,
    };
    const existing = JSON.parse(localStorage.getItem(KEY) || "[]");
    localStorage.setItem(KEY, JSON.stringify([session, ...existing].slice(0, 20)));
    setStepData((s) => ({ ...s, lastSavedSession: session }));
  };

  return (
    <div>
      <p style={{ color: C.textSecondary, fontSize: 14 }}>POST /api/serialize and persist to localStorage.</p>
      <Input label="Case ID" value={caseId} onChange={(e) => setCaseId(e.target.value)} />
      <CTA style={{ marginTop: 12 }} onClick={save} disabled={ser.isPending || !stepData.resolvedIds?.length}>
        {ser.isPending ? "Saving…" : "Save to this browser"}
      </CTA>
      {stepData.lastSavedSession && (
        <pre style={{ marginTop: 16, fontSize: 12, background: C.pageBg, padding: 12, borderRadius: 8 }}>
          {JSON.stringify(stepData.lastSavedSession, null, 2)}
        </pre>
      )}
    </div>
  );
}
