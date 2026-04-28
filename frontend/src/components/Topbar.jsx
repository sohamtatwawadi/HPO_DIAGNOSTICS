import { C } from "../tokens";

export default function Topbar({ title, subtitle }) {
  return (
    <header
      style={{
        marginBottom: 20,
        paddingBottom: 16,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text }}>{title}</h1>
      {subtitle && (
        <p style={{ margin: "6px 0 0", fontSize: 14, color: C.textSecondary }}>{subtitle}</p>
      )}
    </header>
  );
}
