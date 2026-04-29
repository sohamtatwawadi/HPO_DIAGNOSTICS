import { useState } from "react";
import { C } from "../../tokens";
import Input from "../../components/Input";
import CTA from "../../components/CTA";
import { useDisease, useSimilarity } from "../../hooks/useAPI";

export default function Step6Validate({ stepData, setStepData, onNext }) {
  const [dq, setDq] = useState(stepData.validateDisease ?? "154700");
  const dm = useDisease();
  const sm = useSimilarity();

  const run = async () => {
    const dis = await dm.mutateAsync({ query: dq.trim(), source: "omim" });
    const ids = dis.hpo_terms.map((t) => t.id);
    const ov = await sm.mutateAsync({
      patient1: stepData.resolvedIds,
      patient2: ids,
      kind: "omim",
      method: "resnik",
      combine: "BMA",
      one_way: true,
    });
    setStepData((s) => ({
      ...s,
      validateDisease: dq,
      validateDiseaseProfile: dis,
      diseaseOverlapScore: ov.score,
    }));
  };

  return (
    <div>
      <p style={{ color: C.textSecondary, fontSize: 14 }}>
        GET /api/disease + POST /api/similarity (one_way: patient→disease profile).
      </p>
      <Input label="OMIM id or disease name" value={dq} onChange={(e) => setDq(e.target.value)} />
      <CTA style={{ marginTop: 10 }} onClick={run} disabled={dm.isPending || sm.isPending}>
        {dm.isPending || sm.isPending ? "Running…" : "Validate candidate disease"}
      </CTA>
      {stepData.validateDiseaseProfile && (
        <p style={{ marginTop: 12, fontSize: 14, color: C.text }}>
          <strong>{stepData.validateDiseaseProfile.name}</strong> · overlap score{" "}
          <strong>{stepData.diseaseOverlapScore?.toFixed(4)}</strong>
        </p>
      )}
      <div style={{ marginTop: 16 }}>
        <CTA disabled={!stepData.validateDiseaseProfile} onClick={onNext}>
          Continue → Save session
        </CTA>
      </div>
    </div>
  );
}
