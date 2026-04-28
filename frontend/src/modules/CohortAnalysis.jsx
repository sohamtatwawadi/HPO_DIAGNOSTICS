import { useState } from "react";
import { C } from "../tokens";
import Card from "../components/Card";
import Topbar from "../components/Topbar";
import Textarea from "../components/Textarea";
import CTA from "../components/CTA";
import ResultTable from "../components/ResultTable";
import { useCohort } from "../hooks/useAPI";
import { linesToQueries } from "../lib/utils";

export default function CohortAnalysis() {
  const [blocks, setBlocks] = useState(["HP:0002650\nHP:0000925", "HP:0001166\nHP:0001513"]);
  const mutation = useCohort();

  const add = () => setBlocks((b) => [...b, ""]);

  const run = () => {
    const patients = blocks.map((t) => linesToQueries(t)).filter((p) => p.length);
    mutation.mutate({ patients, kind: "", method: "", combine: "funSimAvg" });
  };

  const mat = mutation.data?.matrix;
  const labels = mutation.data?.labels ?? [];

  const matrixRows =
    mat?.map((row, i) => [
      labels[i],
      ...row.map((v, j) => (
        <span key={j} style={{ fontFamily: "DM Mono, monospace", fontWeight: 600 }}>
          {v}
        </span>
      )),
    ]) ?? [];

  const sharedRows =
    mutation.data?.shared_omim_candidates?.map((r) => [
      String(r.omim_id),
      r.name,
      <span key={r.omim_id} style={{ width: 120, display: "inline-block", height: 8, background: C.accent, borderRadius: 4 }} />,
    ]) ?? [];

  return (
    <div>
      <Topbar title="Cohort analysis" subtitle="Pairwise similarity matrix and shared OMIM top-20 candidates." />
      {blocks.map((txt, i) => (
        <Card key={i} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: C.text }}>Patient {i + 1}</div>
          <Textarea
            label=""
            value={txt}
            onChange={(e) => {
              const next = [...blocks];
              next[i] = e.target.value;
              setBlocks(next);
            }}
          />
        </Card>
      ))}
      <CTA variant="secondary" onClick={add}>
        + Add patient
      </CTA>
      <CTA style={{ marginLeft: 10 }} onClick={run} disabled={mutation.isPending}>
        {mutation.isPending ? "Running…" : "Run cohort analysis"}
      </CTA>
      {mutation.isError && (
        <div style={{ color: C.red, marginTop: 12, fontSize: 13 }}>{mutation.error.message}</div>
      )}
      {mat && (
        <Card style={{ marginTop: 16 }}>
          <ResultTable title="Similarity matrix" headers={["", ...labels]} rows={matrixRows} />
        </Card>
      )}
      {sharedRows.length > 0 && (
        <Card style={{ marginTop: 16 }}>
          <ResultTable
            title="Shared disease candidates (top-20 in every patient)"
            headers={["OMIM", "Name", ""]}
            rows={sharedRows}
          />
        </Card>
      )}
    </div>
  );
}
