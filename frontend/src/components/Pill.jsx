import { C } from "../tokens";

export default function Pill({ children }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: C.fontMono,
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 6,
        border: `1px solid ${C.borderEmphasis}`,
        background: C.pageBg,
        color: C.text,
      }}
    >
      {children}
    </span>
  );
}
