import { C } from "../tokens";

export default function CTA({ children, variant = "primary", style, ...props }) {
  const bg = variant === "secondary" ? C.card : C.accent;
  const fg = variant === "secondary" ? C.text : "#fff";
  const border = variant === "secondary" ? `1px solid ${C.borderEmphasis}` : "none";
  return (
    <button
      type="button"
      {...props}
      style={{
        background: bg,
        color: fg,
        border,
        borderRadius: 8,
        padding: "10px 18px",
        fontWeight: 600,
        fontSize: 14,
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.55 : 1,
        fontFamily: C.fontUi,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
