import { useState } from "react";
import { C } from "../tokens";
import Card from "../components/Card";
import Topbar from "../components/Topbar";
import Textarea from "../components/Textarea";
import CTA from "../components/CTA";
import MetricCard from "../components/MetricCard";
import { useSimilarity } from "../hooks/useAPI";
import { linesToQueries } from "../lib/utils";

export default function PatientSimilarity() {
  const [p1, setP1] = useState("HP:0002650");
  const [p2, setP2] = useState("HP:0001166");
  const [kind, setKind] = useState("omim");
  const [method, setMethod] = useState("resnik");
  const [combine, setCombine] = useState("BMA");
  const mutation = useSimilarity();

  const run = () =>
    mutation.mutate({
      patient1: linesToQueries(p1),
      patient2: linesToQueries(p2),
      kind,
      method,
      combine,
    });

  return (
    <div>
      <Topbar title="Patient similarity" subtitle="HPOSet semantic similarity (configurable method)." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card>
          <Textarea label="Patient 1" value={p1} onChange={(e) => setP1(e.target.value)} />
        </Card>
        <Card>
          <Textarea label="Patient 2" value={p2} onChange={(e) => setP2(e.target.value)} />
        </Card>
      </div>
      <Card style={{ marginTop: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <label style={{ fontSize: 13, color: C.text }}>
            kind{" "}
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="omim">omim</option>
              <option value="gene">gene</option>
              <option value="orpha">orpha</option>
              <option value="decipher">decipher</option>
            </select>
          </label>
          <label style={{ fontSize: 13, color: C.text }}>
            method{" "}
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="resnik">resnik</option>
              <option value="lin">lin</option>
              <option value="jc">jc</option>
              <option value="graphic">graphic</option>
            </select>
          </label>
          <label style={{ fontSize: 13, color: C.text }}>
            combine{" "}
            <select value={combine} onChange={(e) => setCombine(e.target.value)}>
              <option value="BMA">BMA</option>
              <option value="funSimAvg">funSimAvg</option>
              <option value="funSimMax">funSimMax</option>
            </select>
          </label>
          <CTA onClick={run} disabled={mutation.isPending}>
            {mutation.isPending ? "Computing…" : "Compare"}
          </CTA>
        </div>
        {mutation.isError && (
          <div style={{ color: C.red, marginTop: 12, fontSize: 13 }}>{mutation.error.message}</div>
        )}
        {mutation.data && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 16 }}>
              <MetricCard label="Similarity score" value={mutation.data.score.toFixed(4)} />
              <MetricCard label="Shared terms" value={mutation.data.shared.length} />
              <MetricCard label="Unique P1 / P2" value={`${mutation.data.only_in_patient1.length} / ${mutation.data.only_in_patient2.length}`} />
            </div>
            <div style={{ marginTop: 16, fontSize: 13, color: C.textSecondary }}>
              <strong style={{ color: C.text }}>Shared</strong>:{" "}
              {mutation.data.shared.map((t) => t.id).join(", ") || "—"}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
