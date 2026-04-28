import { C } from "../tokens";

/** pct: 0–100 bar width (lower enrichment p-values → higher signal in UI). */
export default function ScoreBar({ pct }) {
  const w = Math.min(100, Math.max(4, pct));
  return (
    <div
      style={{
        height: 8,
        borderRadius: 4,
        background: C.border,
        overflow: "hidden",
        minWidth: 80,
      }}
    >
      <div style={{ width: `${w}%`, height: "100%", background: C.accent, borderRadius: 4 }} />
    </div>
  );
}
