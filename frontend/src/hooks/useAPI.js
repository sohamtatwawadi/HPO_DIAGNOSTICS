import { useMutation, useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.VITE_API_URL ?? "";

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function get(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${BASE}${path}${qs ? `?${qs}` : ""}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => get("/api/health"),
    refetchInterval: (q) => {
      if (q.state.data?.status === "ready") return false;
      if (q.state.fetchFailureCount > 8) return false;
      return 1500;
    },
    retry: 2,
  });
}

export function useResolveTerms() {
  return useMutation({
    mutationFn: (queries) =>
      post("/api/resolve", {
        queries,
        remove_modifiers: true,
        replace_obsolete: true,
      }),
  });
}

export function useICProfile() {
  return useMutation({
    mutationFn: (queries) =>
      post("/api/ic-profile", {
        queries,
        remove_modifiers: true,
        replace_obsolete: true,
      }),
  });
}

export function useEnrichment() {
  return useMutation({
    mutationFn: ({ queries, source, top_n = 20 }) =>
      post("/api/enrichment", {
        queries,
        source,
        top_n,
        remove_modifiers: true,
        replace_obsolete: true,
      }),
  });
}

export function useSimilarity() {
  return useMutation({
    mutationFn: ({ patient1, patient2, kind, method, combine }) =>
      post("/api/similarity", { patient1, patient2, kind, method, combine }),
  });
}

export function useVariantPrioritize() {
  return useMutation({
    mutationFn: ({ hpo_queries, candidate_genes }) =>
      post("/api/variant-prioritize", { hpo_queries, candidate_genes }),
  });
}

export function useDisease() {
  return useMutation({
    mutationFn: ({ query, source }) => get("/api/disease", { query, source }),
  });
}

export function useTerm() {
  return useMutation({
    mutationFn: (query) => get("/api/term", { query }),
  });
}

export function useTermPath() {
  return useMutation({
    mutationFn: ({ term_a, term_b }) => post("/api/term-path", { term_a, term_b }),
  });
}

export function useSerialize() {
  return useMutation({
    mutationFn: (queries) =>
      post("/api/serialize", {
        queries,
        remove_modifiers: true,
        replace_obsolete: true,
      }),
  });
}

export function useDeserialize() {
  return useMutation({
    mutationFn: (serialized) => post("/api/deserialize", { serialized }),
  });
}

export function useCohort() {
  return useMutation({
    mutationFn: (body) => post("/api/cohort", body),
  });
}

export function useGeneHpoEnrichment() {
  return useMutation({
    mutationFn: ({ genes, min_count = 1, top_n = 80 }) =>
      post("/api/gene-hpo-enrichment", { genes, min_count, top_n }),
  });
}
