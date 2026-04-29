import { C } from "../tokens";

export default function ResultTable({ title, headers, rows, columnHelp }) {
  return (
    <div style={{ marginTop: 16 }}>
      {title && (
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 }}>{title}</div>
      )}
      <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.pageBg }}>
              {headers.map((h, i) => (
                <th
                  key={`${String(h)}-${i}`}
                  title={columnHelp?.[i]}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    color: C.textSecondary,
                    fontWeight: 600,
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, ri) => (
              <tr key={ri} style={{ background: ri % 2 ? C.pageBg : C.card }}>
                {cells.map((cell, ci) => (
                  <td
                    key={ci}
                    title={columnHelp?.[ci]}
                    style={{
                      padding: "10px 12px",
                      borderBottom: `1px solid ${C.border}`,
                      color: C.text,
                      verticalAlign: "middle",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
