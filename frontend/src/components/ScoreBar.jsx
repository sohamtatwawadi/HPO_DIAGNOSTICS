import { C } from "../tokens";

/**
 * @param {number} pct — 0–100 bar fill width
 * @param {string} [title] — native hover tooltip (e.g. SIGNAL_TOOLTIP.diagnostic)
 */
export default function ScoreBar({ pct, title }) {
  const w = Math.min(100, Math.max(4, pct));
  return (
    <div
      title={title}
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
