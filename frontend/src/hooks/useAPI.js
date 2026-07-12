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

async function postForm(path, formData) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", body: formData });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function del(path) {
  const r = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/** Poll a job status endpoint (queued -> running -> done|error) until it settles. */
async function pollJob(statusPath, jobId, { onStatusChange, intervalMs = 1200, timeoutMs = 10 * 60 * 1000 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const st = await get(`${statusPath}/${jobId}`);
    onStatusChange?.(st.status);
    if (st.status === "done") return st.result;
    if (st.status === "error") throw new Error(st.error || "Job failed");
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for the job to finish");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
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
    mutationFn: (body) =>
      post("/api/enrichment", {
        remove_modifiers: true,
        replace_obsolete: true,
        mode: "diagnostic",
        top_n: 20,
        ...body,
      }),
  });
}

export function useSimilarity() {
  return useMutation({
    mutationFn: (body) =>
      post("/api/similarity", {
        kind: "omim",
        method: "resnik",
        combine: "BMA",
        one_way: false,
        ...body,
      }),
  });
}

export function useVariantPrioritize() {
  return useMutation({
    mutationFn: (body) =>
      post("/api/variant-prioritize", {
        mode: "diagnostic",
        ...body,
      }),
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

export function useGenePrioritization() {
  return useMutation({
    mutationFn: (body) =>
      post("/api/gene-prioritization", {
        remove_modifiers: false,
        replace_obsolete: true,
        expand_ic: true,
        ic_expansion_threshold: 2.0,
        top_n: 20,
        ...body,
      }),
  });
}

/**
 * Submits a VariMAT file for background processing, then polls
 * GET /api/variant-prioritize-file/status/{job_id} until done/error.
 * Pass `onStatusChange` to observe queued -> running -> done|error live.
 */
export function useVariantPrioritizeFile() {
  return useMutation({
    mutationFn: async ({
      hpoTerms,
      file,
      removeModifiers = false,
      replaceObsolete = true,
      expandIc = true,
      icExpansionThreshold = 2.0,
      topN = 100,
      onStatusChange,
    }) => {
      const fd = new FormData();
      fd.append("hpo_terms", hpoTerms);
      fd.append("file", file);
      fd.append("remove_modifiers", String(removeModifiers));
      fd.append("replace_obsolete", String(replaceObsolete));
      fd.append("expand_ic", String(expandIc));
      fd.append("ic_expansion_threshold", String(icExpansionThreshold));
      fd.append("top_n", String(topN));
      const submitRes = await postForm("/api/variant-prioritize-file", fd);
      onStatusChange?.("queued");
      return pollJob("/api/variant-prioritize-file/status", submitRes.job_id, { onStatusChange });
    },
  });
}

export function useVariantFileGeneDetail() {
  return useMutation({
    mutationFn: ({ token, genes }) => post("/api/variant-prioritize-file/gene-detail", { token, genes }),
  });
}

export function useSaveCase() {
  return useMutation({
    mutationFn: ({ name, kind, params, result, notes = "" }) =>
      post("/api/cases", { name, kind, params, result, notes }),
  });
}

export function useCases(kind) {
  return useQuery({
    queryKey: ["cases", kind ?? "all"],
    queryFn: () => get("/api/cases", kind ? { kind } : {}),
  });
}

export function useCase() {
  return useMutation({
    mutationFn: (caseId) => get(`/api/cases/${caseId}`),
  });
}

export function useDeleteCase() {
  return useMutation({
    mutationFn: (caseId) => del(`/api/cases/${caseId}`),
  });
}
