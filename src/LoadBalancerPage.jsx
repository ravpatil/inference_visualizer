import { useState, useEffect, useRef, useCallback } from "react";
import {
  STEP_GAP_MS,
  ROUTE_MS,
  PREFILL_ANIM_MS,
  DECODE_ANIM_MS,
  HIT_PAUSE_MS,
  PageShell,
  PageLayout,
  PagePanel,
  PageHeader,
  SectionLabel,
  SidebarControls,
} from "./demoShared.jsx";

const C = {
  bg: "#050a0f",
  panel: "#0a1520",
  border: "#1a3050",
  dim: "#1c3a5c",
  text: "#c8dff0",
  muted: "#4a7a9b",
  purple: "#8b5cf6",
  cyan: "#06b6d4",
  green: "#22c55e",
  gold: "#f59e0b",
  orange: "#f97316",
  red: "#ef4444",
  kv: "#a78bfa",
};

const POD_COUNT = 4;
const PREFILL_MS = 84;

const POD_META = [
  { id: 0, name: "vLLM Pod 1", color: C.cyan },
  { id: 1, name: "vLLM Pod 2", color: C.purple },
  { id: 2, name: "vLLM Pod 3", color: C.green },
  { id: 3, name: "vLLM Pod 4", color: C.orange },
];

const PROMPTS = {
  summarize: { label: "Q1", text: "Summarize quarterly report", short: "Summarize" },
  code: { label: "Q2", text: "Review my Python code", short: "Code review" },
  translate: { label: "Q3", text: "Translate email to French", short: "Translate" },
  explain: { label: "Q4", text: "Explain quantum computing", short: "Explain" },
  rag: { label: "Q5", text: "Answer from knowledge base", short: "RAG query" },
  sql: { label: "Q6", text: "Generate SQL for analytics", short: "SQL gen" },
  chat: { label: "Q7", text: "Continue chat conversation", short: "Chat cont." },
  classify: { label: "Q8", text: "Classify support ticket", short: "Classify" },
};

// 8 request slots (Q1–Q8). Prompts 5–8 repeat 1–4 in shuffled order so round-robin
// routes duplicates to a different pod than the first time → KV cache miss + prefill.
const REQUESTS = [
  { key: "summarize", slot: "Q1" },
  { key: "code", slot: "Q2" },
  { key: "translate", slot: "Q3" },
  { key: "explain", slot: "Q4" },
  { key: "code", slot: "Q5" },
  { key: "summarize", slot: "Q6" },
  { key: "explain", slot: "Q7" },
  { key: "translate", slot: "Q8" },
].map((r, i) => ({
  ...r,
  id: i + 1,
  pod: i % POD_COUNT,
  prompt: { ...PROMPTS[r.key], label: r.slot },
}));

