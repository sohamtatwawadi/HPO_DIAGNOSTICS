import { useState } from "react";
import { C } from "../tokens";
import Card from "../components/Card";
import Topbar from "../components/Topbar";
import Badge from "../components/Badge";
import { useCases, useCase, useDeleteCase } from "../hooks/useAPI";

const surfaceAlt = "#F8FAFC";

const KIND_LABEL = {
  "gene-prioritization": "Gene prioritization",
  "variant-file-prioritization": "Variant file prioritization",
};

function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleString();
}

function CaseResultPreview({ result }) {
  const candidates = result?.candidates ?? result?.genes ?? null;
  if (Array.isArray(candidates) && candidates.length > 0) {
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
          Top candidates
        </div>
        {candidates.slice(0, 10).map((c, i) => (
          <div
            key={`${c.name}-${i}`}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              padding: "6px 10px",
              borderRadius: 6,
              background: surfaceAlt,
              marginBottom: 4,
              fontSize: 12,
            }}
          >
            <span style={{ fontFamily: C.fontMono, color: C.textMuted }}>#{c.rank ?? i + 1}</span>
            <span style={{ fontFamily: C.fontMono, fontWeight: 600 }}>{c.name}</span>
            {c.combined_score != null && (
              <span style={{ color: C.textMuted }}>score {c.combined_score.toFixed?.(3) ?? c.combined_score}</span>
            )}
            {c.bridge_disease && <span style={{ color: C.accent }}>{c.bridge_disease.disease_name}</span>}
          </div>
        ))}
      </div>
    );
  }
  return (
    <pre
      style={{
        marginTop: 10,
        maxHeight: 300,
        overflow: "auto",
        background: surfaceAlt,
        padding: 10,
        borderRadius: 6,
        fontSize: 11,
        fontFamily: C.fontMono,
      }}
    >
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

function CaseRow({ item, onDeleted }) {
  const [expanded, setExpanded] = useState(false);
  const detailMut = useCase();
  const deleteMut = useDeleteCase();

  const handleToggle = () => {
    if (!expanded && !detailMut.data) detailMut.mutate(item.id);
    setExpanded((e) => !e);
  };

  const handleDelete = () => {
    deleteMut.mutate(item.id, { onSuccess: () => onDeleted(item.id) });
  };

  return (
    <Card style={{ marginBottom: 10, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{item.name}</span>
        <Badge>{KIND_LABEL[item.kind] ?? item.kind}</Badge>
        <span style={{ fontSize: 12, color: C.textMuted }}>{fmtDate(item.created_at)}</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={handleToggle}
          style={{ fontSize: 12, color: C.accent, background: "none", border: "none", cursor: "pointer" }}
        >
          {expanded ? "Hide" : "View"}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleteMut.isPending}
          style={{ fontSize: 12, color: C.red, background: "none", border: "none", cursor: "pointer" }}
        >
          {deleteMut.isPending ? "Deleting…" : "Delete"}
        </button>
      </div>
      {item.notes && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 6 }}>{item.notes}</div>}
      {expanded && (
        <div>
          {detailMut.isPending && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 10 }}>Loading…</div>}
          {detailMut.isError && <div style={{ fontSize: 12, color: C.red, marginTop: 10 }}>{detailMut.error.message}</div>}
          {detailMut.data && <CaseResultPreview result={detailMut.data.result} />}
        </div>
      )}
    </Card>
  );
}

export default function SavedCases() {
  const [kindFilter, setKindFilter] = useState("");
  const q = useCases(kindFilter || undefined);
  const [removed, setRemoved] = useState(new Set());

  const cases = (q.data?.cases ?? []).filter((c) => !removed.has(c.id));

  return (
    <div>
      <Topbar title="Saved cases" subtitle="Revisit a prior analysis without re-uploading or recomputing. Stored locally via the backend's SQLite case store." />

      <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13, color: C.textSecondary }}>Filter by type</span>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          style={{ padding: 8, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13 }}
        >
          <option value="">All</option>
          <option value="gene-prioritization">Gene prioritization</option>
          <option value="variant-file-prioritization">Variant file prioritization</option>
        </select>
      </div>

      {q.isPending && <div style={{ fontSize: 13, color: C.textMuted }}>Loading saved cases…</div>}
      {q.isError && <div style={{ fontSize: 13, color: C.red }}>{q.error.message}</div>}
      {q.isSuccess && cases.length === 0 && (
        <div style={{ fontSize: 13, color: C.textMuted }}>
          No saved cases yet. Run an analysis on Gene Prioritization or Variant File Prioritization and click "Save this
          case."
        </div>
      )}

      {cases.map((item) => (
        <CaseRow key={item.id} item={item} onDeleted={(id) => setRemoved((s) => new Set(s).add(id))} />
      ))}
    </div>
  );
}
