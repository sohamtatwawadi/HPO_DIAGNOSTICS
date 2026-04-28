import { useState } from "react";
import { C } from "../../tokens";
import Card from "../../components/Card";
import Topbar from "../../components/Topbar";
import Step1Enter from "./Step1Enter";
import Step2IC from "./Step2IC";
import Step3Disease from "./Step3Disease";
import Step4Genes from "./Step4Genes";
import Step5Cohort from "./Step5Cohort";
import Step6Validate from "./Step6Validate";
import Step7Save from "./Step7Save";

const STEPS = [
  "Enter HPO",
  "IC profile",
  "OMIM DDx",
  "Gene check",
  "Cohort",
  "Validate disease",
  "Save",
];

export default function WorkflowView() {
  const [step, setStep] = useState(0);
  const [stepData, setStepData] = useState({});

  const rail = (
    <nav style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}>
      {STEPS.map((label, i) => (
        <button
          key={label}
          type="button"
          onClick={() => setStep(i)}
          style={{
            textAlign: "left",
            padding: "10px 12px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13,
            background: i === step ? C.accent : C.pageBg,
            color: i === step ? "#fff" : C.text,
          }}
        >
          {i + 1}. {label}
        </button>
      ))}
    </nav>
  );

  const body = [
    <Step1Enter key="1" stepData={stepData} setStepData={setStepData} onNext={() => setStep(1)} />,
    <Step2IC key="2" stepData={stepData} setStepData={setStepData} onNext={() => setStep(2)} />,
    <Step3Disease key="3" stepData={stepData} setStepData={setStepData} onNext={() => setStep(3)} />,
    <Step4Genes key="4" stepData={stepData} setStepData={setStepData} onNext={() => setStep(4)} />,
    <Step5Cohort key="5" stepData={stepData} setStepData={setStepData} onNext={() => setStep(5)} />,
    <Step6Validate key="6" stepData={stepData} setStepData={setStepData} onNext={() => setStep(6)} />,
    <Step7Save key="7" stepData={stepData} setStepData={setStepData} />,
  ][step];

  return (
    <div>
      <Topbar title="7-step workflow" subtitle="Structured case work: resolve → IC → DDx → genes → cohort → validate → save." />
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        {rail}
        <Card style={{ flex: 1 }}>{body}</Card>
      </div>
    </div>
  );
}