function GlowButton({ onClick, color, children, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? C.dim : `${color}22`,
        border: `1px solid ${disabled ? C.border : `${color}88`}`,
        color: disabled ? C.muted : color,
        fontFamily: "monospace",
        fontSize: 15,
        fontWeight: "bold",
        padding: "12px 20px",
        borderRadius: 8,
        cursor: disabled ? "not-allowed" : "pointer",
        letterSpacing: "0.05em",
        transition: "all 0.2s",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          color: C.muted,
          fontSize: 12,
          fontFamily: "monospace",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </span>
      <span style={{ color, fontFamily: "monospace", fontSize: 18, fontWeight: "bold" }}>{value}</span>
    </div>
  );
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function animateValue(setter, durationMs) {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      setter(t);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

export default function LoadBalancerPage() {
  const [reqIdx, setReqIdx] = useState(-1);
  const [phase, setPhase] = useState("idle");
  const [packetT, setPacketT] = useState(0);
  const [prefillT, setPrefillT] = useState(0);
  const [podCaches, setPodCaches] = useState(() => Array.from({ length: POD_COUNT }, () => new Set()));
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState({ hits: 0, misses: 0, prefills: 0, wastedMs: 0 });
  const [playing, setPlaying] = useState(false);
  const [rrPointer, setRrPointer] = useState(0);
  const [activePod, setActivePod] = useState(null);
  const [currentMiss, setCurrentMiss] = useState(false);

  const podCachesRef = useRef(podCaches);
  const runningRef = useRef(false);
  const playingRef = useRef(false);

  useEffect(() => {
    podCachesRef.current = podCaches;
  }, [podCaches]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const reset = useCallback(() => {
    runningRef.current = false;
    const empty = Array.from({ length: POD_COUNT }, () => new Set());
    podCachesRef.current = empty;
    setReqIdx(-1);
    setPhase("idle");
    setPacketT(0);
    setPrefillT(0);
    setPodCaches(empty);
    setEvents([]);
    setStats({ hits: 0, misses: 0, prefills: 0, wastedMs: 0 });
    setPlaying(false);
    setRrPointer(0);
    setActivePod(null);
    setCurrentMiss(false);
  }, []);

  const dispatchRequest = useCallback(async (index) => {
    if (runningRef.current) return;
    runningRef.current = true;

    const req = REQUESTS[index];
    const pod = req.pod;
    const isHit = podCachesRef.current[pod].has(req.key);

    setReqIdx(index);
    setActivePod(pod);
    setCurrentMiss(!isHit);
    setPhase("route");
    setPacketT(0);
    setPrefillT(0);

    await animateValue(setPacketT, ROUTE_MS);

    setPhase("prefill");
    if (!isHit) {
      await animateValue(setPrefillT, PREFILL_ANIM_MS);
    } else {
      await delay(HIT_PAUSE_MS);
    }
    await animateValue(() => {}, DECODE_ANIM_MS);

    setPodCaches((prev) => {
      const next = prev.map((s) => new Set(s));
      next[pod].add(req.key);
      podCachesRef.current = next;
      return next;
    });

    setStats((prev) => ({
      hits: prev.hits + (isHit ? 1 : 0),
      misses: prev.misses + (isHit ? 0 : 1),
      prefills: prev.prefills + (isHit ? 0 : 1),
      wastedMs: prev.wastedMs + (isHit ? 0 : PREFILL_MS),
    }));

    setEvents((prev) => [
      {
        id: index,
        req,
        pod,
        isHit,
        text: isHit
          ? `${req.prompt.label} (${req.prompt.short}) → Pod ${pod + 1}: cache HIT — KV reused, skip prefill`
          : `${req.prompt.label} (${req.prompt.short}) → Pod ${pod + 1}: cache MISS — full prefill recomputed (${PREFILL_MS}ms)`,
      },
      ...prev,
    ].slice(0, 12));

    setPhase("done");
    setActivePod(null);
    setRrPointer((pod + 1) % POD_COUNT);
    runningRef.current = false;
  }, []);

  const runFrom = useCallback(
    async (startIndex) => {
      for (let i = startIndex; i < REQUESTS.length; i++) {
        if (!playingRef.current && i > startIndex) break;
        await dispatchRequest(i);
        if (i < REQUESTS.length - 1) {
          await delay(STEP_GAP_MS);
          if (!playingRef.current) break;
        }
      }
      setPlaying(false);
    },
    [dispatchRequest]
  );

  const step = useCallback(async () => {
    if (runningRef.current) return;
    const next = reqIdx + 1;
    if (next >= REQUESTS.length) return;
    setPlaying(false);
    await dispatchRequest(next);
  }, [dispatchRequest, reqIdx]);

  const startPlay = useCallback(async () => {
    if (runningRef.current) return;
    const start = reqIdx >= REQUESTS.length - 1 && phase === "done" ? 0 : Math.max(0, reqIdx + (phase === "done" ? 1 : 0));
    if (start === 0 && (reqIdx >= REQUESTS.length - 1 || reqIdx === -1)) {
      if (reqIdx >= REQUESTS.length - 1) reset();
      await delay(50);
    }
    setPlaying(true);
    playingRef.current = true;
    await runFrom(start === 0 && reqIdx === -1 ? 0 : start);
  }, [phase, reqIdx, reset, runFrom]);

  const W = 720;
  const lbX = W / 2;
  const lbY = 72;
  const podY = 210;
  const podXs = [110, 250, 390, 530];
  const clientX = 36;
  const clientY = 72;

  const currentReq = reqIdx >= 0 ? REQUESTS[reqIdx] : null;
  const targetPodX = currentReq ? podXs[currentReq.pod] : lbX;
  const isAnimating = phase === "route" || phase === "prefill";
  const completed = reqIdx >= REQUESTS.length - 1 && phase === "done";
  const doneCount = reqIdx < 0 ? 0 : phase === "done" ? reqIdx + 1 : reqIdx;

  const packetPos =
    packetT > 0 && currentReq
      ? (() => {
          const t = easeOutCubic(packetT);
          if (t < 0.45) {
            const seg = t / 0.45;
            return { x: lerp(clientX, lbX, seg), y: lerp(clientY, lbY, seg) };
          }
          const seg = (t - 0.45) / 0.55;
          return { x: lerp(lbX, targetPodX, seg), y: lerp(lbY, podY, seg) };
        })()
      : null;

  return (
    <PageShell>
      <style>{`
        @keyframes pulseMiss {
          0%, 100% { filter: drop-shadow(0 0 2px rgba(239,68,68,0.4)); }
          50% { filter: drop-shadow(0 0 10px rgba(239,68,68,0.7)); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <PagePanel borderColor={C.red}>
        <PageHeader
          color={C.red}
          title="Naive Round-Robin Load Balancer"
          description="Eight client prompts hit a stateless round-robin balancer across four vLLM pods. KV cache lives on each pod — when the same prompt is routed to a different pod, the cache is cold and the full prefill runs again."
        />

        <PageLayout
          main={
            <>
        <div
          style={{
            display: "flex",
            gap: 20,
            flexWrap: "wrap",
            marginBottom: 20,
            padding: "16px 20px",
            background: `${C.bg}88`,
            borderRadius: 12,
            border: `1px solid ${C.border}`,
          }}
        >
          <Stat label="Requests" value={`${doneCount} / 8`} color={C.cyan} />
          <Stat label="Cache hits" value={stats.hits} color={C.green} />
          <Stat label="Cache misses" value={stats.misses} color={C.red} />
          <Stat label="Prefill recomputes" value={stats.prefills} color={C.orange} />
          <Stat label="Wasted prefill" value={`${stats.wastedMs} ms`} color={C.gold} />
          <Stat label="Next pod (RR)" value={`Pod ${((reqIdx + 1) % POD_COUNT) + 1}`} color={C.purple} />
        </div>

        <svg width="100%" viewBox={`0 0 ${W} 280`} style={{ display: "block", marginBottom: 20, minHeight: 320 }}>
          <rect x={8} y={48} width={56} height={48} rx={8} fill={C.panel} stroke={C.border} strokeWidth={1} />
          <text x={36} y={68} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">
            CLIENTS
          </text>
          <text x={36} y={84} textAnchor="middle" fill={C.text} fontSize={10} fontFamily="monospace">
            8 reqs
          </text>

          <rect
            x={lbX - 70}
            y={lbY - 28}
            width={140}
            height={56}
            rx={10}
            fill={`${C.gold}18`}
            stroke={C.gold}
            strokeWidth={1.5}
          />
          <text x={lbX} y={lbY - 6} textAnchor="middle" fill={C.gold} fontSize={11} fontFamily="monospace" fontWeight="bold">
            LOAD BALANCER
          </text>
          <text x={lbX} y={lbY + 12} textAnchor="middle" fill={C.muted} fontSize={9} fontFamily="monospace">
            round-robin · no stickiness
          </text>
          <circle cx={lbX + 52} cy={lbY - 18} r={10} fill={C.panel} stroke={C.gold} strokeWidth={1} />
          <line
            x1={lbX + 52}
            y1={lbY - 18}
            x2={lbX + 52 + 7 * Math.cos((rrPointer / POD_COUNT) * Math.PI * 2 - Math.PI / 2)}
            y2={lbY - 18 + 7 * Math.sin((rrPointer / POD_COUNT) * Math.PI * 2 - Math.PI / 2)}
            stroke={C.gold}
            strokeWidth={2}
          />

          {podXs.map((px, i) => (
            <path
              key={i}
              d={`M ${lbX} ${lbY + 28} Q ${lbX} ${podY - 40} ${px} ${podY - 52}`}
              fill="none"
              stroke={activePod === i && isAnimating ? C.gold : C.dim}
              strokeWidth={activePod === i && isAnimating ? 2 : 0.8}
              strokeDasharray={activePod === i && isAnimating ? "none" : "4,6"}
              opacity={0.7}
            />
          ))}

          {POD_META.map((pod, i) => {
            const px = podXs[i];
            const isActive = activePod === i;
            const isPrefilling = isActive && phase === "prefill" && currentMiss;
            const cacheKeys = [...podCaches[i]];

            return (
              <g key={pod.id} style={isPrefilling ? { animation: "pulseMiss 0.8s ease-in-out infinite" } : undefined}>
                <rect
                  x={px - 58}
                  y={podY - 52}
                  width={116}
                  height={118}
                  rx={10}
                  fill={C.panel}
                  stroke={isActive ? pod.color : C.border}
                  strokeWidth={isActive ? 2 : 1}
                />
                <text x={px} y={podY - 34} textAnchor="middle" fill={pod.color} fontSize={10} fontFamily="monospace" fontWeight="bold">
                  {pod.name}
                </text>
                <text x={px} y={podY - 20} textAnchor="middle" fill={C.muted} fontSize={8} fontFamily="monospace">
                  local KV cache
                </text>

                {cacheKeys.length === 0 ? (
                  <text x={px} y={podY + 4} textAnchor="middle" fill={C.dim} fontSize={8} fontFamily="monospace">
                    (empty)
                  </text>
                ) : (
                  cacheKeys.slice(0, 4).map((key, ci) => (
                    <g key={key}>
                      <rect
                        x={px - 48}
                        y={podY - 8 + ci * 16}
                        width={96}
                        height={13}
                        rx={3}
                        fill={`${C.kv}22`}
                        stroke={C.kv}
                        strokeWidth={0.5}
                      />
                      <text x={px} y={podY + 2 + ci * 16} textAnchor="middle" fill={C.kv} fontSize={7} fontFamily="monospace">
                        {PROMPTS[key].short}
                      </text>
                    </g>
                  ))
                )}

                {isPrefilling && (
                  <>
                    <rect x={px - 50} y={podY + 48} width={100} height={6} rx={3} fill={C.dim} />
                    <rect x={px - 50} y={podY + 48} width={100 * prefillT} height={6} rx={3} fill={C.red} />
                    <text x={px} y={podY + 64} textAnchor="middle" fill={C.red} fontSize={8} fontFamily="monospace">
                      PREFILL RECOMPUTE
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {packetPos && currentReq && (
            <g>
              <circle
                cx={packetPos.x}
                cy={packetPos.y}
                r={10}
                fill={`${POD_META[currentReq.pod].color}55`}
                stroke={POD_META[currentReq.pod].color}
                strokeWidth={2}
              />
              <text x={packetPos.x} y={packetPos.y + 4} textAnchor="middle" fill="#fff" fontSize={8} fontFamily="monospace" fontWeight="bold">
                {currentReq.prompt.label}
              </text>
            </g>
          )}
        </svg>

        <div style={{ marginBottom: 16 }}>
          <SectionLabel>REQUEST QUEUE — 8 prompts, round-robin to 4 pods (Q5–Q8 repeat Q2–Q4 on new pods)</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {REQUESTS.map((req, i) => {
              const isCurrent = i === reqIdx && isAnimating;
              const isPast = i < reqIdx || (i === reqIdx && phase === "done");
              const podColor = POD_META[req.pod].color;
              const isRepeat = i >= 4;
              return (
                <div
                  key={i}
                  style={{
                    background: isCurrent ? `${podColor}22` : isPast ? C.dim : C.panel,
                    border: `1px solid ${isCurrent ? podColor : C.border}`,
                    borderRadius: 8,
                    padding: "8px 10px",
                    opacity: !isPast && !isCurrent && reqIdx >= 0 ? 0.55 : 1,
                    transition: "all 0.3s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: podColor, fontSize: 10, fontFamily: "monospace", fontWeight: "bold" }}>
                      {req.prompt.label}
                      {isRepeat && (
                        <span style={{ color: C.orange, marginLeft: 4, fontSize: 8 }}>↻ repeat</span>
                      )}
                    </span>
                    <span style={{ color: C.muted, fontSize: 9, fontFamily: "monospace" }}>→ P{req.pod + 1}</span>
                  </div>
                  <div style={{ color: C.text, fontSize: 9, fontFamily: "monospace", lineHeight: 1.3 }}>
                    {req.prompt.text}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {completed && (
          <div
            style={{
              padding: "18px 22px",
              background: `${C.red}11`,
              border: `1px solid ${C.red}44`,
              borderRadius: 12,
            }}
          >
            <div style={{ color: C.red, fontFamily: "monospace", fontSize: 16, fontWeight: "bold", marginBottom: 8 }}>
              RESULT: KV CACHE FRAGMENTED ACROSS PODS
            </div>
            <div style={{ color: C.muted, fontSize: 15, fontFamily: "monospace", lineHeight: 1.7 }}>
              {stats.misses} of 8 requests triggered full prefill ({stats.wastedMs} ms wasted). Round-robin
              sent repeated prompts to pods that never cached them. A sticky or cache-aware router would
              reuse local KV blocks and skip redundant prefill work.
            </div>
          </div>
        )}
            </>
          }
          sidebar={
            <SidebarControls
              events={events.map((ev) => ({ ...ev, isHit: ev.isHit, text: ev.text }))}
              playing={playing}
              completed={completed}
              isAnimating={isAnimating}
              onPlay={startPlay}
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
