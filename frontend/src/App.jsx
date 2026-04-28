import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { C } from "./tokens";
import Sidebar from "./components/Sidebar";
import { useHealth } from "./hooks/useAPI";
import WorkflowView from "./modules/workflow/WorkflowView";
import DDX from "./modules/DDX";
import PatientSimilarity from "./modules/PatientSimilarity";
import GeneEnrichment from "./modules/GeneEnrichment";
import CohortAnalysis from "./modules/CohortAnalysis";
import VariantPrioritizer from "./modules/VariantPrioritizer";
import DiseaseDeepDive from "./modules/DiseaseDeepDive";
import HPOTermExplorer from "./modules/HPOTermExplorer";
import ICProfiler from "./modules/ICProfiler";
import ReportBuilder from "./modules/ReportBuilder";

function HealthBanner() {
  const q = useHealth();
  if (q.isError) {
    return (
      <div style={{ background: C.red, color: "#fff", padding: "10px 20px", fontSize: 14, fontWeight: 600 }}>
        Cannot reach API. Start the backend: <code style={{ fontFamily: "DM Mono, monospace" }}>uvicorn main:app --port 8000</code>
        {import.meta.env.VITE_API_URL ? ` (${import.meta.env.VITE_API_URL})` : ""}
      </div>
    );
  }
  if (q.data?.status === "ready") return null;
  return (
    <div
      style={{
        background: C.amber,
        color: "#fff",
        padding: "10px 20px",
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      Warming ontology & enrichment models… wait for /api/health = ready.
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display: "flex", minHeight: "100vh", fontFamily: C.fontUi }}>
        <Sidebar />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <HealthBanner />
          <main style={{ padding: "24px 28px 40px", flex: 1, background: C.pageBg }}>
            <Routes>
              <Route path="/" element={<Navigate to="/workflow" replace />} />
              <Route path="/workflow" element={<WorkflowView />} />
              <Route path="/ddx" element={<DDX />} />
              <Route path="/patient-similarity" element={<PatientSimilarity />} />
              <Route path="/gene-enrichment" element={<GeneEnrichment />} />
              <Route path="/cohort" element={<CohortAnalysis />} />
              <Route path="/variant-prioritizer" element={<VariantPrioritizer />} />
              <Route path="/disease" element={<DiseaseDeepDive />} />
              <Route path="/term-explorer" element={<HPOTermExplorer />} />
              <Route path="/ic-profiler" element={<ICProfiler />} />
              <Route path="/report" element={<ReportBuilder />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}
