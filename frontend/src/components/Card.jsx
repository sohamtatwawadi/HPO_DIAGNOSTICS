import { C } from "../tokens";

export default function Card({ children, style, ...rest }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        boxShadow: C.shadow,
        padding: 20,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
