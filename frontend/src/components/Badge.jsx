import { C } from "../tokens";

export default function Badge({ children, tone = "neutral" }) {
  const bg =
    tone === "danger"
      ? "#FEE2E2"
      : tone === "warn"
        ? "#FEF3C7"
        : tone === "ok"
          ? "#DCFCE7"
          : C.pageBg;
  const fg =
    tone === "danger" ? C.red : tone === "warn" ? C.amber : tone === "ok" ? C.green : C.textSecondary;
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 6,
        background: bg,
        color: fg,
        fontFamily: C.fontUi,
      }}
    >
      {children}
    </span>
  );
}
