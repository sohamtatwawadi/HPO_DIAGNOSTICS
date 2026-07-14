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
  ["/ddx", "Differential diagnosis"],
  ["/disease", "Disease deep-dive"],
  ["/term-explorer", "HPO term explorer"],
  ["/ic-profiler", "IC profiler"],
];

const NAV_NEW = [
  ["/gene-prioritization", "★ Gene prioritization", "new"],
  ["/variant-file-prioritization", "★ Variant file prioritization", "new"],
  ["/saved-cases", "★ Saved cases", "new"],
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
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.06em",
          color: C.sidebarMuted,
          marginBottom: 12,
        }}
      >
        HPO DIAGNOSTICS
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.sidebarText, marginBottom: 20 }}>
        Clinical workspace
      </div>
      <nav style={{ flex: 1 }}>
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to} style={linkStyle}>
            {label}
          </NavLink>
        ))}
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: C.sidebarMuted,
            margin: "16px 0 8px",
          }}
        >
          New modules
        </div>
        {NAV_NEW.map(([to, label, badge]) => (
          <NavLink key={to} to={to} style={linkStyle}>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span>{label}</span>
              {badge && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: C.sidebar,
                    background: "#FBBF24",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  {badge}
                </span>
              )}
            </span>
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
