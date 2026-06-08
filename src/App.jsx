import { useState } from "react";
import { C } from "./demoShared.jsx";
import InferencePipelinePage from "./InferencePipelinePage.jsx";
import SingleVLLMPage from "./SingleVLLMPage.jsx";
import LoadBalancerPage from "./LoadBalancerPage.jsx";
import IntelligentRoutingPage from "./IntelligentRoutingPage.jsx";
import LlmDInActionPage from "./LlmDInActionPage.jsx";

const PAGES = [
  { id: "inference", label: "Inference Pipeline" },
  { id: "single", label: "Single vLLM" },
  { id: "loadbalancer", label: "Naive LB" },
  { id: "intelligent", label: "llm-d Routing" },
  { id: "llmd-action", label: "llm-d In Action" },
];

export default function App() {
  const [page, setPage] = useState("inference");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        color: C.text,
        fontFamily: "'Courier New', monospace",
      }}
    >
      <style>{`
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
      `}</style>

      <div
        style={{
          borderBottom: `1px solid ${C.border}`,
          padding: "16px 40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: `${C.panel}cc`,
          position: "sticky",
          top: 0,
          zIndex: 100,
          backdropFilter: "blur(12px)",
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: "bold", color: C.cyan, letterSpacing: "0.08em" }}>
            ◉ AI Inference using llm-d
          </div>
          <div style={{ fontSize: 13, color: C.muted, letterSpacing: "0.1em", marginTop: 4 }}>
            vLLM + KServe + OpenShift AI — Inference Visualizer
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {PAGES.map((p) => (
            <button
              key={p.id}
              onClick={() => setPage(p.id)}
              style={{
                background: page === p.id ? `${C.cyan}22` : C.panel,
                border: `1px solid ${page === p.id ? C.cyan : C.border}`,
                borderRadius: 8,
                padding: "8px 14px",
                cursor: "pointer",
                color: page === p.id ? C.cyan : C.muted,
                fontSize: 13,
                fontFamily: "monospace",
                fontWeight: "bold",
                letterSpacing: "0.04em",
                transition: "all 0.2s",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {page === "inference" && <InferencePipelinePage />}
      {page === "single" && <SingleVLLMPage />}
      {page === "loadbalancer" && <LoadBalancerPage />}
      {page === "intelligent" && <IntelligentRoutingPage />}
      {page === "llmd-action" && <LlmDInActionPage />}
    </div>
  );
}
