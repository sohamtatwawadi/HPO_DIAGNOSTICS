import { C } from "../tokens";

export default function Input({ label, ...props }) {
  return (
    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.text }}>
      {label && <span style={{ display: "block", marginBottom: 6 }}>{label}</span>}
      <input
        {...props}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: `1px solid ${C.border}`,
          fontFamily: C.fontUi,
          fontSize: 14,
          background: C.card,
          color: C.text,
        }}
      />
    </label>
  );
}
