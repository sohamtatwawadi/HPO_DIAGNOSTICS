import { useState } from "react";
import { C } from "../tokens";
import CTA from "./CTA";
import { useSaveCase } from "../hooks/useAPI";

/** Small inline "Save this case" affordance: reusable across analysis pages. */
export default function SaveCaseButton({ kind, params, result, defaultName = "" }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const mut = useSaveCase();

  const handleSave = () => {
    if (!name.trim()) return;
    mut.mutate(
      { name: name.trim(), kind, params, result, notes: notes.trim() },
      {
        onSuccess: () => {
          setSaved(true);
          setOpen(false);
        },
      }
    );
  };

  if (saved) {
    return <span style={{ fontSize: 13, color: C.green, fontWeight: 600 }}>Case saved ✓</span>;
  }

  if (!open) {
    return (
      <CTA variant="secondary" onClick={() => setOpen(true)}>
        Save this case
      </CTA>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        background: C.card,
        border: `1px solid ${C.borderEmphasis}`,
        borderRadius: 8,
        maxWidth: 360,
      }}
    >
      <input
        autoFocus
        type="text"
        placeholder="Case name (e.g. Patient A - CMS panel)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          padding: "8px 10px",
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          fontSize: 13,
          fontFamily: C.fontUi,
        }}
      />
      <textarea
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        style={{
          padding: "8px 10px",
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          fontSize: 12,
          fontFamily: C.fontUi,
          resize: "vertical",
        }}
      />
      {mut.isError && <div style={{ fontSize: 12, color: C.red }}>{mut.error.message}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <CTA onClick={handleSave} disabled={mut.isPending || !name.trim()}>
          {mut.isPending ? "Saving…" : "Save"}
        </CTA>
        <CTA variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </CTA>
      </div>
    </div>
  );
}
