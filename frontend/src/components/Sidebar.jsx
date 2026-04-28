import { NavLink } from "react-router-dom";
import { C } from "../tokens";

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
  ["/workflow", "7-step workflow"],
  ["/ddx", "Differential diagnosis"],
  ["/patient-similarity", "Patient similarity"],
  ["/gene-enrichment", "Gene enrichment"],
  ["/cohort", "Cohort analysis"],
  ["/variant-prioritizer", "Variant prioritizer"],
  ["/disease", "Disease deep-dive"],
  ["/term-explorer", "HPO term explorer"],
  ["/ic-profiler", "IC profiler"],
  ["/report", "Report builder"],
];

export default function Sidebar() {
  return (
    <aside
      style={{
        width: 260,
        minHeight: "100vh",
        background: C.sidebar,
        padding: "20px 14px",
        flexShrink: 0,
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
      <nav>
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to} style={linkStyle}>
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
