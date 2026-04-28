import { useState } from "react";
import { C } from "../tokens";
import Card from "../components/Card";
import Topbar from "../components/Topbar";
import Input from "../components/Input";
import CTA from "../components/CTA";
import ResultTable from "../components/ResultTable";
import { useTerm, useTermPath } from "../hooks/useAPI";

export default function HPOTermExplorer() {
  const [q, setQ] = useState("HP:0002650");
  const [q2, setQ2] = useState("HP:0001166");
  const termM = useTerm();
  const pathM = useTermPath();

  const run = () => termM.mutate(q.trim());
  const compare = () => pathM.mutate({ term_a: q.trim(), term_b: q2.trim() });

  const d = termM.data;

  return (
    <div>
      <Topbar title="HPO term explorer" subtitle="Parents, children, IC, associations, path to root." />
      <Card>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Input label="HPO ID or name" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <CTA onClick={run} disabled={termM.isPending}>
            {termM.isPending ? "Loading…" : "Explore term"}
          </CTA>
        </div>
        {termM.isError && (
          <div style={{ color: C.red, marginTop: 12, fontSize: 13 }}>{termM.error.message}</div>
        )}
      </Card>
      {d && (
        <>
          <Card style={{ marginTop: 16 }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>
              <span style={{ fontFamily: C.fontMono }}>{d.id}</span> — {d.name}
            </h2>
            <p style={{ fontSize: 14, color: C.textSecondary, margin: 0 }}>{d.definition}</p>
            <p style={{ fontSize: 12, color: C.textMuted, marginTop: 8 }}>
              IC (omim / gene / orpha): {d.ic.omim.toFixed(3)} / {d.ic.gene.toFixed(3)} / {d.ic.orpha.toFixed(3)}
            </p>
          </Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <Card>
              <ResultTable title="Parents" headers={["ID", "Name"]} rows={d.parents.map((p) => [p.id, p.name])} />
            </Card>
            <Card>
              <ResultTable title="Children" headers={["ID", "Name"]} rows={d.children.map((p) => [p.id, p.name])} />
            </Card>
          </div>
          <Card style={{ marginTop: 16 }}>
            <ResultTable title="Siblings" headers={["ID", "Name"]} rows={(d.siblings ?? []).map((p) => [p.id, p.name])} />
          </Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <Card>
              <ResultTable title="Genes (sample)" headers={["Gene", "ID"]} rows={d.genes.map((g) => [g.name, g.id])} />
            </Card>
            <Card>
              <ResultTable
                title="OMIM (sample)"
                headers={["ID", "Name"]}
                rows={d.omim_diseases.map((x) => [String(x.id), x.name])}
              />
            </Card>
          </div>
          <Card style={{ marginTop: 16 }}>
            <ResultTable
              title="Orpha (sample)"
              headers={["ID", "Name"]}
              rows={(d.orpha_diseases ?? []).map((x) => [String(x.id), x.name])}
            />
          </Card>
          <Card style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>Path to root</h3>
            <pre style={{ fontFamily: C.fontMono, fontSize: 12, overflow: "auto" }}>
              {(d.path_to_root ?? []).map((p) => `${p.id} ${p.name}`).join("\n")}
            </pre>
          </Card>
          <Card style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>Compare to another term</h3>
            <Input label="Second term" value={q2} onChange={(e) => setQ2(e.target.value)} />
            <CTA style={{ marginTop: 10 }} variant="secondary" onClick={compare} disabled={pathM.isPending}>
              Path between terms
            </CTA>
            {pathM.data && (
              <pre style={{ fontFamily: C.fontMono, fontSize: 12, marginTop: 10 }}>
                distance: {pathM.data.distance}
                {"\n"}
                {pathM.data.path.map((p) => `${p.id} | ${p.name}`).join("\n")}
              </pre>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
