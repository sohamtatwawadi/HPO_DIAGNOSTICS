import { useMutation, useQuery } from "@tanstack/react-query";

/** Empty string = same-origin (Vite proxy or Railway single service). */
export const API_BASE =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace(/\/$/, "")
    : "";

export async function apiPost(path, body) {
  const url = API_BASE ? `${API_BASE}${path}` : path;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

async function get(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = (API_BASE ? `${API_BASE}${path}` : path) + (qs ? `?${qs}` : "");
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

/** Normalise numeric scores to bar widths (8–100%). */
export function scoreWidths(scores, { lowerIsBetter = true } = {}) {
  if (!scores.length) return [];
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  if (hi <= lo) return scores.map(() => 72);
  return scores.map((s) => {
    const t = lowerIsBetter ? (hi - s) / (hi - lo) : (s - lo) / (hi - lo);
    return Math.max(8, Math.min(100, t * 100));
  });
}

export const useResolveTerms = () =>
  useMutation({ mutationFn: (body) => apiPost("/api/resolve", body) });

export const useICProfile = () => useMutation({ mutationFn: (body) => apiPost("/api/ic-profile", body) });

export const useEnrichment = () => useMutation({ mutationFn: (body) => apiPost("/api/enrichment", body) });

export const useSimilarity = () => useMutation({ mutationFn: (body) => apiPost("/api/similarity", body) });

export const useVariantPrioritize = () =>
  useMutation({ mutationFn: (body) => apiPost("/api/variant-prioritize", body) });

export const useGeneHPO = () => useMutation({ mutationFn: (body) => apiPost("/api/gene-hpo-enrichment", body) });

export const useCohort = () => useMutation({ mutationFn: (body) => apiPost("/api/cohort", body) });

export const useSerialize = () => useMutation({ mutationFn: (body) => apiPost("/api/serialize", body) });

export const useDeserialize = () => useMutation({ mutationFn: (body) => apiPost("/api/deserialize", body) });

export const useTerm = (query) =>
  useQuery({
    queryKey: ["term", query],
    queryFn: () => get("/api/term", { query }),
    enabled: !!query && String(query).trim().length > 1,
  });

export const useDisease = (query, source) =>
  useQuery({
    queryKey: ["disease", query, source],
    queryFn: () => get("/api/disease", { query, source }),
    enabled: !!query && String(query).trim().length > 0,
  });

export const useHealth = () =>
  useQuery({
    queryKey: ["health"],
    queryFn: () => get("/api/health"),
    staleTime: 60_000,
  });
