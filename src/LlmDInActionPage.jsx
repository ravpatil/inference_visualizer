import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  C,
  POD_META,
  POD_COUNT,
  REQUESTS,
  buildIntelligentPlan,
  Stat,
  delay,
  animateValue,
  lerp,
  easeOutCubic,
  PageShell,
  PageLayout,
  PagePanel,
  PageHeader,
  SectionLabel,
  SidebarControls,
} from "./demoShared.jsx";

const PHASE_ANIM_MS = 3000;
const STEP_GAP_MS = 1000;

const PLAN = buildIntelligentPlan();

const COMPONENTS = [
  { id: "client", label: "Client", color: C.cyan },
  { id: "proxy", label: "Proxy (Envoy)", color: C.blue },
  { id: "extproc", label: "ext-proc consult", color: C.purple },
  { id: "scrapers", label: "EPP Scrapers", color: C.gold },
  { id: "filters", label: "EPP Filters", color: C.orange },
  { id: "scorers", label: "EPP Scorers", color: C.pink },
  { id: "epp", label: "EPP Decision", color: C.green },
  { id: "pool", label: "InferencePool", color: C.cyan },
  { id: "modelserver", label: "Model Server", color: C.cyan },
];

function buildMicroSteps(req, plan, podCachesBefore) {
  const { pod, isHitPredicted: isHit, routeReason } = plan;
  const scores = POD_META.map((p, i) => {
    const hasCache = podCachesBefore[i].has(req.key);
    const load = podCachesBefore[i].size;
    const affinity = hasCache ? 100 : 10;
    const loadScore = Math.max(0, 100 - load * 22);
    return {
      pod: i,
      total: hasCache ? affinity + loadScore : loadScore,
      affinity,
      load: loadScore,
      hasCache,
    };
  }).sort((a, b) => b.total - a.total);

  const winner = scores[0];

  return [
    {
      component: "proxy",
      title: "Proxy accepts client request",
      explain: `The llm-d Router's Proxy (Envoy) receives ${req.prompt.label} ("${req.prompt.short}") on the data plane. It holds the connection while routing intelligence runs in the EPP.`,
      log: `${req.prompt.label} → Proxy: POST /v1/chat/completions`,
    },
    {
      component: "extproc",
      title: "Proxy consults EPP via ext-proc",
      explain:
        "Before forwarding, the Proxy pauses the request and calls the Endpoint Picker (EPP) over the ext-proc protocol — Envoy's external processing hook for routing decisions.",
      log: `Proxy → EPP: ext-proc ProcessRequest (await endpoint)`,
    },
    {
      component: "scrapers",
      title: "EPP Scrapers collect InferencePool telemetry",
      explain:
        "Extensible scraper plugins poll each Model Server in the InferencePool: KV-cache block occupancy, prefix hash index, queue depth, and accelerator memory headroom.",
      log: `Scrapers: polled ${POD_COUNT} replicas — KV index, queue depth, GPU util`,
      scores,
    },
    {
      component: "filters",
      title: "EPP Filters narrow candidates",
      explain:
        "Filter plugins drop unhealthy or over-capacity endpoints from the InferencePool. Remaining replicas become the candidate set for scoring.",
      log: `Filters: ${POD_COUNT}/${POD_COUNT} replicas pass (healthy, capacity OK)`,
      scores,
    },
    {
      component: "scorers",
      title: "EPP Scorers rank replicas",
      explain: isHit
        ? `KV-cache affinity scorer boosts Pod ${pod + 1} — it already holds "${req.prompt.short}" blocks. Load scorer breaks ties.`
        : "No KV match found. Load-aware scorer picks the least-loaded replica for a cold prefill.",
      log: isHit
        ? `Scorers: Pod ${pod + 1} wins (KV affinity=${winner.affinity}, load=${winner.load})`
        : `Scorers: Pod ${pod + 1} wins (load-aware, load=${winner.load})`,
      scores,
      winnerPod: pod,
    },
    {
      component: "epp",
      title: "EPP returns endpoint to Proxy",
      explain: `The EPP applies the ${routeReason} policy and returns Pod ${pod + 1} as the optimal destination over ext-proc to the Proxy.`,
      log: `EPP → Proxy: route ${req.prompt.label} → Pod ${pod + 1} [${routeReason}]`,
      winnerPod: pod,
    },
    {
      component: "modelserver",
      title: "Proxy forwards to Model Server",
      explain: isHit
        ? `Proxy forwards the request into the InferencePool — Model Server Pod ${pod + 1} serves a KV cache HIT for "${req.prompt.short}", prefill skipped.`
        : `Proxy forwards into the InferencePool — Pod ${pod + 1} runs a KV cache MISS: full prefill, then decode.`,
      log: isHit
        ? `Proxy → Pod ${pod + 1}: cache HIT — decode only`
        : `Proxy → Pod ${pod + 1}: cache MISS — prefill + decode`,
      winnerPod: pod,
      isHit,
    },
  ];
}

