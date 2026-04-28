export function linesToQueries(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Map enrichment scores to 8–100 bar width (lower value = stronger for typical p-like scores). */
export function scoreWidths(results, key = "enrichment") {
  const vals = results.map((r) => r[key]).filter((v) => Number.isFinite(v));
  if (!vals.length) return results.map(() => 8);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return results.map((r) => {
    const v = r[key];
    if (!Number.isFinite(v)) return 8;
    if (hi === lo) return 50;
    const t = (v - lo) / (hi - lo);
    const inv = 1 - t;
    return 8 + inv * 92;
  });
}
