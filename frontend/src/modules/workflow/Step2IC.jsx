import { C } from "../../tokens";
import CTA from "../../components/CTA";
import MetricCard from "../../components/MetricCard";
import { useICProfile } from "../../hooks/useAPI";

export default function Step2IC({ stepData, setStepData, onNext }) {
  const m = useICProfile();

  const run = async () => {
    const res = await m.mutateAsync(stepData.resolvedIds);
    setStepData((s) => ({ ...s, icProfile: res }));
  };

  return (
    <div>
      <p style={{ color: C.textSecondary, fontSize: 14 }}>POST /api/ic-profile on resolved IDs.</p>
      <CTA onClick={run} disabled={m.isPending || !stepData.resolvedIds?.length}>
        {m.isPending ? "Running…" : "Run IC profile"}
      </CTA>
      {stepData.icProfile && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 16 }}>
          <MetricCard label="Mean IC" value={stepData.icProfile.set_summary.mean.toFixed(4)} />
          <MetricCard label="Total" value={stepData.icProfile.set_summary.total.toFixed(4)} />
          <MetricCard label="Max" value={stepData.icProfile.set_summary.max.toFixed(4)} />
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <CTA disabled={!stepData.icProfile} onClick={onNext}>
          Continue → OMIM enrichment
        </CTA>
      </div>
    </div>
  );
}