function ArchitectureDiagram({ activeComponent, packetT, currentReq, winnerPod, scores, animT }) {
  const W = 920;
  const H = 460;
  const podXs = [180, 360, 540, 720];
  const podY = 370;
  const poolY = 290;

  const nodes = {
    client: { x: 55, y: 95 },
    proxy: { x: 210, y: 95 },
    extproc: { x: 310, y: 95 },
    scrapers: { x: 380, y: 175 },
    filters: { x: 500, y: 175 },
    scorers: { x: 620, y: 175 },
    epp: { x: 740, y: 130 },
    pool: { x: 460, y: poolY + 20 },
    modelserver: { x: podXs[winnerPod ?? 0], y: podY },
  };

  const pathOrder = ["client", "proxy", "extproc", "scrapers", "filters", "scorers", "epp", "modelserver"];
  const activeIdx = pathOrder.indexOf(activeComponent);

  let px = nodes.client.x;
  let py = nodes.client.y;
  if (packetT > 0 && activeIdx >= 0) {
    const fromId = activeIdx === 0 ? "client" : pathOrder[activeIdx - 1];
    const from = nodes[fromId] || nodes.client;
    const to = nodes[activeComponent] || from;
    const t = easeOutCubic(packetT);
    px = lerp(from.x, to.x, t);
    py = lerp(from.y, to.y, t);
  }

  const isActive = (id) => activeComponent === id;
  const isPast = (id) => pathOrder.indexOf(id) < activeIdx;
  const routerLit = ["proxy", "extproc", "scrapers", "filters", "scorers", "epp"].includes(activeComponent);
  const eppLit = ["extproc", "scrapers", "filters", "scorers", "epp"].includes(activeComponent);
  const poolLit = activeComponent === "modelserver" || isPast("modelserver");

  const box = (id, x, y, w, h, label, sub, color) => (
    <g key={id}>
      <rect
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        rx={10}
        fill={isActive(id) ? `${color}30` : isPast(id) ? `${color}18` : C.panel}
        stroke={isActive(id) ? color : isPast(id) ? `${color}88` : C.border}
        strokeWidth={isActive(id) ? 2.5 : 1}
      />
      <text x={x} y={y - (sub ? 6 : 0)} textAnchor="middle" fill={color} fontSize={11} fontFamily="monospace" fontWeight="bold">
        {label}
      </text>
      {sub && (
        <text x={x} y={y + 12} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">
          {sub}
        </text>
      )}
    </g>
  );

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", minHeight: 400 }}>
      {/* llm-d Router container */}
      <rect
        x={100}
        y={28}
        width={720}
        height={210}
        rx={14}
        fill={`${C.purple}06`}
        stroke={routerLit ? C.purple : C.border}
        strokeWidth={routerLit ? 2 : 1}
      />
      <text x={460} y={48} textAnchor="middle" fill={C.purple} fontSize={11} fontFamily="monospace" fontWeight="bold">
        llm-d Router — intelligent entry point
      </text>

      {/* EPP sub-container inside Router */}
      <rect
        x={300}
        y={58}
        width={500}
        height={165}
        rx={12}
        fill={`${C.green}06`}
        stroke={eppLit ? C.green : `${C.green}55`}
        strokeWidth={eppLit ? 2 : 1}
        strokeDasharray={eppLit ? "none" : "5,4"}
      />
      <text x={550} y={78} textAnchor="middle" fill={C.green} fontSize={10} fontFamily="monospace" fontWeight="bold">
        Endpoint Picker (EPP) — routing engine
      </text>
      <text x={550} y={92} textAnchor="middle" fill={C.muted} fontSize={8} fontFamily="monospace">
        extensible scrapers · filters · scorers pipeline
      </text>

      {box("client", 55, 95, 80, 46, "CLIENT", null, C.cyan)}
      {box("proxy", 210, 95, 110, 50, "Proxy", "Envoy L7", C.blue)}

      {/* ext-proc link */}
      <path
        d="M 265 95 L 295 95"
        stroke={isActive("extproc") ? C.purple : C.dim}
        strokeWidth={isActive("extproc") ? 2.5 : 1.2}
        markerEnd="url(#arrPurple)"
      />
      {isActive("extproc") && (
        <text x={280} y={82} textAnchor="middle" fill={C.purple} fontSize={8} fontFamily="monospace" fontWeight="bold">
          ext-proc
        </text>
      )}

      {box("scrapers", 380, 175, 100, 44, "Scrapers", "KV · load · queue", C.gold)}
      {box("filters", 500, 175, 90, 44, "Filters", "health · cap", C.orange)}
      {box("scorers", 620, 175, 90, 44, "Scorers", "affinity · load", C.pink)}

      {/* EPP decision area */}
      <rect
        x={700}
        y={108}
        width={80}
        height={44}
        rx={8}
        fill={isActive("epp") ? `${C.green}30` : isPast("epp") ? `${C.green}18` : C.panel}
        stroke={isActive("epp") ? C.green : isPast("epp") ? `${C.green}88` : C.border}
        strokeWidth={isActive("epp") ? 2.5 : 1}
      />
      <text x={740} y={125} textAnchor="middle" fill={C.green} fontSize={9} fontFamily="monospace" fontWeight="bold">
        EPP
      </text>
      <text x={740} y={140} textAnchor="middle" fill={C.muted} fontSize={8} fontFamily="monospace">
        decision
      </text>

      {/* Internal EPP pipeline arrows */}
      <path d="M 330 175 L 350 175" stroke={C.gold} strokeWidth={1} opacity={0.5} />
      <path d="M 455 175 L 475 175" stroke={C.orange} strokeWidth={1} opacity={0.5} />
      <path d="M 575 175 L 595 175" stroke={C.pink} strokeWidth={1} opacity={0.5} />
      <path d="M 665 175 L 700 130" stroke={C.green} strokeWidth={1} opacity={0.5} />

      {/* Proxy ← EPP return path */}
      <path
        d="M 700 118 Q 480 60 265 80"
        fill="none"
        stroke={isActive("epp") ? C.green : `${C.green}44`}
        strokeWidth={isActive("epp") ? 2 : 1}
        strokeDasharray={isActive("epp") ? "none" : "4,4"}
        opacity={0.7}
      />
      {isActive("epp") && (
        <text x={480} y={58} textAnchor="middle" fill={C.green} fontSize={8} fontFamily="monospace">
          ext-proc response → Proxy
        </text>
      )}

      {/* Client → Proxy */}
      <path d="M 95 95 L 155 95" stroke={C.blue} strokeWidth={1.5} opacity={0.6} markerEnd="url(#arrBlue)" />

      {/* InferencePool container */}
      <rect
        x={60}
        y={poolY}
        width={800}
        height={130}
        rx={14}
        fill={`${C.cyan}06`}
        stroke={poolLit ? C.cyan : C.border}
        strokeWidth={poolLit ? 2 : 1}
      />
      <text x={460} y={poolY + 22} textAnchor="middle" fill={C.cyan} fontSize={11} fontFamily="monospace" fontWeight="bold">
        InferencePool — LLM-optimized Service (shared model & compute)
      </text>

      {/* Proxy → InferencePool forward path */}
      <path
        d={`M 210 120 Q 210 220 ${podXs[winnerPod ?? 0]} ${podY - 48}`}
        fill="none"
        stroke={isActive("modelserver") ? C.cyan : C.dim}
        strokeWidth={isActive("modelserver") ? 2.5 : 1}
        strokeDasharray={isActive("modelserver") ? "none" : "5,5"}
        opacity={0.75}
      />

      {/* Model Server pods */}
      {POD_META.map((pod, i) => {
        const px = podXs[i];
        const lit = winnerPod === i && (activeComponent === "modelserver" || activeComponent === "epp");
        const score = scores?.find((s) => s.pod === i);
        return (
          <g key={pod.id}>
            <rect
              x={px - 58}
              y={podY - 38}
              width={116}
              height={68}
              rx={10}
              fill={lit ? `${pod.color}28` : C.panel}
              stroke={lit ? pod.color : C.border}
              strokeWidth={lit ? 2 : 1}
            />
            <text x={px} y={podY - 16} textAnchor="middle" fill={pod.color} fontSize={9} fontFamily="monospace" fontWeight="bold">
              {pod.name}
            </text>
            <text x={px} y={podY - 4} textAnchor="middle" fill={C.muted} fontSize={7} fontFamily="monospace">
              Model Server
            </text>
            {score && activeComponent === "scorers" && (
              <>
                <rect x={px - 48} y={podY + 6} width={96 * (score.total / 200)} height={8} rx={4} fill={pod.color} opacity={0.7} />
                <text x={px} y={podY + 28} textAnchor="middle" fill={C.muted} fontSize={8} fontFamily="monospace">
                  score={Math.round(score.total)}
                </text>
              </>
            )}
            {score?.hasCache && activeComponent !== "scorers" && (
              <text x={px} y={podY + 14} textAnchor="middle" fill={C.kv} fontSize={8} fontFamily="monospace">
                KV ✓
              </text>
            )}
            {/* Scraper telemetry lines to pods */}
            <path
              d={`M 380 197 Q ${px} 260 ${px} ${podY - 40}`}
              fill="none"
              stroke={activeComponent === "scrapers" ? C.gold : C.dim}
              strokeWidth={activeComponent === "scrapers" ? 1.5 : 0.6}
              strokeDasharray="3,4"
              opacity={activeComponent === "scrapers" ? 0.6 : 0.25}
            />
          </g>
        );
      })}

      {/* Scraper sweep animation */}
      {activeComponent === "scrapers" && (
        <g opacity={0.5 + animT * 0.5}>
          {podXs.map((px, i) => (
            <circle
              key={i}
              cx={px}
              cy={podY - 10}
              r={8 + 6 * Math.sin(animT * Math.PI * 2 + i)}
              fill="none"
              stroke={C.gold}
              strokeWidth={1.5}
            />
          ))}
        </g>
      )}

      {/* Packet */}
      {currentReq && packetT > 0 && (
        <g>
          <circle cx={px} cy={py} r={12} fill={`${C.green}55`} stroke={C.green} strokeWidth={2} />
          <text x={px} y={py + 4} textAnchor="middle" fill="#fff" fontSize={9} fontFamily="monospace" fontWeight="bold">
            {currentReq.prompt.label}
          </text>
        </g>
      )}

      <defs>
        <marker id="arrBlue" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6" fill={C.blue} />
        </marker>
        <marker id="arrPurple" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6" fill={C.purple} />
        </marker>
      </defs>
    </svg>
  );
}

