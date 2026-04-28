import { C } from "../tokens";

export default function Textarea({ label, ...props }) {
  return (
    <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: C.text }}>
      {label && <span style={{ display: "block", marginBottom: 6 }}>{label}</span>}
      <textarea
        {...props}
        style={{
          width: "100%",
          minHeight: 120,
          padding: 12,
          borderRadius: 8,
          border: `1px solid ${C.border}`,
          fontFamily: C.fontMono,
          fontSize: 13,
          resize: "vertical",
          background: C.card,
          color: C.text,
        }}
      />
    </label>
  );
}
