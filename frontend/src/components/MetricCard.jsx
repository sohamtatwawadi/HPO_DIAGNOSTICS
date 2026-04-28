import { C } from "../tokens";
import Card from "./Card";

export default function MetricCard({ label, value }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ fontSize: 12, color: C.textMuted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginTop: 4 }}>{value}</div>
    </Card>
  );
}