function ComponentTrack({ microIdx, totalMicro, reqIdx }) {
  const labels = ["Proxy", "ext-proc", "Scrape", "Filter", "Score", "EPP", "Forward"];
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 16 }}>
      {labels.map((label, i) => {
        const isCurrent = i === microIdx;
        const isPast = i < microIdx;
        return (
          <span
            key={label}
            style={{
              padding: "5px 10px",
              borderRadius: 14,
              fontSize: 12,
              fontFamily: "monospace",
              fontWeight: "bold",
              background: isCurrent ? `${C.green}33` : isPast ? `${C.green}18` : C.panel,
              border: `1px solid ${isCurrent ? C.green : isPast ? `${C.green}66` : C.border}`,
              color: isCurrent ? C.green : isPast ? C.green : C.muted,
            }}
          >
            {i + 1}. {label}
          </span>
        );
      })}
      <span style={{ color: C.muted, fontSize: 12, fontFamily: "monospace", marginLeft: 8 }}>
        Request {reqIdx + 1}/8 · step {microIdx + 1}/{totalMicro}
      </span>
    </div>
  );
}

export default function LlmDInActionPage() {
  const allSteps = useMemo(() => {
    const caches = Array.from({ length: POD_COUNT }, () => new Set());
    return PLAN.map((plan, reqIdx) => {
      const req = REQUESTS[reqIdx];
      const cachesBefore = caches.map((s) => new Set(s));
      const micro = buildMicroSteps(req, plan, cachesBefore);
      caches[plan.pod].add(req.key);
      return { reqIdx, req, plan, micro };
    });
  }, []);

  const flatSteps = useMemo(
    () => allSteps.flatMap((r) => r.micro.map((m, mi) => ({ ...m, reqIdx: r.reqIdx, req: r.req, plan: r.plan, microIdx: mi, totalMicro: r.micro.length }))),
    [allSteps]
  );

  const [stepIdx, setStepIdx] = useState(-1);
  const [phase, setPhase] = useState("idle");
  const [animT, setAnimT] = useState(0);
  const [events, setEvents] = useState([]);
  const [playing, setPlaying] = useState(false);

  const runningRef = useRef(false);
  const playingRef = useRef(false);
  const sessionRef = useRef(0);

  const current = stepIdx >= 0 ? flatSteps[stepIdx] : null;
  const completed = stepIdx >= flatSteps.length - 1 && phase === "done";
  const isAnimating = phase === "animating";
  const doneCount = stepIdx < 0 ? 0 : phase === "done" ? stepIdx + 1 : stepIdx;

  const reset = useCallback(() => {
    sessionRef.current += 1;
    runningRef.current = false;
    playingRef.current = false;
    setStepIdx(-1);
    setPhase("idle");
    setAnimT(0);
    setEvents([]);
    setPlaying(false);
  }, []);

  const runStep = useCallback(async (index, session) => {
    if (session !== sessionRef.current) return false;
    if (runningRef.current) return false;
    runningRef.current = true;

    const step = flatSteps[index];
    setStepIdx(index);
    setPhase("animating");
    setAnimT(0);

    try {
      await animateValue(setAnimT, PHASE_ANIM_MS);
      if (session !== sessionRef.current) return false;
      setEvents((prev) => {
        if (prev.some((e) => e.id === index)) return prev;
        return [
          {
            id: index,
            color: step.isHit ? C.green : step.isHit === false ? C.orange : C.purple,
            prefix: `${step.req.prompt.label} ·`,
            text: step.log,
          },
          ...prev,
        ].slice(0, 20);
      });
      setPhase("done");
      return true;
    } finally {
      runningRef.current = false;
    }
  }, [flatSteps]);

  const runFrom = useCallback(
    async (start, session) => {
      for (let i = start; i < flatSteps.length; i++) {
        if (session !== sessionRef.current || !playingRef.current) break;
        await runStep(i, session);
        if (i < flatSteps.length - 1) {
          await delay(STEP_GAP_MS);
          if (session !== sessionRef.current || !playingRef.current) break;
        }
      }
      if (session === sessionRef.current) {
        setPlaying(false);
        playingRef.current = false;
      }
    },
    [runStep]
  );

  const step = useCallback(async () => {
    if (runningRef.current) return;
    const next = stepIdx + 1;
    if (next >= flatSteps.length) return;
    setPlaying(false);
    playingRef.current = false;
    await runStep(next, sessionRef.current);
  }, [runStep, stepIdx, flatSteps.length]);

  const startPlay = useCallback(async () => {
    if (runningRef.current) return;
    if (stepIdx >= flatSteps.length - 1 && phase === "done") {
      reset();
      await delay(50);
    }
    const session = sessionRef.current;
    playingRef.current = true;
    setPlaying(true);
    const start = stepIdx < 0 ? 0 : phase === "done" ? stepIdx + 1 : stepIdx;
    if (start >= flatSteps.length) return;
    await runFrom(start, session);
  }, [phase, stepIdx, reset, runFrom, flatSteps.length]);

  useEffect(() => {
    const session = sessionRef.current;
    playingRef.current = true;
    setPlaying(true);
    runFrom(0, session);
    return () => {
      sessionRef.current += 1;
      playingRef.current = false;
      runningRef.current = false;
    };
  }, [runFrom]);

  return (
    <PageShell>
      <PagePanel borderColor={C.purple}>
        <PageHeader
          color={C.purple}
          title="Intelligent Routing in Action — llm-d Internals"
          description="Watch the same 8 client prompts traverse the official llm-d architecture: Client → Router (Proxy + EPP via ext-proc) → InferencePool Model Servers. The EPP runs scrapers, filters, and scorers for KV-cache-aware endpoint selection."
        />

        <PageLayout
          main={
            <>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 16, padding: "16px 20px", background: `${C.bg}88`, borderRadius: 12, border: `1px solid ${C.border}` }}>
                <Stat label="Micro-steps" value={`${doneCount} / ${flatSteps.length}`} color={C.purple} />
                <Stat label="Requests" value={`${current ? current.reqIdx + 1 : 0} / 8`} color={C.cyan} />
                <Stat label="Active component" value={current?.component ?? "—"} color={C.green} />
                <Stat label="Target replica" value={current?.winnerPod != null ? `Pod ${current.winnerPod + 1}` : "—"} color={C.gold} />
              </div>

              {current && (
                <ComponentTrack microIdx={current.microIdx} totalMicro={current.totalMicro} reqIdx={current.reqIdx} />
              )}

              <div style={{ marginBottom: 16, padding: "20px 24px", background: `${C.purple}08`, border: `1px solid ${C.purple}44`, borderRadius: 14 }}>
                {current ? (
                  <>
                    <div style={{ color: C.purple, fontFamily: "monospace", fontSize: 22, fontWeight: "bold", marginBottom: 12 }}>
                      {current.title}
                    </div>
                    <ArchitectureDiagram
                      activeComponent={current.component}
                      packetT={animT}
                      currentReq={current.req}
                      winnerPod={current.winnerPod ?? current.plan.pod}
                      scores={current.scores}
                      animT={animT}
                    />
                    <p style={{ color: C.text, fontSize: 16, fontFamily: "monospace", lineHeight: 1.75, margin: "16px 0 0", borderLeft: `4px solid ${C.purple}66`, paddingLeft: 14 }}>
                      {current.explain}
                    </p>
                  </>
                ) : (
                  <div style={{ padding: 40, textAlign: "center", color: C.dim, fontSize: 16, fontFamily: "monospace" }}>
                    Auto-playing llm-d routing micro-steps…
                  </div>
                )}
              </div>

              <SectionLabel>llm-d COMPONENT MAP (per architecture)</SectionLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {COMPONENTS.map((c) => {
                  const lit = current?.component === c.id;
                  return (
                    <span
                      key={c.id}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        fontSize: 13,
                        fontFamily: "monospace",
                        fontWeight: "bold",
                        background: lit ? `${c.color}28` : C.panel,
                        border: `1px solid ${lit ? c.color : C.border}`,
                        color: lit ? c.color : C.muted,
                      }}
                    >
                      {c.label}
                    </span>
                  );
                })}
              </div>

              <SectionLabel>8 CLIENT PROMPTS — routing outcomes</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
                {PLAN.map((r, i) => {
                  const isCurrent = current?.reqIdx === i;
                  const isPast = current && current.reqIdx > i;
                  return (
                    <div
                      key={i}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: isCurrent ? `${POD_META[r.pod].color}22` : isPast ? C.dim : C.panel,
                        border: `1px solid ${isCurrent ? POD_META[r.pod].color : C.border}`,
                      }}
                    >
                      <div style={{ color: POD_META[r.pod].color, fontSize: 13, fontWeight: "bold", fontFamily: "monospace" }}>
                        {r.prompt.label} → Pod {r.pod + 1}
                      </div>
                      <div style={{ color: C.muted, fontSize: 11, fontFamily: "monospace", marginTop: 4 }}>
                        {r.routeReason} · {r.isHitPredicted ? "KV hit" : "cold"}
                      </div>
                    </div>
                  );
                })}
              </div>

              {completed && (
                <div style={{ padding: "18px 22px", background: `${C.green}11`, border: `1px solid ${C.green}44`, borderRadius: 12 }}>
                  <div style={{ color: C.green, fontSize: 16, fontWeight: "bold", fontFamily: "monospace", marginBottom: 8 }}>
                    llm-d ROUTING COMPLETE
                  </div>
                  <div style={{ color: C.muted, fontSize: 15, fontFamily: "monospace", lineHeight: 1.7 }}>
                    All 8 prompts routed through the llm-d Router: Proxy consulted EPP via ext-proc,
                    scrapers/filters/scorers selected optimal InferencePool replicas.
                    Repeats (Q5–Q8) were cache-aware routed back to pods holding matching KV blocks.
                  </div>
                </div>
              )}
            </>
          }
          sidebar={
            <SidebarControls
              events={events}
              playing={playing}
              completed={completed}
              isAnimating={isAnimating}
              onPlay={() => { playingRef.current = true; startPlay(); }}
              onPause={() => { setPlaying(false); playingRef.current = false; }}
              onStep={step}
              onReset={reset}
            />
          }
        />
      </PagePanel>
    </PageShell>
  );
}
