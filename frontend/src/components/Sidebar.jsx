import { NavLink } from "react-router-dom";
import { C } from "../tokens";
import { useAuth } from "../auth/AuthContext";

const linkStyle = ({ isActive }) => ({
  display: "block",
  padding: "10px 14px",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  color: isActive ? C.sidebar : C.sidebarText,
  background: isActive ? C.sidebarText : "transparent",
  marginBottom: 4,
});

const NAV = [
  ["/gene-prioritization", "Gene prioritization"],
  ["/variant-file-prioritization", "Variant file prioritization"],
  ["/saved-cases", "Saved cases"],
  ["/ddx", "Differential diagnosis"],
  ["/disease", "Disease deep-dive"],
  ["/term-explorer", "HPO term explorer"],
  ["/ic-profiler", "IC profiler"],
];

export default function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside
      style={{
        width: 260,
        minHeight: "100vh",
        background: C.sidebar,
        padding: "20px 14px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700, color: C.sidebarText, marginBottom: 20, letterSpacing: "-0.02em" }}>
        VarMatch<span style={{ color: C.sidebarMuted }}>.AI</span>
      </div>
      <nav style={{ flex: 1 }}>
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to} style={linkStyle}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div
        style={{
          borderTop: "1px solid rgba(255,255,255,0.12)",
          paddingTop: 14,
          marginTop: 12,
        }}
      >
        <div
          style={{
            fontSize: 12,
            color: C.sidebarMuted,
            marginBottom: 8,
            wordBreak: "break-all",
          }}
          title={user?.email}
        >
          {user?.email || "Signed in"}
        </div>
        <button
          type="button"
          onClick={logout}
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "transparent",
            color: C.sidebarText,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: C.fontUi,
          }}
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
