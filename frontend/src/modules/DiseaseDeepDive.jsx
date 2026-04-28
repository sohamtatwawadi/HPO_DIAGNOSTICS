import { useState } from "react";
import { C } from "../tokens";
import Card from "../components/Card";
import Topbar from "../components/Topbar";
import Textarea from "../components/Textarea";
import Input from "../components/Input";
import CTA from "../components/CTA";
import ResultTable from "../components/ResultTable";
import MetricCard from "../components/MetricCard";
import { useDisease, useSimilarity } from "../hooks/useAPI";
import { linesToQueries } from "../lib/utils";

export default function DiseaseDeepDive() {
  const [q, setQ] = useState("154700");
  const [source, setSource] = useState("omim");
  const [patient, setPatient] = useState("");
  const diseaseM = useDisease();
  const simM = useSimilarity();

  const explore = () => diseaseM.mutate({ query: q.trim(), source });

  const runOverlap = () => {
    const d = diseaseM.data;
    if (!d) return;
    const ids = d.hpo_terms.map((t) => t.id);
    const p1 = linesToQueries(patient);
    if (!p1.length) return;
    simM.mutate({ patient1: p1, patient2: ids, kind: "omim", method: "resnik", combine: "BMA" });
  };

  const geneRows = (diseaseM.data?.genes ?? []).map((g) => [g.name, g.id]);
  const hpoRows = (diseaseM.data?.hpo_terms ?? []).map((t) => [t.id, t.name]);

  return (
    <div>
      <Topbar title="Disease deep-dive" subtitle="OMIM or Orphanet profile and optional patient overlap." />
      <Card>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Input label="Disease name or ID" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            Catalog{" "}
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="omim">OMIM</option>
              <option value="orpha">Orpha</option>
            </select>
          </label>
          <CTA onClick={explore} disabled={diseaseM.isPending}>
            {diseaseM.isPending ? "Loading…" : "Explore disease"}
          </CTA>
        </div>
        {diseaseM.isError && (
          <div style={{ color: C.red, marginTop: 12, fontSize: 13 }}>{diseaseM.error.message}</div>
        )}
      </Card>
      {diseaseM.data && (
        <>
          <Card style={{ marginTop: 16 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 18, color: C.text }}>{diseaseM.data.name}</h2>
            <p style={{ margin: 0, fontSize: 13, color: C.textSecondary }}>
              {source.toUpperCase()} ID <strong>{diseaseM.data.id}</strong> · {diseaseM.data.hpo_count} HPO terms
            </p>
          </Card>
          <Card style={{ marginTop: 16 }}>
            <Textarea
              label="Optional patient HPO (one per line)"
              value={patient}
              onChange={(e) => setPatient(e.target.value)}
            />
            <CTA style={{ marginTop: 8 }} variant="secondary" onClick={runOverlap} disabled={simM.isPending}>
              Compute patient ↔ disease similarity
            </CTA>
            {simM.data && (
              <div style={{ marginTop: 12, maxWidth: 280 }}>
                <MetricCard label="Overlap score" value={simM.data.score.toFixed(4)} />
              </div>
            )}
          </Card>
          <Card style={{ marginTop: 16 }}>
            <ResultTable title="Disease HPO terms" headers={["HP ID", "Name"]} rows={hpoRows} />
          </Card>
          <Card style={{ marginTop: 16 }}>
            <ResultTable title="Associated genes" headers={["Gene", "HGNC"]} rows={geneRows} />
          </Card>
        </>
      )}
    </div>
  );
}
